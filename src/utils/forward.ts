/**
 * @description 合并转发段的内容获取：把「只给了一个 id」的入站转发段回查成真正的消息
 *
 * Milky 的入站转发段只有一个 id（adapter/Milky.js:853-854 把协议的 forward 段压成
 * `{ type:"forward", id }`，正文一个字都不带），想要内容只能回查。
 * 回查能力：OneBotv11 有 getForwardMsg（挂在 pickFriend/pickGuild/pickGroup 上）；
 * Milky 没有任何包装，但通用 `sendApi("get_forwarded_messages")` 通道在，
 * 翻译协议原始段则借它自己的 `adapter.parseMsg`（Milky.js:819-872）。
 * 注意：两样东西都**按能力探测**拿，不 import 宿主模块、也不照抄一份 parseMsg 等着两边漂移。
 * 注意：不写 `adapter_id === "Milky"` 这种名字分支（理由同 compat.ts 文件头）——
 * 名字会被 fork 改掉，而非 Milky 的实现收到未知 action 会回非 0 retcode，走同一条降级路径。
 */
import type { AdapterEvent, YunzaiSegment } from "@/types"
import { makeLog, toStr } from "./compat.js"

/**
 * @description 云崽 node 段载荷的一项：一条被转发的消息
 * 只保证 `message` 字段，其余原样保留适配器给的（sender / time / ...）——
 * 调用方（toGscore 的拍平逻辑）也只读 message，不去发明一套字段映射。
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

/** Milky：协议有 get_forwarded_messages，适配器没包装，走通用 sendApi + parseMsg。 */
async function fromMilky(id: string, e?: AdapterEvent): Promise<ForwardNode[]> {
  const bot: any = e?.bot
  if (typeof bot?.sendApi !== "function" || typeof bot?.adapter?.parseMsg !== "function") return []

  try {
    const ret = await bot.sendApi("get_forwarded_messages", { forward_id: id })
    // Milky 的 callApi 在 retcode 缺失时补 0（Milky.js:403-405），所以非 0 一定是真失败
    // （含「不认识这个 action」）。silent 降级，不往用户日志里塞。
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
 * @description 取合并转发的内容，返回云崽段而不是核心段
 * 让 msgToGscore 统一做媒体转换（base64 兜底、image_size 派生等），这里不碰核心协议。
 *
 * @param id 合并转发 id（Milky 的 forward_id / OneBot 的 message_id）
 * @param e  触发事件；不传（如从 node 内部转换时）就没有探测对象，直接放弃
 * @returns 取不到返回空数组，**不抛错** —— 调用方据此决定怎么降级
 */
export async function resolveForwardMessage(id: string, e?: AdapterEvent): Promise<ForwardNode[]> {
  if (!id) return []

  // 注意：getForwardMsg 只挂在 pickGroup / pickFriend 返回的会话对象上，Bot 上没有
  // （OneBotv11.js 的三处挂载全在 pick* 里）
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
