/**
 * QQBot 被动回复
 *
 * 带 msg_id 发出的回复在客户端挂为「引用」，不带则是独立消息。核心下发不带原消息 id，
 * 故这里记住每个会话最近一条入站消息的 id，在 5 分钟窗口内带上发出（思路取自
 * xiowo/yunzai-gscore-adapter，这里用 sqlite 换 redis，理由见 db.ts）。省配额的旧说法已过时，留它只为引用形态。
 *
 * 限次：同一 msg_id 官方按场景限回复次数（群 5、单聊 4，见 MAX_USES），回满再带会被平台拒收，比不带 id 更糟；
 * 计数由新入站消息覆盖同会话记录时重置。只对 QQBot 生效：其它适配器没这概念，按适配器 name 严格限定。
 */
import { makeLog } from "@/utils/compat"
import type { AdapterEvent, SendBot } from "@/types"
import * as db from "./db"

/**
 * 被动回复窗口。官方给 5 分钟，取 4 分 30 秒留余量：时间戳来自本机时钟，加网络与处理延迟，卡 5 分钟可能刚好过期。
 */
const WINDOW_MS = 270_000

/**
 * 同一个 msg_id 最多能带几次。两个数字都取满：一条指令触发多段回复（正文+图+按钮）是常态。
 *   群聊  /v2/groups/{openid}/messages  被动有效 5 分钟 / 5 次
 *   单聊  /v2/users/{openid}/messages   被动有效 60 分钟 / 4 次
 * 单聊是 4 不是 5：第 5 段会撞 `40034128 回复消息失败，被动回复时间或者次数超过限制`，
 * 白打一次请求、留错误日志，再靠 GsCoreClient.doSend 失败回退改主动发（消息不丢，只失引用形态）。
 * 频道被 keyOf 归进 group：官方没公布频道上限，保持 5 不猜；频道私聊不走被动（passiveSender 返回 null），
 * 落到这里的 direct 只可能是 QQ 单聊，4 精确对得上。
 */
const MAX_USES: Record<TargetType, number> = { direct: 4, group: 5 }

/** key -> { id, at, used }。内存是权威值 */
const recent = new Map<string, { id: string; at: number; used: number }>()

/** 待回写的 key */
const dirty = new Set<string>()

/**
 * @description 上一轮没删成的 key，下一轮接着删
 * 注意：不能塞回 dirty —— 那是「照当时的内存重判一次」的意思，同会话再来一条消息就会把「删」判成「写」
 */
const pendingRemove = new Set<string>()

let timer: NodeJS.Timeout | null = null

/** 回写间隔。比 stats 短一些：这些行本身只活 4 分半 */
const FLUSH_MS = 5_000

/** 会话数硬顶：id 只活 4 分半，正常不会堆积，但高并发下仍可能，超了就清掉最旧的一批 */
const MAX = 2000

/** 会话类型。与核心的 UserType 不同，这里只需要分「私聊 / 其余」两档 */
type TargetType = "direct" | "group"

function keyOf(
  selfId: string | number | undefined,
  targetType: TargetType,
  targetId: string | number,
): string {
  return `${selfId}:${targetType}:${targetId}`
}

/**
 * 从 key 反解会话类型。selfId 不含冒号，故第二段必是 targetType；
 * targetId 可能自带冒号（QQBot openid 形如 `{appid}:{hex}`），只能取 [1]，不能按段数判断。
 */
function typeOfKey(key: string): TargetType {
  return key.split(":")[1] === "direct" ? "direct" : "group"
}

/**
 * @description 是不是 QQBot 适配器
 * 入参可能是 `e.bot` 或下行的 `Bot[self_id]`，都只读 `adapter.name`，故标宽到 {@link SendBot} 即可。
 */
export function isQQBot(bot: SendBot | undefined | null): boolean {
  return String(bot?.adapter?.name || "") === "QQBot"
}

/**
 * 交互事件 id 的前缀。QQBot-Plugin 把按钮回调凭据挂成 `message_id: event_<真实 id>`（index.js:1692），
 * 官方收这类凭据的字段是 `event_id` 而非 `id`。前缀原样存，发送侧靠它分辨填哪个字段（见 GsCoreClient.doSend）。
 */
const EVENT_PREFIX = "event_"

/** @description 这个凭据是交互事件而不是消息 */
export function isEventId(id: string): boolean {
  return id.startsWith(EVENT_PREFIX)
}

/** @description 剥掉前缀，得到官方 `event_id` 字段要的值 */
export function eventIdOf(id: string): string {
  return id.slice(EVENT_PREFIX.length)
}

/**
 * @description QQBot 的 message_id 是否可用于被动回复
 * 空值、`0`、`null` / `undefined` 字面量都不行。
 * 注意：`event_<id>` 是可用的（按钮回调等交互事件凭据，官方按 `event_id` 字段收）；光秃秃 `event_` 后面没东西的仍不行。
 */
export function isValidId(id: unknown): boolean {
  if (id == null) return false
  const s = String(id)
  if (!s || s === "0" || s === "null" || s === "undefined") return false
  if (isEventId(s)) return eventIdOf(s) !== ""
  return true
}

/**
 * 这个凭据还能带几次。消息 id 按场景取满（{@link MAX_USES}）；交互事件保守只算 1 次：
 * 官方文档没公布交互事件上限，多算会撞 `40034128`（白打请求 + 错误日志，再靠 doSend 回退主动发），
 * 少算只是失引用形态，两者不对等故取保守值。真实上限确认后改这一处。
 */
function usesFor(targetType: TargetType, id: string): number {
  return isEventId(id) ? 1 : MAX_USES[targetType]
}

/**
 * @description 记一条入站消息。在上报给核心的同一处调用（每条入站都经过），必须同步且极轻。
 * @param selfId 已由 resolveSelfId 解析过，与 bot_self_id 对齐；不传则退回 e.self_id —— 与 sendReceive 产出的 bot_self_id 对不上时，message_id 找不到、被动回复失效。
 */
export function remember(e: AdapterEvent, selfId?: string): void {
  if (!isQQBot(e?.bot)) return
  if (!isValidId(e?.message_id)) return

  // 私聊与群共用 key 空间，靠 target_type 区分
  const type = e.message_type === "private" && !e.group_id ? "direct" : "group"
  const target = type === "direct" ? e.user_id : e.group_id
  if (target == null) return

  const key = keyOf(selfId || e.self_id, type, target)
  // 覆盖同会话旧记录，used 归零：新消息自带一份完整回复额度
  recent.set(key, { id: String(e.message_id), at: Date.now(), used: 0 })
  dirty.add(key)

  if (recent.size > MAX) evict()
}

/**
 * 超上限时清理：先删过期的，还超就按时间删最旧的。删掉的都标脏让 flush 把库里那行也删了
 * （否则要等下次重启的 db.prune）。用满的行留在内存里（见 take()），这里是它们的主要出口。
 */
function evict() {
  const now = Date.now()
  for (const [k, v] of recent)
    if (now - v.at > WINDOW_MS) {
      recent.delete(k)
      dirty.add(k)
    }
  if (recent.size <= MAX) return

  const sorted = [...recent.entries()].sort((a, b) => a[1].at - b[1].at)
  for (const [k] of sorted.slice(0, recent.size - MAX)) {
    recent.delete(k)
    dirty.add(k)
  }
}

/**
 * @description 取一个可用于被动回复的 id
 * 每取一次记一次数，取满该场景 MAX_USES 后作废（超出会被平台拒收）。过期行删掉标脏；用满的行留着当凭据（见下）。
 * @returns 没有可用 id 时返回空串（调用方照常发，只是不带 id）
 */
export function take(
  selfId: string | number | undefined,
  targetType: TargetType,
  targetId: string | number,
): string {
  const key = keyOf(selfId, targetType, targetId)
  const hit = recent.get(key)
  if (!hit) return ""

  // 过期直接丢掉
  if (Date.now() - hit.at > WINDOW_MS) {
    recent.delete(key)
    dirty.add(key)
    return ""
  }

  // 注意：用满的行要留在内存当「不可用」凭据，不能删 —— 删了 flush 只发 DELETE，库里那行 used 还是旧值（通常 0）；
  // DELETE 没落地就重启，initPassive 守卫读到 0 放行，id 被重新灌进内存再用一轮撞 40034128。留着则 used=上限 正常 save 落盘，守卫读到真值。
  if (hit.used >= usesFor(targetType, hit.id)) return ""

  hit.used += 1
  dirty.add(key)
  return hit.id
}

/** 把脏行回写。已从内存删掉的 key 在库里也删掉，删不成的留到下一轮重试 */
async function flush() {
  if (!dirty.size && !pendingRemove.size) return
  const rows: db.PassiveRow[] = []
  const gone = new Set<string>()
  for (const key of dirty) {
    const v = recent.get(key)
    if (v) rows.push({ key, id: v.id, at: v.at, used: v.used })
    else gone.add(key)
  }
  // 又回到内存里的（同会话来了新消息）不能删：那行会被 save 覆盖成新 id
  for (const key of pendingRemove) if (!recent.has(key)) gone.add(key)
  dirty.clear()
  pendingRemove.clear()

  try {
    if (rows.length) await db.save(rows)
    // 过期与被 evict 挤掉的行从库里删掉，仅回收空间：正确性不靠删除（见 take()），
    // 删不成只是多留几行过期数据，initPassive 的 minAt 过滤与 db.prune 都会挡住。
    if (gone.size) await db.remove([...gone])
  } catch (err) {
    makeLog("debug", ["被动回复：回写失败", err], "GsCore")
    // save 抛了 remove 没跑，两边都重试；写绝对值、删按 key，都幂等
    for (const r of rows) dirty.add(r.key)
    for (const key of gone) pendingRemove.add(key)
  }
}

/** @description 初始化：开库、灌历史、起定时回写 */
export async function initPassive(): Promise<void> {
  const ok = await db.open()
  if (!ok) return

  try {
    const min = Date.now() - WINDOW_MS
    const rows = await db.load(min)
    for (const r of rows) {
      if (!r.id) continue
      // used 必须跟着载入：重启不该抹平已用次数，否则一个 id 会被带满上限以上、超出的被平台拒收。
      // 老库没这列，读出 undefined 按 0 算。门槛按场景取：用统一值会让单聊 used=4 的行被载回内存后被 take() 当第 5 次用掉。
      const used = Number(r.used) || 0
      if (used >= MAX_USES[typeOfKey(r.key)]) continue
      recent.set(r.key, { id: r.id, at: Number(r.at), used })
    }
    if (rows.length) makeLog("debug", `被动回复：载入 ${recent.size} 条会话记录`, "GsCore")
    // 顺手清掉过期行
    await db.prune(min)
  } catch (err) {
    makeLog("error", ["被动回复：载入失败", err], "GsCore")
  }

  timer = setInterval(flush, FLUSH_MS)
  timer.unref?.()

  process.once("beforeExit", () => {
    stopPassive().catch(() => {})
  })
}

/** @description 停掉并刷盘。测试与退出钩子用 */
export async function stopPassive(): Promise<void> {
  if (timer) clearInterval(timer)
  timer = null
  await flush()
  await db.close()
}

/**
 * @description 当前还能带 id 发的会话数，供 #早柚状态 显示，并经面板 API 下发
 * 注意：不能直接返回 recent.size —— 用满的行留在内存当「不可用」凭据（见 take）、过期行也要等下次访问才清掉，数进去就是虚报。
 */
export function passiveCount(): number {
  const now = Date.now()
  let n = 0
  for (const [key, v] of recent)
    if (now - v.at <= WINDOW_MS && v.used < MAX_USES[typeOfKey(key)]) n += 1
  return n
}

/** @description 是否在落盘 */
export function passivePersisted(): boolean {
  return db.available()
}
