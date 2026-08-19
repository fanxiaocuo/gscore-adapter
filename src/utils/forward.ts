/**
 * 合并转发段的内容获取
 *
 * 为什么需要专门一层
 * ------------------
 * Milky 的入站合并转发段**只有一个 id**：adapter/Milky.js:853-854 把协议的
 * `forward` 段压成 `{ type: "forward", id: d.forward_id }`，正文一个字都不带
 * （协议侧的 `title` / `preview` / `summary` 也在这一步被丢掉）。想要内容只能回查。
 *
 * 各适配器的回查能力
 * ----------------
 *   适配器       方法                                    评估
 *   OneBotv11    getForwardMsg(message_id)               有；OneBotv11.js:216-226，
 *                                                        挂在 pickFriend/pickGuild/
 *                                                        pickGroup 上（:740/:812/:834）
 *   Milky        **没有任何包装**                         无
 *
 * `e.group` / `e.friend` 上能探到它：Milky 的 makeMessage 虽然显式
 * `delete data.group / data.friend`（Milky.js:510-512），但 TRSS 的
 * `prepareEvent` 会用 pickGroup / pickFriend 重新挂回去（lib/bot.js:320-335，
 * 由 `em` 调用 :363-364）。所以这两个对象恒在，能力差别才是真差别。
 *
 * Milky 上怎么补出来
 * ----------------
 * Milky.js 全文只有发送侧的 sendGroupForwardMsg / makeForwardMsg，没有
 * getForwardMsg，也没有包装协议的 `get_forwarded_messages`（全文 0 处）。
 * 但通用 API 通道挂在 Bot 上：`sendApi(action, params)`（Milky.js:144-145、:192），
 * 而 Milky 协议确实定义了 `get_forwarded_messages`（入参 `forward_id`，返回
 * `messages: IncomingForwardedMessage[]`，每项含 sender_name / time / segments）。
 *
 * 拿回来的是**协议原始段**（`{ type:"image", data:{ temp_url, ... } }`），
 * 而 msgToGscore 读的是云崽段的 `i.text` / `i.url`，直接喂进去会整段丢失。
 * 翻译那一步不自己写：Milky.js:819-872 的 `parseMsg` 就是干这个的，而适配器实例
 * 就挂在 Bot 上（`adapter: this`，Milky.js:141-142，框架本身也读它 —— lib/bot.js:346）。
 * **按能力探测**拿这两个东西，探不到就放弃 —— 不 import 宿主模块，也不照抄一份
 * parseMsg 等着两边漂移。
 *
 * 不按适配器名分支
 * --------------
 * 这里不写 `adapter_id === "Milky"`，理由同 compat.ts:13-15：名字会被 fork 改掉，
 * 能力不会。非 Milky 的实现收到未知 action 会回非 0 retcode，走同一条降级路径。
 */
import type { AdapterEvent, YunzaiSegment } from "@/types"
import { makeLog, toStr } from "./compat.js"

/**
 * 云崽 node 段载荷的一项：一条被转发的消息。
 *
 * 只保证 `message` 字段 —— 其余原样保留适配器给的字段（sender / time / ...），
 * 不去发明一套字段映射：调用方（toGscore 的拍平逻辑）也只读 message。
 */
export interface ForwardNode {
  /** 被转发那条消息的云崽消息段 */
  message: (string | YunzaiSegment)[]
  [k: string]: any
}

/** 把各家 getForwardMsg 的返回形状统一成 ForwardNode[]。 */
function toNodes(raw: any): ForwardNode[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  const out: ForwardNode[] = []

  for (const i of list) {
    if (i == null) continue
    // OneBotv11 把 parseMsg 的结果写回 i.message（OneBotv11.js:223-224），但
    // get_forward_msg 协议原字段叫 content，实现不一时两个都认；都没有就当整项
    // 本身就是一个消息段。
    const message = typeof i === "object" ? (i.message ?? i.content ?? i) : i
    const arr = Array.isArray(message) ? message : [message]
    if (!arr.length) continue
    out.push(typeof i === "object" ? { ...i, message: arr } : { message: arr })
  }

  return out
}

/** Milky：协议有 get_forwarded_messages，适配器没包装，走通用 sendApi + parseMsg。 */
async function fromMilky(id: string, e?: AdapterEvent): Promise<ForwardNode[]> {
  const bot: any = e?.bot
  if (typeof bot?.sendApi !== "function" || typeof bot?.adapter?.parseMsg !== "function") return []

  try {
    const ret = await bot.sendApi("get_forwarded_messages", { forward_id: id })
    // Milky 的 callApi 在 retcode 缺失时补 0（Milky.js:403-405），所以非 0 一定是
    // 真失败（含"不认识这个 action"）。silent 降级，不往用户日志里塞。
    if (!ret || ret.retcode !== 0) {
      makeLog("debug", [`get_forwarded_messages 未返回内容：${toStr(ret)}`], "GsCore", true)
      return []
    }

    const out: ForwardNode[] = []
    for (const m of Array.isArray(ret.data?.messages) ? ret.data.messages : []) {
      const message = bot.adapter.parseMsg(m?.segments)
      if (!Array.isArray(message) || !message.length) continue
      out.push({ ...m, message })
    }
    return out
  } catch (err) {
    makeLog("debug", ["通过 get_forwarded_messages 获取合并转发失败", err], "GsCore", true)
    return []
  }
}

/**
 * 取合并转发的内容。
 *
 * 返回云崽段而不是核心段，理由同 reply.ts 的 fromMsgElements：让 msgToGscore
 * 统一做媒体转换（base64 兜底、image_size 派生等），这里不碰核心协议。
 *
 * @param id 合并转发 id（Milky 的 forward_id / OneBot 的 message_id）
 * @param e  触发事件；不传（如从 node 内部转换时）就没有探测对象，直接放弃
 * @returns 取不到返回空数组，**不抛错** —— 调用方据此决定怎么降级
 */
export async function resolveForwardMessage(id: string, e?: AdapterEvent): Promise<ForwardNode[]> {
  if (!id) return []

  // 群私各自的会话对象上探 —— pickGroup / pickFriend 返回的东西才带这个方法，
  // Bot 上没有（OneBotv11.js 的三处挂载全在 pick* 里）。
  const group = e?.isGroup || e?.message_type === "group"
  const target: any = group ? e?.group : e?.friend

  if (typeof target?.getForwardMsg === "function") {
    try {
      const nodes = toNodes(await target.getForwardMsg(id))
      if (nodes.length) return nodes
    } catch (err) {
      makeLog("debug", ["通过 getForwardMsg 获取合并转发失败", err], "GsCore", true)
    }
  }

  return fromMilky(id, e)
}
