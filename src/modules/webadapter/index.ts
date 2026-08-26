/**
 * @description Web 面板：接 QQBot-Web-Adapter 的插件页，宿主没装时这个模块整个不会被加载
 *
 * 宿主契约（对它 index.js:307-332 与 page.md 核实过）：接口必须走 `ctx.registerApi`，
 * 它挂宿主的 Bot.express 并自动套 apiAuthGuard；`registerPage({ src, style, script })`
 * 是 iframe 模式，这三项同时是**文件访问白名单**，没列的文件一律 403；iframe 里的
 * API 前缀取宿主注入的 `?__webBase=`。
 *
 * 注意：改配置只走 saveConfig 的 yaml Document 增量改写，绝不 YAML.stringify 整份覆盖 ——
 * 那会抹掉用户写在配置里的注释
 * 注意：热生效必须走 applyConnections，面板不自己组合停起 —— 路由仲裁是全局的，
 * 手工停起表达不了「删掉冲突的那条会让被顶掉的另一条活过来」这种连带影响
 */
import {
  accountPlatform,
  config,
  configFile,
  saveConfig,
  getWsConnections,
  appendConnection,
  updateConnection,
  removeConnection,
  enabled,
  wsEnabled,
  withPlatform,
  profileWithPlatform,
  type ConnectionPatch,
} from "@/config"
import { UNIT_FIELDS, boundsError, toDisplay, toStored } from "@/config/units.js"
import { applyConnections, clients, reloadClients } from "@/modules/client"
import {
  effectiveAccounts,
  expandConnections,
  isAutomaticEndpoint,
  requireAccounts,
} from "@/modules/client/expand"
import { snapshot, forName } from "@/modules/stats/index.js"
import { passiveCount } from "@/modules/passive/index.js"
import {
  findSameCore,
  inlineToken,
  mergeEndpointQuery,
  normalizeEndpoint,
  redactUrl,
  requireWsUrl,
} from "@/utils/url"
import { readIds } from "@/utils/ids"
import { writeAccountBotId, writeAccountBotIds } from "@/config/botmap"
import { getBot, onlineBots, qqAvatar } from "@/utils/bots.js"
import { restartFileServer } from "@/utils/fileServer.js"
// 三个「效力值」直接问下游要：面板要显示实际生效的那个数，各自再写一遍 `|| 默认` 就会漂
import { fileMaxSize, linkExpire, mediaMaxSize } from "@/utils/media.js"
import { DEFAULT_MAX_RECONNECT, STATUS_TEXT, pickByStatus } from "@/constants"
import { makeLog } from "@/utils/compat"
import { versionLabel } from "@/modules/render/version.js"
import { PLUGIN_LOGO } from "@/modules/render/assets.js"
import { PluginName, ResPath, YunzaiPath } from "@/dir"
import type { RuntimeWsConnection, WsConnection } from "@/types"
import type { BotProfile, ConnView, Payload, RuntimeConnView, TargetsPayload } from "@/webui/api.js"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/* ---------- 宿主契约 ---------- */

/**
 * @description 宿主传进来的 express req / res，只按实际用到的成员声明
 * 注意：别图省事标成 any —— 那样 `res.jsno(...)` 这种拼错也不会报。本仓库不装 @types/express
 */
interface WebRequest {
  /** 已被宿主的 body 解析中间件填好；面板送的是任意 JSON，先过 safeBody */
  body?: unknown
  [k: string]: any
}

interface WebResponse {
  json(data: unknown): unknown
  status(code: number): WebResponse
  setHeader(name: string, value: string): unknown
  end(data?: unknown): unknown
  [k: string]: any
}

/**
 * @description 宿主注入的上下文（index.js:307-332 调 `init(ctx)`）
 * 注意：路由必须从 registerApi 注册，不能自己碰 Bot.express —— 只有它会套上 apiAuthGuard
 */
interface WebCtx {
  registerPage(desc: Record<string, unknown>): unknown
  registerApi(
    method: "get" | "post",
    route: string,
    handler: (req: WebRequest, res: WebResponse) => unknown,
  ): unknown
  /** 宿主的 logger，未必存在，调用点一律 `?.` */
  logger?: { warn?: (msg: string) => unknown; [k: string]: any }
  [k: string]: any
}

/**
 * @description 面板送上来的请求体，字段一律 unknown
 * 前端表单的值形状不受我们控制（空串、"true"、数字字符串），由 {@link bool} / {@link num}
 * / `String()` 在使用点归一化
 */
type PanelBody = Record<string, unknown>

/** 原型链污染防护：这三个键写进配置对象会污染 Object.prototype */
const BAD_KEYS = ["__proto__", "prototype", "constructor"]

/**
 * @description 面板与回包话术里显示的连接名，没起名字的用脱敏后的地址
 * 注意：一律先过 redactUrl —— 凭据可能只内联在地址的 `?token=` 里（normalizeEndpoint 保留查询串），
 * 而这个串会进面板卡片与 POST 回包
 */
function label(conf: WsConnection): string {
  return conf.name || redactUrl(conf.url)
}

/**
 * @description 一条连接的绑定候选：在线的全部机器人 ∪ 本连接已绑定的账号
 * 只给已绑定的就没法绑新号，只给在线的又没法解绑一个已离线的号。
 * 注意：刻意不减掉 exclude —— 被排除的号也要留在候选里，否则面板上没有任何地方能把它放回来
 * （那一行另挂 {@link ConnView.conflicts} 标记说明它绑了但不会连）
 * @param online 在线清单由 payload() 取一次传进来：每条连接各问一遍等于把 Bot.uin 走 N+1 遍、每个账号重建一份档案，
 *   而面板开着时这个接口 10s 一轮
 */
function bindBots(conf: WsConnection, online: BotProfile[]): BotProfile[] {
  // 在线的排前面：union 的顺序就是显示顺序，先在线后离线才好扫
  const ids = [...new Set([...online.map(p => p.id), ...readIds(conf.bind)])]
  return ids.map(id => profileWithPlatform(id))
}

/**
 * @description 连接的可序列化视图，逐字段挑出来给前端
 * 注意：不要整个 conf 扔给前端 —— 里面有 token，面板只拿 has_token 表示「配没配」。
 * 返回类型标成 {@link ConnView}，字段改了名编译期就在这里报
 *
 * @param runtime 本条连接派生出的运行时连接，由 payload() 一次展开后按 sourceIndex 分好
 * @param online 在线机器人清单，由 payload() 取一次后传给每条连接，见 {@link bindBots}
 */
function connView(
  conf: WsConnection,
  i: number,
  runtime: RuntimeWsConnection[],
  online: BotProfile[],
): ConnView {
  const enabled = conf.enable !== false
  const views: RuntimeConnView[] = runtime.map(rt => {
    // 注意：相邻两行故意用两个键 —— 活客户端按 runtimeKey 认（改名与位移都不动它，按名字
    // 找会让改名那一瞬把连着的连接显示成「未启动」），计数按 runtimeName 取（stats 的分桶
    // 键就是运行时名字，换成 runtimeKey 取不到桶且不报错）
    const live = clients.find(c => c.runtimeKey === rt.runtimeKey)
    const counters = forName(rt.runtimeName)
    return {
      account: rt.account ?? undefined,
      name: rt.runtimeName,
      // 只给 pathname：runtimeUrl 本身已净化，但不取整串，免得上游哪天把鉴权参数放回地址里
      path: new URL(rt.runtimeUrl).pathname || "/",
      status: live?.status ?? 0,
      // 注意：不用 client.statusText —— 它为文字指令服务，把重连次数拼进了括号，
      // 而前端已按 retry 字段单独渲了一个「已重连 N 次」标签
      status_text: !enabled ? "已停用" : live ? STATUS_TEXT[live.status] : "未启动",
      retry: live?.retry ?? 0,
      up: counters.up + counters.event,
      down: counters.down,
    }
  })
  // 「配了哪些账号」与「哪些账号真会连」不是一回事：exclude 优先级高于 bind，两边都写的号
  // 留在 bind 里却永远派生不出运行时连接，所以两个集合都回，前端才不会画成绿着却不连的开关
  const { accounts, conflicts } = effectiveAccounts(conf)
  // 顶行只能显示一个状态，按 STATUS_ORDER 挑代表，不让一条 0 盖掉另一条正在连的 2。
  // 注意：规则与状态图（render/pages.ts 的 collect）共用，各写一遍就会出现两处说法不一致
  const lead = pickByStatus(views)
  return {
    index: i,
    name: label(conf),
    // 地址脱敏后再回：token 可能只内联在 url 里，见 label() 的说明
    url: conf.url ? redactUrl(conf.url) : "",
    enable: enabled,
    /**
     * @description 只说明有没有配 token，不回原值；内联在地址里的也算配了
     * 注意：不看运行时那层的内联标志 —— 停用的连接零条运行时连接，那个标志恒为 false，
     * 会对一条配过 token 的连接报「没配 token」
     */
    has_token: !!conf.token || inlineToken(conf.url) !== null,
    reconnect_interval: Number(conf.reconnect_interval) || 5,
    // 字段缺失时回默认次数而不是 0：面板上那个数字就是运行时真正用的值，回 0 会显示成「无限重连」
    max_reconnect_attempts: Number(conf.max_reconnect_attempts ?? DEFAULT_MAX_RECONNECT),
    bind: Array.isArray(conf.bind) ? conf.bind : [],
    exclude: Array.isArray(conf.exclude) ? conf.exclude : [],
    accounts,
    conflicts,
    bind_bots: bindBots(conf, online),
    // 自动端点与兼容连接在「关掉最后一个绑定」上的后果完全不同（前者被 requireAccounts 拒、
    // 后者变成不限账号），判定跟着视图回，不让前端自己看 url 猜
    automatic: isAutomaticEndpoint(conf),
    runtime: views,
    // 逻辑连接的状态是聚合值：任一账号连上就算这个核心通了（明细在 runtime 里逐条给）
    status: lead?.status ?? 0,
    // 「已停用」与「未启动」在状态码上都是 0，但成因不同，前端要分开显示
    status_text: !enabled ? "已停用" : (lead?.status_text ?? "未启动"),
    // 各账号里最差的那个重连次数：这一行的用途是「这条核心有账号在挣扎」，
    // 与 status 同时看会显得矛盾，逐账号的准确值在 runtime 里
    retry: views.reduce((n, v) => Math.max(n, v.retry), 0),
    up: views.reduce((n, v) => n + v.up, 0),
    down: views.reduce((n, v) => n + v.down, 0),
  }
}

/** 保证是数组，且不改元素类型：群号在 yaml 里写成数字就是数字，String 化会让前端回传时改掉落盘格式 */
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

/**
 * @description 全局设置区，按 {@link PayloadConfig} 逐字段挑出来
 *
 * 注意：三栏过 toDisplay 换成面板单位（MB / 秒），落盘仍是字节 / 毫秒 —— 换算只在服务端做，
 * 前端跟着换会与 boundsError 那道校验各持一种口径
 * 注意：回的是**效力值**不是 yaml 原值 —— 那三栏写 0 或缺省时下游按「没配」跑默认值，
 * 所以直接问下游那三个函数要，别在这里另写一遍 `|| 默认`（写两遍就会漂）
 * 注意：默认 true 的项写 `!== false`、默认 false 的写 `=== true`，两者不能互换 ——
 * 判据要与下游读它的那句一致，否则面板显示的开合与实际行为相反
 */
function configView(): Payload["config"] {
  // 不叫 fs：这个文件顶上 import 了 node:fs，同名会把 logo 那条路由的 readFileSync 遮掉
  const srv = config.file_server || {}
  const up = config.update_check || {}
  const f = config.filter || {}
  return {
    enable: enabled(),
    media_max_size: toDisplay("media_max_size", mediaMaxSize()) as number,
    file_max_size: toDisplay("file_max_size", fileMaxSize()) as number,
    link_expire: toDisplay("link_expire", linkExpire()) as number,
    log_truncate: config.log_truncate !== false,
    notify_master: config.notify_master === true,
    // 模块路径不是凭据，原样回 —— 面板要能显示当前填的是哪个文件，否则改一次就得重填
    upload_hook: String(config.upload_hook || ""),
    client: {
      heartbeat: Number(config.client?.heartbeat) || 0,
      heartbeat_timeout: Number(config.client?.heartbeat_timeout) || 0,
      enable_ws: wsEnabled(),
    },
    filter: {
      report_private: f.report_private !== false,
      report_group: f.report_group !== false,
      report_meta: f.report_meta !== false,
      only_reply_at: f.only_reply_at === true,
      prefix: arr<string>(f.prefix),
      block_prefix: arr<string>(f.block_prefix),
      block_include: arr<string>(f.block_include),
      white_group: arr<string | number>(f.white_group),
      black_group: arr<string | number>(f.black_group),
      black_user: arr<string | number>(f.black_user),
    },
    update_check: {
      enable: up.enable === true,
      // 不套下游那个 Math.max(30, …)：面板照原值显示，被按 30 处理这件事由字段说明讲
      interval: Number(up.interval) || 180,
      delay: Number(up.delay) || 0,
      notify: up.notify !== false,
    },
    file_server: {
      enable: srv.enable !== false,
      // 0 就是「每次随机取可用端口」，是有效取值而不是没配，别兜成别的数
      port: Number(srv.port) || 0,
      host: String(srv.host || "0.0.0.0"),
      // 留空表示按 ws 连接的本机地址自动推断，没有可回的默认值
      public_host: String(srv.public_host || ""),
      once: srv.once !== false,
      // 只说明配没配，凭据绝不回前端（同连接的 has_token）
      has_imagebed_token: !!String(srv.imagebed_token || "").trim(),
    },
  }
}

/** GET 回的整包 */
function payload(): Payload {
  const stats = snapshot()
  const list = getWsConnections()
  // 展开只做一次：expandConnections 是全局裁决（路由冲突先到先得），逐条各展开一次既拿不到
  // 全局上下文，也会把同一批错误重复算 n 遍。
  // errors 必须一起回：派生不出运行时连接的连接在面板上只是停在「未启动」，原因只有这份话术
  // 说得出；它只含连接名、来源序号与 pathname，没有完整地址，可以直接回给前端
  const { runtime, errors } = expandConnections(list)
  // 在线清单取一次给全包用：bindBots 每条连接都要它，各自去问等于把 Bot.uin 走 N+1 遍、每个账号重建一份档案
  const online = onlineBots()
  const connections = list.map((c, i) =>
    connView(
      c,
      i,
      runtime.filter(r => r.sourceIndex === i),
      online,
    ),
  )
  const flat = connections.flatMap(c => c.runtime)
  return {
    ok: true,
    plugin: { name: PluginName, version: versionLabel(), configFile },
    config: configView(),
    connections,
    // 只上话术，不带 sourceIndex：前端把错误统一列在顶部一个块里，不逐卡显示。
    // 注意：skipped 必须分成两个数组 —— 红框标题是「有连接没能启动」，而警告那两条
    //（bind/exclude 撞、共享 /ws/Yunzai）之后连接照常跑，混在一起会让正常收发的连接顶着红框
    errors: errors.filter(e => e.skipped).map(e => e.message),
    warnings: errors.filter(e => !e.skipped).map(e => e.message),
    totals: {
      logical: connections.length,
      runtime: flat.length,
      connected: flat.filter(r => r.status === 1).length,
    },
    // 在线机器人清单：面板「添加绑定」的候选，含头像与昵称
    bots: online.map(withPlatform),
    stats: {
      total: stats.total,
      today: stats.today,
      since: stats.since,
      persisted: stats.persisted,
      passive: passiveCount(),
    },
  }
}

/** 按名字或 index 定位，语义与 apps/admin.ts 的 find() 一致 */
function locate(key: unknown) {
  const list = getWsConnections()
  if (typeof key === "number" && Number.isInteger(key) && key >= 0 && key < list.length)
    return { index: key, conf: list[key] }
  const i = list.findIndex(c => (c.name || c.url) === String(key))
  return i > -1 ? { index: i, conf: list[i] } : null
}

/** 布尔字段：前端可能传 "true" 这种字符串 */
function bool(v: unknown, dflt: boolean): boolean {
  if (v === undefined || v === null || v === "") return dflt
  if (typeof v === "boolean") return v
  return v === "true" || v === 1 || v === "1"
}

/**
 * @description 数字字段：留空回默认值，显式的 0 保留
 * 注意：Number("") 是 0，只判 Number.isFinite 会把「清空输入框」当成「填了 0」，
 * 而 max_reconnect_attempts 的 0 恰好是无限重连
 */
function num(v: unknown, dflt: number): number {
  if (v === undefined || v === null || v === "") return dflt
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

/**
 * @description 从请求体里取一栏，点号路径与嵌套对象两种写法都认
 * 前端字段表的 key 是 `filter.report_private` 这种点号路径，而契约类型（PayloadConfig）是嵌套的 ——
 * 两种形状都可能提交上来，在这里归一化一次，下面的白名单表就只写一遍路径。
 * 注意：返回 undefined 表示「body 里没这一栏」，写盘循环据此跳过。这就是「只写提交过的键」的判据，
 * 别改成回默认值 —— 那会让单字段保存把用户没碰过的项一起重写，写过的注释也跟着没了
 */
function pick(body: PanelBody, path: string): unknown {
  if (Object.hasOwn(body, path)) return body[path]
  let cur: unknown = body
  for (const key of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/** @description 按点号路径读当前落盘值，漂移防护与「这一栏真会改动吗」都要它 */
function stored(path: string): unknown {
  let cur: unknown = config
  for (const key of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/**
 * @description 布尔项与它在下游的缺省值
 * 注意：缺省值必须与下游读它的那句一致 —— 默认 true 的项在下游写成 `!== false`，填成 false
 * 会让「面板里没表态」被存成关闭，开合与实际行为相反
 */
const BOOL_FIELDS: [path: string, dflt: boolean][] = [
  ["enable", true],
  ["log_truncate", true],
  ["notify_master", false],
  ["client.enable_ws", true],
  ["filter.report_private", true],
  ["filter.report_group", true],
  ["filter.report_meta", true],
  ["filter.only_reply_at", false],
  ["update_check.enable", false],
  ["update_check.notify", true],
  ["file_server.enable", true],
  ["file_server.once", true],
]

/**
 * @description 整数项的下限上限，越界的话术带中文栏目名
 * 注意：interval 的下限不写 30 —— 下游是 `Math.max(30, …)` 按 30 处理而不是报错，
 * 在这里拦掉会让面板与实际行为各说一套（契约 api.ts 那一行也是这么写的）
 */
const NUM_FIELDS: { path: string; label: string; min: number; max?: number }[] = [
  { path: "client.heartbeat", label: "心跳间隔", min: 0 },
  { path: "client.heartbeat_timeout", label: "心跳超时", min: 0 },
  { path: "update_check.interval", label: "检查间隔", min: 1 },
  { path: "update_check.delay", label: "首次检查延迟", min: 0 },
  // 0 是「每次随机取可用端口」，是有效取值
  { path: "file_server.port", label: "文件服务端口", min: 0, max: 65535 },
]

/**
 * @description 纯文本项，写盘时统一 trim
 * host 留空等于回落到默认值（0.0.0.0），所以不拦空串；`upload_hook` 空串就是「不启用」。
 * 注意：upload_hook 也在这里，别为它单开一段一次性写法 —— 那段与本循环的循环体一字不差，
 * 而将来改 trim 规则（比如放行末尾空格的 Windows 路径）只会改到循环这一处，
 * 漏掉的那一份表现为「保存时说好、真发文件时找不到」。它的**试加载校验**在 saveConfig 之前，
 * 与写盘无关，不影响这次归并
 */
const STR_FIELDS = ["file_server.host", "file_server.public_host", "upload_hook"]

/** @description 列表项，六栏都是「原样存」的匹配规则或号码 */
const ARRAY_FIELDS = [
  "filter.prefix",
  "filter.block_prefix",
  "filter.block_include",
  "filter.white_group",
  "filter.black_group",
  "filter.black_user",
]

/**
 * @description 列表清洗：丢空项、按 String(id) 去重，值本身与类型原样留着
 * 空项不减 length 而过滤判据全是 `?.length && …`，后果全是静默的：white_group 有一个空项
 * 就会停掉全部群上报（同 config/index.ts 的 pruneFilterLists）。
 * 注意：不 trim、不改类型 —— 前缀里的空格与大小写改一个字就匹配不上，群号在 yaml 里写成数字就得存回数字
 */
function clean(list: unknown[]): unknown[] {
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const v of list) {
    if (v === null || v === undefined || v === "") continue
    const key = String(v)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/**
 * @description upload_hook 试加载：默认导出不是函数就连原因一起抛（外层 guard 转成 400）
 *
 * 注意：import 会**执行**那个模块 —— 但运行时发大文件时本来也会执行它（utils/media.ts 的
 * getUploadHook），没有新增风险；只在保存这一刻、只加载用户自己填的那个路径
 * 注意：**URL 必须与运行时那处一字不差**（`pathToFileURL(abs).href`，不带 query），路径解析也一样
 *（相对云崽根目录、取 default 或 upload）。曾经这里带过 `?t=<时间戳>` 想绕开 ESM 模块缓存，
 * 那反而是错的：运行时 import 的是不带 query 的 URL，两个 URL 在 Node 的模块注册表里是两条
 * 记录，于是「校验到的是新代码、真发文件时跑的是旧代码」—— 正好是这段注释想避免的情形。
 * 代价是改完 hook 文件后重填同一路径校验不到新代码，但运行时同样跑不到（要重启云崽才换），
 * 所以校验结果仍然如实反映「真发文件时会发生什么」，这才是这道校验的意义
 */
async function checkUploadHook(p: string): Promise<void> {
  // 空串 = 不启用，直接放过
  if (!p) return

  const abs = path.isAbsolute(p) ? p : path.join(YunzaiPath, p)
  let mod: Record<string, unknown>
  try {
    mod = await import(pathToFileURL(abs).href)
  } catch (err) {
    throw new Error(
      `加载 upload_hook 失败：${err instanceof Error ? err.message : String(err)}。留空可关掉它`,
    )
  }
  if (typeof (mod.default || mod.upload) !== "function")
    throw new Error(`upload_hook ${p} 没有默认导出函数（应为 async (buf, name) => "http…"）`)
}

/** 文件服务里「改了就得重启」的那几栏，写盘前后各取一次比对 */
function fsState() {
  const c = config.file_server || {}
  return {
    enable: c.enable !== false,
    port: Number(c.port) || 0,
    host: String(c.host || "0.0.0.0"),
  }
}

/**
 * @description 保存全局设置，只认白名单里的键并逐个 setIn
 * 注意：不整份覆盖 —— 用户没写过的项继续继承默认值，写过的注释也留着。所以单字段提交与整批
 * 提交走的是同一条路，不需要第二个接口
 * 注意：校验一律在 saveConfig 的回调里抛 —— 它先跑完回调再写文件，抛出去就是整份不写，
 * 与锅巴、#早柚设置 一致，别落一半
 */
async function saveGlobal(body: PanelBody) {
  const changed: string[] = []
  const notes: string[] = []

  // 试加载排在写盘之前：import 是异步的，而 saveConfig 的回调必须同步（yaml Document 增量改写）
  const hook = pick(body, "upload_hook")
  if (hook !== undefined) await checkUploadHook(String(hook).trim())

  // 重启判据必须在写盘前取：saveConfig 末尾就 reload 了，之后 config 里已是新值，比不出改没改
  const before = fsState()

  saveConfig(doc => {
    for (const [field, dflt] of BOOL_FIELDS) {
      const v = pick(body, field)
      if (v === undefined) continue
      doc.setIn(field.split("."), bool(v, dflt))
      changed.push(field)
    }

    for (const field of Object.keys(UNIT_FIELDS)) {
      const v = pick(body, field)
      if (v === undefined) continue
      // 第三个参数是当前落盘值，漂移防护靠它：toDisplay 收两位小数，乘回去是另一个数
      //（5000000 字节显示 4.77 MB，存回去变 5001708），少传这个参数就会让保存别的项顺手改了它
      let next = toStored(field, v, stored(field))
      // undefined 是「这一栏不写」（清空输入框发的 null），不是 0 —— 下游把 0 当「没配」跑默认值，
      // 于是面板显示 0、实际跑 10 MB
      if (next === undefined) continue

      /*
       * 漂移防护保住的有可能是一个**越界的**手写值：yaml 里 268435457（比上限多 1 字节）显示成
       * 256，用户照着 256 存回来，防护认出「显示值没变」就原样留住了那个越界数 —— 于是面板
       * 明明是唯一的编辑入口，却永远改不掉它，而校验也被一起跳过。
       * 这时改用用户填的值重算：让面板真能把它拉回合法范围。
       * 注意：不能直接报错了事 —— 那句话会变成「最多 256 MB，收到 256 MB」，用户看不懂
       */
      if (boundsError(field, next)) {
        const fresh = toStored(field, v)
        if (fresh !== undefined && !boundsError(field, fresh)) next = fresh
      }

      /*
       * 无条件校验。这里与锅巴那处刻意不同：锅巴每次保存整表回传，拦一个手写越界值会让每一次
       * 无关保存都失败；而 web 面板只提交用户动过的字段（逐字段脏集合），键出现在 body 里就说明
       * 他真的在改这一栏，那就必须拦住
       */
      const err = boundsError(field, next)
      if (err) throw new Error(err)

      doc.setIn(field.split("."), next)
      changed.push(field)
    }

    for (const { path: field, label: cn, min, max } of NUM_FIELDS) {
      const v = pick(body, field)
      if (v === undefined) continue
      // 清空输入框当「这一栏不写」而不是 0：Number("") 与 Number(null) 都是 0，
      // 而这几栏的 0 各有含义（心跳 0 是关闭、端口 0 是随机），静默存成 0 是改了行为
      if (v === null || String(v).trim() === "") continue
      const n = Number(v)
      if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${cn}应为整数`)
      if (n < min) throw new Error(`${cn}不能小于 ${min}，收到 ${n}`)
      if (max !== undefined && n > max) throw new Error(`${cn}不能大于 ${max}，收到 ${n}`)
      doc.setIn(field.split("."), n)
      changed.push(field)
    }

    for (const field of STR_FIELDS) {
      const v = pick(body, field)
      if (v === undefined) continue
      doc.setIn(field.split("."), String(v).trim())
      changed.push(field)
    }

    for (const field of ARRAY_FIELDS) {
      const v = pick(body, field)
      if (v === undefined) continue
      if (!Array.isArray(v)) throw new Error(`${field} 应为数组`)
      // createNode 而不是塞裸数组：与 updateConnection 同一套，flow 风格由写盘出口的 unflow 拍平
      doc.setIn(field.split("."), doc.createNode(clean(v)))
      changed.push(field)
    }

    /**
     * @description 图床凭据：留空 = 不修改，要清空得点显式的「清除」
     *
     * 面板拿不到原值（整包只回 has_imagebed_token），把空串当清空会让每次保存都抹掉它 ——
     * 与连接 token 的 clear_token 同一套。清除键嵌套写法与点号写法都收，前端两种都能提交。
     *
     * 注意：**填了新值就以新值为准，清除让位**。这两件事必须互斥判一次而不是写成两个前后相邻的 if：
     * 用户先点「清除」再粘一个新凭据、一起提交时（两个键都在 body 里），「先写新值、再清空」
     * 的写法会把新凭据静默丢成空串，还因为同一路径 push 两次而报「已保存 2 项」。
     * 反过来「先清空、再写新值」虽然结果对，但仍然写了两次盘、话术也仍然多算一项
     */
    const token = pick(body, "file_server.imagebed_token")
    const next = token === undefined ? "" : String(token).trim()
    const clearToken =
      pick(body, "file_server.imagebed_token_clear") ?? pick(body, "imagebed_token_clear")

    if (next) {
      doc.setIn(["file_server", "imagebed_token"], next)
      changed.push("file_server.imagebed_token")
    } else if (bool(clearToken, false)) {
      doc.setIn(["file_server", "imagebed_token"], "")
      changed.push("file_server.imagebed_token")
    }
  })

  // 注意：心跳是全局项、不在 behaviorChanged 的判据里，改了必须 reloadClients ——
  // applyConnections 会把每条客户端原地留着，实际发的还是旧间隔；其余项每条消息现读，即时生效
  // 注意：enable_ws 也靠这条前缀判据进来 —— 它改了不重载等于没生效（ws 那条通路的开合只在
  // startClients 里读一次）
  // 注意：总开关关着时不走这条路 —— startClients 尾巴上那句「没有可用连接」警告
  // 会把用户刚选的状态报得像故障
  const touchedClient = changed.some(k => k.startsWith("client."))
  if (touchedClient && enabled()) reloadClients()

  /**
   * @description 只有 port / host / enable 真的变了才重起文件服务
   * 注意：public_host / once / imagebed_token 每次请求现读，重起它们只是白作废在途外链。
   * 注意：三种结果的话术必须分开 —— `was: false` 是「本来就没在听」（TRSS 上这一节永远无效，
   * 属正常），`port: null` 而 `was: true` 是**故障**（端口被占用之类：旧服务已关、新的没起来，
   * 此后大文件外链全拿不到）。压成一句「已重启」会把故障报成成功
   * 注意：重起会作废 files 里的暂存文件（在途外链最长影响一个 link_expire），所以要说清楚，
   * 并报出新端口 —— port 写 0 时端口是随机的，用户没有别的地方能看到实际值
   */
  const after = fsState()
  if (before.port !== after.port || before.host !== after.host || before.enable !== after.enable) {
    try {
      const r = await restartFileServer()
      if (!r.was)
        notes.push(
          after.enable
            ? "已保存；内置文件服务当前没在运行（框架自带文件服务时用不到它），下次真需要外链时按新配置启动"
            : "已保存；内置文件服务本来就没在运行",
        )
      else if (!after.enable) notes.push("内置文件服务已关闭，未取走的外链已作废")
      else if (r.port === null)
        notes.push(
          `配置已保存，但文件服务没能在 ${after.host}:${after.port || "随机端口"} 上起来（端口可能被占用），` +
            "大文件外链暂时不可用，详见日志",
        )
      else notes.push(`文件服务已按新配置重启（${after.host}:${r.port}），未取走的外链已作废`)
    } catch (err) {
      // 配置已经落盘了，重起失败不该把整次保存报成失败 —— 说清楚「配置存了但服务没起来」更有用
      makeLog("error", ["重启内置文件服务失败", err], "GsCore")
      notes.push(
        `配置已保存，但文件服务没能按新配置起来：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return { changed, touchedClient, notes }
}

/** 新增连接 */
function addConnection(body: PanelBody) {
  const list = getWsConnections()
  const bind = (Array.isArray(body.bind) ? body.bind : []).map(String)
  // requireWsUrl 而不是裸 normalizeEndpoint：协议校验只有那一处，http:// 会带着换算好的
  // ws 地址抛出来，guard 转成 400 后那句话本身就是可用的建议
  const url = requireWsUrl(String(body.url ?? ""))
  const explicit = String(body.bot_id || "").trim()
  const exclude = (Array.isArray(body.exclude) ? body.exclude : []).map(String)

  // 同一核心已有自动路径的连接 → 合并 bind，不再新开一条 ws
  const existing = findSameCore(list, url)
  if (existing) {
    const idx = list.indexOf(existing)
    // 走 readIds 而不是裸 map(String)：手写配置里的 `bind: [" 111"]` 带着空白留下来，之后
    // 判重认不出它与 "111" 是同一个号
    const prev = readIds(existing.bind)
    const nextBind = [...new Set([...prev, ...bind])]
    // 已有配置值走 normalizeEndpoint：它不做协议校验，只把地址收成核心 origin
    const nextUrl = normalizeEndpoint(existing.url || url)

    // 注意：明确要绑的账号必须从 existing.exclude 里放出来 —— exclude 优先级更高，
    // 留着它这个号永远派生不出运行时连接，面板上却显示已绑定
    const nextExclude = readIds(existing.exclude).filter(id => !bind.includes(id))
    const freed = readIds(existing.exclude).length !== nextExclude.length

    const err =
      existing.enable === false
        ? undefined
        : requireAccounts({ ...existing, url: nextUrl, bind: nextBind, exclude: nextExclude })
    if (err) throw new Error(err)

    const patch: ConnectionPatch = { bind: nextBind }
    if (freed) patch.exclude = nextExclude.length ? nextExclude : null
    if (nextUrl !== existing.url) patch.url = nextUrl
    if (existing.bot_id) patch.bot_id = null
    updateConnection(
      idx,
      patch,
      doc => {
        for (const id of nextBind) {
          // 判据是 bind（本次请求点明要绑的那几个）而不是 nextBind：后者含这条连接上的老账号，
          // 替他们改平台标识是越权。
          // 注意：这一支必须 force —— 老连接上多半已有一行自动推断出来的映射，而
          // writeAccountBotId 默认「有值就不写」，用户在面板里明确填的 bot_id 会静默失效；
          // 反过来不带 explicit 的那一支保持不覆盖，那只是推断，不该盖掉用户的记录
          if (explicit && bind.includes(String(id)))
            writeAccountBotId(doc, id, explicit, undefined, true)
          else writeAccountBotId(doc, id, undefined, config.bot_id_map)
        }
      },
      existing.enable === false
        ? []
        : bind.length
          ? bind.map(account => ({ sourceIndex: idx, account, action: "绑定" }))
          : undefined,
    )
    applyConnections({ sourceIndex: idx })
    // 回包话术里的名字过 label()：没起名字的连接拿地址当名字，那串可能带凭据
    return getWsConnections()[idx]?.name || label(existing)
  }

  let name = String(body.name || "").trim() || `core${list.length + 1}`
  if (list.some(c => (c.name || c.url) === name)) name = `${name}-${Date.now().toString(36)}`

  const conf: WsConnection = {
    name,
    url,
    token: String(body.token || ""),
    enable: bool(body.enable, true),
    reconnect_interval: Number(body.reconnect_interval) || 5,
    max_reconnect_attempts: num(body.max_reconnect_attempts, DEFAULT_MAX_RECONNECT),
    bind,
    exclude,
  }

  // 落盘前拦：自动端点没有明确账号就派生不出任何运行时连接，存下来只是条永远不连的死配置。
  // 话术与指令层共用，两处说法不会漂
  const err = conf.enable === false ? undefined : requireAccounts(conf)
  if (err) throw new Error(err)

  const addedSourceIndex = list.length
  appendConnection(
    conf,
    doc => {
      // 注意：新建也要 force —— bot_id_map 是全局的，这个账号可能早因别条连接留了一行，
      // 不 force 的话「新建连接时填的 bot_id」会静默失效
      for (const id of bind) {
        if (explicit) writeAccountBotId(doc, id, explicit, undefined, true)
        else writeAccountBotId(doc, id, undefined, config.bot_id_map)
      }
    },
    conf.enable === false
      ? []
      : bind.length
        ? bind.map(account => ({ sourceIndex: addedSourceIndex, account, action: "新增" }))
        : undefined,
  )

  // sourceIndex 只用来把展开诊断收窄到刚加的这条：新连接撞了别人已占的路由时会被跳过
  //（前项优先），那句话才是用户此刻要看的；别条连接的历史冲突不该跟着重刷一遍
  applyConnections({ sourceIndex: getWsConnections().length - 1 })
  return conf.name
}

/**
 * @description 改一条连接，改完交给协调器（lifecycle 的 behaviorChanged）决定要不要断线
 * 注意：入口不自己猜要不要重连 —— 地址与 token 改了必须重连，而 bind / exclude / 重连参数
 * 换个 conf 引用就生效，为它们断线是白丢一次退避期的消息
 */
function editConnection(body: PanelBody) {
  const hit = locate(body.key ?? body.index ?? body.name)
  if (!hit) throw new Error("找不到该连接")

  // 先把请求体校验成 patch 再写盘，校验错误由外层 guard 转成 400 回给面板
  const patch: ConnectionPatch = {}
  if (body.url !== undefined) {
    const next = requireWsUrl(String(body.url))
    // 面板显示的是脱敏地址、弹层又原样回填并提交，所以判「这一栏动过没有」得把我们显示给
    // 他的那个串按同一套规则规范化（requireWsUrl 内部就是 normalizeEndpoint）再比 ——
    // 只比 redactUrl(conf.url) 会因为补协议、主机小写、去默认端口而把没动过的地址判成动过，
    // 白写一次 patch.url，而写 url 就会丢查询串里的凭据
    if (next !== normalizeEndpoint(redactUrl(hit.conf.url)))
      // 注意：搬参数必须排在协议门之后、且排在「这一栏动过没有」判完之后 —— 垫在
      // requireWsUrl 前面等于让协议门去校验一个派生串；拿合并后的串去比，带 `?tenant=`
      // 的连接每次都「看起来变了」，上面那段收敛全废，用户只改了名字地址却被重写
      patch.url = mergeEndpointQuery(hit.conf.url, next)
  } else {
    // normalizeEndpoint 补 ws://、砍 fragment、经 new URL() 重新序列化（主机小写、默认端口
    // 消失），但**不改写用户写的路径**。所以这一支同样可能产出 patch.url
    const normalized = normalizeEndpoint(String(hit.conf.url || ""))
    if (normalized !== hit.conf.url) patch.url = normalized
  }
  /**
   * @description 未命名连接：别把它的地址落成名字
   * 注意：卡片标题走 label()，未命名时就是脱敏地址，而弹层把标题当 name 回填并提交回来 ——
   * 照收等于替用户取了个名字，而这个名字是旧地址。判据同上：与显示给他的那个串相同就当没动过
   */
  if (body.name !== undefined) {
    const submitted = String(body.name).trim()
    if (hit.conf.name || submitted !== label(hit.conf)) patch.name = submitted
  }
  if (body.bot_id !== undefined || hit.conf.bot_id) patch.bot_id = null
  // 注意：token 留空表示「不改」而不是「清空」—— 面板拿不到原值（GET 只回 has_token），
  // 当清空会让每次保存都把 token 抹掉。要清空走 clear_token
  if (body.token) patch.token = String(body.token)
  if (body.clear_token) patch.token = ""
  /**
   * @description 覆写 url 时把内联凭据搬进 token 字段
   * 注意：面板回填的是脱敏地址、提交回来的新地址不带查询串 —— 不搬的话只存在于 `?token=` 里的
   * 凭据会静默消失，而面板没有任何字段能把它填回来（token 留空表示「不改」），改完连不上且不报错。
   * body 自带 token、显式 clear_token、或新地址已内联凭据时不搬 —— 那是用户的意图
   */
  if (patch.url !== undefined && patch.token === undefined) {
    const carried = inlineToken(hit.conf.url)
    if (carried !== null && inlineToken(patch.url) === null) patch.token = carried
  }
  if (body.enable !== undefined) patch.enable = bool(body.enable, true)
  for (const k of ["reconnect_interval", "max_reconnect_attempts"] as const) {
    if (body[k] === undefined) continue
    // 注意：空串走 num() 回默认值，别用裸 Number —— Number("") 是 0，而
    // max_reconnect_attempts 的 0 恰好是无限重连
    const blank = body[k] === null || body[k] === ""
    const n = num(body[k], k === "reconnect_interval" ? 5 : DEFAULT_MAX_RECONNECT)
    // 填了东西却不是数字仍要报错，不能静默当成没填
    if (!blank && !Number.isFinite(Number(body[k]))) throw new Error(`${k} 应为数字`)
    // 注意：间隔为负会让退避算出负延时、setTimeout 立即回调，成热重连循环。次数不设下界，
    // <= 0 就是无限重连
    if (k === "reconnect_interval" && n < 1) throw new Error(`${k} 应为不小于 1 的数字`)
    patch[k] = n
  }
  for (const k of ["bind", "exclude"] as const) {
    if (body[k] === undefined) continue
    if (!Array.isArray(body[k])) throw new Error(`${k} 应为数组`)
    patch[k] = body[k] as (string | number)[]
  }

  const nextBind = (
    body.bind !== undefined ? (patch.bind as (string | number)[]) : hit.conf.bind || []
  ).map(String)
  const nextExclude = (
    body.exclude !== undefined ? (patch.exclude as (string | number)[]) : hit.conf.exclude || []
  ).map(String)
  const explicit = body.bot_id !== undefined ? String(body.bot_id || "").trim() : ""
  if (explicit && !nextBind.length)
    throw new Error("当前连接未绑定账号，无法按账号写入平台标识。请先填写绑定账号")

  // 改成「自动端点 + 没有有效账号」等于把连接改死，写盘前就拦掉
  const nextEnable = patch.enable ?? hit.conf.enable ?? true
  const err = nextEnable
    ? requireAccounts({
        ...hit.conf,
        url: patch.url ?? hit.conf.url,
        bind: nextBind,
        exclude: nextExclude,
      })
    : undefined
  if (err) throw new Error(err)

  updateConnection(
    hit.index,
    patch,
    doc => {
      if (explicit) for (const id of nextBind) writeAccountBotId(doc, id, explicit, undefined, true)
      else {
        if (hit.conf.bot_id) for (const id of nextBind) writeAccountBotId(doc, id, hit.conf.bot_id)
        if (body.bind !== undefined) writeAccountBotIds(doc, nextBind, config.bot_id_map)
      }
    },
    !nextEnable
      ? []
      : body.bind !== undefined && nextBind.length
        ? nextBind.map(account => ({ sourceIndex: hit.index, account, action: "绑定" }))
        : [{ sourceIndex: hit.index, action: "修改" }],
  )

  applyConnections({ sourceIndex: hit.index })
  const next = getWsConnections()[hit.index]
  // 回包话术里的名字过 label()（脱敏，见 addConnection 处的说明），并且看**改完之后**的
  // 那份配置：这次编辑可能刚好改了 name 或 url，报旧值等于告诉用户「改的是另一条」
  return label(next || hit.conf)
}

/** 删一条 */
function delConnection(body: PanelBody) {
  const hit = locate(body.key ?? body.index ?? body.name)
  if (!hit) throw new Error("找不到该连接")

  removeConnection(hit.index)
  // 收敛器按新配置整批重算元数据，不需要「下标前移」那一步；而且删掉的这条可能正占着别条
  // 要用的路由，释放之后被顶掉的那条现在起得来了（前项优先的仲裁见 expand.ts 的 claim）。
  // 注意：这里不传 sourceIndex —— 来源已经没了，收窄到它等于把诊断全滤掉，而删除恰好最
  // 可能让别条连接的展开结果发生变化
  applyConnections()
  return label(hit.conf)
}

/** 开关一条 */
function toggleConnection(body: PanelBody) {
  const hit = locate(body.key ?? body.index ?? body.name)
  if (!hit) throw new Error("找不到该连接")

  const on = bool(body.enable, true)
  updateConnection(
    hit.index,
    { enable: on },
    undefined,
    on ? [{ sourceIndex: hit.index, action: "启用" }] : [],
  )
  // 停用一条会释放它占的路由，被它顶掉的那条这才起得来，所以停用也要走整批收敛（同 delConnection）
  applyConnections({ sourceIndex: hit.index })
  return label(hit.conf)
}

/**
 * @description 面板绑定开关：on 表示绑定，off 表示取消绑定
 * 注意：不复用 edit —— 那要回传整份 bind 数组，两个人同时点两个开关时后一个请求会覆盖前一个
 */
function bindConnection(body: PanelBody): string {
  const hit = locate(body.key ?? body.index ?? body.name)
  if (!hit) throw new Error("找不到该连接")
  const id = String(body.id || "").trim()
  if (!id) throw new Error("缺少账号")
  const on = bool(body.on, false)

  const bind = readIds(hit.conf.bind).filter(x => x !== id)
  const exclude = readIds(hit.conf.exclude)
  let freed = false
  if (on) {
    bind.push(id)
    // 「开」必须真的等于绑定：exclude 优先级更高，留在里面会让开关绿着却不连
    const i = exclude.indexOf(id)
    if (i >= 0) {
      exclude.splice(i, 1)
      freed = true
    }
  }
  // 关只删 bind：不写 exclude（那是高级过滤项，一关就写进去等于替用户做决定），
  // 也不删 bot_id_map（平台映射与绑定无关，下次绑回来还能用）

  // 与指令同一套校验、同一句话术
  const nextEnable = hit.conf.enable !== false
  const err = nextEnable ? requireAccounts({ ...hit.conf, bind, exclude }) : undefined
  if (err) throw new Error(err)

  const patch: ConnectionPatch = { bind }
  // 只在真的放出了账号时才动 exclude：没改的键不重写，免得把用户写成数字的
  // 账号悄悄规范成字符串
  if (freed) patch.exclude = exclude.length ? exclude : null
  updateConnection(
    hit.index,
    patch,
    doc => (on ? writeAccountBotId(doc, id, accountPlatform(id)) : undefined),
    nextEnable && on ? [{ sourceIndex: hit.index, account: id, action: "绑定" }] : [],
  )

  const name = label(hit.conf)

  // 收敛器按 runtimeKey 比目标与现状，「开一个 / 关一个 / 兼容连接改过滤器」自然是同一件事：
  // 别的账号的键没变就原地留着不断线，多出来的键新建一条，少了的键只停它。兼容连接更是只换
  // conf 引用（bind 是每条消息现读的转发过滤器，不在 behaviorChanged 的判据里），新过滤器
  // 立刻生效。注意：这里刻意不重建 —— 重建要付一次 5 秒起步的退避，期间的上下行是真的丢了
  applyConnections({ sourceIndex: hit.index })
  return `${name} ${on ? "已绑定" : "已取消绑定"} ${id}`
}

/**
 * @description 一个账号的群表 / 好友表
 * TRSS 是 getGroupMap() / getFriendMap()，Miao 的 Bot 是 icqq Client，只有 gl / fl —— 两条都要兜
 * （同 guoba/index.ts 的 friendIds）。
 * @returns 取不到时返回 null，调用方据此回一句 note；当成空表会让用户以为「本来就没有」，
 *          一按保存就把存着的名单抹平
 */
function targetMap(
  bot: Record<string, any> | null,
  kind: "group" | "friend",
): Map<any, any> | null {
  if (!bot) return null
  try {
    const map =
      kind === "group" ? (bot.getGroupMap?.() ?? bot.gl) : (bot.getFriendMap?.() ?? bot.fl)
    return map instanceof Map ? map : null
  } catch {
    // getGroupMap 在个别适配器上是 getter / 会打网络，宁缺毋错
    return null
  }
}

/**
 * @description 候选条目的头像，取不到回空串（前端 Avatar 组件回退成首字圆）
 *
 * 三条互不相同的规则，别想着统一成一个模板：
 *
 * | 对象 | 头像 |
 * | --- | --- |
 * | QQBot 用户 | `q.qlogo.cn/qqapp/<appid>/<openid>/0` —— 要 appid 与 openid **两个**值 |
 * | QQ 用户 | `q.qlogo.cn/g?b=qq&s=100&nk=<QQ号>` |
 * | QQ 群 | `p.qlogo.cn/gh/<群号>/<群号>/100` |
 * | QQBot 群 | **没有**，官方 API 不提供（QQBot-Web-Adapter 同样回空串），只能显示群名 |
 *
 * 优先读表里已有的 `avatar`：QQBot-Plugin 写 fl 时就带着上面那个 qqapp 串（index.js:1358），
 * 它比这里现拼的准（openid 前缀、频道号那些特例它都处理过了）。
 *
 * 注意：**不能把 QQBot 的账号键塞进 `nk=`**。fl 的键是 `<appid>:<openid>`，而 q.qlogo 只认开头
 * 那段数字（appid），于是每个用户都返回 Bot 自己的头像 —— 锅巴 GSelectFriend 里全是同一张
 * 机器人头像正是这个原因（它的 g-avatar 组件把 user_id 直接拼进 `nk=`，写死在编译产物里，
 * 插件侧改不了）。同理别「顺手统一」utils/bots.ts 里 Bot 自己那条 `nk=<appid>`：那一条是对的，
 * QQBot-Plugin 给 Bot 头像用的就是它（index.js:1920）。
 */
function targetAvatar(
  bot: Record<string, any> | null | undefined,
  kind: "group" | "friend",
  key: string,
  info: any,
): string {
  // 表里带的最准，直接用（QQBot 的 qqapp 串就在这里）
  const had = String(info?.avatar || "").trim()
  if (had) return had

  /*
   * 频道账号（`qg_` 前缀）到这儿就结束：频道用户的头像是事件里带过来的（QQBot-Plugin 存的
   * event.author.avatar），表里没有就没有 —— tinyid 拼不出任何公开接口能认的地址
   */
  if (key.startsWith("qg_")) return ""

  /*
   * 键可能带 `<selfId><sep>` 前缀，取末段才是平台原样 ID。
   * 注意：分隔符读适配器的 `sep` 而不是写死 `:` —— QQBot-Plugin 用的是它自己那个字段
   *（pickFriend 里 `user_id.replace(\`${id}${this.sep}\`, "")` 同源），改过 sep 的部署下写死会切错
   */
  const sep = String(bot?.adapter?.sep || ":")
  const at = sep ? key.indexOf(sep) : -1
  const bare = at > -1 ? key.slice(at + sep.length) : key
  if (!bare) return ""

  // 纯数字就是 QQ 号 / QQ 群号，各有自己的公开取图接口
  const isQQ = /^\d{5,12}$/.test(bare)

  if (kind === "friend") {
    // QQ 号那条走 utils/bots.ts 的 qqAvatar：连接卡上的账号头像用的是同一个函数
    if (isQQ) return qqAvatar(bare)
    // openid 不是 QQ 号，必须配 appid 走 qqapp 那条；appid 取不到就只能空着
    const appid = String(bot?.info?.appid || "").trim()
    return appid ? `https://q.qlogo.cn/qqapp/${appid}/${bare}/0` : ""
  }

  // 群：只有 QQ 群号能取到图，QQBot 的群 openid 没有头像可拿
  return isQQ ? `https://p.qlogo.cn/gh/${bare}/${bare}/100` : ""
}

/**
 * @description 群 / 好友选择器的候选：聚合所有在线 Bot 的表，按 id 去重
 * 注意：取不到列表必须回一句 note 而不是静默回空数组 —— 账号离线时表是空的，前端要能把
 * 「这个号没有群」与「查不到，别以为名单空了」分开说
 */
function targets(kind: unknown): TargetsPayload {
  const want: "group" | "friend" = String(kind) === "friend" ? "friend" : "group"
  const online = onlineBots()
  const items: { id: string; name: string; avatar: string }[] = []
  const seen = new Set<string>()

  const collect = (bot: Record<string, any> | null | undefined): boolean => {
    const map = targetMap(bot ?? null, want)
    if (!map) return false
    for (const [id, info] of map) {
      const key = String(id ?? "").trim()
      // 同一个群可能在多个号上都有，取第一个查到的名字
      if (!key || seen.has(key)) continue
      seen.add(key)
      const name =
        want === "group"
          ? String(info?.group_name || "").trim()
          : String(info?.nickname || info?.remark || "").trim()
      // 名字取不到就用号码本身：前端那一行至少要有东西可显示
      items.push({ id: key, name: name || key, avatar: targetAvatar(bot, want, key, info) })
    }
    return true
  }

  // 逐账号问：只有这条分得清哪个号有哪些群，而头像要那个号自己的 appid 才拼得出来
  let fromAccount = false
  for (const p of online) if (collect(getBot(p.id))) fromAccount = true

  /*
   * 一个账号都没问到时才退到全局 Bot：Miao 的账号表就挂在它身上。
   * 注意：**不能无条件再走一遍**。TRSS 的根 Bot 是一份跨账号聚合表，逐账号那轮已经把同样的
   * 条目收完了，再遍历一次只会被 seen 全部丢弃 —— 5 个号 × 2000 群就是白走一万条。
   */
  const globalOk = fromAccount ? false : collect(globalThis.Bot as Record<string, any> | undefined)

  /**
   * @description 一条都没查到时说清是「查不到」而不是「没有」
   *
   * 判据是「有没有拿到过一张表」而不是 items.length：账号在线且真的一个群都没有，那是空列表不是故障。
   * 注意：**不能把全局 Bot 那次也算进判据**。TRSS 的根 Bot 恒有 getGroupMap()/getFriendMap()，
   * 没同步时回的是**空 Map** 而不是抛错，而 targetMap 只对「不是 Map」返回 null —— 把它算进来
   * 会让 got 恒 ≥ 1，下面这两句话永远不出现，正好废掉这段代码存在的理由。
   * 注意：这句话必须出现 —— 用户把空列表当成「名单本来就空」，一按保存就把存着的名单抹平
   */
  const what = want === "group" ? "群" : "好友"
  const note =
    fromAccount || (globalOk && items.length)
      ? ""
      : online.length
        ? `在线账号没有提供${what}列表（框架未实现或还没同步完）。存着的名单仍然生效`
        : `当前没有在线账号，${what}列表拉不到。存着的名单仍然生效，只是显示成光秃秃的号码`

  return { ok: true, kind: want, items, note }
}

/**
 * @description 挡住原型污染键：面板收的是任意 JSON，不能直接信
 * 入参 unknown、出参 {@link PanelBody} —— 这个函数就是「不可信输入」与「可以按字段读」之间的边界
 */
function safeBody(body: unknown): PanelBody {
  if (!body || typeof body !== "object") return {}
  for (const k of BAD_KEYS) if (Object.hasOwn(body, k)) delete (body as PanelBody)[k]
  return body as PanelBody
}

/**
 * @description 宿主入口
 * 注意：必须是具名导出 init（宿主取 `mod.init || mod.default`）
 */
export function init(ctx: WebCtx) {
  const { registerPage, registerApi, logger } = ctx

  registerPage({
    id: "gscore-adapter",
    title: "早柚核心适配器",
    // 注意：只能是 emoji —— 宿主用 textContent 渲染这颗图标，给图片路径会把路径本身显示出来。
    // 插件 logo 放在页面内部（标题区与 favicon 各一张），都走 /gscore-adapter/logo 接口
    icon: "☄️",
    src: "page.html",
    // 注意：src / style / script 同时是**文件访问白名单**，少列一个页面就拿 403（page.md:82）
    style: "page.css",
    // 注意：产物名不能叫 page.js —— 宿主 scanWebPages() 会把它当「约定式页面描述符」
    // 在 Node 侧 import，而这份是浏览器 bundle，顶层就读 location，每次扫描刷一条 error 日志
    script: "panel.js",
    priority: 40,
  })

  /** 统一的错误出口：错误信息回给前端，堆栈只进日志 */
  const guard =
    (fn: (req: WebRequest) => unknown, code = 400) =>
    async (req: WebRequest, res: WebResponse) => {
      try {
        res.json(await fn(req))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        makeLog("warn", ["web 面板：请求失败", err], "GsCore")
        logger?.warn?.(`[gscore-adapter] ${message}`)
        res.status(code).json({ ok: false, error: message })
      }
    }

  registerApi(
    "get",
    "/gscore-adapter/config",
    guard(() => payload(), 500),
  )

  /**
   * @description 群 / 好友选择器的候选，前端开弹层时才拉
   * 注意：不进整包 —— 整包 10 秒一轮，几千个群跟着来回传毫无必要。几千条一次性传是已知取舍，
   * 前端自己虚拟滑动
   * 注意：走 registerApi 与 /config 同一道鉴权（宿主的 apiAuthGuard 自动套上），别自己碰 Bot.express。
   * 这里回的是群名与好友昵称，别为了「反正只是列表」放行未鉴权访问
   */
  registerApi(
    "get",
    "/gscore-adapter/targets",
    guard(req => targets(req.query?.kind), 500),
  )

  /**
   * @description 插件图标，由本插件自己回，走同一套鉴权
   * 注意：页面里的 <img> 不能直接指向 resources/ —— 宿主只放行描述符里列过的三个文件，别的 403
   */
  registerApi("get", "/gscore-adapter/logo", (_req: WebRequest, res: WebResponse) => {
    try {
      const file = path.join(ResPath, "template/image", PLUGIN_LOGO)
      const buf = fs.readFileSync(file)
      res.setHeader("Content-Type", "image/webp")
      // 图标随版本走，版本不变就不必重取
      res.setHeader("Cache-Control", "public, max-age=86400")
      res.end(buf)
    } catch {
      res.status(404).end()
    }
  })

  registerApi(
    "post",
    "/gscore-adapter/config",
    guard(async req => {
      const r = await saveGlobal(safeBody(req.body))
      const done = r.changed.length ? `已保存 ${r.changed.length} 项` : "没有需要保存的改动"
      return {
        ...payload(),
        // 文件服务重起那句接在后面：作废在途外链与新端口都得让用户看见
        message: [done, ...r.notes].join("；"),
      }
    }),
  )

  registerApi(
    "post",
    "/gscore-adapter/connection",
    guard(req => {
      const body = safeBody(req.body)
      const action = String(body.action || "")
      let name: string
      switch (action) {
        case "add":
          name = addConnection(body)
          break
        case "edit":
          name = editConnection(body)
          break
        case "del":
          name = delConnection(body)
          break
        case "toggle":
          name = toggleConnection(body)
          break
        case "bind":
          name = bindConnection(body)
          break
        default:
          throw new Error(`未知操作 ${action}`)
      }
      return {
        ...payload(),
        // bind 回的已经是整句（含账号），再套一层就成了「连接 xx 已绑定 111 已更新」
        message:
          action === "bind"
            ? name
            : `连接 ${name} 已${{ add: "添加", edit: "保存", del: "删除", toggle: "更新" }[action]}`,
      }
    }),
  )

  registerApi(
    "post",
    "/gscore-adapter/reconnect",
    guard(() => {
      // 与 #早柚重连 一致：restart() 而不是 reloadClients()，后者会按配置重建实例，
      // 把「配置没变、只是想重连」变成一次重载
      for (const c of clients) c.restart()
      return { ...payload(), message: `已重连 ${clients.length} 个连接` }
    }),
  )

  makeLog("info", "web 面板已注册到 QQBot-Web-Adapter", "GsCore")
}

export default init
