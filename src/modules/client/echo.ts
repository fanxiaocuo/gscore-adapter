/**
 * 回环防护
 *
 * 记录本插件刚代发出去的内容，防止被适配器回显后再次上报，
 * 构成 核心 -> 云崽 -> 核心 死循环。
 */
import { ECHO_TTL, ECHO_MAX } from "@/constants"
import type { YunzaiMessage } from "@/types"

const recentSent = new Map<string, number>()

/**
 * 拼一条「刚发过什么」的指纹
 *
 * @param target 群号或用户 id（哪一个都行，只要上下行两侧取的是同一个）
 * @param message 云崽 message。上行侧直接拿的是事件上的 `e.message`，
 *                那个字段允许是裸字符串或单个段（见 {@link YunzaiMessage}），
 *                所以归一化放在这里做而不是让两个调用点各写一遍。
 *                段的 text 之外只取 type，因为媒体段的 file 在上下行两侧形状不同
 *                （我们发的是 base64/路径，回显回来的是平台 url），拼进去就永远对不上
 */
export function echoKey(
  self_id: string | number,
  target: string | number,
  message: YunzaiMessage,
): string {
  const list = Array.isArray(message) ? message : [message]
  const text = list
    .map(i => (typeof i === "string" ? i : i?.type === "text" ? i.text : `[${i?.type}]`))
    .join("")
    .slice(0, 200)
  return `${self_id}:${target}:${text}`
}

export function markSent(key: string) {
  recentSent.set(key, Date.now() + ECHO_TTL)
  if (recentSent.size > ECHO_MAX) {
    const now = Date.now()
    for (const [k, exp] of recentSent) if (exp < now) recentSent.delete(k)
  }
}

export function isEcho(key: string) {
  const exp = recentSent.get(key)
  if (!exp) return false
  if (exp < Date.now()) {
    recentSent.delete(key)
    return false
  }
  return true
}
