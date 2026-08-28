/**
 * @description 连接增改的共用核心：校验与算 patch 在这里，写盘与回执由调用方做
 * 指令层（apps/admin.ts）与面板（modules/webadapter）原先各写了一遍，且两套规则互相矛盾 ——
 * reconnect_interval 一边收 0 一边拒 <1、enable 一边报错一边静默当停用、合并分支一边校验指令里的
 * 字段一边校验合并后状态。现在校验只有这一处。
 *
 * 分工：本模块只做「收归一化输入 → 出 {errors, patch}」，不写盘、不碰 e.reply、不返回话术。
 * 错误是结构化码 + 参数，两边各自渲染 —— 指令层要念「用 #早柚连接列表 查看」这种聊天专属提示，
 * 面板得念成链接，共用成品中文串会把聊天指令漏进面板。
 *
 * 注意：定位不在本模块 —— find() 是 1 起、locate() 是 0 起，两个基准刻意各自保留，所以本模块收的是
 * 已经解析好的 {index, conf}，而不是 key
 * 注意：只 import 子文件，不碰 @/modules/client barrel —— 那个 barrel 里 framework.ts 有顶层 await 且
 * 路径相对 cwd，从云崽根目录跑会给真实 bot 的配置挂上监听
 */
import { config, type ConnectionPatch } from "@/config"
import { writeAccountBotId, writeAccountBotIds } from "@/config/botmap"
import { requireAccounts } from "@/modules/client/expand"
import { findSameCore, inlineToken, normalizeEndpoint, requireWsUrl } from "@/utils/url"
import { readIds } from "@/utils/ids"
import { DEFAULT_MAX_RECONNECT } from "@/constants"
import type { WsConnection } from "@/types"

/** @description 列表字段的操作：追加 / 移除 / 整体替换 */
export type ListOp = "add" | "remove" | "replace"

/** @description 一个列表字段的诉求。op 省略即整体替换 */
export interface ListChange {
  ids: string[]
  op?: ListOp
}

/**
 * @description 归一化后的连接输入
 * 两种入口各自映射到这里：指令层解析 key=value，面板读 JSON。
 * 注意：token 是三态 —— undefined 不改、null 清空（删键）、字符串写入。指令层把 `token=` 空值映射成
 * null，面板把 clear_token 映射成 null；两边输入习惯不同，落盘结果统一成删键
 * 注意：add 时 bind 的缺省值由调用方显式传（指令层传发指令那个账号，HTTP 没有事件对象只能传空）——
 * 本模块不认识 e
 */
export interface ConnInput {
  url?: string
  name?: string
  token?: string | null
  /** 原始开关值，解析与校验在本模块 —— 「什么算合法开关值」正是要统一的规则，放到调用方就又是两套 */
  enable?: unknown
  /** 原始值，空串与 null 视为没填 */
  reconnect_interval?: unknown
  /** 原始值，空串与 null 视为没填 */
  max_reconnect_attempts?: unknown
  bind?: ListChange
  exclude?: ListChange
  /** 平台标识，按 bind 账号写入 bot_id_map */
  bot_id?: string
}

/**
 * @description 校验失败：码 + 渲染所需的参数
 * 注意：不因层而异的文案自带 message（字段校验、地址、账号缺失），因层而异的只给码 —— 后三个引用了指令
 * 语法（bind=all / bind+= / 请先 bind=），面板照抄会出现用户点不到的指令。这样两层各自只需渲染三个码，
 * 而不是把五条相同文案在两处各抄一遍
 */
export type PlanError =
  /** 地址缺失、协议不对或解析不了。message 来自 requireWsUrl，本身就是可用的建议 */
  | { code: "url_invalid"; message: string }
  /** enable 不是 true/false */
  | { code: "enable_invalid"; message: string }
  /** reconnect_interval 不是不小于 1 的数字 */
  | { code: "interval_invalid"; message: string }
  /** max_reconnect_attempts 不是数字 */
  | { code: "retry_invalid"; message: string }
  /** 自动端点没有有效账号。message 来自 requireAccounts */
  | { code: "accounts_required"; message: string }
  /** bind=all 已不再支持。指令层专属语法 */
  | { code: "bind_all_unsupported" }
  /** bind+= / bind-= / exclude+= / exclude-= 没填账号。指令层专属语法 */
  | { code: "list_op_empty"; field: "bind" | "exclude"; op: "add" | "remove" }
  /** 设了平台标识但没有绑定账号。两层措辞不同：指令层要念 bind=<账号>，面板要念「填写绑定账号」 */
  | { code: "bot_id_without_bind" }

/** @description 算完的结果。ok 为 false 时 errors 非空，patch 不可用 */
export interface PlanResult {
  ok: boolean
  errors: PlanError[]
  /** 本次点明要绑的账号（已归一化）。写 bot_id_map 的判据与 expectations 门禁都用它，别让调用方再算一遍 */
  requested?: string[]
  /** 归一化后的平台标识，空串表示没设 */
  explicit?: string
  /** 合并进已有连接时给出；新建时为 undefined */
  merge?: {
    index: number
    existing: WsConnection
    patch: ConnectionPatch
    /**
     * @description 本次从排除名单里放出来的账号。指令层回执要念具体账号，不能只给布尔值
     * 注意：只有 planAdd 的合并分支算它 —— planEdit 里 exclude 是用户直接给的最终值，
     * 「放出来了谁」不是那条路上的概念，所以那边不给这个字段（而不是给个会被读成「一个都没放」的空数组）
     */
    freed?: string[]
    nextBind: string[]
    nextExclude: string[]
    nextUrl: string
    /** 这次落盘后该连接是否启用，写盘的 expectations 门禁要用 */
    nextEnable: boolean
  }
  /** 新建连接时给出 */
  create?: {
    conf: WsConnection
    sourceIndex: number
  }
}

/** @description reconnect_interval 的下限。0 秒重连是紧密循环，断线时会把 CPU 与对端一起灼掉 */
const MIN_INTERVAL = 1

/**
 * @description 严格解析开关值：认不出来返回 "invalid"，不静默当停用
 * 注意：面板原先的 bool() 把认不出的值一律当 false，`enable: "yes"` 会静默把连接停掉且不报错。
 * 注意：认 1/0 与 on/off 是为了收下面板前端实际会送的形状（表单值可能是数字或字符串）——
 * 相对指令层原先只认 true/false 是放宽了一点，换来的是两层同一套判定
 */
function parseEnable(v: unknown): boolean | "invalid" | undefined {
  if (v === undefined || v === null || v === "") return undefined
  if (typeof v === "boolean") return v
  const s = String(v).trim().toLowerCase()
  if (["true", "1", "on"].includes(s)) return true
  if (["false", "0", "off"].includes(s)) return false
  return "invalid"
}

/** @description 数字字段：空串与 null 视为没填，返回 undefined 让默认值接手 */
function parseNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined
  return Number(v)
}

/**
 * @description 一条连接当前是否启用
 * 注意：判据是 !== false 而不是真值 —— 与 expandConnections 的 `enable === false` 短路保持同一套判定，
 * 全仓只有一个「什么算停用」
 */
export function isEnabled(conf: Pick<WsConnection, "enable"> | undefined): boolean {
  return conf?.enable !== false
}

/** @description 对一个 id 列表施加 op */
export function applyListOp(current: string[], ids: string[], op: ListOp = "replace"): string[] {
  if (op === "add") return [...new Set([...current, ...ids])]
  if (op === "remove") return current.filter(id => !ids.includes(id))
  return [...new Set(ids)]
}

/** @description 解析并校验 input 里那几个标量字段 */
function normalize(input: ConnInput) {
  const errors: PlanError[] = []

  const parsedEnable = parseEnable(input.enable)
  if (parsedEnable === "invalid")
    errors.push({ code: "enable_invalid", message: "enable 只能是 true 或 false" })
  const enable = parsedEnable === "invalid" ? undefined : parsedEnable

  const interval = parseNum(input.reconnect_interval)
  if (interval !== undefined && (!Number.isFinite(interval) || interval < MIN_INTERVAL))
    errors.push({
      code: "interval_invalid",
      message: `reconnect_interval 应为不小于 ${MIN_INTERVAL} 的数字`,
    })

  const retry = parseNum(input.max_reconnect_attempts)
  if (retry !== undefined && !Number.isFinite(retry))
    errors.push({ code: "retry_invalid", message: "max_reconnect_attempts 应为数字" })

  for (const field of ["bind", "exclude"] as const) {
    const change = input[field]
    if (!change) continue
    if ((change.op === "add" || change.op === "remove") && !change.ids.length)
      errors.push({ code: "list_op_empty", field, op: change.op })
  }
  return { errors, enable, interval, retry }
}

/**
 * @description 添加连接：命中同一核心就算合并 patch，否则算新连接
 * @param list 当前连接列表，由调用方取（本模块不决定何时读盘）
 * @param defaultBind bind 缺省值 —— 指令层传发指令那个账号，HTTP 传空
 */
export function planAdd(
  input: ConnInput,
  list: WsConnection[],
  defaultBind: string[] = [],
): PlanResult {
  const { errors, enable: enableInput, interval, retry } = normalize(input)

  let url: string
  try {
    url = requireWsUrl(input.url)
  } catch (err) {
    // 注意：unshift 而不是 push —— 两层都只渲染 errors[0]，而地址那句自带换算好的可用地址
    //（`不支持 http://…请改用：ws://…`），是这几个错误里唯一直接告诉用户该发什么的
    errors.unshift({
      code: "url_invalid",
      message: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, errors }
  }

  const bind = input.bind ? applyListOp([], input.bind.ids, "replace") : defaultBind
  const exclude = input.exclude ? applyListOp([], input.exclude.ids, "replace") : []
  const explicit = (input.bot_id || "").trim()

  const existing = findSameCore(list, url)
  if (existing) {
    const index = list.indexOf(existing)
    // 注意：走 readIds 而不是裸 map(String) —— 手写配置里的 `bind: [" 111"]` 带着空白留下来，判重认不出它与 "111" 是同一个号
    const prevBind = readIds(existing.bind)
    const nextBind = [...new Set([...prevBind, ...bind])]
    // 已有配置值走 normalizeEndpoint：它不做协议校验，只把地址收成核心 origin
    const nextUrl = normalizeEndpoint(existing.url || url)

    // 注意：明确要绑的账号必须从 existing.exclude 里放出来 —— exclude 优先级更高，留着它这个号永远派生不出运行时连接，两边却都显示已绑定
    const prevExclude = readIds(existing.exclude)
    const nextExclude = prevExclude.filter(id => !bind.includes(id))
    const freed = bind.filter(id => prevExclude.includes(id))

    /*
     * 停用状态下要顺手打开 —— 这条指令的语义就是「添加并立即启动」。
     * 注意：不打开的话首装最常见那条路必然失败。出厂示例连接是 `enable: false`（没绑账号前不该去连），
     * 地址又恰好是 ws://127.0.0.1:8765，于是填这个地址会被 findSameCore 命中、走到本分支；
     * 只写 bind 的话保存后它仍是停用的，validate 那条「这个账号保存后要有运行时连接」不成立 →
     * 整次保存被取消，而回给用户的是一句在讲路由与 exclude 的话。显式传了 enable=false 的照他说的办
     */
    const nextEnable = enableInput !== undefined ? enableInput : true

    // 注意：校验的是合并后的真实状态，不是输入里那几个字段 —— existing.exclude 原样留着时，
    // 拿指令里的 exclude 去校验等于校验一份「谁都没看过」的组合
    const accountsErr = nextEnable
      ? requireAccounts({ url: nextUrl, bind: nextBind, exclude: nextExclude })
      : undefined
    if (accountsErr) errors.push({ code: "accounts_required", message: accountsErr })

    if (explicit && !nextBind.length) errors.push({ code: "bot_id_without_bind" })
    if (errors.length) return { ok: false, errors }

    const patch: ConnectionPatch = { bind: nextBind }
    if (nextEnable !== isEnabled(existing)) patch.enable = nextEnable
    if (freed.length) patch.exclude = nextExclude.length ? nextExclude : null
    if (nextUrl !== existing.url) patch.url = nextUrl
    if (existing.bot_id) patch.bot_id = null

    return {
      ok: true,
      errors: [],
      requested: bind,
      explicit,
      merge: { index, existing, patch, freed, nextBind, nextExclude, nextUrl, nextEnable },
    }
  }

  const enable = enableInput === undefined ? true : enableInput
  const accountsErr = enable ? requireAccounts({ url, bind, exclude }) : undefined
  if (accountsErr) errors.push({ code: "accounts_required", message: accountsErr })
  if (explicit && !bind.length) errors.push({ code: "bot_id_without_bind" })
  if (errors.length) return { ok: false, errors }

  let name = (input.name || "").trim() || `core${list.length + 1}`
  // 判重连 url 一起比：没起名字的连接拿地址当显示名，只比 name 会与它撞
  if (list.some(c => (c.name || c.url) === name)) name = `${name}-${Date.now().toString(36)}`

  // 标 WsConnection 而不是让它自己推：空的 exclude 会被推成 never[]（TS7018），而这个对象要同时写进 yaml 与传给 startClient
  const conf: WsConnection = {
    name,
    url,
    token: input.token ?? null,
    enable,
    reconnect_interval: interval ?? 5,
    // retry=0 要能写进去（那是「无限重连」的显式选择），所以不能用 `|| 默认值`
    max_reconnect_attempts: retry ?? DEFAULT_MAX_RECONNECT,
    bind,
    exclude,
  }

  return {
    ok: true,
    errors: [],
    requested: bind,
    explicit,
    create: { conf, sourceIndex: list.length },
  }
}

/**
 * @description 修改一条已有连接：算 patch 与合并后状态
 * @param hit 已定位好的连接。定位不在本模块 —— find() 是 1 起、locate() 是 0 起，两个基准各自保留
 * @param urlOverride 调用方已解析好的新地址。面板要先判「这一栏动过没有」（它回填的是脱敏串），
 *   指令层要搬旧地址的查询参数，两边的判定各自不同，所以地址由调用方给成品，本模块只管写不写进 patch
 *
 * 注意：patch 的键序即指令层回执里「xx 已更新」的顺序，改动顺序会改回执文案
 */
export function planEdit(
  input: ConnInput,
  hit: { index: number; conf: WsConnection },
  urlOverride?: string,
): PlanResult {
  const { errors, enable: enableInput, interval, retry } = normalize(input)
  const { conf } = hit

  const prevBind = readIds(conf.bind)
  const nextBind = input.bind ? applyListOp(prevBind, input.bind.ids, input.bind.op) : prevBind
  const prevExclude = readIds(conf.exclude)
  const nextExclude = input.exclude
    ? applyListOp(prevExclude, input.exclude.ids, input.exclude.op)
    : prevExclude

  const nextUrl = urlOverride ?? normalizeEndpoint(String(conf.url || ""))
  const nextEnable = enableInput === undefined ? isEnabled(conf) : enableInput
  const explicit = (input.bot_id || "").trim()

  // 改成「自动端点 + 没有有效账号」等于把连接改死，写盘前就拦掉
  const accountsErr = nextEnable
    ? requireAccounts({ url: nextUrl, bind: nextBind, exclude: nextExclude })
    : undefined
  if (accountsErr) errors.push({ code: "accounts_required", message: accountsErr })
  if (explicit && !nextBind.length) errors.push({ code: "bot_id_without_bind" })
  if (errors.length) return { ok: false, errors }

  const patch: ConnectionPatch = {}
  if (nextUrl !== conf.url) patch.url = nextUrl
  if (input.name !== undefined) patch.name = input.name
  if (input.token !== undefined) patch.token = input.token
  /*
   * 覆写 url 时把内联凭据搬进 token 字段。
   * 注意：`url=10.0.0.5:8765` 写的是裸地址，而旧地址的凭据只存在于 `?token=` 里、跟着地址一起没了 ——
   * 改完不报错、下次握手直接无凭据，症状和地址毫无关系。面板那边更隐蔽：它回填的是脱敏地址，
   * 提交回来的新地址不带查询串，而面板没有任何字段能把凭据填回来（token 留空表示「不改」）。
   * 显式给了 token、或新地址已内联凭据时不搬 —— 那是用户的意图
   */
  if (patch.url !== undefined && patch.token === undefined) {
    const carried = inlineToken(conf.url)
    if (carried !== null && inlineToken(patch.url) === null) patch.token = carried
  }
  // 显式平台标识按 bind 账号写入 bot_id_map；任何改动都顺手清掉连接上的旧字段
  if (input.bot_id !== undefined || conf.bot_id) patch.bot_id = null
  if (enableInput !== undefined) patch.enable = enableInput
  if (interval !== undefined) patch.reconnect_interval = interval
  if (retry !== undefined) patch.max_reconnect_attempts = retry
  if (input.bind) patch.bind = nextBind
  if (input.exclude) patch.exclude = nextExclude

  return {
    ok: true,
    errors: [],
    // -= 移除时不能拿结果当「本次要绑的」：那会要求「这些留下来的账号保存后必须连上」，
    // 而这次操作的意图恰恰是减账号
    requested: input.bind && input.bind.op !== "remove" ? input.bind.ids : [],
    explicit,
    merge: {
      index: hit.index,
      existing: conf,
      patch,
      nextBind,
      nextExclude,
      nextUrl,
      nextEnable,
    },
  }
}

/**
 * @description 合并/新建时往 bot_id_map 写平台标识的闭包，两边写盘调用共用
 * @param targets 本次点明要绑的账号 —— 判据是它而不是最终 bind：后者含这条连接上的老账号，替他们改平台标识是越权
 * @param all 最终要遍历的账号
 * 注意：显式 bot_id 那一支必须 force —— 老连接上多半已有一行自动推断的映射，而 writeAccountBotId 默认
 * 「有值就不写」，用户明确填的会静默失效；不带 explicit 的那一支保持不覆盖，那只是推断，不该盖掉用户记录
 */
export function botmapWriter(all: (string | number)[], targets: string[], explicit: string) {
  return (doc: Parameters<typeof writeAccountBotId>[0]) => {
    for (const id of all) {
      if (explicit && targets.includes(String(id)))
        writeAccountBotId(doc, id, explicit, undefined, true)
      else writeAccountBotId(doc, id, undefined, config.bot_id_map)
    }
  }
}

/**
 * @description edit 的 bot_id_map 写入：没给显式标识时沿用连接上的旧字段，再按形状补
 * 注意：与 {@link botmapWriter} 分开而不是加参数 —— add 那边没有「连接上原有 bot_id」这个概念
 */
export function editBotmapWriter(
  nextBind: string[],
  explicit: string,
  legacy: string | undefined,
  bindChanged: boolean,
) {
  return (doc: Parameters<typeof writeAccountBotId>[0]) => {
    if (explicit) {
      for (const id of nextBind) writeAccountBotId(doc, id, explicit, undefined, true)
      return
    }
    if (legacy) for (const id of nextBind) writeAccountBotId(doc, id, legacy)
    if (bindChanged) writeAccountBotIds(doc, nextBind, config.bot_id_map)
  }
}
