/** 连接状态数值的可读名 */
export const STATUS_TEXT = {
  0: "未连接",
  1: "已连接",
  2: "连接中",
  3: "断线重连中",
}

/** 回环防护：记录本插件代发内容的有效期与容量上限 */
export const ECHO_TTL = 10000
export const ECHO_MAX = 500

/** log_{level} 段，仅出现在 MessageSend 方向 */
export const GS_LOG_RE = /^log_/i

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "mark"]

/**
 * 早柚核心 segment.py 的 MessageSegment.log 只发这四种（大写）：
 *   Literal["INFO", "WARNING", "ERROR", "SUCCESS"]
 * 其中 WARNING / SUCCESS 不是云崽 logger 的方法名，需要映射，
 * 否则会静默降级成 info、丢掉告警级别。
 */
export const LOG_ALIAS = { warning: "warn", success: "mark", critical: "fatal" }

/**
 * 本 fork 的 notice 事件形状与 OneBot 原生不同。
 * plugins/adapter/OneBotv11.js:1330-1333 把 notice_type 按 _ 拆成两段：
 *   group_increase -> notice_type="group", sub_type="increase"
 * ICQQ 原生即是这个形状，OneBotv11 的拆分正是为了对齐它。
 * 故匹配主键是 sub_type；写成 notice_type === "group_increase" 恒为 false。
 */
export const SUB_TYPE_MAP = {
  increase: "user_join_group",
  decrease: "user_exit_group",
}

/** 早柚核心的会话类型 */
export const USER_TYPES = ["group", "direct", "channel", "sub_channel"]
