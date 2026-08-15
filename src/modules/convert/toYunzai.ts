/**
 * 早柚核心 -> 云崽
 */
import { fromGscoreMedia } from "@/utils"
import { GS_LOG_RE, LOG_LEVELS, LOG_ALIAS } from "@/constants"
import { buttonsFromGscore } from "./buttons.js"
import { makeLog, toStr, makeForwardMsg } from "@/utils/compat"
import type { SendSegment, SendTarget, YunzaiSegment } from "@/types"

/**
 * MessageSend.content -> 云崽 message
 * @param content 早柚核心消息段。允许单段（非数组）—— 核心多数情况发数组，
 *                但 node 段递归时这里自己传的是单元素数组，两种都收
 * @param target  已 pick 出的 Group/Friend。仅 node 段用得上：
 *                Miao 上制作转发必须靠 target 的原生实现（见 compat.makeForwardMsg）。
 *                不传则 Miao 上的转发会降级为纯文本。
 * @returns { message, quote, logOnly }
 *
 * 修复 ws-plugin 的 bug：上游 makeGSUidSendMsg 只检查 content[0] 是否为 log 段，
 * 命中就丢弃整条消息的其余内容。这里逐段过滤，log 之后的正文照常发送。
 *
 * 段一律原样转换，不按适配器能力做降级：发不出 button / markdown 的适配器
 * （Milky、OneBotv11、OPQBot）本来就会把这些段丢掉，再加一层降级只是用文本
 * 噪音替换静默丢弃，并没有让内容真的送达。而按钮目前基本只有 QQBot 在用，
 * QQBot 原生支持，降级路径实际服务不到什么人。
 */
export async function gscoreToYunzai(
  content: SendSegment | SendSegment[] | null | undefined,
  target?: SendTarget,
) {
  /**
   * 云崽侧 message
   *
   * 标 any[] 而不是 `(string | YunzaiSegment)[]`：装进去的是
   * `segment.image()` / `segment.button()` 等的返回值，那些函数的声明用了泛型
   * 各自返回不同的具体形状（segment.d.ts:41/30），而 `YunzaiSegment` 是本插件
   * 为**读**入站段定义的宽结构。往里塞精确形状会因 index signature 的兼容规则
   * 处处报错，收益只是一层不参与任何判断的标注 —— 这个数组造完就直接交给
   * `target.sendMsg`，中途只被 `unshift` 与 `.length` 碰过。
   */
  const message: any[] = []
  let quote: string | null = null
  let sawLog = false

  for (const i of Array.isArray(content) ? content : [content]) {
    if (!i?.type) continue

    if (GS_LOG_RE.test(i.type)) {
      sawLog = true
      const raw = i.type.slice(4).toLowerCase()
      const level = (LOG_ALIAS as Record<string, string>)[raw] || raw
      makeLog(LOG_LEVELS.includes(level) ? level : "info", toStr(i.data), "GsCore")
      continue // 关键：继续处理后续真实内容
    }

    switch (i.type) {
      case "text":
        if (i.data !== "" && i.data != null) message.push(String(i.data))
        break

      /**
       * 空 markdown 不透传，并把「核心侧可能丢了图」这条线索说出来
       * ------
       * 核心 bot.send_option(图片, 按钮) 在平台命中按钮白名单时会走 to_markdown
       * （core segment.py:478）把图文压成一段 markdown。那里取图片 URL 的前提是
       * 消息里带 image_size 段，而 image_size 只有 _image_to_url 走「转链接」分支
       * 才会产出（core segment.py:278/308）；一旦「图片发送方式=link」却没启用图床，
       * _image_to_url 落到 `else: return [message]`，图片仍是 bytes、没有 image_size，
       * 于是 to_markdown 的 `if url and size` 不成立 —— 图片既没写进 markdown 文本，
       * 也没留在消息里，被静默丢弃，核心那边一句日志都不打。纯图片响应（如 ww帮助）
       * 因此只剩一个空 markdown 加一组按钮。
       *
       * 空 markdown 发出去对用户没有任何信息量，QQ 侧还可能因空内容直接报错，
       * 顺带把按钮也拖没。跳过它，让按钮自己发出去，并留一条 warn 指向核心配置 ——
       * 这类问题从现象上看只是「帮助没图了」，不给线索就得去翻核心源码。
       */
      case "markdown":
        if (String(i.data ?? "").trim() === "") {
          makeLog(
            "warn",
            "核心下发了空 markdown，已跳过；若本该是图片，检查核心「图片发送方式」与图床配置",
            "GsCore",
            true,
          )
          break
        }
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
        const nodes: { message: any[]; nickname: string; user_id: number }[] = []
        for (const sub of Array.isArray(i.data) ? i.data : []) {
          const { message: m } = await gscoreToYunzai([sub], target)
          if (m.length)
            // user_id 传数字：ICQQ 的 Forwardable.user_id 声明为 number，
            // 且 contactable.js:551 把它直接写进 protobuf 数字字段（`1: fake.user_id`），
            // 不做转换。实测 pb.encode 对字符串不抛错，但没理由喂错类型。
            // Bot.uin 在两个框架上都是数字；取不到时退回 0 而不是 NaN。
            nodes.push({ message: m, nickname: "早柚核心", user_id: Number(Bot.uin) || 0 })
        }
        if (!nodes.length) break

        const fwd = await makeForwardMsg(nodes, target)
        if (fwd) {
          message.push(fwd)
          break
        }

        // 制作失败（如 Miao 上没拿到 target，或上传被风控）：
        // 拍平成普通消息，宁可少了折叠样式也别把整条转发吞掉。
        makeLog("warn", "转发消息制作失败，已降级为普通消息", "GsCore", true)
        for (const n of nodes) for (const seg of n.message) message.push(seg)
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
        makeLog("warn", `暂不支持的消息段类型 ${i.type}，已跳过`, "GsCore", true)
    }
  }

  return { message, quote, logOnly: sawLog && message.length === 0 }
}

/**
 * 把 gscoreToYunzai 的产物归一化成事件 message 数组
 * dealEvent 遍历 e.message 时期望 {type,...} 对象，且读 i.url 取图片
 */
export function normalizeEventMsg(message: (string | YunzaiSegment)[]): YunzaiSegment[] {
  return message.map(i => {
    if (typeof i === "string") return { type: "text", text: i }
    if (i?.type === "image" && !i.url) return { ...i, url: i.file }
    return i
  })
}
