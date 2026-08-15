/**
 * Web 面板：接 QQBot-Web-Adapter 的插件页
 *
 * 宿主是什么
 * ---------
 * `plugins/QQBot-Web-Adapter`（另一个插件）提供一个 web 控制台，并允许各插件往
 * 导航栏挂自己的页面：它开机及 `login` / `plugins/loaded` 时扫各插件下的
 * `webadapter/index.js`，import 后调 `export function init(ctx)`。
 * **本插件不自带 http 服务**，宿主没装时这个模块根本不会被加载，是死代码。
 * （真要自己起服务的场景见 utils/fileServer.ts，那是另一回事。）
 *
 * 契约要点（对宿主 index.js:307-332 与 page.md 核实过）
 * -------------------------------------------------
 * - 接口必须走 `ctx.registerApi`。它挂的是宿主的 Bot.express 并自动套
 *   `apiAuthGuard`（非内网 403、未登录 401）。裸 `Bot.express.get()` 会绕过鉴权。
 * - `registerPage({ src, style })` 是 iframe 模式，且 src/style/script 同时是
 *   **文件访问白名单** —— 页面里引用了但描述符没列的文件一律 403。
 * - iframe 里拿 API 前缀要用宿主注入的 `?__webBase=` 查询参数。
 *
 * 为什么不自己另写一套配置读写
 * -------------------------
 * 指令（apps/admin.ts）已经把「改配置 + 热生效」走通了，面板必须调同一批函数：
 * `saveConfig` 保留 yaml 注释，`stopSource` / `startSource` 按来源精确启停一条
 * 逻辑连接派生出的全部运行时连接。
 * 参考实现 xiowo/yunzai-gscore-adapter 的面板是 `YAML.stringify(config)` 整份覆盖，
 * 用户写在配置里的注释会被抹掉，这里不学。
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
  type ConnectionPatch,
} from "@/config"
import {
  clients,
  reloadClients,
  shiftSourceIndex,
  startSource,
  stopClient,
  stopSource,
} from "@/modules/client"
import {
  accountRuntimeName,
  effectiveAccounts,
  expandConnections,
  isAutomaticEndpoint,
  readIds,
  requireAccounts,
  sourceLabel,
} from "@/modules/client/expand"
import { snapshot, forName } from "@/modules/stats/index.js"
import { passiveCount } from "@/modules/passive/index.js"
import { PluginName, ResPath } from "@/dir"
import {
  findDuplicate,
  findSameCore,
  inlineToken,
  normalizeEndpoint,
  redactUrl,
  requireWsUrl,
} from "@/utils/url"
import { writeAccountBotId, writeAccountBotIds } from "@/config/botmap"
import { botProfile, onlineBots } from "@/utils/bots.js"
import { DEFAULT_MAX_RECONNECT } from "@/constants"
import { makeLog } from "@/utils/compat"
import { versionLabel } from "@/modules/render/version.js"
import { PLUGIN_LOGO } from "@/modules/render/assets.js"
import type { RuntimeWsConnection, WsConnection } from "@/types"
import type { BotProfile, ConnView, Payload, RuntimeConnView } from "@/webui/api.js"
import fs from "node:fs"
import path from "node:path"

/* ---------- 宿主契约 ---------- */

/**
 * 宿主（QQBot-Web-Adapter）传进来的 express req / res
 *
 * 本仓库没装 `@types/express`，也不该为这四个方法名去装 —— 宿主自己才是
 * express 的宿主，我们只是收它递过来的对象。这里按**实际用到的成员**声明，
 * 而不是把它标成 any：那样 `res.jsno(...)` 这种拼错也不会报。
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
 * 宿主注入的上下文（index.js:307-332 调 `init(ctx)`）
 *
 * `registerApi` 挂的是宿主的 Bot.express 并自动套 apiAuthGuard，
 * 所以路由**必须**从这里注册，不能自己去碰 Bot.express。
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
 * 面板送上来的请求体
 *
 * 前端表单的值形状不受我们控制（输入框清空是空串、复选框可能送 "true"、
 * 数字框可能送字符串），所以字段一律 unknown，由 {@link bool} / {@link num}
 * / `String()` 在使用点归一化 —— 那几个函数存在的理由正是这个。
 */
type PanelBody = Record<string, unknown>

/** 原型链污染防护：这三个键写进配置对象会污染 Object.prototype */
const BAD_KEYS = ["__proto__", "prototype", "constructor"]

/**
 * 档案叠加平台标识
 *
 * bot_id_map 的显式映射优先于适配器推断（accountPlatform 内部就是这个顺序）：
 * 用户手写的映射才是上报时真正用的值，被在线实例的猜测盖掉就成了假显示。
 */
function withPlatform(p: BotProfile): BotProfile {
  const platform = accountPlatform(p.id)
  return platform ? { ...p, platform } : p
}

/**
 * 面板与回包话术里显示的连接名
 *
 * 没起名字的连接只能拿地址当名字，而**凭据可能只存在于地址里**：normalizeEndpoint
 * 只把根路径收成 origin，非根路径是 `u.toString()`、查询串一起留着
 * （utils/url.ts:53-54），所以 `ws://host:port/ws/Custom?token=xxx` 这种配置的
 * conf.token 是空的。这个串会进面板卡片、也会进 POST 回包的 message，
 * 所以一律先过 redactUrl。
 *
 * locate() 定位比的是配置里的原值（`c.name || c.url`），与这里的显示串是两条路径；
 * 面板发的动作都带 index（webui/main.tsx 一律 `key: c.index`）。
 */
function label(conf: WsConnection): string {
  return conf.name || redactUrl(conf.url)
}

/**
 * 聚合状态的取值顺序：已连接 > 连接中 > 断线待重连 > 未连接
 *
 * 一条逻辑连接的多个账号各有状态，面板顶行只能显示一个。原来只特判「已连接」、
 * 其余按 views[0] 取，于是账号 A 重连耗尽停在 0、账号 B 正在握手（2）时，
 * 面板说整条连接「未连接」—— 而 B 其实正连着。同名次内保持出现顺序（find 取首个），
 * 与展开顺序（也就是 bind 的书写顺序）一致。
 */
const STATUS_ORDER: (0 | 1 | 2 | 3)[] = [1, 2, 3, 0]

/** 按 {@link STATUS_ORDER} 挑出代表整条连接的那一条运行时视图 */
function pickView(views: RuntimeConnView[]): RuntimeConnView | undefined {
  for (const status of STATUS_ORDER) {
    const hit = views.find(v => v.status === status)
    if (hit) return hit
  }
  return undefined
}

/**
 * 一条连接的绑定候选
 *
 * 面板要为每个候选画一个开关，所以候选集是「在线的全部机器人 ∪ 本连接已绑定的
 * 账号」：只给已绑定的就没法在面板上绑一个新号，只给在线的又没法解绑一个已经
 * 离线的号。其他连接绑过、本连接没绑又不在线的账号不塞进来 —— 那是别人的号，
 * 出现在这里只会让人误点。
 *
 * exclude 刻意不在这里减掉：被排除的账号仍要留在候选里，否则面板上就没有任何
 * 地方能把它放回来（绑定开关打开时会把它从 exclude 里删掉，见 bindConnection）。
 * 前端也不是把它画成一个普通的绿开关就完事 —— 这一行会额外挂「已被排除，不会转发」
 * 标记（main.tsx 按 {@link ConnView.conflicts} 判），所以「绑了但不会连」是看得见的；
 * 反过来若在这里按 exclude 过滤掉，那个号会从列表里整条消失，用户会以为自己没绑过它。
 */
function bindBots(conf: WsConnection): BotProfile[] {
  // 在线的排前面：union 的顺序就是显示顺序，先在线后离线才好扫
  const ids = [...new Set([...onlineBots().map(p => p.id), ...readIds(conf.bind)])]
  return ids.map(id => withPlatform(botProfile(id)))
}

/**
 * 连接的可序列化视图
 *
 * **不要整个 conf 扔给前端** —— 里面有 token。这里逐字段挑，token 只回一个
 * 布尔表示「配没配」，要改就重新填。同理不用 GsCoreClient 的 url getter，
 * 它会把 token 拼进查询参数。
 *
 * 返回类型标成 {@link ConnView}（与前端共用的那份声明）：字段改了名，
 * 编译期就在这里报，而不是等到面板上显示成 undefined
 *
 * @param runtime 本条连接派生出的运行时连接，由 payload() 一次展开后按 sourceIndex 分好
 */
function connView(conf: WsConnection, i: number, runtime: RuntimeWsConnection[]): ConnView {
  const enabled = conf.enable !== false
  const views: RuntimeConnView[] = runtime.map(rt => {
    // 一条配置对应多个客户端，靠运行时名字找它自己那一个：
    // 按 conf.name 找只会拿到第一个账号，另外几条的状态与计数全丢
    const live = clients.find(c => c.name === rt.runtimeName)
    const counters = forName(rt.runtimeName)
    return {
      account: rt.account ?? undefined,
      name: rt.runtimeName,
      // 只给 pathname：runtimeUrl 本身已净化，但仍不取整串，免得哪天
      // 上游又把鉴权参数放回地址里，面板就直接把它显示出去了
      path: new URL(rt.runtimeUrl).pathname || "/",
      status: live?.status ?? 0,
      status_text: !enabled ? "已停用" : live ? live.statusText : "未启动",
      retry: live?.retry ?? 0,
      up: counters.up + counters.event,
      down: counters.down,
    }
  })
  // exclude 优先级高于 bind（expand.ts 的 effectiveAccounts），所以「配了哪些账号」
  // 与「哪些账号真会连」不是一回事：两边都写了的号留在 bind 里却永远派生不出运行时
  // 连接。前端只看 bind 的话会把它画成一个绿着却不连的开关，所以两个集合都回。
  const { accounts, conflicts } = effectiveAccounts(conf)
  // 顶行只能显示一个状态，按 STATUS_ORDER 挑代表：不让一条 0 盖掉另一条正在连的 2
  const lead = pickView(views)
  return {
    index: i,
    name: label(conf),
    // 地址脱敏后再回：token 可能只内联在 url 里，见 label() 的说明
    url: conf.url ? redactUrl(conf.url) : "",
    enable: enabled,
    /**
     * 只说明有没有配，不回原值；内联在地址里的也算配了
     *
     * 不看运行时那层的内联标志：停用的连接根本不展开（expand.ts 里
     * `conf.enable === false` 直接 return），零条运行时连接时那个标志恒为 false，
     * 而配置里的凭据仍在 —— 那样这里会对一条配过 token 的连接报「没配 token」。
     */
    has_token: !!conf.token || inlineToken(conf.url) !== null,
    reconnect_interval: Number(conf.reconnect_interval) || 5,
    // 字段缺失时回默认次数而不是 0：面板上那个数字就是运行时真正用的值
    // （GsCoreClient.scheduleReconnect 同样 ?? 默认值），回 0 会显示成「无限重连」
    max_reconnect_attempts: Number(conf.max_reconnect_attempts ?? DEFAULT_MAX_RECONNECT),
    bind: Array.isArray(conf.bind) ? conf.bind : [],
    exclude: Array.isArray(conf.exclude) ? conf.exclude : [],
    accounts,
    conflicts,
    bind_bots: bindBots(conf),
    // 自动端点与兼容连接在「关掉最后一个绑定」上的后果完全不同（前者被
    // requireAccounts 拒、后者变成不限账号），前端要能分辨，所以这个判定跟着视图回。
    // 不让前端自己看 url 猜：那等于把 normalizeEndpoint 的规则抄一份到浏览器里
    automatic: isAutomaticEndpoint(conf),
    runtime: views,
    // 逻辑连接的状态是聚合值：任一账号连上就算这个核心通了，
    // 不让某一条的状态盖掉其他账号（明细在 runtime 里逐条给）
    status: lead?.status ?? 0,
    // 「已停用」与「未启动」在状态码上都是 0，但成因不同，前端要分开显示
    status_text: !enabled ? "已停用" : (lead?.status_text ?? "未启动"),
    // 各账号里最差的那个重连次数。与 status 同时看会显得矛盾（A 已连接、B 在重连时
    // 是「已连接 + 重连 5 次」），但这一行的用途正是「这条核心有账号在挣扎」；
    // 逐账号的准确值在 runtime 里
    retry: views.reduce((n, v) => Math.max(n, v.retry), 0),
    up: views.reduce((n, v) => n + v.up, 0),
    down: views.reduce((n, v) => n + v.down, 0),
  }
}

/** GET 回的整包 */
function payload(): Payload {
  const stats = snapshot()
  const list = getWsConnections()
  // 展开只做一次：expandConnections 是全局裁决（路由冲突先到先得），
  // 每条连接各展开一次既拿不到全局上下文，也会把同一批错误重复算 n 遍
  //
  // errors 必须一起回：一条启用中的连接派生不出任何运行时连接时（路由冲突、地址
  // 解析失败、没有有效账号……），面板上它只是一直停在「未启动」，原因过去只有
  // 控制台日志能看到（lifecycle.ts 的 startSource 把 errors 打成 error 日志）。
  // 这些话术里只有连接名、来源序号与 pathname，没有完整地址（expand.ts 的
  // errors.push 各处），所以可以直接回给前端。
  const { runtime, errors } = expandConnections(list)
  const connections = list.map((c, i) =>
    connView(
      c,
      i,
      runtime.filter(r => r.sourceIndex === i),
    ),
  )
  const flat = connections.flatMap(c => c.runtime)
  return {
    ok: true,
    plugin: { name: PluginName, version: versionLabel(), configFile },
    config: {
      enable: enabled(),
      heartbeat: Number(config.client?.heartbeat) || 0,
      heartbeat_timeout: Number(config.client?.heartbeat_timeout) || 0,
      notify_master: config.notify_master === true,
      media_max_size: Number(config.media_max_size) || 0,
      filter: {
        report_private: config.filter?.report_private !== false,
        report_group: config.filter?.report_group !== false,
        report_meta: config.filter?.report_meta !== false,
        only_reply_at: config.filter?.only_reply_at === true,
      },
    },
    connections,
    errors,
    totals: {
      logical: connections.length,
      runtime: flat.length,
      connected: flat.filter(r => r.status === 1).length,
    },
    // 在线机器人清单：面板「添加绑定」的候选，含头像与昵称
    bots: onlineBots().map(withPlatform),
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
 * 数字字段：留空回默认值，显式的 0 保留
 *
 * Number("") 是 0，所以不能只判 Number.isFinite —— 那会把「清空输入框」
 * 当成「填了 0」，而 max_reconnect_attempts 的 0 恰好是无限重连。
 */
function num(v: unknown, dflt: number): number {
  if (v === undefined || v === null || v === "") return dflt
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

/**
 * 保存全局设置
 *
 * 只认白名单里的键，逐个 setIn —— 不整份覆盖，用户配置里没写过的项继续
 * 继承默认值，写过的注释也留着。
 */
function saveGlobal(body: PanelBody) {
  const changed: string[] = []

  saveConfig(doc => {
    if (body.enable !== undefined) {
      doc.setIn(["enable"], bool(body.enable, true))
      changed.push("enable")
    }
    if (body.notify_master !== undefined) {
      doc.setIn(["notify_master"], bool(body.notify_master, false))
      changed.push("notify_master")
    }
    if (body.media_max_size !== undefined) {
      const n = Number(body.media_max_size)
      // 下限同指令那边：比 1KiB 还小的上限意味着所有媒体都走外链，多半是填错了
      if (!Number.isFinite(n) || n < 1024) throw new Error("media_max_size 不能小于 1024")
      doc.setIn(["media_max_size"], n)
      changed.push("media_max_size")
    }
    for (const k of ["heartbeat", "heartbeat_timeout"]) {
      if (body[k] === undefined) continue
      const n = Number(body[k])
      if (!Number.isFinite(n) || n < 0) throw new Error(`${k} 应为 0 或正整数`)
      doc.setIn(["client", k], n)
      changed.push(`client.${k}`)
    }
    const f =
      typeof body.filter === "object" && body.filter !== null
        ? (body.filter as Record<string, unknown>)
        : {}
    for (const k of ["report_private", "report_group", "report_meta", "only_reply_at"]) {
      if (f[k] === undefined) continue
      doc.setIn(["filter", k], bool(f[k], true))
      changed.push(`filter.${k}`)
    }
  })

  // 心跳参数在建连时读，改了要重连才生效；其余项每条消息现读，即时生效
  const touchedClient = changed.some(k => k.startsWith("client."))
  if (touchedClient && enabled()) reloadClients()

  return { changed, touchedClient }
}

/** 新增连接 */
function addConnection(body: PanelBody) {
  const list = getWsConnections()
  const bind = (Array.isArray(body.bind) ? body.bind : []).map(String)
  // requireWsUrl 而不是裸 normalizeEndpoint：协议校验只有那一处，http:// 会带着
  // 换算好的 ws 地址抛出来，guard 转成 400 后那句话本身就是可用的建议
  const url = requireWsUrl(String(body.url ?? ""))
  const explicit = String(body.bot_id || "").trim()
  const exclude = (Array.isArray(body.exclude) ? body.exclude : []).map(String)

  // 同一核心已有自动路径的连接 → 合并 bind，不再新开一条 ws
  const existing = findSameCore(list, url)
  if (existing) {
    if (findDuplicate([existing], url, bind))
      throw new Error(
        // label() 而不是裸 name：没起名字的连接 name 是空的，原来这句会显示成
        // 「这个核心已经加过了（）」；label 退回地址且过 redactUrl，不会把凭据带出去
        `这个核心已经加过了（${label(existing)}），绑定：${
          existing.bind?.length ? existing.bind.join("、") : "未绑定账号"
        }`,
      )
    const idx = list.indexOf(existing)
    const prev = Array.isArray(existing.bind) ? existing.bind.map(String) : []
    const nextBind = [...new Set([...prev, ...bind])]
    // 已有配置值走 normalizeEndpoint：它不做协议校验，只把地址收成核心 origin
    const nextUrl = normalizeEndpoint(existing.url || url)

    // 明确要绑的账号必须从 existing.exclude 里放出来
    // ------
    // 合并只改 bind、existing.exclude 原样留着的话，落盘的组合是谁都没校验过的
    // 那份：exclude 优先级更高，这个号永远派生不出运行时连接，面板上却显示已绑定。
    // 与绑定开关同一套语义（拨开就等于绑上，不能绿着却不连），也与 admin.ts 一致
    const nextExclude = readIds(existing.exclude).filter(id => !bind.includes(id))
    const freed = readIds(existing.exclude).length !== nextExclude.length

    const err = requireAccounts({ ...existing, url: nextUrl, bind: nextBind, exclude: nextExclude })
    if (err) throw new Error(err)

    const patch: ConnectionPatch = { bind: nextBind }
    if (freed) patch.exclude = nextExclude.length ? nextExclude : null
    if (nextUrl !== existing.url) patch.url = nextUrl
    if (existing.bot_id) patch.bot_id = null
    updateConnection(idx, patch, doc => {
      for (const id of nextBind)
        writeAccountBotId(
          doc,
          id,
          explicit && bind.includes(String(id)) ? explicit : undefined,
          config.bot_id_map,
        )
    })
    stopSource(idx, existing.name || existing.url)
    if (enabled()) startSource(idx)
    // 回包话术里的名字过 label()：没起名字的连接拿地址当名字，那串可能带凭据。
    // 上一行 stopSource 收的仍是原值 —— 那是与 client.name 比较的键，不是给人看的串
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

  // 落盘前拦：自动端点没有明确账号就派生不出任何运行时连接，存下来只会变成
  // 一条永远不连的死配置。话术与指令层共用，两处说法不会漂
  const err = requireAccounts(conf)
  if (err) throw new Error(err)

  appendConnection(conf, doc => {
    for (const id of bind) writeAccountBotId(doc, id, explicit || undefined, config.bot_id_map)
  })

  if (enabled()) startSource(getWsConnections().length - 1)
  return conf.name
}

/**
 * 改一条连接
 *
 * 改完先停后起：连接参数（url / token / bind）都是建连时读的，
 * 光改配置不重连的话面板显示已改、实际还连着老地址。
 */
function editConnection(body: PanelBody) {
  const hit = locate(body.key ?? body.index ?? body.name)
  if (!hit) throw new Error("找不到该连接")

  const oldName = hit.conf.name || hit.conf.url

  // 先把请求体校验成 patch 再写盘，校验错误由外层 guard 转成 400 回给面板
  const patch: ConnectionPatch = {}
  if (body.url !== undefined) {
    const next = requireWsUrl(String(body.url))
    // 面板看到的地址是脱敏过的（connView 的 url 过了 redactUrl），编辑弹层又会把
    // 它原样回填、原样提交（webui/main.tsx 的 Modal 只跳过 token）。要判断用户是不是
    // 真动了这一栏，得把「我们显示给他的那个串」按同一套规则规范化，再与他提交回来的
    // 比 —— requireWsUrl 内部就是 normalizeEndpoint。
    // 只比 redactUrl(conf.url) 不够：规范化还会补协议、把主机小写、去掉默认端口
    // （normalizeEndpoint 走 new URL().toString()），于是 `h:8765/ws/X`、
    // `ws://HOST:8765/...`、`ws://h:80/...` 这些配置即便一个字没动也「看起来变了」，
    // 白写一次 patch.url —— 而写 url 就会丢查询串里的凭据（下面那段搬运是兜底）
    if (next !== normalizeEndpoint(redactUrl(hit.conf.url))) patch.url = next
  } else {
    // normalizeEndpoint 只做两件事：补 ws:// 协议、把根路径收成 origin
    // （utils/url.ts:43-58）。**不收**非根路径 —— 老配置里的 `/ws/Yunzai-123`、
    // `/ws/Yunzai` 会原样留下。要不要把这类旧路径一并收回 origin 是全局决定
    // （apps/admin.ts 的编辑分支同样只调 normalizeEndpoint），不在这条改动里单独换掉。
    // 但这一支同样可能产出 patch.url：非根路径虽不被收成 origin，仍会经
    // new URL().toString() 重新序列化，主机小写、默认端口消失
    const normalized = normalizeEndpoint(String(hit.conf.url || ""))
    if (normalized !== hit.conf.url) patch.url = normalized
  }
  if (body.name !== undefined) patch.name = String(body.name).trim()
  if (body.bot_id !== undefined || hit.conf.bot_id) patch.bot_id = null
  // token 留空表示「不改」，不是「清空」—— 面板拿不到原值（GET 只回 has_token），
  // 把空串当清空会让每次保存都把 token 抹掉。要清空走 clear_token
  if (body.token) patch.token = String(body.token)
  if (body.clear_token) patch.token = ""
  /**
   * 覆写 url 时把内联凭据搬进 token 字段
   * ------
   * 上面那个「没动这一栏就不写」只挡住了「真没动」。用户确实改了地址时 patch.url
   * 必须写，而面板回填的是脱敏地址、提交回来的新地址不带查询串 —— 只存在于
   * `?token=` 里的凭据就跟着消失了。而且面板没有任何字段能把它填回来：token 输入框
   * 留空表示「不改」，has_token 会从「已配」翻成「没配」，下一次握手直接无凭据，
   * 全程不报错。改 url 前是能连的、改完连不上，症状和地址本身毫无关系。
   *
   * 搬而不是把查询串留着：凭据本来就该待在 token 字段，运行时也是这么摆的
   * （expand.ts 的 detachInlineToken 把它摘出来，运行时地址不带凭据），顺手收正。
   * body 自己带了 token（改密）或显式 clear_token（清空）时不搬 —— 那是用户的意图。
   */
  if (patch.url !== undefined && patch.token === undefined) {
    const carried = inlineToken(hit.conf.url)
    if (carried !== null && inlineToken(patch.url) === null) patch.token = carried
  }
  if (body.enable !== undefined) patch.enable = bool(body.enable, true)
  for (const k of ["reconnect_interval", "max_reconnect_attempts"] as const) {
    if (body[k] === undefined) continue
    const n = Number(body[k])
    if (!Number.isFinite(n)) throw new Error(`${k} 应为数字`)
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
  const err = requireAccounts({
    ...hit.conf,
    url: patch.url ?? hit.conf.url,
    bind: nextBind,
    exclude: nextExclude,
  })
  if (err) throw new Error(err)

  updateConnection(hit.index, patch, doc => {
    if (explicit) for (const id of nextBind) writeAccountBotId(doc, id, explicit, undefined, true)
    else {
      if (hit.conf.bot_id) for (const id of nextBind) writeAccountBotId(doc, id, hit.conf.bot_id)
      if (body.bind !== undefined) writeAccountBotIds(doc, nextBind, config.bot_id_map)
    }
  })

  stopSource(hit.index, oldName)
  const next = getWsConnections()[hit.index]
  if (enabled()) startSource(hit.index)
  // 回包话术里的名字过 label()（脱敏，见 addConnection 处的说明），并且看**改完之后**
  // 的那份配置：这次编辑可能刚好改了 name 或 url，报旧值等于告诉用户「改的是另一条」。
  // stopSource 收的仍是 oldName —— 那是与 client.name 比较的键，必须是改之前的
  return label(next || hit.conf)
}

/** 删一条 */
function delConnection(body: PanelBody) {
  const hit = locate(body.key ?? body.index ?? body.name)
  if (!hit) throw new Error("找不到该连接")

  const name = hit.conf.name || hit.conf.url
  removeConnection(hit.index)
  stopSource(hit.index, name)
  // 删除会让后面各条配置下标 -1，运行时来源序号必须跟着前移，
  // 否则下一次停用第 3 条，停掉的是原来第 4 条派生的连接
  shiftSourceIndex(hit.index)
  return label(hit.conf)
}

/** 开关一条 */
function toggleConnection(body: PanelBody) {
  const hit = locate(body.key ?? body.index ?? body.name)
  if (!hit) throw new Error("找不到该连接")

  const on = bool(body.enable, true)
  updateConnection(hit.index, { enable: on })
  const name = hit.conf.name || hit.conf.url
  // 先停后起：本来就在跑的运行时连接会被 startClient 的同名去重挡掉
  // （lifecycle.ts:33），不停就起的话「重复开启」什么也起不来
  stopSource(hit.index, name)
  if (on && enabled()) startSource(hit.index)
  return label(hit.conf)
}

/**
 * 面板绑定开关：on 表示绑定，off 表示取消绑定
 *
 * 为什么单独一个动作，不复用 edit
 * ---------------------------
 * 面板上一个账号一个开关，一次只表达「这个号要不要接这条核心」。走 edit 就得把
 * 整份 bind 数组回传，两个人同时点两个开关时后一个请求会把前一个的结果覆盖掉。
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
  // 关只删 bind：不写 exclude（那是高级过滤项，面板一关就写进去等于替用户做决定），
  // 也不删 bot_id_map（平台映射与绑定无关，下次绑回来还能用）

  // 与指令同一套校验、同一句话术
  const err = requireAccounts({ ...hit.conf, bind, exclude })
  if (err) throw new Error(err)

  const patch: ConnectionPatch = { bind }
  // 只在真的放出了账号时才动 exclude：没改的键不重写，免得把用户写成数字的
  // 账号悄悄规范成字符串
  if (freed) patch.exclude = exclude.length ? exclude : null
  updateConnection(hit.index, patch, doc =>
    on ? writeAccountBotId(doc, id, accountPlatform(id)) : undefined,
  )

  const name = label(hit.conf)

  // 只动这一个账号的运行时连接
  // ------
  // stopSource 是按 sourceIndex 全停（lifecycle.ts:53-64），拨一个开关就会把这条
  // 核心上已经连上的其他账号一起断掉再连回来 —— 而这个动作存在的理由正是「一个
  // 开关只表达一个账号的意图」。自动端点上一个账号一条 ws、各自 bind 收窄成单账号
  // （expand.ts 里 `bind: [account]`），改一个号不影响别的号：
  //   开 → 只调 startSource，已在跑的同名客户端被 startClient 的同名去重挡掉
  //        （lifecycle.ts:33），实际只新建了这个账号那一条
  //   关 → 按名字停掉这个账号那一条。名字必须与展开器拼的一模一样，所以用
  //        accountRuntimeName + sourceLabel 现算，而不是在这儿手拼字符串
  //
  // 非根路径的兼容连接走不通这条精确路径：它只有一条运行时连接，bind 在那条连接上
  // 是转发过滤器（GsCoreClient.accept 读 conf.bind），改了 bind 必须重建那条连接才
  // 生效，而按账号名去停又找不到人（它的运行时名字就是 label，不带 [账号]）。
  // 好在它本来就只有一条，全停全起没有连带损失。
  if (!isAutomaticEndpoint(hit.conf)) {
    stopSource(hit.index, hit.conf.name || hit.conf.url)
    if (enabled()) startSource(hit.index)
  } else if (on) {
    if (enabled()) startSource(hit.index)
  } else {
    stopClient(accountRuntimeName(sourceLabel(hit.conf, hit.index), id))
  }
  return `${name} ${on ? "已绑定" : "已取消绑定"} ${id}`
}

/**
 * 挡住原型污染键：面板收的是任意 JSON，不能直接信
 *
 * 入参标 unknown（`req.body` 就是 unknown），出参是 {@link PanelBody} ——
 * 这个函数正是「不可信输入」与「可以按字段读」之间的那道边界
 */
function safeBody(body: unknown): PanelBody {
  if (!body || typeof body !== "object") return {}
  for (const k of BAD_KEYS) if (Object.hasOwn(body, k)) delete (body as PanelBody)[k]
  return body as PanelBody
}

/**
 * 宿主入口
 *
 * 注意签名必须是具名导出 init（宿主取 `mod.init || mod.default`）。
 */
export function init(ctx: WebCtx) {
  const { registerPage, registerApi, logger } = ctx

  registerPage({
    id: "gscore-adapter",
    title: "早柚核心适配器",
    // 只能是 emoji：宿主用 textContent 渲染这颗图标（web/app.js:146 导航栏、
    // 171 移动端横幅），给图片路径会把路径本身当文字显示出来。
    // 插件 logo 放在页面内部 —— 标题区一张、favicon 一张，都走
    // /gscore-adapter/logo 接口。
    icon: "☄️",
    src: "page.html",
    // iframe 模式下宿主不会把 style/script 注入外层 DOM（页面自己 <link>/<script>
    // 引），但这两项同时是**文件访问白名单** —— /api/web-page/ 只放行描述符里
    // 列过的文件。少列一个，页面就会拿到 403（page.md:82）
    style: "page.css",
    // 产物名不能叫 page.js：宿主的 scanWebPages() 会把 webadapter/page.js
    // 当「约定式页面描述符」在 **Node 侧** import（index.js:291 的固定文件名
    // 列表 page.js / page.json / pages.js / pages.json）。而这份是浏览器 bundle，
    // 顶层就读 location，一 import 必然抛 `location is not defined`。
    // 报错只影响那次扫描（本模块仍由 index.js 正常初始化），但每次开机 /
    // login / plugins/loaded 都会刷一条 error 日志。
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
   * 插件图标
   *
   * 页面里的 <img> 不能直接指向 resources/template/image/ —— 宿主的
   * /api/web-page/ 只放行描述符里列过的 src/style/script 三个文件（index.js:271-278），
   * 别的路径一律 403。所以图标由本插件自己回，走同一套鉴权。
   *
   * 顺带一提：导航栏那颗 icon 只能是 emoji。宿主用 textContent 渲染它
   * （web/app.js:146），给图片路径会被当字面量显示出来。
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
    guard(req => {
      const r = saveGlobal(safeBody(req.body))
      return {
        ...payload(),
        message: r.changed.length ? `已保存 ${r.changed.length} 项` : "没有需要保存的改动",
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
      // 与 #早柚重连 一致：restart() 而不是 reloadClients()，
      // 后者会按配置重建实例，把「配置没变、只是想重连」变成一次重载
      for (const c of clients) c.restart()
      return { ...payload(), message: `已重连 ${clients.length} 个连接` }
    }),
  )

  makeLog("info", "web 面板已注册到 QQBot-Web-Adapter", "GsCore")
}

export default init
