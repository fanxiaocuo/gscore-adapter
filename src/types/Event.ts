/**
 * 云崽事件类型别名
 *
 * 从 @types/trss-yunzai 重导出，供本项目使用。
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
 * 适配器入站事件
 *
 * 为什么不直接用 MessageEvent
 * --------------------------
 * `MessageEvent` 是 `GroupEvent | PrivateEvent` 闭合联合，能表达「群私收窄」
 * 语义但覆盖不了这个插件实际读的字段 —— 适配器内部要同时读：
 *
 *   - notice 事件字段（post_type / notice_type / sub_type / operator_id / target_id）
 *   - QQBot-Plugin 添加的字段（channel_id / isGuild / avatar）
 *   - ICQQ 特有字段（source / member / friend）
 *   - 本插件自己标记的字段（gscore_origin / message_sent）
 *
 * 这些字段 `MessageEvent` 都不含，用它标等于每个读取点都要 `as any`。
 * 用 `any` 标又等于放弃所有类型信息。
 *
 * 这个接口是第三条路：已知字段有类型，其余透传
 * ----------------------------------------------
 * 定义成「联合的公共字段 + 平台自加字段的交集 + 索引签名」：
 *   - `post_type` / `user_id` / `self_id` / `bot` 等 `CustomEvent` 上就有的能读到类型
 *   - `group_id` / `channel_id` / `source` / `avatar` 这些群私事件只有一边有、
 *     或第三方适配器自加的标成可选，读出来是 `T | undefined` 而不是 `any`
 *   - `[k: string]: any` 让平台新加字段不报错、让 `MessageEvent` 能赋值进来
 *     （`Bot.on("message", handler)` 那一路逆变方向也能过）
 *
 * 为什么 `message` 里的段允许 `Readable`、而 `FileLike` 不允许
 * -------------------------------------------------------
 * 两个问题：
 *   1. 段能否**携带** Readable —— 能，`ImageElem.file` 声明是 `string | Buffer | Readable`
 *   2. `toBuffer` 能否**读取** Readable —— 不能，`Bot.Buffer` 把非 Buffer 入参全转字符串
 *
 * `FileLike` 收窄成 `string | Buffer` 是为了答问题 2：声明支持读流会让调用方以为能处理，
 * 实际会静默生成坏图。但 `YunzaiSegment.file` 的问题是 1 不是 2 —— 消息段里**可能带着**
 * 流（其他适配器收到的段、或用户自己传进来的段），我们不能假装它不存在。
 * 对流的处理不是「读」而是「透传」：`toGscore.ts` 里取 `i.url ?? i.file ?? i.fid`，
 * 真是流的话 `toGscoreMedia` 能识别（`toBuffer` 内部判 `Buffer.isBuffer` / `isHttpUrl`，
 * 剩下的都当路径），调用方自己决定要不要先读成 Buffer —— 那才是正确的失败点。
 *
 * 结论：`YunzaiSegment` / `AdapterEvent.message` 里的 `file` / `url` 允许 `Readable`，
 * `FileLike` 不允许。前者描述「段里有什么」，后者描述「`toBuffer` 能读什么」。
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
   * 群成员对象（GroupEvent 有，可调 getAvatarUrl）
   *
   * `size` 标成 icqq 的字面量联合而不是 number：标宽了参数逆变方向就对不上，
   * `MessageEvent` 会赋不进来（icqq.d.ts:1864 / :2204 的签名就是这四个值）。
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
   * QQBot 的被引用消息内容（Yunzai-QQBot-Plugin index.js:1380/1430 挂上）
   *
   * QQBot 既没有 source / reply_id，也不产出入站 reply 段，被引用消息只在这里。
   * 字段结构见 QQBot-Plugin 仓库的 msg_elements.md（作者实测记录）。
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
 * 云崽消息段（对应 ICQQ 的 MessageElem）
 *
 * 为什么不直接用 MessageElem 联合
 * -------------------------------
 * `@types/trss-yunzai` 里有精确的 `MessageElem`（icqq.d.ts:971，三十来个成员），
 * 但云崽的消息段**实际是开放集**：markdown / button / raw / node 各适配器自造，
 * QQBot-Plugin 还会往段上挂平台字段（qg_ 系）。用闭合联合去标，收到的每个段
 * 都要先 `as any` 才能读，等于把 any 从签名挪到每个使用点。
 *
 * 这里标成「已知字段有类型 + 其余透传」：`i.text` 是 `string | undefined` 而不是 any，
 * 写错字段名（`i.txt`）仍然是 any 而不报错 —— 拿到的是段里确实稳定的那部分，
 * 剩下的诚实地留白。
 *
 * 为什么 file / url 允许 Readable
 * ------------------------------
 * `ImageElem.file` 声明是 `string | Buffer | Readable`（icqq.d.ts:691），
 * 其他适配器收到的段、或用户自己传进来的段可能带流。我们不能假装它不存在。
 * 对流的处理是「透传」而不是「读」：`toGscore.ts` 里取 `i.url ?? i.file ?? i.fid`，
 * `toGscoreMedia` 收到流时会交给 `toBuffer`，后者能识别出「这不是我能读的」
 * 并让调用方自己决定要不要先读成 Buffer —— 那才是正确的失败点。
 *
 * `FileLike` 不含 `Readable` 是另一个问题：它描述的是「`toBuffer` 能读什么」，
 * 而 `Bot.Buffer` 对流做 `String(data)` 会静默产出坏图，所以 `FileLike` 收窄
 * 成 `string | Buffer` 免得声明支持却静默失败。
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
