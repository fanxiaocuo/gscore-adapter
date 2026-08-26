import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"
import type { Document, ParsedNode, YAMLSeq } from "yaml"
import chokidar from "chokidar"
import { PluginPath, ConfigPath } from "@/dir"
import {
  validateConnections,
  type RuntimeExpectation,
  type ValidationResult,
} from "@/modules/client/validate.js"
import type { AdapterEvent, Config, WsConnection } from "@/types"
import { isChannel } from "@/utils/session.js"
import { guessPlatform, isQQBotAppId } from "@/utils/platform.js"
import { getBot, botProfile, type BotProfile } from "@/utils/bots.js"
import { unflow } from "./yaml.js"
import { upgradeUserConfig } from "./upgrade.js"
export { writeAccountBotId, writeAccountBotIds, syncConnectionAccounts } from "./botmap.js"

/**
 * @description 默认值随插件发布（resources/config/），用户配置目录被 .gitignore 忽略，升级不覆盖用户改动
 * 路径由 dir.ts 从 import.meta.url 推导，插件改名或换目录都不受影响。
 */
const defFile = path.join(ConfigPath, "default_config.yaml")
const userDir = path.join(PluginPath, "config")
// 测试用：指向临时文件，避免动用户的真实配置
const userFile = process.env.GSCORE_CONFIG || path.join(userDir, "config.yaml")

/** @description 深合并：数组整体覆盖，对象递归 */
function merge(def: unknown, user: unknown): unknown {
  if (user === undefined) return def
  if (Array.isArray(def) || Array.isArray(user)) return user ?? def
  if (typeof def !== "object" || def === null) return user ?? def
  if (typeof user !== "object" || user === null) return user ?? def
  const defaults = def as Record<string, unknown>
  const overrides = user as Record<string, unknown>
  const ret: Record<string, unknown> = { ...defaults }
  for (const key of Object.keys(overrides)) ret[key] = merge(defaults[key], overrides[key])
  return ret
}

/**
 * @description 摘掉 filter 下所有列表字段里的 null/undefined/空串项（`0` 是合法值，原样保留）
 * 空项不减 length 而判据全是 `?.length && …`，后果全是静默的：white_group 有空项会停掉全部群上报，
 * block_prefix / block_include 有空串会停掉全部上报，prefix 有空串让 only_reply_at 形同废止。
 * 注意：清洗放在读取侧，锅巴（云崽只洗经过锅巴的写入）与手写 yaml 两条来路都覆盖。
 */
function pruneFilterLists(conf: Config): Config {
  const f = conf.filter
  if (!f || typeof f !== "object") return conf
  for (const [key, value] of Object.entries(f)) {
    if (!Array.isArray(value)) continue
    const kept = value.filter(i => i != null && i !== "")
    if (kept.length !== value.length) (f as Record<string, unknown>)[key] = kept
  }
  return conf
}

function read(file: string, optional = false) {
  try {
    return YAML.parse(fs.readFileSync(file, "utf8")) || {}
  } catch (err) {
    if (optional && (err as NodeJS.ErrnoException)?.code === "ENOENT") return {}
    globalThis.Bot?.makeLog?.("error", ["读取配置失败", file, err], "GsCore")
    return {}
  }
}

function load(migrate = false) {
  // 首次运行自动生成用户配置（仅此一次写盘）
  if (!fs.existsSync(userFile)) {
    try {
      // 注意：config/ 被 .gitignore 忽略，全新 clone 里目录不存在，不先建会 ENOENT
      fs.mkdirSync(path.dirname(userFile), { recursive: true })
      fs.copyFileSync(defFile, userFile)
      globalThis.Bot?.makeLog?.("mark", `已生成配置 ${userFile}`, "GsCore")
    } catch (err) {
      globalThis.Bot?.makeLog?.("error", ["生成配置失败", err], "GsCore")
    }
  } else if (migrate) {
    // 已有配置：把默认里后加的顶层项连注释补进去，并迁旧连接。
    // 注意：只在模块首次求值时做，热重载再跑会把用户事后拆开的连接又合并回去
    try {
      const changes = upgradeUserConfig(userFile)
      if (changes.length)
        globalThis.Bot?.makeLog?.(
          // 注意：别提「已备份为 .bak」，那份备份只在首次升级时生成（见 upgrade.ts）
          "mark",
          `配置已升级：${changes.join("、")}`,
          "GsCore",
        )
    } catch (err) {
      globalThis.Bot?.makeLog?.("error", ["升级配置失败，按原配置运行", err], "GsCore")
    }
  }
  return pruneFilterLists(merge(read(defFile), read(userFile, true)) as Config)
}

/**
 * @description 读重载候选配置，解析失败照抛，不像 read() 那样退成空配置
 * @param userText 用户文件的原文。watcher 传它进来是为了「读一次、就解析那一份」——
 *                 自己再读一遍的话，两次读之间文件可能又变了，于是校验的是 A、落地的是 B
 */
function loadStrict(userText?: string) {
  const defaults = YAML.parse(fs.readFileSync(defFile, "utf8")) || {}
  const text = userText ?? (fs.existsSync(userFile) ? fs.readFileSync(userFile, "utf8") : "")
  const user = YAML.parse(text) || {}
  return pruneFilterLists(merge(defaults, user) as Config)
}

/**
 * @description 配置对象，热重载时原地更新（delete + assign）
 * 保证其它模块已 import 的引用同步生效。
 */
export const config: Config = load(true)

/** @description 用户配置文件路径，供报错信息与管理指令使用 */
export const configFile = userFile

/**
 * @description 当前已生效的那份用户配置原文，watcher 用它判断「文件到底变没变」
 *
 * 原先这里是一个 `selfWrite` 布尔闩：saveConfig 写盘前置位，watcher 收到事件就清位并跳过。
 * 那个做法有个静默的洞 —— 自己写盘与用户手改挨得近时，两次写会被合并成**一个** change 事件，
 * 闩把它当成「我写的」吞掉，用户在文件管理器里改的东西就此不生效，且一条日志都没有。
 * 比内容比闩靠得住：内容一样就是真没变（谁写的都一样，没什么要重载的），
 * 内容不一样就一定要重载。重复事件、事件合并、事件丢失，三种情况都不再影响正确性。
 */
let loadedText = fs.existsSync(userFile) ? fs.readFileSync(userFile, "utf8") : ""

/**
 * @description 配置重载时要清掉的缓存
 * 注意：用回调注册而不是直接 import —— utils/media.ts 依赖 @/config，反向 import 会成环
 */
const invalidators: (() => void)[] = []

/** @description 注册一个"配置变了就清缓存"的回调 */
export function onConfigReload(fn: () => void) {
  invalidators.push(fn)
}

function replaceConfig(next: Config) {
  for (const k of Object.keys(config)) delete (config as Partial<Config>)[k as keyof Config]
  Object.assign(config, next)
  for (const fn of invalidators)
    try {
      fn()
    } catch {
      // 清缓存失败不该影响重载本身
    }
}

function reload() {
  replaceConfig(load())
}

/**
 * @description online 之前不碰连接：watcher 在本模块求值时就装好，而登录要几秒到几十秒
 * 提前拉起会撞上 e.isMaster 尚未定义、消息落到还没有登录号的全局 Bot（同 src/index.ts 顶部那条）。
 * 跳过不丢改动：online 那一刻的 startClients 读的是当时的配置。
 * 注意：latch 由 src/index.ts 的 online 钩子推过来 —— 本模块求值早于 Bot 就绪，自己 `Bot?.once?.()` 会静默不注册、latch 永远为 false
 */
let online = false

/** @description 由 src/index.ts 的 online 钩子调用；见 {@link online} */
export function markOnline() {
  online = true
}

/**
 * @description 把跑着的连接收敛到刚重载的配置，返回一句接在「配置已重载」后面的话
 * 手改 yaml 是第四个配置入口（指令 / 面板 / 锅巴 / 手改），另外三个都在自己那头收敛了，只有它没人替它做。
 * 注意：lifecycle 静态 import 了本模块，只能动态 import 才不成环
 * 注意：不能挂 onConfigReload —— saveConfig 也走那条路，且拿不到「本次改的是哪一条」，会把所有来源的展开诊断重打一遍
 */
async function converge(): Promise<string> {
  if (!online) return "，连接等登录完成后按新配置拉起"
  try {
    const { applyConnections } = await import("@/modules/client/lifecycle.js")
    const r = applyConnections()
    // 不传 sourceIndex：手改 yaml 可以一次动任意多条，没有「本次那一条」可收窄
    const moved: string[] = []
    if (r.started) moved.push(`起 ${r.started}`)
    if (r.stopped) moved.push(`停 ${r.stopped}`)
    if (r.restarted) moved.push(`重起 ${r.restarted}`)
    // 只改了名字 / bind 这类懒读字段时一条都不用停起，报「无需停起」而不是看着没生效的「起 0 停 0」
    return moved.length ? `，连接已收敛（${moved.join("、")}）` : "，跑着的连接无需停起"
  } catch (err) {
    // 收敛失败不连累重载本身：配置已经是新的了，那句话该照报
    globalThis.Bot?.makeLog?.("error", ["按新配置收敛连接失败", err], "GsCore")
    return "，但连接没能按新配置收敛"
  }
}

/**
 * @description 手改配置文件后的重载。读一次原文，与已生效的那份比，真变了才走校验与落地
 * 注意：读文件与解析用同一份原文（loadStrict 收 text）—— 分两次读的话校验的是 A、落地的是 B
 */
async function onFileChanged() {
  let text: string
  try {
    text = fs.readFileSync(userFile, "utf8")
  } catch (err) {
    // 保存过程中文件可能短暂不可读（重命名替换的中间态），下一次事件会补上
    globalThis.Bot?.makeLog?.("debug", ["读配置失败，等下一次改动", err], "GsCore")
    return
  }

  // 内容没变：自己写盘后 saveConfig 已经 reload 过，用户手改成一模一样的也没什么要重载的
  if (text === loadedText) return

  try {
    const next = loadStrict(text)
    const list = Array.isArray(next.client?.connections) ? next.client.connections : []
    const result = validateConnections(list)
    if (!result.ok) {
      globalThis.Bot?.makeLog?.(
        "error",
        ["配置重载校验失败", new ConnectionValidationError(result)],
        "GsCore",
      )
      return
    }
    loadedText = text
    replaceConfig(next)
    globalThis.Bot?.makeLog?.("mark", `配置已重载${await converge()}`, "GsCore")
  } catch (err) {
    globalThis.Bot?.makeLog?.("error", ["配置重载校验失败", err], "GsCore")
  }
}

/**
 * @description 合并短时间内的多次事件，只按最后那一次读文件
 *
 * 编辑器保存不是一次原子写：多数是「先截断、再分块写」，chokidar 会在中间态就报一次 change。
 * 那一刻读到的是半截 yaml —— 解析得到的是个残缺对象，与默认值合并后**用户配的项静默变回默认**，
 * 而日志照样报「配置已重载」。实测过：截断后立刻读到的 media_max_size 就是默认值。
 * 合并之后只读稳定下来的那一份。awaitWriteFinish 也开着，两道一起兜
 */
let debounce: NodeJS.Timeout | undefined
function scheduleReload() {
  clearTimeout(debounce)
  debounce = setTimeout(() => void onFileChanged(), 400)
}

/*
 * cfg.bot.file_watch 为 false 时框架已全局 stub 掉 chokidar.watch，此处自动尊重。
 * 注意：add 也要收 —— 部分编辑器与文件管理器的保存是「删掉再新建」而不是原地改，
 * 那种形状下只有 add 事件；内容比对让重复触发不产生副作用，多收一种事件没有代价
 */
const watcher = chokidar
  .watch(userFile, { awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 } })
  .on("change", scheduleReload)
  .on("add", scheduleReload)

/**
 * @description 停掉配置监听，返回 close() 的 promise
 * 注意：chokidar v4 的 FSWatcher 没有 unref()，不显式 close 会一直持有事件循环 —— 测试进程会挂到超时被杀，只留一句 'test failed'
 */
export function stopConfigWatch(): Promise<void> {
  // 在途的那次合并也要取消：留着它会在 watcher 关掉之后再读一次盘，测试里表现为跑完仍挂着一个 timer
  clearTimeout(debounce)
  return watcher.close()
}

/**
 * @description saveConfig 回调收到的 yaml 文档
 * Strict 取 false（第二个类型参数）：路径都是运行时拼出来的字符串数组，Strict 为 true 时
 * getIn 返回 unknown，每个 `doc.getIn(path).add(...)` 调用点都要补一次 `as YAMLSeq`。
 */
export type ConfigDoc = Document.Parsed<ParsedNode, false>

/**
 * @description 修改用户配置并写盘，保留原有注释
 * 注意：只能像 fn 这样逐节点改 Document，不能 YAML.stringify 整个对象，那会丢掉用户所有注释
 * @param fn 直接操作 yaml Document
 */
export function saveConfig(fn: (doc: ConfigDoc) => void) {
  let doc: ConfigDoc
  try {
    doc = YAML.parseDocument<ParsedNode, false>(fs.readFileSync(userFile, "utf8"))
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT")
      doc = YAML.parseDocument<ParsedNode, false>(fs.readFileSync(defFile, "utf8"))
    else throw err
  }

  fn(doc)

  const text = unflow(doc).toString({ lineWidth: 0 })
  // 记下自己写的这一份：watcher 拿它比对，认出「这次改动是我干的」而跳过重载
  loadedText = text
  fs.writeFileSync(userFile, text)
  reload()
  return config
}

export class ConnectionValidationError extends Error {
  constructor(public readonly result: ValidationResult) {
    super(result.errors.map(issue => issue.message).join("\n"))
    this.name = "ConnectionValidationError"
  }
}

/**
 * @description 在内存里的 yaml 文档上改连接，校验完整的连接集通过后才落盘
 */
export function saveConnectionConfig(
  fn: (doc: ConfigDoc) => void,
  expectations: RuntimeExpectation[] = [],
): ValidationResult {
  let result: ValidationResult | undefined

  saveConfig(doc => {
    fn(doc)
    const next = merge(read(defFile), doc.toJS() || {}) as Config
    const list = Array.isArray(next.client?.connections) ? next.client.connections : []
    result = validateConnections(list, expectations)
    if (!result.ok) throw new ConnectionValidationError(result)
  })

  return result as ValidationResult
}

/** @description 读取 WebSocket 连接列表（保证是数组） */
export function getWsConnections() {
  const list = config.client?.connections
  return Array.isArray(list) ? list : []
}

/**
 * @description 取用户文档里的 client.connections 序列，缺失时把当前生效的列表原样物化进去
 * 用户文件没写过这个键时运行时列表来自默认配置的示例连接：指令能看到它、能删它，而 saveConfig 操作的
 * 用户文档里根本没这个键，直接 deleteIn/setIn 会抛 `Expected YAML collection at connections`。
 * 物化后删除示例连接会留下 `connections: []`，靠「数组整体覆盖」的合并规则不再从默认值冒出来。
 * 注意：`client` 存在但不是 map（手改成 null / 标量）时要先删再建，否则 setIn 在 client 那一层抛同样的错
 */
function ensureWsConnections(doc: ConfigDoc): YAMLSeq {
  const target = ["client", "connections"]
  const node = doc.getIn(target, true)
  if (YAML.isSeq(node)) return node as YAMLSeq

  const client = doc.get("client", true)
  if (client !== undefined && !YAML.isMap(client)) doc.delete("client")
  doc.setIn(target, doc.createNode(getWsConnections()))
  return doc.getIn(target, true) as YAMLSeq
}

/** @description updateConnection 的补丁：undefined 的键跳过（没改），null 删除该键 */
export type ConnectionPatch = { [K in keyof WsConnection]?: WsConnection[K] | null }

/**
 * @description 以下三个函数是连接的增 / 改 / 删，指令、Web 面板等入口共用
 * 调用方只负责把用户输入校验成 patch / conf，以及把抛出来的错误变成一句能回给用户的话 ——
 * 校验刻意留在调用方：指令回中文短句、面板回 400 JSON，措辞与时机都不同。
 */

/** @description 追加一条连接并写盘；extra 在同一次保存里执行（如添加时顺手记 bot_id_map） */
export function appendConnection(
  conf: WsConnection,
  extra?: (doc: ConfigDoc) => void,
  expectations?: RuntimeExpectation[],
) {
  const sourceIndex = getWsConnections().length
  return saveConnectionConfig(
    doc => {
      ensureWsConnections(doc).add(doc.createNode(conf))
      extra?.(doc)
    },
    expectations ?? [{ sourceIndex, action: "新增" }],
  )
}

/**
 * @description 对单条连接做增量修改并写盘
 * @param index 连接下标，与 getWsConnections() 的下标一致
 * @param patch 要写的字段。数组走 createNode（flow 风格由写盘出口的 unflow 拍平）
 */
export function updateConnection(
  index: number,
  patch: ConnectionPatch,
  extra?: (doc: ConfigDoc) => void,
  expectations?: RuntimeExpectation[],
) {
  return saveConnectionConfig(doc => {
    const item = ensureWsConnections(doc).get(index, true)
    if (!item || !YAML.isMap(item)) throw new Error(`连接序号 ${index + 1} 不存在`)
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      if (value === null) {
        item.delete(key)
        continue
      }
      item.set(key, Array.isArray(value) ? doc.createNode(value) : value)
    }
    extra?.(doc)
  }, expectations ?? [])
}

/** @description 删除一条连接并写盘 */
export function removeConnection(index: number) {
  return saveConnectionConfig(doc => {
    const seq = ensureWsConnections(doc)
    if (!seq.get(index, true)) throw new Error(`连接序号 ${index + 1} 不存在`)
    seq.delete(index)
  })
}

/**
 * @description 适配器是否启用，缺省 true（配置里没写过这项时按启用算）
 * 注意：每次调用都读当前 config 不缓存 —— index.ts 靠 onConfigReload 在这个值翻转时热起停连接，缓存住就又要重启才生效
 */
export function enabled(): boolean {
  return config.enable !== false
}

/** @description WebSocket 是否启用，缺省 true（旧配置里没写过这项时按启用算） */
export function wsEnabled(): boolean {
  return config.client?.enable_ws !== false
}

/** @description 某个账号当前会用的平台标识，供状态图 / 面板展示 */
export function accountPlatform(selfId: string | number): string {
  const sid = String(selfId ?? "").trim()
  if (!sid) return ""
  const map = config.bot_id_map || {}
  return map[sid] || guessPlatform(sid, getBot(sid)) || ""
}

/**
 * @description 档案叠加平台标识，bot_id_map 的显式映射优先于适配器推断
 * 用户手写的映射才是上报时真正用的值，被在线实例的猜测盖掉就成了假显示。
 * 平台为空时原样返回，不白拷一层 —— 消费方（面板整包、状态图胶囊）都只读。
 */
export function withPlatform(p: BotProfile): BotProfile {
  const platform = accountPlatform(p.id)
  return platform ? { ...p, platform } : p
}

/**
 * @description 按账号取档案并叠上平台标识，面板的绑定候选与状态图的 bind 胶囊共用
 * 注意：放在 config 而不是 utils/bots —— 那边不能反向 import @/config（见该文件头，会成 config↔bots 的环，
 * 表现为启动期 TDZ 崩）。
 */
export function profileWithPlatform(id: string | number): BotProfile {
  return withPlatform(botProfile(id))
}

/**
 * @description 这条频道事件是不是 QQ 家族的（只有它们才该报 qqguild）
 * 优先看账号形状（qg_ 前缀的频道级账号、QQBot 的 appid），账号缺失或认不出时退到适配器名。
 */
function isQQChannel(e: AdapterEvent, sid: string): boolean {
  if (sid.startsWith("qg_") || isQQBotAppId(sid)) return true
  const names = [e.bot?.adapter?.id, e.adapter_id, e.bot?.adapter?.name, e.adapter_name]
  return names.some(n => n === "QQBot" || n === "QQGuild")
}

/**
 * @description 解析上报用的平台 bot_id
 * 优先级：频道特判 > self_id 精确匹配 > 适配器 id > 适配器 name > 形状推断 > 兜底
 * 一条连接可以 bind 多个平台各异的账号（ICQQ → onebot、QQBot → qqgroup），所以按账号查 `bot_id_map`。
 * 注意：必须查 adapter.name，各适配器的 id 大量撞车（ICQQ / OneBotv11 / OPQBot 都是 "QQ"），而 e.adapter_id 取的是 id
 * 注意：频道特判压在账号级映射之前 —— QQBot-Plugin 群与频道共用 adapter.id 与 appid，只能按事件形状分，而账号级那行记的是群平台 qqgroup
 * 注意：查表全落空时先过 guessPlatform 再落 map.default，否则 wx_ / tg_ / dc_ 前缀与 QQBot appid 会全被兜成 onebot
 * @param selfId 调用方解析过的账号。不传则退回 e.self_id —— 它可能为 null，不过滤会拿字符串 "null" 去查表
 */
export function resolveBotId(e: AdapterEvent, _conf?: WsConnection | null, selfId?: string) {
  const map = config.bot_id_map || {}

  const sid = selfId ?? (e.self_id != null ? String(e.self_id) : "")

  // 频道判在账号级映射之前，理由见上面的注释
  if (isChannel(e) && isQQChannel(e, sid)) {
    // qg_ 前缀的账号键例外：那本身就是频道级账号，用户单独记它就是要例外
    if (sid.startsWith("qg_") && map[sid]) return map[sid]
    // 注意：兜死成 qqguild，退到 map.default / map[appid] / map.QQBot 会得到 qqgroup，对频道事件一定是错的
    return map.QQGuild || "qqguild"
  }

  // self_id 精确覆盖优先级最高（同一适配器下的不同账号可各指其一）
  const bySelf = sid ? map[sid] : undefined
  if (bySelf) return bySelf

  return (
    map[e.bot?.adapter?.id] ||
    map[e.adapter_id] ||
    map[e.bot?.adapter?.name] ||
    map[e.adapter_name] ||
    // 用户配的表全落空时按账号形状再推一次，别一律兜成 onebot
    guessPlatform(sid, e.bot) ||
    map.default ||
    "onebot"
  )
}
