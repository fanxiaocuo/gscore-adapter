/**
 * 消息过滤与回环防护的共享工具
 */
import { config } from "@/config"

/** 群/用户黑白名单，消息与 meta 事件路径共用同一份 filter 配置 */
export function passFilter(e) {
  const f = config.filter || {}
  const gid = e.group_id != null ? String(e.group_id) : null
  if (gid) {
    if (f.white_group?.length && !f.white_group.some(i => String(i) === gid)) return false
    if (f.black_group?.length && f.black_group.some(i => String(i) === gid)) return false
  }
  if (f.black_user?.length && f.black_user.some(i => String(i) === String(e.user_id))) return false
  return true
}

/** 事件来源是否为早柚核心方向的 Bot（回环防护第 2、3 层） */
export function isFromGsCore(e) {
  const adapterId = e.bot?.adapter?.id || e.adapter_id
  if (adapterId === "GSUIDCore" || adapterId === (config.server?.id || "GsCore")) return true
  // 本插件 server 打的标记。比查 adapter 更精确，
  // 且在 prepareEvent 整体 no-op（Bot.bots[self_id] 缺失）时仍有效
  return !!e.gscore_origin
}

/** 提取事件中的纯文本，用于前缀/包含匹配 */
export function eventText(e) {
  return (e.message || [])
    .filter(i => i?.type === "text")
    .map(i => i.text)
    .join("")
    .trim()
}

/** 转成非空字符串，取不到给 "" */
export function str(v) {
  return v == null ? "" : String(v)
}
