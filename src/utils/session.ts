/**
 * 会话类型判定
 *
 * 单独一个文件、**不 import 任何东西**：config/index.ts 的 resolveBotId 要用
 * isChannel，而 utils/message.ts 依赖 @/config —— 把它放在 message.ts 里会形成
 * config -> utils/message -> config 的环。打包成单文件后这种环会变成求值顺序问题
 * （TDZ），表现是启动即崩且栈里看不出原因。纯函数拆出来最省事。
 */

/**
 * 是否为频道（QQ 频道 / guild）会话
 *
 * 不能只看 e.isGuild 与 e.message_type === "guild" —— QQBot-Plugin 的
 * makeGuildMessage（index.js:1322-1337）把频道消息**标成 group**：
 *   data.message_type = "group"
 *   data.group_id = `qg_${guild_id}-${channel_id}`
 * 既不设 isGuild、也不把 message_type 置为 guild。于是两个常规判据双双为假，
 * 频道消息会被当普通群消息上报，user_type 填成 group —— 而早柚核心的 channel
 * 是独立会话类型（Protocol.ts UserType），核心侧会走错处理路径。
 *
 * 所以补第三条判据：group_id 带 `qg_` 前缀。这个前缀是 QQBot-Plugin 用来在
 * pickGroup 里分派到 pickGuild 的标记（index.js:1103），凡是频道会话必然带，
 * 是它自己的事实来源，比猜 message_type 可靠。
 *
 * 注意 sender.src_guild_id 不能作为判据：频道**私聊**（makeDirectMessage）
 * 的 sender 上也有它，而那是 direct 而非 channel。
 */
export function isChannel(e) {
  if (e?.isGuild) return true
  if (e?.message_type === "guild") return true
  return String(e?.group_id ?? "").startsWith("qg_")
}
