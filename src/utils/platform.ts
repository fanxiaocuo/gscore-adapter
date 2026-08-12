/**
 * 早柚核心平台标识的推断
 *
 * 为什么单独一个文件
 * ----------------
 * 这套判据有两个调用方：`apps/admin.ts`（#早柚添加连接 时给 bot_id 填个默认值）
 * 与 `config/index.ts` 的 `resolveBotId`（上报时查表全落空后的兜底）。
 * 放进 config 里会让 admin → config 的依赖方向多一层含义；放 `utils/message.ts`
 * 更不行——那个模块 import 了 `@/config`，而 config 要用这里的函数，会成环
 * （`utils/session.ts` 的文件头注释记着同一个坑）。
 *
 * 所以本文件**不 import 任何本项目模块**，只接收调用方递进来的 selfId 与 bot 对象。
 * 连 `import type` 也不写（虽然它编译后会被擦掉、不会真成环）—— 这条约束的价值
 * 在于「看一眼 import 区就知道这里不会成环」，破一次例就得每次都验证一遍。
 * 所以 bot 参数用行内结构类型标，只列这里实际读的两个字段。
 *
 * 判据来源
 * -------
 * 账号前缀表与 QQBot appid 特征都取自 ws-plugin `components/WebSocket.js`
 * （前缀表在 :10-56，appid 判据在 :88-91）。那个插件解决的是同一个问题：
 * 云崽这边只有一个账号字符串，要反推它属于哪个平台。
 */

/**
 * 账号前缀 → 核心平台标识
 *
 * 键是账号头三个字符。这些前缀是各适配器自己造的标记（QQGuild-Plugin 给频道号
 * 加 `qg_`、Telegram 适配器加 `tg_`），比适配器名更可靠：适配器可以换实现、
 * 改名字，账号字符串的形状不会变，它要参与消息路由。
 *
 * ws-plugin 那张表里 WeChat 与 stdin 没给 gsBotId —— 核心侧没有对应平台，
 * 按 onebot 收。这里显式写成 onebot 而不是留空，是为了区分「已知按 onebot 处理」
 * 与「不认识这个账号」（后者返回 ""，由调用方决定要不要兜底）。
 */
const PREFIX_PLATFORM: Record<string, string> = {
  qg_: "qqguild",
  wx_: "onebot",
  // wxid_ 开头的微信号，取前三位正好是 wxi
  wxi: "onebot",
  mv_: "villa",
  ko_: "kook",
  tg_: "telegram",
  dc_: "discord",
  std: "onebot",
}

/**
 * 适配器名 / id → 核心平台标识
 *
 * 只收「确定该映射成什么」的那几家。`resolveBotId` 已经会查用户配的 `bot_id_map`，
 * 这张表是那之后的兜底，所以刻意保守：拿不准的一律不写，让它返回 "" 而不是猜。
 *
 * 键同时覆盖 name 与 id 两种写法，理由见 `resolveBotId` 上方那段（同一个适配器的
 * id 与 name 大量不一致，且 id 严重撞车：ICQQ / OneBotv11 / OPQBot 的 id 同为 "QQ"）。
 * 这里三家都映射成 onebot，所以撞车不影响结果。
 */
const ADAPTER_PLATFORM: Record<string, string> = {
  QQBot: "qqgroup",
  QQGuild: "qqguild",
  ICQQ: "onebot",
  OneBotv11: "onebot",
  OneBot: "onebot",
  OPQBot: "onebot",
  ComWeChat: "onebot",
  WeChat: "onebot",
  Satori: "onebot",
  stdin: "console",
  QQ: "onebot",
}

/**
 * 是否形似 QQBot 官方 bot 的 appid
 *
 * 官方 bot 的账号是腾讯发的 appid，不是 QQ 号，落在几个固定号段里。
 * 判据照抄 ws-plugin `:88-91`，但去掉了它那个 `!Version.isTrss` 条件：
 * 本插件不依赖 ws-plugin 的 Version 单例，而那条分支只是说「TRSS 下 1020 开头
 * 会撞上民间号段」。两边都认更简单，判错了用户可以 `id=` 显式覆盖 ——
 * 反过来漏认则会静默按 onebot 上报，核心侧收到的平台是错的。
 */
export function isQQBotAppId(id: string | number | null | undefined): boolean {
  const s = id == null ? "" : String(id)
  if (!s) return false
  if (/^(2854|3889|401)/.test(s) && s.length === 10) return true
  return s.startsWith("1020") && s.length === 9
}

/**
 * 按账号与 Bot 对象推断核心平台标识
 *
 * @param selfId 机器人账号（云崽的 self_id / Bot.uin）
 * @param bot    可选的 Bot 实例，用来读 adapter.id / adapter.name
 * @returns 平台标识，推不出返回 ""
 *
 * 判定顺序（先具体后笼统）：
 *   1. 账号前缀 —— 适配器自己打的标记，且 `qg_` 能把频道从 QQBot 里分出来
 *   2. QQBot appid 特征 / adapter.id === "QQBot" → qqgroup
 *   3. 适配器名与 id 查表
 *   4. 推不出返回 ""
 *
 * 为什么返回 "" 而不是兜一个 onebot：调用方的两处需求不同。添加连接时「推不出」
 * 意味着不写 bot_id、留给运行时按 bot_id_map 走；上报兜底时才需要一个具体值，
 * 那一步的兜底本来就在 `resolveBotId` 里。在这里兜掉会让前者失去「不确定」这个状态。
 */
export function guessPlatform(
  selfId: string | number | null | undefined,
  bot?: { adapter?: { id?: string; name?: string; [k: string]: any }; [k: string]: any } | null,
): string {
  const sid = selfId == null ? "" : String(selfId)

  const byPrefix = sid.length >= 3 ? PREFIX_PLATFORM[sid.slice(0, 3).toLowerCase()] : undefined
  if (byPrefix) return byPrefix

  const adapterId = bot?.adapter?.id
  const adapterName = bot?.adapter?.name
  if (adapterId === "QQBot" || isQQBotAppId(sid)) return "qqgroup"

  return ADAPTER_PLATFORM[adapterName] || ADAPTER_PLATFORM[adapterId] || ""
}
