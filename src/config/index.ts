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
import { getBot } from "@/utils/bots.js"
import { unflow } from "./yaml.js"
import { upgradeUserConfig } from "./upgrade.js"
export { writeAccountBotId, writeAccountBotIds, syncConnectionAccounts } from "./botmap.js"

/**
 * 默认值与用户配置分属两个目录：
 * 默认值随插件发布（resources/config/），用户配置整个目录被 .gitignore 忽略，
 * 升级时不会覆盖用户改动。
 *
 * 路径由 dir.ts 从 import.meta.url 推导，不再依赖 process.cwd() 与
 * 硬编码的 "plugins/gscore-adapter"，插件改名或换目录都不受影响。
 */
const defFile = path.join(ConfigPath, "default_config.yaml")
const userDir = path.join(PluginPath, "config")
// 测试用：指向临时文件，避免动用户的真实配置
const userFile = process.env.GSCORE_CONFIG || path.join(userDir, "config.yaml")

/** 深合并：数组整体覆盖，对象递归 */
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
      // config/ 被 .gitignore 忽略，全新 clone 里整个目录都不存在，
      // 直接 copyFileSync 会 ENOENT，所以先建目录
      fs.mkdirSync(path.dirname(userFile), { recursive: true })
      fs.copyFileSync(defFile, userFile)
      globalThis.Bot?.makeLog?.("mark", `已生成配置 ${userFile}`, "GsCore")
    } catch (err) {
      globalThis.Bot?.makeLog?.("error", ["生成配置失败", err], "GsCore")
    }
  } else if (migrate) {
    // 已有配置：把默认里后加的顶层项连注释补进去，并迁旧连接。
    // 只在模块首次求值时做；热重载再跑会把用户事后拆开的连接又合并回去。
    try {
      const changes = upgradeUserConfig(userFile)
      if (changes.length)
        globalThis.Bot?.makeLog?.(
          // 不再说「原文件备份为 .bak」——那份备份只在首次升级时生成（见 upgrade.ts
          // 里的理由），每次都这么说会让人以为手上那份是刚才这次的
          "mark",
          `配置已升级：${changes.join("、")}`,
          "GsCore",
        )
    } catch (err) {
      globalThis.Bot?.makeLog?.("error", ["升级配置失败，按原配置运行", err], "GsCore")
    }
  }
  return merge(read(defFile), read(userFile, true)) as Config
}

/** Read a reload candidate without converting parse failures into an empty config. */
function loadStrict() {
  const defaults = YAML.parse(fs.readFileSync(defFile, "utf8")) || {}
  const user = fs.existsSync(userFile) ? YAML.parse(fs.readFileSync(userFile, "utf8")) || {} : {}
  return merge(defaults, user) as Config
}

/**
 * 配置对象。热重载时原地更新（delete + assign），
 * 保证其它模块已 import 的引用同步生效。
 */
export const config: Config = load(true)

/** 用户配置文件路径，供报错信息与管理指令使用 */
export const configFile = userFile

/** 自己写盘时抑制一次 watcher 回调，避免重复重载 */
let selfWrite = false

/**
 * 配置重载时要清掉的缓存。
 * 用回调注册而不是直接 import——utils/media.ts 依赖 @/config，
 * 反向 import 会成环。
 */
const invalidators: (() => void)[] = []

/** 注册一个"配置变了就清缓存"的回调 */
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
 * online 之前不碰连接
 *
 * 理由与 src/index.ts 顶上那段是同一条：早于框架的 message 监听注册钩子会把我们排到
 * 监听器队列最前，正是 e.isMaster 尚未定义的那个顺序；核心此时下发消息也只能落到还
 * 没有登录号的全局 Bot 上，发错账号。而 watcher 在本模块求值时就装好了，登录要等几
 * 秒到几十秒 —— 这中间存一次 yaml 就会把连接提前拉起来。
 *
 * 跳过不丢改动：online 那一刻的 startClients 读的是**当时**的配置，这次改的照样生效。
 *
 * 为什么由 src/index.ts 推过来，而不是本模块自己 `Bot.once("online")`
 * ------
 * 本模块是所有人都 import 的最底层，求值时机比插件入口更早，`globalThis.Bot` 未必
 * 已经装好。自己注册就得写成 `globalThis.Bot?.once?.(…)`，而那个可选链在 Bot 还没
 * 就绪时**静默什么也不做** —— 于是这个latch 永远是 false，watcher 从此再也不收敛，
 * 没有任何一行日志指得到成因。src/index.ts 的 online 钩子是唯一权威的登录时点
 * （它那里 `Bot` 必然已就绪，用的是裸 `Bot.once`），从那边推过来就不存在这个失败态，
 * 也不用为同一件事装第二个监听器。
 */
let online = false

/** 由 src/index.ts 的 online 钩子调用；见 {@link online} 上面的说明 */
export function markOnline() {
  online = true
}

/**
 * 把跑着的连接收敛到刚重载的配置，并回一句「到底发生了什么」接在重载话术后面
 *
 * 为什么手改 yaml 也要收敛
 * ------
 * 原来这里只 reload()、然后回一句「连接变更需 #早柚重连」：配置是新的，跑着的连接还
 * 是旧的 —— 改完地址还得记着再敲一次指令，而面板与状态图读的是新配置，那段时间里
 * 「看到的」与「连着的」是两回事。手改文件是第四个配置入口（指令 / 面板 / 锅巴 /
 * 手改），另外三个都在自己那头收敛了，只有它没人替它做。
 *
 * 为什么是动态 import
 * ------
 * lifecycle 静态 import 了本模块（config / enabled / getWsConnections），顶上再静态
 * import 它就成环。本模块是所有人都 import 的最底层，环一成，谁先求值就成了 import
 * 顺序的运气，症状是 lifecycle 读到还没赋值的 config。动态 import 把这条依赖推到
 * 「真的有人改了文件」那一刻，那时两边早求值完了；ESM 有模块缓存，不会每次重新求值。
 *
 * 为什么不挂 onConfigReload
 * ------
 * 那套回调的语义是「配置变了就清缓存」，而 reload() 由 watcher **和 saveConfig** 共同
 * 调用 —— 挂上去等于指令 / 面板每写一次盘都先收敛一遍，紧接着入口自己再收敛一遍。
 * 更要紧的是挂在那里拿不到「本次改的是哪一条」，那多出来的一遍会把**所有**来源的展开
 * 诊断重打一次：点一下与本次操作无关的开关，控制台就再刷一遍别条连接的冲突报错，看着
 * 像刚出的新故障（logErrors 的 only 参数正是为了消掉这个）。所以收敛只留在这条唯一
 * 没有入口替它做的路径上。
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
    // 只改了名字 / bind 这类懒读字段时一条都不用停起（收敛器原地换 conf），
    // 报「无需停起」而不是「起 0 停 0」—— 后者看着像什么都没生效
    return moved.length ? `，连接已收敛（${moved.join("、")}）` : "，跑着的连接无需停起"
  } catch (err) {
    // 收敛失败不能连累重载本身：配置已经是新的了，那句话该照报
    globalThis.Bot?.makeLog?.("error", ["按新配置收敛连接失败", err], "GsCore")
    return "，但连接没能按新配置收敛"
  }
}

// cfg.bot.file_watch 为 false 时框架已全局 stub 掉 chokidar.watch，此处自动尊重
const watcher = chokidar.watch(userFile).on("change", async () => {
  if (selfWrite) {
    selfWrite = false
    return
  }
  try {
    const next = loadStrict()
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
    replaceConfig(next)
    globalThis.Bot?.makeLog?.("mark", `配置已重载${await converge()}`, "GsCore")
  } catch (err) {
    globalThis.Bot?.makeLog?.("error", ["配置重载校验失败", err], "GsCore")
  }
})

/**
 * 停掉配置监听
 *
 * chokidar v4 的 FSWatcher **没有 unref()**（只有 close()），所以它会一直持有
 * 事件循环 —— 表现是任何 import 过本模块的 node 进程都不会自己退出。
 * 插件跑在常驻的云崽里时这不是问题，但测试进程会挂住直到超时被杀，
 * 且失败信息只有一句 'test failed'，看不出原因。
 *
 * 所以提供一个显式的收尾入口。返回 promise 是因为 close() 是异步的。
 */
export function stopConfigWatch(): Promise<void> {
  return watcher.close()
}

/**
 * saveConfig 回调收到的 yaml 文档
 *
 * Strict 取 false（第二个类型参数），因为几个写入点是 `doc.getIn(path).add(...)`：
 * Strict 为 true 时 getIn 返回 unknown，那一句要在每个调用点补一次
 * `as YAMLSeq`。yaml 库自己就是用这个开关表达「按动态结构操作」的，
 * 而这里的路径全是运行时拼出来的字符串数组，本来就没有静态结构可依。
 */
export type ConfigDoc = Document.Parsed<ParsedNode, false>

/**
 * 修改用户配置并写盘，保留原有注释
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

  selfWrite = true
  fs.writeFileSync(userFile, unflow(doc).toString({ lineWidth: 0 }))
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
 * Apply a connection-related edit to an in-memory YAML document, validate the
 * complete resulting connection set, and only then replace the on-disk config.
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

/** 读取 WebSocket 连接列表（保证是数组） */
export function getWsConnections() {
  const list = config.client?.connections
  return Array.isArray(list) ? list : []
}

/**
 * 取用户文档里的 client.connections 序列，缺失时物化当前生效的列表
 *
 * 为什么不能只报错
 * --------------
 * 运行时的连接列表是深合并出来的：用户文件里**没有** connections 时，
 * 列表来自默认配置的那条示例连接 —— #早柚连接列表 看得到它、能对它发
 * 删除/停用指令，但 saveConfig 操作的是用户文档，那里根本没有这个键。
 * 原来直接 deleteIn/setIn 会抛 `Expected YAML collection at connections`；
 * 后来改成报「请先执行配置迁移」也不对 —— 用户什么都没配错，只是还没写过这个键。
 *
 * 所以把「用户此刻看到的列表」原样写进文档再操作：删除示例连接会留下
 * `connections: []`，运行时合并规则（数组整体覆盖）让它从此不再从默认值
 * 冒出来，与用户的预期一致。文件里已有正常序列时本函数只是取出它，零改动。
 *
 * `client` 键存在但不是 map（手改成了 null / 标量）时先删掉再建 ——
 * 不删的话 setIn 会在 client 那一层抛同样的 collection 错误。
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

/**
 * updateConnection 的补丁
 *
 * undefined 的键跳过（没改），null 删除该键。
 */
export type ConnectionPatch = { [K in keyof WsConnection]?: WsConnection[K] | null }

/**
 * 连接的增 / 改 / 删，三个入口（指令、Web 面板、将来可能的新入口）共用
 * ------------------------------------------------------------------
 * 原来两边各写一遍「ensureWsConnections → 取条目 → 校验是 map → 逐字段 setIn」，
 * 同一句「连接序号 X 不存在」出现在四处。收敛到这里之后调用方只负责两件事：
 * 把用户输入校验成 patch / conf，以及把抛出来的错误变成一句能回给用户的话。
 *
 * 校验刻意留在调用方：指令要回中文短句、面板要回 400 JSON，错误的措辞与
 * 时机（写盘前逐条回）不同，塞进这里会让两边都别扭。
 */

/** 追加一条连接并写盘。extra 在同一次保存里执行（如添加时顺手记 bot_id_map） */
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
 * 对单条连接做增量修改并写盘
 *
 * @param index 连接下标，与 getWsConnections() 的下标一致
 * @param patch 要写的字段。数组走 createNode（flow 风格由写盘出口的 unflow 拍平）
 */
export function updateConnection(
  index: number,
  patch: ConnectionPatch,
  extra?: (doc: ConfigDoc) => void,
  expectations?: RuntimeExpectation[],
) {
  return saveConnectionConfig(
    doc => {
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
    },
    expectations ?? [],
  )
}

/** 删除一条连接并写盘 */
export function removeConnection(index: number) {
  return saveConnectionConfig(doc => {
    const seq = ensureWsConnections(doc)
    if (!seq.get(index, true)) throw new Error(`连接序号 ${index + 1} 不存在`)
    seq.delete(index)
  })
}

/**
 * 适配器是否启用
 *
 * 每次调用都读当前 config，不缓存 —— index.ts 靠 onConfigReload 在这个值翻转时
 * 热起停连接，缓存住就又要重启才生效了。
 *
 * 缺省为 true：配置里没写过这项时按启用算，与「装了插件就想用」一致。
 */
export function enabled(): boolean {
  return config.enable !== false
}

/**
 * WebSocket 是否启用
 *
 * 缺省为 true：旧配置里没写过这项时按启用算，兼容性优先。
 */
export function wsEnabled(): boolean {
  return config.client?.enable_ws !== false
}

/**
 * 解析上报用的平台 bot_id
 *
 * 优先级：self_id 精确匹配 > 频道特判 > 适配器 id > 适配器 name > 形状推断 > 兜底
 *
 * 一条连接可以 bind 多个账号，平台可能各不相同（ICQQ → onebot、QQBot → qqgroup），
 * 所以按账号查 `bot_id_map`。显式 `id=` 也是写进这张表。
 *
 * 为什么要查 name
 * --------------
 * 框架填的 e.adapter_id 取自 adapter.**id**（lib/bot.js:346），而实测本机各适配器
 * 的 id 与 name 大量不一致，且 id 严重撞车：
 *
 *   插件          adapter.id   adapter.name
 *   ICQQ-Plugin   QQ           ICQQ
 *   OneBotv11     QQ           OneBotv11
 *   OPQBot        QQ           OPQBot
 *   ComWeChat     WeChat       ComWeChat
 *   QQBot-Plugin  QQBot        QQBot
 *   Milky         Milky        Milky
 *
 * 老配置把键写成了 ICQQ / OneBotv11 / OPQBot / ComWeChat —— 那些是 name，
 * 用 id 查永远命中不了，只是恰好都该映射成 onebot，靠 default 兜底掩盖了。
 * 反过来只查 id 也不行：ICQQ / OneBot / OPQBot 三家 id 同为 "QQ"，
 * 想给其中一家单独指定平台标识就做不到。
 *
 * 所以两者都查、id 优先 name 兜底：既保持「精确到具体适配器」的能力
 * （写 name 命中唯一一家），又让 "QQ" 这种粗粒度键可用。
 *
 * 查表全落空之后还有一层
 * -------------------
 * 原来落空就直接 `map.default || "onebot"`。那对非 QQ 平台的账号是错的：
 * wx_ / tg_ / dc_ 这些前缀在默认 bot_id_map 里根本没有键，QQBot 的 appid
 * 也不在表里，全都被 default 兜成 onebot，核心侧收到的平台标识就是错的。
 * 所以在 default 之前插一次 `guessPlatform` —— 它按账号前缀与 appid 形状判断，
 * 不依赖用户有没有配对那张表。见 utils/platform.ts。
 *
 * 频道要压在账号级映射之前
 * ---------
 * QQBot-Plugin 用**同一个** adapter（id 恒为 QQBot）、同一个 appid 同时处理 QQ 群
 * 与 QQ 频道，所以按适配器或按账号查表都分不开这两者 —— 而核心侧 qqgroup 与
 * qqguild 是两个平台。判据只能来自事件形状，见 utils/session.ts 的 isChannel。
 *
 * 账号级那行记的是这个 appid 的**群**平台（seedAccountBotIds 自动补的就是
 * qqgroup），一旦排在频道特判之前，频道消息就会按群消息上报 —— 核心拿 qqgroup
 * 处理频道会话，静默出错，用户那头只看到「功能怪异」。所以频道判在最前面。
 *
 * 但只有 QQ 家族的频道才该报 qqguild：isChannel 只看事件形状，KOOK / Discord
 * 的频道消息也会命中，那些得按自己的账号形状推。见 isQQChannel。
 * 键名 QQGuild 与 xiowo/yunzai-gscore-adapter 的 ADAPTER_BOT_ID_MAP 对齐。
 */
/**
 * @param selfId 调用方解析过的账号。不传则退回 e.self_id ——
 *               但它可能为 null，那时 `String(null)` 会拿字符串 "null" 去查表，
 *               既查不中又可能撞上用户真写了 "null" 键的极端情况，故一律先过滤。
 */
/** 某个账号当前会用的平台标识，供状态图 / 面板展示 */
export function accountPlatform(selfId: string | number): string {
  const sid = String(selfId ?? "").trim()
  if (!sid) return ""
  const map = config.bot_id_map || {}
  return map[sid] || guessPlatform(sid, getBot(sid)) || ""
}

/**
 * 这条频道事件是不是 QQ 家族的
 *
 * 只有它们的频道该报 qqguild。判据优先看账号形状（qg_ 前缀的频道级账号、
 * QQBot 的 appid 形状），账号缺失或形状认不出时退到适配器名 —— QQBot-Plugin
 * 的群与频道共用 adapter.id，光看适配器分不出群还是频道，但足以确认「是 QQ」。
 */
function isQQChannel(e: AdapterEvent, sid: string): boolean {
  if (sid.startsWith("qg_") || isQQBotAppId(sid)) return true
  const names = [e.bot?.adapter?.id, e.adapter_id, e.bot?.adapter?.name, e.adapter_name]
  return names.some(n => n === "QQBot" || n === "QQGuild")
}

export function resolveBotId(e: AdapterEvent, _conf?: WsConnection | null, selfId?: string) {
  const map = config.bot_id_map || {}

  const sid = selfId ?? (e.self_id != null ? String(e.self_id) : "")

  // 频道判在账号级映射之前，理由见上面的注释
  if (isChannel(e) && isQQChannel(e, sid)) {
    // qg_ 前缀的账号键例外：那本身就是频道级账号，用户单独记它就是要例外
    if (sid.startsWith("qg_") && map[sid]) return map[sid]
    // 兜死成 qqguild，不落回 map.default —— 用户可能删掉或改坏 QQGuild 那行，
    // 而退到 map[appid] / map.QQBot 会得到 qqgroup，那对频道事件一定是错的
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
