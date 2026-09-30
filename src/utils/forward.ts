/**
 * @description 合并转发段的内容获取：把「只给了一个 id」的入站转发段回查成真正的消息
 * 入站转发段只给一个 id、不带正文（Milky.js:853-854 压成 `{type:"forward", id}`；OneBot 家给 `[CQ:forward,id=...]`），想要内容只能回查
 * 注意：内容一律自己用 `sendApi` 取 —— 宿主 OneBotv11 的 getForwardMsg 里 `if (i?.message)`（OneBotv11.js:242）在协议端只给 `content` 时不成立，
 * parseMsg 从没跑过，段停在 `{type,data:{...}}` 原始态、被下游按抬平字段名读取而整体丢弃
 * 注意：翻译借宿主自己的 `adapter.parseMsg` 按能力探测拿，不 import 宿主模块、也不照抄一份等着两边漂移
 * 注意：不写 `adapter_id === "Milky"` 这种名字分支（名字会被 fork 改掉）—— 改用「有没有包 getForwardMsg」选 action：包了的是 OneBot 家，没包的按 Milky 算
 */
import type { AdapterEvent, YunzaiSegment } from "@/types"
import { makeLog, toStr } from "./compat.js"

/**
 * @description 云崽 node 段载荷的一项：一条被转发的消息
 * 只保证 `message` 字段，其余原样保留适配器给的（sender / time / ...）；调用方（toGscore 的拍平逻辑）也只读 message
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
    // 注意：OneBotv11 把 parseMsg 结果写回 i.message（OneBotv11.js:223-224），
    // 而 get_forward_msg 协议原字段叫 content —— 实现不一时两个都认；都没有就当整项本身是一个段。
    const message = typeof i === "object" ? (i.message ?? i.content ?? i) : i
    const arr = Array.isArray(message) ? message : [message]
    if (!arr.length) continue
    out.push(typeof i === "object" ? { ...i, message: arr } : { message: arr })
  }

  return out
}

/** @description 取会话对象 —— getForwardMsg 只挂在 pickGroup / pickFriend 的返回上，Bot 上没有 */
function pickTarget(e?: AdapterEvent): any {
  const group = e?.isGroup || e?.message_type === "group"
  return group ? e?.group : e?.friend
}

/**
 * @description 自己发一次请求取内容，翻译走宿主的 parseMsg
 * 注意：只发一个 action —— OneBotv11 的 sendApi 超时 60s 且到点会 ws.terminate()（OneBotv11.js:23-27），盲试第二个 action 被静默忽略就是一次断线
 */
async function fromSendApi(id: string, e?: AdapterEvent): Promise<ForwardNode[]> {
  const bot: any = e?.bot
  if (typeof bot?.sendApi !== "function" || typeof bot?.adapter?.parseMsg !== "function") return []

  const onebot = typeof pickTarget(e)?.getForwardMsg === "function"
  const action = onebot ? "get_forward_msg" : "get_forwarded_messages"
  const params = onebot ? { message_id: id } : { forward_id: id }

  try {
    const ret = await bot.sendApi(action, params)
    // 注意：两家失败姿势不同 —— OneBotv11 对非 0 retcode 直接 throw（OneBotv11.js:31-32），
    // Milky 的 callApi 在 retcode 缺失时补 0（Milky.js:403-405），所以既要 catch 也要查 retcode
    if (!ret || (ret.retcode != null && ret.retcode !== 0)) {
      makeLog("debug", [`${action} 未返回内容：${toStr(ret)}`], "GsCore", true)
      return []
    }

    // OneBotv11 把响应包成读穿 data 的 Proxy（OneBotv11.js:34-36），两种取法都通
    const messages = ret.data?.messages ?? ret.messages
    const out: ForwardNode[] = []
    for (const m of Array.isArray(messages) ? messages : []) {
      // 注意：只喂原始段 —— parseMsg 是 `{...i.data, type:i.type}`，对已翻译的段再跑一次会把
      // 正文抹成 `{type:"text"}`，所以不拿 m.message 兜底
      const message = bot.adapter.parseMsg(m?.segments ?? m?.content)
      if (Array.isArray(message) && message.length) out.push({ ...m, message })
    }
    return out
  } catch (err) {
    makeLog("debug", [`通过 ${action} 获取合并转发失败`, err], "GsCore", true)
    return []
  }
}

/**
 * @description 取合并转发的内容，返回云崽段而不是核心段
 * 让 msgToGscore 统一做媒体转换（base64 兜底、image_size 派生等），这里不碰核心协议。
 *
 * @param id 合并转发 id（Milky 的 forward_id / OneBot 的 message_id）
 * @param e  触发事件；不传（如从 node 内部转换时）就没有探测对象，直接放弃
 * @returns 取不到返回空数组，**不抛错** —— 调用方据此决定怎么降级
 */
export async function resolveForwardMessage(id: string, e?: AdapterEvent): Promise<ForwardNode[]> {
  if (!id) return []

  const nodes = await fromSendApi(id, e)
  if (nodes.length) return nodes

  // 兜底：只包了 getForwardMsg、bot 上没挂 sendApi 的适配器还能走这条
  // 注意：这条路不补翻译 —— 宿主漏翻译时拿到的仍是原始段，下游拍不出东西，落到空 node
  const target: any = pickTarget(e)
  if (typeof target?.getForwardMsg === "function") {
    try {
      return toNodes(await target.getForwardMsg(id))
    } catch (err) {
      makeLog("debug", ["通过 getForwardMsg 获取合并转发失败", err], "GsCore", true)
    }
  }

  return []
}
