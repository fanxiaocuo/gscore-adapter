/**
 * @description 云崽事件类型别名，从 @types/trss-yunzai 重导出
 * plugin<'message'> 的泛型让 this.e 正确解析，但函数参数仍需显式标注。
 */

import type {
  MessageEvent,
  GroupMessageEvent,
  PrivateMessageEvent,
  Event,
  CustomEvent,
  Client,
  MessageRet,
} from "trss-yunzai"
import type { Readable } from "node:stream"

/** 默认消息事件（可通过 isGroup / isPrivate 收窄） */
export type YunzaiEvent = MessageEvent

/** 宿主 reply/sendMasterMsg 接受的消息类型 */
export type YunzaiSendable = Parameters<YunzaiEvent["reply"]>[0]

/** 群聊消息事件 */
export type GroupEvent = GroupMessageEvent

/** 私聊消息事件 */
export type PrivateEvent = PrivateMessageEvent

/** 泛化事件（含 notice / request 等） */
export type AnyEvent = Event<any>

/** 自定义字段（各框架通用部分） */
export type { CustomEvent }

/* ============= 适配器入站事件（内部 modules/ 与 utils/ 专用） ============= */

/**
 * @description 适配器入站事件：已知字段有类型，其余透传（`[k: string]: any`）
 * 不用 `MessageEvent`：那是 `GroupEvent | PrivateEvent` 的闭合联合，不含本插件要读的 notice 字段
 * （post_type / notice_type / operator_id / target_id）、QQBot-Plugin 自加字段（channel_id / isGuild / avatar）、
 * ICQQ 特有字段（source / member / friend）与本插件自己的标记（gscore_origin / message_sent），用它等于每个读取点都 `as any`。
 * 群私事件只有一边有的字段标成可选，读出来是 `T | undefined` 而不是 any；索引签名同时让 `MessageEvent` 能逆变赋值进来。
 * 注意：`message` 里的段允许 `Readable` 而 {@link import("./Media.js").FileLike} 不允许 —— 前者描述「段里能带什么」（ImageElem.file 确实可能是流），后者描述「toBuffer 能读什么」；流只透传不读，真读的失败点在调用方
 */
export interface AdapterEvent {
  // ---- 事件元信息（post_type 系，message / notice / request 共有） ----
  /** 事件类型（message / notice / request / meta_event） */
  post_type?: string
  /** 消息类型（group / private / guild） */
  message_type?: string
  /** 通知类型（group / friend / …） */
  notice_type?: string
  /** 事件子类型（poke / increase / decrease / …） */
  sub_type?: string

  // ---- CustomEvent 核心字段 ----
  /** 收到事件的机器人账号 */
  self_id?: number | string
  /** 发送者 / 事件涉及用户 */
  user_id?: number | string
  /** 收到事件的 Bot 对象 */
  bot?: Client & { icqq?: any; [k: string]: any }

  // ---- 会话标识（群私共有，但 PrivateEvent 上 group_id 为空） ----
  /** 群号（频道时带 qg_ 前缀） */
  group_id?: number | string
  /** 频道 id（QQBot-Plugin 添加） */
  channel_id?: number | string
  /** 消息 id */
  message_id?: string

  // ---- 消息内容与发送者 ----
  /** 消息段数组（可能是字符串或单段） */
  message?: string | YunzaiSegment | (string | YunzaiSegment)[]
  /** 发送者信息 */
  sender?: {
    user_id?: number | string
    nickname?: string
    /** 群名片（GroupEvent 有，PrivateEvent 无） */
    card?: string
    /** 群角色 */
    role?: string
    /** 头像 url（第三方适配器可能添加） */
    avatar?: string
    [k: string]: any
  }

  // ---- 布尔标志 ----
  /** 是否为群聊 */
  isGroup?: boolean
  /** 是否为私聊 */
  isPrivate?: boolean
  /** 是否为频道 */
  isGuild?: boolean
  /** 触发者是否为主人 */
  isMaster?: boolean

  // ---- 第三方适配器添加字段 ----
  /** 头像 url（部分适配器在顶层添加） */
  avatar?: string

  // ---- ICQQ 专有字段 ----
  /**
   * @description 群成员对象（GroupEvent 有，可调 getAvatarUrl）
   * 注意：`size` 标成 icqq 的字面量联合而不是 number —— 标宽了参数逆变方向就对不上，`MessageEvent` 会赋不进来（icqq.d.ts:1864 / :2204 的签名就是这四个值）
   */
  member?: { getAvatarUrl?: (size?: 0 | 40 | 100 | 140) => string; [k: string]: any }
  /** 群对象（ICQQ 引用正文回退时可调 getChatHistory） */
  group?: {
    getChatHistory?: (cursor: number, count: number) => Promise<any>
    [k: string]: any
  }
  /** 好友对象（PrivateEvent 有，可调 getAvatarUrl / getChatHistory） */
  friend?: {
    getAvatarUrl?: (size?: 0 | 40 | 100 | 140, history?: number) => string
    getChatHistory?: (cursor: number, count: number) => Promise<any>
    [k: string]: any
  }
  /** 引用消息元信息（ICQQ 的 Quotable） */
  source?: {
    message_id?: string
    user_id?: number | string
    time?: number
    seq?: number
    rand?: number
    message?: any
    [k: string]: any
  }

  // ---- 引用回复 ----
  /** 引用的消息 id（框架从 reply 段派生） */
  reply_id?: string
  /** TRSS 获取被引用消息正文与媒体的能力。 */
  getReply?: () => Promise<any>
  /**
   * @description QQBot 的被引用消息内容（Yunzai-QQBot-Plugin index.js:1380/1430 挂上）
   * 注意：QQBot 既没有 source / reply_id 也不产出入站 reply 段，被引用消息只在这里；字段结构见 QQBot-Plugin 仓库的 msg_elements.md
   */
  msg_elements?: Array<{
    /** 被引用消息正文，可能含 `<faceType=...>` 与 `[@名字](mqqapi://...)` 标记 */
    content?: string
    /** 形如 `REFIDX_xxx` 的引用索引 —— 不是 message_id */
    msg_idx?: string
    /** 被引用消息的作者（群消息才有） */
    author?: Record<string, any>
    attachments?: Array<{
      url?: string
      /** `image/*` | `voice` | `video/*` | `file` */
      content_type?: string
      filename?: string
      size?: number
      width?: number
      height?: number
      /** 语音专有：wav 转码直链 */
      voice_wav_url?: string
      /** 语音专有：ASR 转写文本 */
      asr_refer_text?: string
      [k: string]: any
    }>
    [k: string]: any
  }>

  // ---- notice 事件专有字段 ----
  /** 操作者（踢人者 / 邀请者） */
  operator_id?: number | string
  /** 被操作者 */
  target_id?: number | string

  // ---- 回环防护标记 ----
  /** 是否为自己发送的消息 */
  message_sent?: boolean
  /** 是否来自早柚核心（本插件标记） */
  gscore_origin?: boolean

  // ---- 适配器标识 ----
  /** 适配器 id */
  adapter_id?: string
  /** 适配器名称 */
  adapter_name?: string

  // ---- 快速回复（CustomEvent 上有签名，这里重新标一遍免得 undefined） ----
  reply?: (msg: any, quote?: boolean, data?: any) => Promise<MessageRet>

  // ---- 平台自加字段透传 ----
  [k: string]: any
}

/**
 * @description 云崽消息段（对应 ICQQ 的 MessageElem）：已知字段有类型，其余透传
 * 不用闭合的 `MessageElem` 联合：云崽的消息段实际是开放集（markdown / button / raw / node 各适配器自造，
 * QQBot-Plugin 还往段上挂 qg_ 系平台字段），用它去标每个段都要先 `as any`，等于把 any 挪到每个使用点。
 * 注意：`file` / `url` 允许 `Readable`（ImageElem.file 声明就是 `string | Buffer | Readable`），段里确实可能带流；
 * 流只透传不读，而 {@link import("./Media.js").FileLike} 收窄成 `string | Buffer` 是因为 `Bot.Buffer` 对流做 `String(data)` 会静默产出坏图
 */
export interface YunzaiSegment {
  type: string
  /** text 段正文 */
  text?: string
  /** markdown / button / raw / node 段的载荷，形状随 type 变 */
  data?: any
  /** 媒体段：收到的消息带 url */
  url?: string | Buffer | Readable
  /** 媒体段：自己构造的消息带 file */
  file?: string | Buffer | Readable
  /** file 段在部分适配器上只有 fid */
  fid?: string
  name?: string
  width?: number | string
  height?: number | string
  /** at 段的目标，`"all"` 表示全体成员 */
  qq?: number | string
  /** at / reply 段在不同适配器上的等价字段 */
  id?: number | string
  user_id?: number | string
  message_id?: string
  /** 平台自加字段 */
  [k: string]: any
}
