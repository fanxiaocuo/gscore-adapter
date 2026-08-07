/**
 * 早柚核心 -> 云崽
 */
import { fromGscoreMedia } from "@/utils"
import { GS_LOG_RE, LOG_LEVELS, LOG_ALIAS } from "@/constants"
import { buttonsFromGscore } from "./buttons.js"

/**
 * MessageSend.content -> 云崽 message
 * @returns { message, quote, logOnly }
 *
 * 修复 ws-plugin 的 bug：上游 makeGSUidSendMsg 只检查 content[0] 是否为 log 段，
 * 命中就丢弃整条消息的其余内容。这里逐段过滤，log 之后的正文照常发送。
 */
export async function gscoreToYunzai(content) {
  const message = []
  let quote = null
  let sawLog = false

  for (const i of Array.isArray(content) ? content : [content]) {
    if (!i?.type) continue

    if (GS_LOG_RE.test(i.type)) {
      sawLog = true
      const raw = i.type.slice(4).toLowerCase()
      const level = LOG_ALIAS[raw] || raw
      Bot.makeLog(LOG_LEVELS.includes(level) ? level : "info", Bot.String(i.data), "GsCore")
      continue // 关键：继续处理后续真实内容
    }

    switch (i.type) {
      case "text":
        if (i.data !== "" && i.data != null) message.push(String(i.data))
        break

      case "markdown":
        message.push(segment.markdown(i.data))
        break

      case "image":
        message.push(segment.image(fromGscoreMedia(i.data)))
        break

      case "image_size":
        // 附加到上一个 image 段
        if (Array.isArray(i.data) && message.at(-1)?.type === "image") {
          message.at(-1).width = Number(i.data[0])
          message.at(-1).height = Number(i.data[1])
        }
        break

      case "record":
        message.push(segment.record(fromGscoreMedia(i.data)))
        break

      case "video":
        message.push(segment.video(fromGscoreMedia(i.data)))
        break

      case "file": {
        // `{文件名}|{base64}`，用 indexOf 而非 split，避免 base64 里的 | 干扰
        const s = String(i.data ?? "")
        const idx = s.indexOf("|")
        const name = idx > -1 ? s.slice(0, idx) : undefined
        const body = idx > -1 ? s.slice(idx + 1) : s
        message.push(segment.file(fromGscoreMedia(body), name))
        break
      }

      case "at":
        message.push(segment.at(Number(i.data) || String(i.data)))
        break

      case "reply":
        // 由调用方 unshift(segment.reply(quote))
        quote = String(i.data)
        break

      case "buttons": {
        const b = buttonsFromGscore(i.data)
        if (b) message.push(b)
        break
      }

      case "node": {
        const nodes = []
        for (const sub of Array.isArray(i.data) ? i.data : []) {
          const { message: m } = await gscoreToYunzai([sub])
          if (m.length)
            nodes.push({ message: m, nickname: "早柚核心", user_id: String(Bot.uin) })
        }
        if (nodes.length) message.push(Bot.makeForwardMsg(nodes))
        break
      }

      case "group":
        // 定位 ID，不是内容。核心 bot.py:433 在 group_id 非空时给**每一帧**都附上这段，
        // 供 DoDo 私聊那类「需要两个 ID 才能定位」的平台取用（见核心 docs
        // 08-special-platforms.md:37）。云崽靠 target_id 就能定位，用不上它。
        // 不显式吃掉的话会掉进 default 被 String() 成群号，每条群消息尾巴上都挂一串数字。
        break

      default:
        // 红线 14（核心 docs 10-pitfalls.md:75）：不支持的类型 warning + 跳过，不抛异常。
        // 早期这里是 push(String(i.data))，本意是"尽量别丢内容"，但对
        // template_markdown 这种 data 为 dict 的段会打印 [object Object]，
        // 对纯元数据段则是把定位 ID 当正文发出去 —— 宁可少发也不发垃圾。
        Bot.makeLog("warn", `暂不支持的消息段类型 ${i.type}，已跳过`, "GsCore", true)
    }
  }

  return { message, quote, logOnly: sawLog && message.length === 0 }
}

/**
 * 把 gscoreToYunzai 的产物归一化成事件 message 数组
 * dealEvent 遍历 e.message 时期望 {type,...} 对象，且读 i.url 取图片
 */
export function normalizeEventMsg(message) {
  return message.map(i => {
    if (typeof i === "string") return { type: "text", text: i }
    if (i?.type === "image" && !i.url) return { ...i, url: i.file }
    return i
  })
}
