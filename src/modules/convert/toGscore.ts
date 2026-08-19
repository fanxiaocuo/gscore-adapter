/**
 * 云崽 -> 早柚核心
 */
import {
  toGscoreMedia,
  toGscoreFile,
  isChannel,
  resolveReplyId,
  resolveReplyMessage,
  resolveForwardMessage,
  hasReplyContext,
} from "@/utils"
import type {
  MessageReceive,
  UserPm,
  MessageSegment,
  YunzaiMessage,
  YunzaiSegment,
  AdapterEvent,
} from "@/types"
import { buttonsToGscore } from "./buttons.js"
import { makeLog, toStr } from "@/utils/compat"

const NODE_MARK = "[合并转发]"

function replyTextValue(value: unknown): string {
  if (typeof value !== "string") return ""
  try {
    const parsed = JSON.parse(value)
    if (parsed?.type === "markdown" && parsed?.data?.content) return String(parsed.data.content)
  } catch {
    // 普通文本不是 JSON，按原样返回。
  }
  return value
}

/** 从被引用消息中提取正文，不把 at / media 等上下文误当成当前命令。 */
function replyText(message: YunzaiMessage): string {
  const list = Array.isArray(message) ? message : [message]
  const parts: string[] = []
  for (const item of list) {
    if (item == null) continue
    if (typeof item !== "object") {
      const text = replyTextValue(String(item))
      if (text) parts.push(text)
      continue
    }

    if (item.type === "text") {
      const text = replyTextValue(item.text ?? item.data)
      if (text) parts.push(text)
      continue
    }

    if (item.type === "markdown" || item.type === "json") {
      const data = item.data
      const value =
        typeof data === "object" && data !== null
          ? (data.content ?? data.text ?? data.data)
          : data
      const text = replyTextValue(value)
      if (text) parts.push(text)
    }
  }
  return parts.join("")
}

function nodePreview(items: MessageSegment[]): string {
  const lines = [NODE_MARK]
  for (const item of items) {
    if (item.type === "text" && item.data != null) {
      const text = String(item.data).trim()
      if (text) lines.push(text)
    } else if (item.type === "image") lines.push("[图片]")
    else if (item.type === "record") lines.push("[语音]")
    else if (item.type === "video") lines.push("[视频]")
    else if (item.type === "file") lines.push("[文件]")
  }
  return lines.join("\n")
}

/**
 * node 段的载荷拍平成不含 node 的核心段 —— 协议禁止 node 嵌套（Protocol.ts:97-103）。
 *
 * 刻意**不**把事件传进去（也就没法在这里回查 forward）：节点里若还套着一层转发，
 * 查出来也是个 node 段，而下面正把 node 全丢掉，等于白发一次请求。落到跳过分支
 * 顺带解决了「转发套自己」时无限递归的问题。
 */
async function flattenNodes(nodes: any[]): Promise<Exclude<MessageSegment, { type: "node" }>[]> {
  const arr: Exclude<MessageSegment, { type: "node" }>[] = []
  for (const n of nodes) {
    for (const s of await msgToGscore(n?.message ?? n)) if (s.type !== "node") arr.push(s)
  }
  return arr
}

/**
 * 云崽 message 数组 -> 早柚核心 Message[]
 *
 * @param e 触发事件。只用于合并转发回查（要拿事件上的会话对象与 Bot 做能力探测），
 *          不传就只是取不到转发内容，其余转换不受影响。
 */
export async function msgToGscore(msg: YunzaiMessage, e?: AdapterEvent): Promise<MessageSegment[]> {
  const list: (string | YunzaiSegment)[] = Array.isArray(msg) ? msg : [msg]
  const out: MessageSegment[] = []

  for (const i of list) {
    if (i == null) continue
    if (typeof i !== "object") {
      const s = String(i)
      if (s) out.push({ type: "text", data: s })
      continue
    }

    switch (i.type) {
      case "text":
        if (i.text) out.push({ type: "text", data: String(i.text) })
        break

      case "markdown":
        out.push({
          type: "markdown",
          data: typeof i.data === "string" ? i.data : toStr(i.data),
        })
        break

      case "image": {
        // 收到的消息带 url，自己构造的消息带 file
        const data = await toGscoreMedia(i.url ?? i.file, i.name)
        if (!data) break
        out.push({ type: "image", data })
        if (i.width && i.height)
          out.push({ type: "image_size", data: [Number(i.width), Number(i.height)] })
        break
      }

      case "record": {
        const data = await toGscoreMedia(i.url ?? i.file, i.name)
        if (data) out.push({ type: "record", data })
        break
      }

      case "video": {
        const data = await toGscoreMedia(i.url ?? i.file, i.name)
        if (data) out.push({ type: "video", data })
        break
      }

      case "file": {
        const data = await toGscoreFile(i.url ?? i.file ?? i.fid, i.name)
        if (data) out.push({ type: "file", data })
        break
      }

      case "at": {
        const at = String(i.qq ?? i.id ?? i.user_id)
        // @全体成员：云崽用 qq:"all" 表示，早柚核心没有这个概念。
        // 核心 handler.py:754-762 只把 at 分成"等于 bot_self_id"和"其它"两种，
        // "all" 会落进后者被 append 进 at_list —— 那是一串用户 id，混进字面量
        // "all" 会被下游当成真实用户：core_pm/__init__.py:36-37 把 at_list
        // 直接 extend 进封禁参数，handler.py:671 又拿 `not at_list` 当
        // "没 @ 具体某人"的判据。丢弃它比伪造一个用户 id 安全。
        if (at === "all") break
        out.push({ type: "at", data: at })
        break
      }

      case "reply": {
        const id = i.id ?? i.message_id
        if (id != null && id !== "") out.push({ type: "reply_id", data: String(id) })
        break
      }

      case "button":
        out.push({ type: "buttons", data: buttonsToGscore(i.data) })
        break

      case "node": {
        // 协议禁止 node 嵌套，这里拍平
        out.push({ type: "node", data: await flattenNodes(Array.isArray(i.data) ? i.data : []) })
        break
      }

      case "forward": {
        // Milky 的入站转发段只有 id、没有内容（adapter/Milky.js:853-854），落到下面的
        // default 会被 toStr 按普通对象 JSON.stringify（utils/compat.ts:65 ->
        // TRSS lib/util.js:232-248），于是 raw_text 里出现一坨
        // {"type":"forward","id":"..."}。纯转发时无害，但「ww面板 + 转发」同时发来时，
        // 核心那些 ^...$ 命令正则就匹配不上了。
        const nodes = await resolveForwardMessage(String(i.id ?? ""), e)
        if (nodes.length) {
          out.push({ type: "node", data: await flattenNodes(nodes) })
          break
        }

        // 取不到内容时**什么都不上报**，不放 "[合并转发]" 之类的占位。
        // 权衡点在于占位同样是 text 段，会和命令文本拼进同一个 raw_text：
        // 「ww面板[合并转发]」对 ^ww面板$ 与「ww面板{"type":...}」是一样的失配 ——
        // 换一串好看的字节修不掉这个 bug。而转发正文本来就不进 raw_text，
        // 丢掉它核心并没有少掉可匹配的东西。与 case "at" 丢弃 "all" 同一路数。
        //
        // 代价：只有一个转发段的消息会因 content 为空被 yunzaiToGscore 判 false、
        // 整条不上报。那条消息原先也匹配不上任何命令，少发一帧比污染命令文本划算。
        makeLog("debug", `合并转发取不到内容，不上报占位：${i.id}`, "GsCore", true)
        break
      }

      case "raw":
        if (i.data?.type) out.push(i.data)
        break

      default:
        out.push({ type: "text", data: toStr(i) })
    }
  }
  return out
}

/**
 * 完整 MessageReceive
 * @param e     云崽消息事件
 * @param botId 平台标识（resolveBotId 的结果）
 * @param opts  { isMaster, selfId }
 */
export async function yunzaiToGscore(
  e: AdapterEvent,
  botId: string,
  opts: { isMaster?: boolean; selfId?: string } = {},
): Promise<MessageReceive | false> {
  const content: MessageSegment[] = []

  // 先上报当前消息，引用上下文放在末尾，避免 reply/node 影响命令匹配。
  // 引用 id 与正文是两个不同字段；引用图片和合并转发节点也一并保留。
  const current = await msgToGscore(e.message || [], e)
  content.push(...current.filter(i => i.type !== "reply" && i.type !== "reply_id"))

  const replyId = resolveReplyId(e)
  if (replyId) content.push({ type: "reply_id", data: replyId })

  // 引用正文/媒体与引用 id 是两件事，不能把前者挂在后者上：QQBot 只有 REFIDX
  // 引用索引（reply.ts 分支 5），核心拿它查不到缓存的图，引用图必须自己作为
  // image 段上报。用 hasReplyContext 而不是直接 await —— 有 getReply 的适配器
  // 上那是一次请求，不能对每条消息都白调。
  if (hasReplyContext(e)) {
    const quotedMessage = await resolveReplyMessage(e)
    if (quotedMessage.length) {
      const quoted = await msgToGscore(quotedMessage, e)
      const nodes: MessageSegment[] = []
      for (const item of quoted) {
        if (item.type === "node") nodes.push(...item.data)
      }

      let quotedText = replyText(quotedMessage)
      if (nodes.length) {
        quotedText = quotedText
          ? quotedText.includes(NODE_MARK)
            ? quotedText
            : `${NODE_MARK}\n${quotedText}`
          : nodePreview(nodes)
      }
      if (quotedText) content.push({ type: "reply", data: quotedText })

      // 核心新协议要求引用图片作为普通 image 段上报；node 同样保持独立段。
      for (const item of quoted) {
        if (item.type === "image" || item.type === "image_size" || item.type === "node")
          content.push(item)
      }
    }
  }

  if (!content.length) return false

  // user_pm 越小权限越高；主人恒为 1（短路，主人在群里也是 1）
  let user_pm: UserPm = 6
  if (opts.isMaster) {
    user_pm = 1
  } else if (e.message_type === "group" || e.isGroup) {
    const role = e.sender?.role
    if (role === "owner") user_pm = 2
    else if (role === "admin") user_pm = 3
  }

  const sender = { ...e.sender, user_id: String(e.user_id) }
  sender.nickname ||= e.sender?.card || String(e.user_id)
  const avatar =
    e.avatar || e.sender?.avatar || e.member?.getAvatarUrl?.() || e.friend?.getAvatarUrl?.()
  if (avatar) sender.avatar = avatar

  const data: MessageReceive = {
    bot_id: botId,
    // 用调用方解析过的 selfId：e.self_id 可能为 null，
    // String(null) 会把字符串 "null" 发到核心，核心侧再拿它当账号去查就全错了
    bot_self_id: opts.selfId ?? (e.self_id != null ? String(e.self_id) : ""),
    msg_id: String(e.message_id ?? Date.now().toString(36)),
    user_id: String(e.user_id),
    user_pm,
    content,
    sender,
    group_id: null,
    user_type: "direct",
  }

  // isChannel 而不是 e.isGuild || e.message_type === "guild"：QQBot-Plugin 的
  // 频道消息把 message_type 标成 group、且不设 isGuild，靠 group_id 的 qg_ 前缀
  // 才认得出来。判据与理由见 utils/message.ts 的 isChannel。
  if (isChannel(e)) {
    data.user_type = "channel"
    // 保持 qg_ 前缀原样：核心把 group_id 当不透明定位符回传到 MessageSend.target_id，
    // 而 QQBot-Plugin 的 pickGroup 正是靠这个前缀分派到 pickGuild（index.js:1103）。
    // 剥掉它下行就 pick 不到频道了。
    data.group_id = String(e.group_id ?? e.channel_id)
  } else if (e.message_type === "group" || e.isGroup) {
    data.user_type = "group"
    data.group_id = String(e.group_id)
  } else {
    data.user_type = "direct"
  }
  return data
}
