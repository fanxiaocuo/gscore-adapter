/**
 * 非消息事件（meta event）转换
 *
 * 核心 handler.py 的消费方式（已对源码核对）：
 *   _extract_meta_segment: if seg.type and seg.type.startswith("meta-")
 *   msg_process:           event.meta_event_type = _msg.type[len("meta-"):]
 * data 为 dict 时整体存入 event.meta_event_data，且核心会用其中的
 * user_id / group_id 回填顶层缺失字段，供权限与黑白名单使用——
 * 所以必需字段缺失时宁可整包丢弃，不发残包。
 */
import { SUB_TYPE_MAP } from "@/constants"
import { str, passFilter, isChannel } from "@/utils"
import type { AdapterEvent, MessageReceive } from "@/types"
import { toStr } from "@/utils/compat"

export { passFilter }

/**
 * 云崽 notice 事件 -> meta event
 * @param selfId 调用方解析过的账号，用于 poke 的被戳者兜底；不传则退回 e.self_id
 * @returns 无法映射返回 null
 */
/** noticeToMeta 的产物：事件名 + 核心要的 data 字典 */
export interface MetaEvent {
  eventName: string
  data: Record<string, string>
}

export function noticeToMeta(e: AdapterEvent, selfId?: string): MetaEvent | null {
  if (!e || e.post_type !== "notice") return null

  // poke 判断必须在 group/friend 之前：它在两种 notice_type 下都出现
  if (e.sub_type === "poke") {
    // OneBotv11.js:1170 把 operator_id 赋为戳人者
    const user_id = str(e.operator_id ?? e.user_id)
    if (!user_id) return null

    const data: Record<string, string> = { user_id }
    // 被戳者缺失时兜底为 bot 自己（照参考实现 buildMetaEvent）
    data.target_id = str(e.target_id) || selfId || str(e.self_id)
    const group_id = str(e.group_id)
    if (group_id) data.group_id = group_id
    return { eventName: "poke", data }
  }

  if (e.notice_type !== "group") return null

  const eventName = SUB_TYPE_MAP[e.sub_type]
  if (!eventName) return null

  // 入退群两个 id 都是核心鉴权链路要用的，缺一不可
  const user_id = str(e.user_id)
  const group_id = str(e.group_id)
  if (!user_id || !group_id) return null

  const data: Record<string, string> = { user_id, group_id }
  const operator_id = str(e.operator_id)
  if (operator_id) data.operator_id = operator_id

  // 注意：这里没有 sub_type。OneBot 原生的 approve/invite/kick/leave
  // 已被 OneBotv11.js:1333 用拆出来的 increase/decrease 覆盖，取不回来了。
  return { eventName, data }
}

/**
 * meta event -> 完整 MessageReceive
 * @param e     云崽 notice 事件
 * @param meta  noticeToMeta 的产物
 * @param botId 平台标识（resolveBotId 的结果）
 * @param opts  { isMaster, selfId }
 */
export function metaToGscore(
  e: AdapterEvent,
  meta: MetaEvent | null,
  botId: string,
  opts: { isMaster?: boolean; selfId?: string } = {},
): MessageReceive | null {
  if (!meta) return null

  const group_id = meta.data.group_id || str(e.group_id)

  return {
    bot_id: botId,
    bot_self_id: opts.selfId || str(e.self_id),
    msg_id: "",
    // 频道要判在前：QQBot-Plugin 的频道事件 group_id 带 qg_ 前缀但 message_type
    // 是 group，只看 group_id 有无会把频道事件标成 group（同 toGscore 的处理）
    user_type: group_id ? (isChannel(e) ? "channel" : "group") : "direct",
    group_id: group_id || null,
    user_id: meta.data.user_id,
    user_pm: opts.isMaster ? 1 : 6,
    sender: {},
    content: [{ type: `meta-${meta.eventName}`, data: meta.data }],
  }
}

/** 日志用的简短描述 */
export function metaLogStr(meta: MetaEvent) {
  return `${meta.eventName} ${toStr(meta.data)}`
}
