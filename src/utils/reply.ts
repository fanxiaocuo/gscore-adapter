/**
 * 引用回复的 message_id 与正文解析
 *
 * 为什么需要专门一层
 * ------------------
 * 各适配器表达「这条消息引用了谁」以及「被引用消息的内容」的方式完全不统一。
 * 新协议要求上报两段：reply_id 放 message_id，reply 放引用正文；引用图片另作
 * image 段上报。这里把 id 解析与原消息获取收敛到同一处。
 *
 *   适配器            引用信息在哪                             有 message_id 吗
 *   ICQQ-Plugin       e.source = {user_id,time,seq,rand,...}   **没有**
 *   OneBotv11         reply 段 -> dealEvent 派生 e.reply_id     有
 *   Milky             reply 段（message_seq）                   有
 *   Satori            reply 段                                  有
 *   ComWeChat         reply 段（带额外 user_id）                 有
 *   QQBot-Plugin      e.msg_elements[]                          **没有**（见下）
 *
 * 原实现只看 `e.source?.message_id` 与 `e.reply_id`，而 ICQQ **两者都没有**：
 * icqq 的 source 由 message.js:157-166 从 proto type 45 构造，字段只有
 * user_id / time / seq / rand / message，没有 message_id；而 e.reply_id 由框架
 * dealEvent 从 **reply 段**派生，偏偏 icqq 的 parser 永不产出 reply 段
 * （ICQQ-Plugin 用自己的 Model/parser.js 覆盖了 icqq 自带的那份，同样不产出）。
 * 于是两个分支在 ICQQ 上双双不可达 —— 引用回复完全传不到核心，且不报错。
 *
 * ICQQ 上怎么补出来
 * ----------------
 * icqq 自己的 message_id 就是拿 (gid, uin, seq, rand, time) 算出来的
 * （message.js:382 `genGroupMessageId(...)`、:300 `genDmMessageId(...)`），
 * 而 source 里正好有 user_id / seq / rand / time。所以能用同一个函数反算回去，
 * 且必然与我们当初上报那条消息时用的 msg_id 一致 —— 这一点是关键，核心拿它当键
 * 去查自己缓存的图，键不一致等于没有。
 *
 * 这两个函数从 `Bot[self_id].icqq` 上取（ICQQ-Plugin 挂在 Bot 代理上，
 * index.js:868），**按能力探测**：拿不到就跳过，不去 import icqq
 * —— 本插件不依赖它，而且用户可能根本没装 ICQQ-Plugin。
 *
 * 已知不精确之处：`source.rand` 取自 `uuid2rand(q[8]?.[3] || 0)`，上游字段缺失时
 * 会是 0，算出的 id 与真实 message_id 不符。这种情况下核心查不到缓存，
 * 行为退化成「没有引用」—— 与修复前一致，不会更糟。
 *
 * QQBot 上怎么补出来
 * ----------------
 * QQBot-Plugin 三条路径全断：没有 getReply、不设 source / reply_id、也不产出
 * **入站** reply 段（index.js:383/615/739 那三处 `type:"reply"` 是出站，把我们的
 * reply 段转成 QQ API 的 `{type:"reply", event_id}`）。它只把原始
 * `e.msg_elements` 与 `e.reply_user` 挂到事件上（index.js:1430-1432）。
 * 于是引用完全传不到核心，且不报错 —— 核心那边 `image` / `reply_id` 恒为 None。
 *
 * 好在被引用消息的媒体**直链就在事件里**，比 OneBot 那条路还省事，不用回查：
 * `msg_elements[].attachments[].url` 可直接当 image/record/video/file 用。
 * 结构见 QQBot-Plugin 仓库的 msg_elements.md（作者实测记录）。
 *
 * 唯一拿不到的是 message_id：`msg_idx` 是 `REFIDX_xxx` 形式的引用索引，与我们
 * 当初上报那条消息用的 msg_id 不同源，核心拿它查缓存必然查不到。所以引用正文与
 * 媒体不能挂在「有 reply_id」这个前提上 —— 见 `hasReplyContext` 与 toGscore.ts。
 */
import type { AdapterEvent, YunzaiSegment } from "@/types"
import { makeLog } from "./compat.js"

type ReplyMessagePart = string | YunzaiSegment

/** 把 getReply / getChatHistory 的不同返回形状拍平成消息段数组。 */
function appendReplyParts(out: ReplyMessagePart[], raw: any): void {
  if (raw == null) return
  if (Array.isArray(raw)) {
    for (const item of raw) appendReplyParts(out, item)
    return
  }
  if (typeof raw === "string") {
    out.push(raw)
    return
  }
  if (typeof raw === "object" && raw.message != null) {
    appendReplyParts(out, raw.message)
    return
  }
  if (typeof raw === "object" && raw.type) out.push(raw as YunzaiSegment)
}

/**
 * 把 QQBot 引用正文里的富文本标记normalize成纯文本。
 *
 * `content` 里混着两种 QQ 专有标记（msg_elements.md 的例 2/3/7）：
 *   `<faceType=3,faceId="359",ext="...">`               表情，丢掉
 *   `[@风](mqqapi://markdown/mention?at_tinyid=...)`      at，只留显示名
 * 原样透传会让核心的 `reply` 字段里出现一坨标记，命令匹配与 AI 上下文都会被污染。
 */
function normalizeQQBotContent(content: string): string {
  return content
    .replace(/<faceType=[^>]*>/g, "")
    .replace(/\[([^\]]*)\]\(mqqapi:\/\/[^)]*\)/g, "$1")
    .trim()
}

/**
 * QQBot 专用：从 `e.msg_elements` 取被引用消息，返回云崽形状的消息段。
 *
 * 返回云崽段而不是核心段，是为了让 msgToGscore 统一做媒体转换（base64 兜底、
 * image_size 派生等），这里不碰核心协议。
 */
function fromMsgElements(e: AdapterEvent): YunzaiSegment[] {
  const list = Array.isArray(e?.msg_elements) ? e.msg_elements : []
  const out: YunzaiSegment[] = []

  for (const el of list) {
    if (el == null || typeof el !== "object") continue

    const parts: string[] = []
    const text = normalizeQQBotContent(String(el.content ?? ""))
    if (text) parts.push(text)

    const images: YunzaiSegment[] = []
    for (const a of Array.isArray(el.attachments) ? el.attachments : []) {
      const url = a?.url
      if (!url) continue
      const kind = String(a.content_type ?? "")

      // 只提图片。引用块最终只回传 image / image_size / node（toGscore.ts），
      // 其余类型转换了也会被丢掉；而 file 更糟 —— toGscoreFile 用的 toBuffer
      // 没开 http 直通，会把整个 URL 下载下来 base64（msg_elements.md 例 6 就是
      // 个 200MB 文件），白下一遍再扔掉。所以非图片只在引用正文里留个标记，
      // 用词与 nodePreview 保持一致。
      if (kind.startsWith("image/")) {
        images.push({
          type: "image",
          url,
          name: a.filename,
          width: a.width,
          height: a.height,
        } as YunzaiSegment)
      } else if (kind === "voice") {
        // 有 ASR 文本就带上：那才是被引用语音的实际内容，比"[语音]"有用得多
        parts.push(a.asr_refer_text ? `[语音]${a.asr_refer_text}` : "[语音]")
      } else if (kind.startsWith("video/")) {
        parts.push("[视频]")
      } else if (kind === "file") {
        parts.push(a.filename ? `[文件]${a.filename}` : "[文件]")
      } else {
        makeLog("debug", [`引用附件 content_type 未识别，跳过：${kind}`], "GsCore", true)
      }
    }

    const merged = parts.join(" ").trim()
    if (merged) out.push({ type: "text", text: merged } as YunzaiSegment)
    out.push(...images)
  }

  return out
}

/**
 * 事件里是否存在引用上下文（无 IO，可作为调 resolveReplyMessage 前的廉价判据）。
 *
 * 存在的意义：`resolveReplyMessage` 在有 getReply 的适配器上会发起一次请求，
 * 不能对每条消息都白调。而 QQBot 拿不到 message_id（msg_idx 是 REFIDX 引用索引，
 * 不同源），所以「有引用」不能等价于「resolveReplyId 有值」。
 */
export function hasReplyContext(e: AdapterEvent): boolean {
  if (resolveReplyId(e)) return true
  return Array.isArray(e?.msg_elements) && e.msg_elements.length > 0
}

/**
 * 获取被引用消息的原始消息段。
 *
 * QQBot 的被引用消息直接躺在事件里，优先用它，省一次请求；TRSS 走框架的
 * getReply；ICQQ 没有该路径时，按 Common.js 的做法从当前 Group/Friend 的
 * 聊天记录取一条。失败只丢引用正文，不影响 reply_id 与当前消息。
 */
export async function resolveReplyMessage(e: AdapterEvent): Promise<ReplyMessagePart[]> {
  const fromElements = fromMsgElements(e)
  if (fromElements.length) return fromElements

  if (typeof e?.getReply === "function") {
    try {
      const out: ReplyMessagePart[] = []
      appendReplyParts(out, await e.getReply())
      if (out.length) return out
    } catch (err) {
      makeLog("debug", ["通过 getReply 获取引用消息失败", err], "GsCore", true)
    }
  }

  const src = e?.source
  const group = e?.isGroup || e?.message_type === "group"
  const target = group ? e?.group : e?.friend
  const cursor = group ? src?.seq : src?.time
  if (cursor == null || typeof target?.getChatHistory !== "function") return []

  try {
    const history = await target.getChatHistory(cursor, 1)
    const latest = Array.isArray(history) ? history.at(-1) : history
    const out: ReplyMessagePart[] = []
    appendReplyParts(out, latest)
    return out
  } catch (err) {
    makeLog("debug", ["从聊天记录获取引用消息失败", err], "GsCore", true)
    return []
  }
}

/** 从消息数组里找 reply 段的 id */
function fromReplySegment(e: AdapterEvent): string {
  const list = Array.isArray(e?.message) ? e.message : e?.message != null ? [e.message] : []
  for (const i of list) {
    if (typeof i !== "object" || i?.type !== "reply") continue
    const id = i.id ?? i.message_id
    if (id != null && id !== "") return String(id)
  }
  return ""
}

/**
 * ICQQ 专用：由 e.source 反算 message_id
 *
 * @returns 算不出来返回空串
 */
function fromIcqqSource(e: AdapterEvent): string {
  const src = e?.source
  if (!src || src.seq == null) return ""

  // ICQQ-Plugin 把整个 icqq 模块挂在 Bot[uin].icqq 上（index.js:868）。没有就说明
  // 不是 ICQQ，或者版本变了 —— 两种情况都只能放弃，不猜。
  // 走 any：@types/trss-yunzai 的 Client 上没有 icqq 字段（它是 ICQQ-Plugin 自己
  // 加的，不属于框架契约），按能力探测而不是让类型定义追着插件跑。
  const icqq = e.bot?.icqq ?? (globalThis.Bot as any)?.[e.self_id]?.icqq
  if (!icqq) return ""

  const seq = Number(src.seq)
  const rand = Number(src.rand) || 0
  const time = Number(src.time) || 0
  if (!Number.isFinite(seq)) return ""

  try {
    const gid = Number(e.group_id)
    if (gid && typeof icqq.genGroupMessageId === "function") {
      // pktnum 恒给 1：source 里没有这个信息，而分片消息（pktnum > 1）
      // 在引用场景极少见。给错只会让核心查不到缓存，不会发错消息。
      return String(icqq.genGroupMessageId(gid, Number(src.user_id) || 0, seq, rand, time, 1))
    }

    if (typeof icqq.genDmMessageId === "function") {
      // 私聊 id 里存的是「对方账号」而非发送者：icqq message.js:297-300
      //   opposite = from_id；from_id === 自己时 opposite = to_id 且 flag = 1
      // 收到的消息里对方恒为 e.user_id。被引用的那条若是自己发的（source.user_id
      // 等于 self_id），flag 取 1，否则 0。
      const self = String(e.self_id)
      const flag = String(src.user_id) === self ? 1 : 0
      return String(icqq.genDmMessageId(Number(e.user_id) || 0, seq, rand, time, flag))
    }
  } catch (err) {
    makeLog("debug", ["由 source 反算引用 id 失败", err], "GsCore", true)
  }
  return ""
}

/**
 * 解析事件引用的消息 id
 *
 * 顺序即可信度：适配器直接给的 > 框架派生的 > 消息段里的 > 由 source 反算的。
 *
 * @returns 没有引用返回空串
 */
export function resolveReplyId(e: AdapterEvent): string {
  // 1) 适配器直接在 source 上给了（非 ICQQ 的适配器可能有）
  if (e?.source?.message_id != null && e.source.message_id !== "")
    return String(e.source.message_id)

  // 2) 框架 dealEvent 从 reply 段派生
  if (e?.reply_id != null && e.reply_id !== "") return String(e.reply_id)

  // 3) 自己从消息段里找 —— 本插件的钩子可能早于 dealEvent 执行，
  //    那时 e.reply_id 还没挂上（lifecycle.ts 注册在框架监听器之前）
  const seg = fromReplySegment(e)
  if (seg) return seg

  // 4) ICQQ：由 source 反算
  const icqqId = fromIcqqSource(e)
  if (icqqId) return icqqId

  // 5) QQBot：只有 REFIDX 引用索引可用
  //    它与 msg_id 不同源，核心拿它查缓存查不到 —— 但仍然上报：它是 QQ 侧真实的
  //    引用标识，且能让下游「有没有引用」的判断成立。真正承载引用图的是随后单独
  //    上报的 image 段，不依赖这个 id。
  const refIdx = e?.msg_elements?.[0]?.msg_idx
  if (refIdx != null && refIdx !== "") return String(refIdx)

  return ""
}
