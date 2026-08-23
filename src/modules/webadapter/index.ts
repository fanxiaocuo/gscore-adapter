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
  withPlatform,
  profileWithPlatform,
  type ConnectionPatch,
} from "@/config"
import { applyConnections, clients, reloadClients } from "@/modules/client"
import {
  effectiveAccounts,
  expandConnections,
  isAutomaticEndpoint,
  requireAccounts,
} from "@/modules/client/expand"
import { snapshot, forName } from "@/modules/stats/index.js"
import { passiveCount } from "@/modules/passive/index.js"
import { PluginName, ResPath } from "@/dir"
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
import { onlineBots } from "@/utils/bots.js"
import { DEFAULT_MAX_RECONNECT, MEDIA_SIZE_MAX, STATUS_TEXT, pickByStatus } from "@/constants"
import { makeLog } from "@/utils/compat"
import { versionLabel } from "@/modules/render/version.js"
import { PLUGIN_LOGO } from "@/modules/render/assets.js"
import type { RuntimeWsConnection, WsConnection } from "@/types"
import type { BotProfile, ConnView, Payload, RuntimeConnView } from "@/webui/api.js"
import fs from "node:fs"
import path from "node:path"

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
 * @description 保存全局设置，只认白名单里的键并逐个 setIn
 * 注意：不整份覆盖 —— 用户没写过的项继续继承默认值，写过的注释也留着
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
      // 上限同指令那边：这一栏是「超过就走外链」的阈值，调爆等于关掉外链兜底、每个附件都在内存里 base64
      if (n > MEDIA_SIZE_MAX)
        throw new Error(
          `media_max_size 不能大于 ${MEDIA_SIZE_MAX}（${MEDIA_SIZE_MAX / 1048576} MiB）`,
        )
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

  // 注意：心跳是全局项、不在 behaviorChanged 的判据里，改了必须 reloadClients ——
  // applyConnections 会把每条客户端原地留着，实际发的还是旧间隔；其余项每条消息现读，即时生效
  // 注意：总开关关着时不走这条路 —— startClients 尾巴上那句「没有可用连接」警告
  // 会把用户刚选的状态报得像故障
  const touchedClient = changed.some(k => k.startsWith("client."))
  if (touchedClient && enabled()) reloadClients()

  return { changed, touchedClient }
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
      // 与 #早柚重连 一致：restart() 而不是 reloadClients()，后者会按配置重建实例，
      // 把「配置没变、只是想重连」变成一次重载
      for (const c of clients) c.restart()
      return { ...payload(), message: `已重连 ${clients.length} 个连接` }
    }),
  )

  makeLog("info", "web 面板已注册到 QQBot-Web-Adapter", "GsCore")
}

export default init
