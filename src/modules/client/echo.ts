/**
 * 回环防护
 *
 * 记录本插件刚代发出去的内容，防止被适配器回显后再次上报，
 * 构成 核心 -> 云崽 -> 核心 死循环。
 */
import { ECHO_TTL, ECHO_MAX } from "@/constants"

const recentSent = new Map<string, number>()

export function echoKey(self_id, target, message) {
  const text = message
    .map(i => (typeof i === "string" ? i : i?.type === "text" ? i.text : `[${i?.type}]`))
    .join("")
    .slice(0, 200)
  return `${self_id}:${target}:${text}`
}

export function markSent(key) {
  recentSent.set(key, Date.now() + ECHO_TTL)
  if (recentSent.size > ECHO_MAX) {
    const now = Date.now()
    for (const [k, exp] of recentSent) if (exp < now) recentSent.delete(k)
  }
}

export function isEcho(key) {
  const exp = recentSent.get(key)
  if (!exp) return false
  if (exp < Date.now()) {
    recentSent.delete(key)
    return false
  }
  return true
}
