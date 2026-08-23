/**
 * @description 早柚核心平台标识的推断，只按账号形状与 adapter 名判定
 * 注意：本文件不 import 任何本项目模块（连 import type 也不写），看一眼 import 区就知道它不会成环；
 * 调用方是 apps/admin.ts 与 config 的 resolveBotId，放进任一边都会成环。
 * 判据取自 ws-plugin `components/WebSocket.js`（前缀表 :10-56，appid 判据 :88-91）。
 */

/**
 * @description 账号前缀（头三个字符）→ 核心平台标识
 * 前缀是各适配器自己打的标记，比适配器名可靠（名字会改，账号形状要参与路由）。
 * 显式写 onebot 而不留空，是为了区分「已知按 onebot 处理」与「不认识这个账号」（后者回 ""）。
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
 * @description 适配器名 / id → 核心平台标识，是用户配的 bot_id_map 之后的兜底
 * 刻意保守：拿不准的一律不写，让它回 "" 而不是猜。键同时覆盖 name 与 id
 * （同一适配器的两者大量不一致，且 id 严重撞车：ICQQ / OneBotv11 / OPQBot 都是 "QQ"，
 * 三家都映射成 onebot 所以不影响结果）。
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
 * @description 是否形似 QQBot 官方 bot 的 appid（腾讯发的号段，不是 QQ 号）
 * 判据照抄 ws-plugin `:88-91`，但去掉它的 `!Version.isTrss` 条件：判错用户能 `id=` 显式覆盖，
 * 漏认则会静默按 onebot 上报。
 */
export function isQQBotAppId(id: string | number | null | undefined): boolean {
  const s = id == null ? "" : String(id)
  if (!s) return false
  if (/^(2854|3889|401)/.test(s) && s.length === 10) return true
  return s.startsWith("1020") && s.length === 9
}

/**
 * @description 按账号与 Bot 对象推断核心平台标识，先具体后笼统：账号前缀 → QQBot appid 特征 → 适配器名/id 查表
 * 推不出返回 "" 而不兜 onebot：添加连接时就不写 bot_id_map，上报兜底那步在 `resolveBotId` 里。
 *
 * @param selfId 机器人账号（云崽的 self_id / Bot.uin）
 * @param bot    可选的 Bot 实例，用来读 adapter.id / adapter.name；不传则只按账号形状推断
 * @returns 平台标识，推不出返回 ""
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
