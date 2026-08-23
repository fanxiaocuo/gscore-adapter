/**
 * @description 早柚核心（gsuid_core）协议类型声明
 * 来源：gsuid_core/models.py 的 msgspec Struct 定义 + gsuid_core/segment.py，修改前请先核对上游源码。
 * 注意：permisson / excute_ 均为核心源码原文的错拼，必须逐字匹配，勿凭直觉"修正"拼写
 */

import type { YunzaiSegment } from "./Event.js"

/* ============================ 消息段 ============================ */

/** 纯文本 */
export interface SegText {
  type: "text"
  data: string
}

/** Markdown 原文 */
export interface SegMarkdown {
  type: "markdown"
  data: string
}

/** @description 图片，data 形如 `base64://...` 或 `link://https://...` */
export interface SegImage {
  type: "image"
  data: string
}

/** @description 图片尺寸，紧跟在 image 段之后作用于前一个 image，data 为 [宽, 高] */
export interface SegImageSize {
  type: "image_size"
  data: [number, number]
}

/**
 * @description 文件，data 形如 `{文件名}|{裸 base64}`（无 URL 形式，只能全量传输）
 * 注意：文件名之后的第一个 `|` 才是分隔符，解析时用 indexOf 而非 split
 */
export interface SegFile {
  type: "file"
  data: string
}

/** @ 某人，data 为用户 id 字符串 */
export interface SegAt {
  type: "at"
  data: string
}

/**
 * @description 引用回复
 * 上行（适配器 -> 核心）data 为被引用消息正文；下行（核心 -> 适配器）兼容旧协议，data 为被引用消息 id。
 */
export interface SegReply {
  type: "reply"
  data: string
}

/** 引用消息 id（上行使用；下行也接受该新字段） */
export interface SegReplyId {
  type: "reply_id"
  data: string
}

/** 语音 */
export interface SegRecord {
  type: "record"
  data: string
}

/** 视频 */
export interface SegVideo {
  type: "video"
  data: string
}

/** 按钮组，data 为二维数组（行 × 列） */
export interface SegButtons {
  type: "buttons"
  data: Button[][]
}

/** @description 合并转发节点。注意：协议禁止 node 嵌套，data 内不应再出现 node 段 */
export interface SegNode {
  type: "node"
  data: Exclude<MessageSegment, SegNode>[]
}

/**
 * @description 日志段，仅出现在 MessageSend 方向（核心 -> 适配器）
 * 核心 segment.py 只产出四种（大写）：INFO / WARNING / ERROR / SUCCESS。
 * 注意：WARNING / SUCCESS 不是云崽 logger 的方法名，需映射 warning -> warn、success -> mark、critical -> fatal
 */
export interface SegLog {
  type: `log_${string}`
  data: string
}

/**
 * @description 群号定位段：核心 bot.py:433-434 只要 group_id 为真就往每一帧 content 追加它
 * 供「需要双 ID 才能定位会话」的适配器（如频道）使用。
 * 注意：它是元数据不是正文 —— 云崽侧已能靠 target_id 定位，静默消费掉即可
 */
export interface SegGroup {
  type: "group"
  data: string
}

/**
 * @description meta 事件段，仅出现在 MessageReceive 方向（适配器 -> 核心）
 * 非消息事件（入退群、戳一戳等）没有正文可发，靠它把事件名与数据带给核心：核心取 `meta-` 之后的部分作
 * event.meta_event_type，data 为 dict 时整体存入 event.meta_event_data，还会用其中的 user_id / group_id 回填顶层缺失字段。
 * 注意：不并进 {@link MessageSegment} —— 正文段的 data 都是 string / 数组，这里是字典，混在一起每个消费正文的地方都要先排除它
 */
export interface SegMeta {
  type: `meta-${string}`
  data: Record<string, string>
}

/** MessageReceive / MessageSend 中可出现的消息段 */
export type MessageSegment =
  | SegText
  | SegMarkdown
  | SegImage
  | SegImageSize
  | SegFile
  | SegAt
  | SegReply
  | SegReplyId
  | SegRecord
  | SegVideo
  | SegButtons
  | SegNode

/** MessageSend.content 中额外可能出现 log 段、群号定位段与控制指令 */
export type SendSegment = MessageSegment | SegLog | SegGroup | ControlSegment

/* ============================ 控制指令 ============================ */

/**
 * @description 控制类段，核心下发给适配器执行的动作
 * 注意：拼写为核心源码原文（excute 少一个 e），勿"修正"
 */
export interface SegDeleteMessage {
  type: "excute_delete_message"
  /** 核心 bot.py:624：data={"message_id": "<id>"}，是 dict 不是裸字符串 */
  data: { message_id: string }
}

export interface SegBanUser {
  type: "excute_ban_user"
  /**
   * 核心 bot.py:573-579：data={"user_id", "group_id", "duration"}。
   * duration 核心侧已校验为 int 或纯数字字符串，0 表示解除禁言。
   */
  data: { user_id: string; group_id: string; duration: number | string }
}

export type ControlSegment = SegDeleteMessage | SegBanUser

/* ============================ 按钮 ============================ */

/**
 * @description 早柚侧按钮
 * 注意：`permisson` 为核心源码原文拼写（少一个 i），必须逐字匹配，写成 permission 会被 msgspec 当作未知字段
 */
export interface Button {
  /** 按钮显示文本 */
  text: string
  /** 点击后显示的文本 */
  pressed_text?: string | null
  /**
   * 动作类型
   * - 0 跳转链接
   * - 1 回调
   * - 2 发送命令
   */
  action: 0 | 1 | 2
  /** 按钮携带的数据，语义随 action 变化（链接 / 回调数据 / 命令文本） */
  data: string
  /** 样式，通常 0 灰底 1 蓝字 */
  style?: number
  /**
   * 可见/可点击权限
   * - 0 指定用户（配合 specify_user_ids）
   * - 1 仅管理者
   * - 2 所有人
   * - 3 指定身份组（配合 specify_role_ids）
   */
  permisson?: 0 | 1 | 2 | 3
  /** permisson 为 3 时生效 */
  specify_role_ids?: string[]
  /** permisson 为 0 时生效 */
  specify_user_ids?: string[]
  /** 客户端不支持时的提示语 */
  unsupport_tips?: string
}

/**
 * @description 云崽侧按钮（segment.button 的元素），与早柚的 {@link Button} 是两套字段
 * 动作用互斥的 link / callback / input 三键表达，而非 action + data。
 * 注意：云崽用 permission（两个 i），早柚用 permisson
 */
export interface YunzaiButton {
  text: string
  /** action 0：跳转链接 */
  link?: string
  /** action 1：回调数据 */
  callback?: string
  /** action 2：发送命令 */
  input?: string
  /** 早柚 pressed_text 的对应字段 */
  clicked_text?: string
  style?: number
  /** "all" 所有人 / "admin" 管理者 / string[] 指定用户 */
  permission?: "all" | "admin" | string[]
  /** 指定身份组 */
  role_ids?: string[]
  unsupport_tips?: string
  /** 允许直接携带早柚形状 */
  action?: unknown
  data?: unknown
  pressed_text?: string | null
  GsCore?: Partial<Button>
  GSUIDCore?: Partial<Button>
  /** 允许按平台透传原始字段 */
  [key: string]: unknown
}

/* ============================ 云崽侧消息段 ============================ */

/** 云崽 message 字段：段数组，也允许裸字符串或单段 */
export type YunzaiMessage = string | YunzaiSegment | (string | YunzaiSegment)[]

/* ============================ 用户 / 会话 ============================ */

/**
 * @description 会话类型
 * 配套约定：适配器内部把 group_id 表示为 `${user_type}-${真实id}`（如 `group-12345`、`channel-67890`），发送前再拆开。
 */
export type UserType = "group" | "direct" | "channel" | "sub_channel"

/**
 * @description 用户权限等级，数值越小权限越高
 * 1 主人（superuser）/ 2 群主 / 3 管理员 / 6 普通成员
 */
export type UserPm = 1 | 2 | 3 | 4 | 5 | 6

/** 发送者信息，除 user_id 外均为平台透传的可选字段 */
export interface Sender {
  user_id: string
  nickname?: string
  avatar?: string
  card?: string
  role?: "owner" | "admin" | "member" | string
  [k: string]: unknown
}

/* ============================ 上下行报文 ============================ */

/**
 * @description 适配器 -> 核心（上行）
 * 注意：`/ws/{bot_id}` 路由下核心用 `websocket.receive_bytes()` 读取，必须发二进制帧 —— 发文本帧会因超时被丢弃（已发布文档里"text 类型"的说法与当前源码不符）
 */
export interface MessageReceive {
  /** 平台标识，如 "onebot" / "telegram" */
  bot_id: string
  /** 机器人自身账号 */
  bot_self_id: string
  /** 消息 id */
  msg_id: string
  /** 发送者 id */
  user_id: string
  /** 权限等级，越小权限越高 */
  user_pm: UserPm
  /** 会话类型；私聊为 "direct" */
  user_type?: UserType
  /** 群/频道 id；私聊为 null */
  group_id: string | null
  /**
   * @description 消息内容
   * 含 {@link SegMeta} 是因为非消息事件（入退群、戳一戳）走同一个上行结构，只是 content 里放 `meta-{eventName}` 段而不是正文段 —— 见 modules/notice。
   */
  content: (MessageSegment | SegMeta)[]
  /**
   * @description 发送者信息
   * 注意：meta 事件没有发送者语义（"某人被踢"里 e.user_id 与事件涉及的用户不是一个人），那条路径发的是 `{}`，所以每个字段都得可选 —— 唯一必填的 user_id 在顶层已有
   */
  sender?: Partial<Sender>
  /** meta 事件专用，形如 "meta-{eventName}" 时由核心 handler 提取 */
  meta_event_type?: string
}

/**
 * @description 核心 -> 适配器（下行）
 * `echo` 用于撤回回执：适配器收到带 echo 的下行后，需回一条 `recall_message_id` 携带同一 echo。
 * 注意：核心 bot.py 连续 3 次超时（RECALL_WAIT_TIMEOUT=10s）后会把 `_supports_recall` 置 false，不再等待回执
 */
export interface MessageSend {
  bot_id: string
  bot_self_id?: string
  msg_id?: string
  /** 目标会话类型 */
  target_type: UserType | string
  /** 目标 id */
  target_id: string
  /** 消息内容，可含 log 段与控制指令 */
  content: SendSegment[]
  /** 撤回回执关联 id */
  echo?: string
}

/**
 * @description 撤回回执，适配器 -> 核心，由收到的 MessageSend.echo 触发
 * 整条帧是一个 MessageReceive，content 必须恰好一段，否则核心 bot.py:200 直接判定不是回执。
 * 注意：echo 与 id 都在 data 内部（bot.py:206-218）不是平级字段；id 可以是 string / string[]（一帧拆成多条发出）/ null（没拿到）
 * 注意：收到的 echo 非空就必须回执，与是否拿到 id 无关 —— 漏回会被核心计 3 次超时后 latch 成"不支持撤回"，此后 wait_recall 直接返回空
 */
export interface RecallReceipt {
  type: "recall_message_id"
  data: {
    echo: string
    id: string | string[] | null
  }
}

/**
 * @description 核心内部事件结构（handler.py 中由 MessageReceive 加工得到）
 * 适配器一般不直接构造，此处保留用于理解 meta 事件流转。
 */
export interface Event extends MessageReceive {
  /** 由 `meta-xxx` 前缀剥离后得到 */
  meta_event_type?: string
  /** 指令文本 */
  raw_text?: string
  command?: string
  text?: string
  image?: string
  at?: string
  image_list?: string[]
  at_list?: string[]
  is_tome?: boolean
  /** 被引用消息正文（上行 reply 段） */
  reply?: string
  /** 被引用消息 id（上行 reply_id 段） */
  reply_id?: string
  /** 被引用消息的合并转发节点（不允许嵌套 node） */
  node?: Exclude<MessageSegment, SegNode>[]
  /** 文件/媒体数据的传输形式 */
  file_type?: "url" | "base64"
  file_name?: string
  file?: string
}
