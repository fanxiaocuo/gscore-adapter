/**
 * 云崽 -> 早柚核心
 */
import { toGscoreMedia, toGscoreFile } from "@/utils"
import type { MessageReceive, UserPm } from "@/types"
import { buttonsToGscore } from "./buttons.js"

/** 云崽 message 数组 -> 早柚核心 Message[] */
export async function msgToGscore(msg) {
  if (!Array.isArray(msg)) msg = [msg]
  const out = []

  for (const i of msg) {
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
          data: typeof i.data === "string" ? i.data : Bot.String(i.data),
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

      case "at":
        out.push({ type: "at", data: String(i.qq ?? i.id ?? i.user_id) })
        break

      case "reply":
        out.push({ type: "reply", data: String(i.id ?? i.message_id) })
        break

      case "button":
        out.push({ type: "buttons", data: buttonsToGscore(i.data) })
        break

      case "node": {
        // 协议禁止 node 嵌套，这里拍平
        const arr = []
        for (const n of Array.isArray(i.data) ? i.data : []) {
          for (const s of await msgToGscore(n?.message ?? n)) if (s.type !== "node") arr.push(s)
        }
        out.push({ type: "node", data: arr })
        break
      }

      case "raw":
        if (i.data?.type) out.push(i.data)
        break

      default:
        out.push({ type: "text", data: Bot.String(i) })
    }
  }
  return out
}

/**
 * 完整 MessageReceive
 * @param e     云崽消息事件
 * @param botId 平台标识（resolveBotId 的结果）
 * @param opts  { isMaster }
 */
export async function yunzaiToGscore(e, botId, opts: { isMaster?: boolean } = {}) {
  const content = []

  // 引用消息放最前
  if (e.source?.message_id != null) {
    content.push({ type: "reply", data: String(e.source.message_id) })
  } else if (e.reply_id != null && !e.message?.some?.(i => i?.type === "reply")) {
    content.push({ type: "reply", data: String(e.reply_id) })
  }

  content.push(...(await msgToGscore(e.message || [])))
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
    bot_self_id: String(e.self_id),
    msg_id: String(e.message_id ?? Date.now().toString(36)),
    user_id: String(e.user_id),
    user_pm,
    content,
    sender,
    group_id: null,
    user_type: "direct",
  }

  if (e.isGuild || e.message_type === "guild") {
    data.user_type = "channel"
    data.group_id = String(e.group_id ?? e.channel_id)
  } else if (e.message_type === "group" || e.isGroup) {
    data.user_type = "group"
    data.group_id = String(e.group_id)
  } else {
    data.user_type = "direct"
  }
  return data
}
