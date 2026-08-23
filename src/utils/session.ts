/**
 * @description 会话类型判定
 * 注意：本文件不 import 任何东西 —— config 要用 isChannel，而 utils/message.ts 依赖 @/config，
 * 放进那边会成 config → message → config 的环，打包后表现为 TDZ 启动即崩。
 */

/**
 * @description 是否为频道（QQ 频道 / guild）会话，除 isGuild / message_type 外还认 group_id 的 `qg_` 前缀
 * 第三条判据是必需的：QQBot-Plugin 的 makeGuildMessage（index.js:1322-1337）把频道消息标成
 * group、只用 `qg_` 前缀分派，两个常规判据双双为假，频道会被当普通群上报。
 * 注意：sender.src_guild_id 不能作判据 —— 频道私聊的 sender 上也有它，那是 direct 不是 channel。
 */
export function isChannel(
  e?: { isGuild?: unknown; message_type?: string; group_id?: unknown } | null,
) {
  if (e?.isGuild) return true
  if (e?.message_type === "guild") return true
  return String(e?.group_id ?? "").startsWith("qg_")
}
