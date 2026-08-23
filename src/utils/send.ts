/**
 * @description 发送结果判定：各适配器的 sendMsg 失败语义分抛错派与返回派，不能只靠「没抛错就算成功」
 *
 * 注意：返回派（OneBot 系与 Milky）从不抛 —— Milky 的 callApi 在 catch 里造一个
 * `{ retcode:-1, status:"failed", error }` 返回（Milky.js:424-434）。直接 count("down")
 * 会把失败记成一次成功中转，而中转计数的全部意义就是发现「连着但不通」。
 * 判定保守，只在明确有失败信号时判失败：retcode 存在且非 0 / status 是 "failed" / error 为真。
 * 注意：不拿「取不到 message_id」当失败 —— 很多适配器成功时也不返回 id（stdin、部分 OneBot 实现）。
 */

/**
 * @description 从发送返回值里提取失败原因；成功返回空串
 *
 * @param ret 各适配器 sendMsg 的返回值。标 any 是诚实的 —— 这函数存在的理由就是各家返回形状不统一，
 *            所有字段读取都得先当「可能没有」处理
 */
export function sendError(ret: any): string {
  // undefined / null：多数适配器成功时也这样，不能算失败
  if (ret == null) return ""
  if (typeof ret !== "object") return ""

  // 数组：QQBot-Plugin 与 ICQQ-Plugin 拆多条发送时返回数组，任一失败即整体失败
  if (Array.isArray(ret)) {
    for (const i of ret) {
      const err = sendError(i)
      if (err) return err
    }
    return ""
  }

  if (ret.error) {
    // error 可能是 Error、字符串，也可能是 ICQQ-Plugin 那种数组
    if (Array.isArray(ret.error)) {
      const first = ret.error.find(Boolean)
      if (first) return String(first?.message || first)
      // error 是空数组：ICQQ-Plugin 多组发送时恒带这个字段，空的表示没出错
    } else {
      return String(ret.error?.message || ret.error)
    }
  }

  if (ret.status === "failed") return String(ret.msg || ret.wording || "status: failed")

  // retcode 只在存在时判：0 成功是 OneBot 约定，没有这个字段的适配器不参与判定
  if (ret.retcode != null && Number(ret.retcode) !== 0)
    return String(ret.msg || ret.wording || `retcode: ${ret.retcode}`)

  return ""
}

/**
 * @description 从发送返回值里取消息 id，供核心的定时撤回回执用
 * 可能是数组（ICQQ-Plugin 风控时会重打成转发重试，返回 `{ message_id: [], data: [], error: [] }`），
 * 协议的 RecallReceipt.id 本身允许 string[]，所以原样透传，只把空数组归一成 null。
 *
 * @param ret 同 {@link sendError}，形状因适配器而异
 */
export function sendMessageId(ret: any): string | string[] | null {
  if (ret == null || typeof ret !== "object") return null

  if (Array.isArray(ret)) {
    const ids = ret
      .map(i => sendMessageId(i))
      .flat()
      .filter(Boolean) as string[]
    return ids.length ? (ids.length === 1 ? ids[0] : ids) : null
  }

  const id = ret.message_id ?? ret.msg_id ?? ret.id
  if (id == null) return null
  if (Array.isArray(id)) {
    const ids = id.filter(i => i != null && i !== "").map(String)
    return ids.length ? (ids.length === 1 ? ids[0] : ids) : null
  }
  return id === "" ? null : String(id)
}

/** @description 一次下行投递的状态 */
export type DeliveryKind =
  /** 明确没有当前失败，或能证明所有最终分组都成功 */
  | "complete"
  /** 同时存在成功数据与最终失败 */
  | "partial"
  /** 没有任何成功且存在失败 */
  | "failed"
  /** 返回形状不足以证明结果 */
  | "unknown"

export interface Delivery {
  kind: DeliveryKind
  /** 失败原因；没有失败信号时为空串。同 {@link sendError} 的取值 */
  error: string
  /** 已投出的分组数；返回形状证明不了时为 null */
  delivered: number | null
}

/**
 * @description 把发送返回值分成四态：complete / partial / failed / unknown
 *
 * 一个「投出去了吗」的布尔不够用：QQBotAdapter.sendMsg（index.js:805-865）把一条下行拆成多组逐个发，
 * 失败只 push 进 `rets.error` 就继续，接着四级阶梯重试，而 **rets.error 全程不清空** ——
 * 首轮失败、后续成功的发送返回的仍是 `{ message_id:[非空], data:[非空], error:[旧错误] }`。
 * 那个布尔要同时回答「要不要整条重发」（不能，会复制成功的部分）与「算不算完整成功」（不算），
 * 旧实现用它兼任两者，把半条计成了一次完整中转。
 *
 * 注意：分组总数拿不到，所以 data 与 error 同时非空时证不出整条完成（「自愈成功」与「有一组永久失败」
 * 形状相同），一律判 partial：不重发、取撤回 id、但不计完整成功。
 * 注意：判据用 `rets.data` 而不是 `message_id`（:821 是 `if (ret.id)`，已投递但无 id 时它是空的）。
 * 注意：形状不认识时必须归 unknown 退回 sendError，不能当「没投出去」—— 只认 data 数组的话，
 * 返回形状一变就会无条件地「每条消息都回退再发一遍」，比偶发重复更糟。
 *
 * @param ret 同 {@link sendError}，形状因适配器而异
 */
export function classifyDelivery(ret: any): Delivery {
  const error = sendError(ret)

  // 顶层数组：QQBot-Plugin 与 ICQQ-Plugin 拆多条发送时返回数组。逐项分类再归并 ——
  // 旧实现在这个形状上与 { data: [...] } 结论相反，于是把已经成功的那几条又发一遍
  if (Array.isArray(ret)) {
    const parts = ret.map(i => classifyDelivery(i))
    const delivered = parts.some(p => p.delivered != null)
      ? parts.reduce((n, p) => n + (p.delivered ?? 0), 0)
      : null
    const bad = parts.find(p => p.error)
    if (!bad) {
      // 只有项项都拿到确切证据才敢说 complete；空数组同理归 unknown（没有成员可判）
      const proven = parts.length > 0 && parts.every(p => p.kind === "complete")
      return { kind: proven ? "complete" : "unknown", error: "", delivered }
    }
    const anyOk = parts.some(p => !p.error)
    return { kind: anyOk ? "partial" : "failed", error: bad.error, delivered }
  }

  const delivered = Array.isArray(ret?.data) ? ret.data.length : null
  if (delivered == null) return { kind: "unknown", error, delivered: null }
  if (!error) return { kind: "complete", error: "", delivered }
  return { kind: delivered > 0 ? "partial" : "failed", error, delivered }
}

/**
 * @description 这次投递有没有把内容送出去 —— 决定要不要整条回退重发
 * partial 也算「送出去了」：已有分组成功，整条重发会复制那部分内容，而上游没提供可精确重试的失败分组。
 */
export function deliveryDelivered(d: Delivery): boolean {
  if (d.kind === "unknown") return !d.error
  return d.kind !== "failed"
}

/**
 * @description 能不能算一次完整下行成功 —— 决定 count("down") 与正常撤回回执
 * 只有 complete 算；unknown 沿用 sendError 的保守语义（判不出失败即成功），
 * 否则换个返回形状就会让计数大面积归零。
 */
export function deliveryComplete(d: Delivery): boolean {
  if (d.kind === "unknown") return !d.error
  return d.kind === "complete"
}
