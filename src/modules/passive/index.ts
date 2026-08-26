/**
 * QQBot 被动回复
 *
 * 是什么
 * ------
 * QQ 官方 Bot 发消息时可以带上用户那条消息的 msg_id：
 *   带 msg_id  客户端里这条回复挂在用户那条消息下，显示为「引用」
 *   不带       作为一条独立消息发出，与上下文没有关联
 *
 * 早柚核心下发的是「给某个会话发这些内容」，不带原消息 id —— 于是所有下发都会
 * 变成独立消息。而核心插件的绝大多数回复其实都是用户刚发指令触发的，本该挂上去。
 *
 * > 历史：这个功能最早是为「省主动推送配额」做的 —— 当时官方对不带 msg_id 的
 * > 主动推送有严格的每月配额。现在两者一视同仁，配额不再是理由，留下它是为了
 * > 上面那个引用形态。凡是提「省额度」的说法都已过时。
 *
 * 做法
 * ----
 * 记住每个会话最近一条**入站**消息的 id，下发时如果它还在 5 分钟窗口内，
 * 就带上它发出去。思路取自 xiowo/yunzai-gscore-adapter（它用 redis，
 * 这里换 sqlite，理由见 db.ts）。
 *
 * 为什么限次
 * ---------
 * 官方对**同一个 msg_id** 能回几条有上限，且按场景分档（群 5、单聊 4，见 MAX_USES）。
 * 回满之后再带它发会被平台拒收 ——
 * 那比不带 id 发出去糟得多：后者只是少了引用形态，前者是消息根本发不出去。
 * 所以每个 id 记一个使用计数，回满即视为不可用，之后的下发不带 id。
 * 计数由新的入站消息覆盖同会话记录时自然重置。
 * 参考 xiowo 的 86f9bad（他用 redis INCR + QQBOT_MESSAGE_ID_REPLY_LIMIT）。
 *
 * 只对 QQBot 生效
 * --------------
 * 其它适配器没有这个概念，传 event 参数进去多半被忽略（也可能踩到未知分支），
 * 所以按适配器 name 严格限定。
 */
import { makeLog } from "@/utils/compat"
import type { AdapterEvent, SendBot } from "@/types"
import * as db from "./db.js"

/**
 * 被动回复窗口
 *
 * QQ 官方文档给的是 5 分钟。取 4 分 30 秒留一点余量 —— 时间戳来自本机时钟，
 * 与平台判定之间还有网络与处理延迟，卡着 5 分钟发过去可能刚好过期。
 */
const WINDOW_MS = 270_000

/**
 * 同一个 msg_id 最多能带几次
 *
 * 官方按场景分档，两个数字都取满而不是保守地取 1：一条指令触发多段回复
 * （正文 + 图 + 按钮）是核心插件的常态，只用一次的话后面几段就都掉出引用形态了。
 *
 *   群聊  /v2/groups/{openid}/messages  被动有效 5 分钟 / **5 次**
 *   单聊  /v2/users/{openid}/messages   被动有效 60 分钟 / **4 次**
 *
 * 单聊是 4 不是 5 —— 早先两边共用一个 5，单聊的第 5 段必然撞
 * `40034128 回复消息失败，被动回复时间或者次数超过限制`，白打一次请求、留一条
 * 错误日志，然后靠 GsCoreClient.doSend 的失败回退改成主动发出去（消息不会丢，
 * 但那一段的引用形态没了）。
 *
 * 频道被 keyOf 归进 group：官方没公布频道的次数上限，保持 5 不猜。
 * 频道私聊压根不走被动（passiveSender 直接返回 null），所以落到这里的 direct
 * 只可能是 QQ 单聊，4 精确对得上。
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

/**
 * 上限：会话数
 *
 * 单个 id 只有 4 分半的寿命，正常规模下 Map 里不会有太多条。但「每分钟几千个群
 * 各来一条」这种量级下仍可能堆积，所以给个硬顶，超了就清掉最旧的一批。
 */
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
 * 从 key 反解会话类型
 *
 * initPassive 灌载与 passiveCount 数可用会话时都要用 —— 两处手里都只有 key，而次数上限按场景分档。
 * selfId 不含冒号，所以第二段必是 targetType；targetId 可能自带冒号
 * （QQBot 的 openid 形如 `{appid}:{hex}`），所以只能取 [1]，不能按段数判断。
 */
function typeOfKey(key: string): TargetType {
  return key.split(":")[1] === "direct" ? "direct" : "group"
}

/**
 * 是不是 QQBot 适配器
 *
 * 入参既可能是事件上的 bot（`e.bot`），也可能是下行拿到的 `Bot[self_id]`，
 * 两者都只在这里读 `adapter.name`，所以标宽到 {@link SendBot} 就够
 */
export function isQQBot(bot: SendBot | undefined | null): boolean {
  return String(bot?.adapter?.name || "") === "QQBot"
}

/**
 * 交互事件 id 的前缀
 *
 * QQBot-Plugin 把按钮回调这类交互事件的凭据挂成 `message_id: event_<真实 id>`
 *（它自己 index.js:1692 那行拼的），而官方接口收这类凭据的字段是 `event_id` 而不是 `id`。
 * 前缀在本模块里**原样存**：发送侧靠它分辨该填哪个字段（见 GsCoreClient.doSend）
 */
const EVENT_PREFIX = "event_"

/** 这个凭据是交互事件而不是消息 */
export function isEventId(id: string): boolean {
  return id.startsWith(EVENT_PREFIX)
}

/** 剥掉前缀，得到官方 `event_id` 字段要的值 */
export function eventIdOf(id: string): string {
  return id.slice(EVENT_PREFIX.length)
}

/**
 * QQBot 的 message_id 是否可用于被动回复
 *
 * 空值、`0`、`null` / `undefined` 字面量都不行。
 * 注意：`event_<id>` **是可用的** —— 它是按钮回调这类交互事件的凭据，官方按 `event_id` 字段收。
 * 早先这里一律拒 `event_` 开头的，于是点按钮触发的回复全部退化成主动消息、不与那次交互关联；
 * 判据当时抄的是参考实现的旧版（xiowo 已在 26374f7 修掉，同一处）。
 * 光秃秃一个 `event_` 后面没东西的仍然不行
 */
export function isValidId(id: unknown): boolean {
  if (id == null) return false
  const s = String(id)
  if (!s || s === "0" || s === "null" || s === "undefined") return false
  if (isEventId(s)) return eventIdOf(s) !== ""
  return true
}

/**
 * 这个凭据还能带几次
 *
 * 消息 id 按场景取满（{@link MAX_USES}）。交互事件**保守只算 1 次** —— 官方文档
 *（v2_groups_group_openid_messages / v2_users_user_openid_messages）只写了消息被动回复的
 * 次数与时长，没有公布交互事件的上限。多算的代价是撞
 * `40034128 回复消息失败，被动回复时间或者次数超过限制`：白打一次请求、留一条错误日志，
 * 再靠 doSend 的失败回退改成主动发出去；少算的代价只是后面几段少了引用形态。
 * 两者不对等，所以取保守的那个。真实上限确认后改这一处即可
 */
function usesFor(targetType: TargetType, id: string): number {
  return isEventId(id) ? 1 : MAX_USES[targetType]
}

/**
 * 记一条入站消息
 *
 * 在上报给核心的同一处调用（每条入站消息都会经过），所以必须是同步且极轻的。
 * @param selfId 已由 resolveSelfId 解析过，与发到核心的 bot_self_id 对齐；
 *               不传则退回 e.self_id —— 与 sendReceive 产出的 bot_self_id 对不上时
 *               QQBot 被动回复的 message_id 就找不到，被动回复会失效。
 */
export function remember(e: AdapterEvent, selfId?: string): void {
  if (!isQQBot(e?.bot)) return
  if (!isValidId(e?.message_id)) return

  // 私聊与群用同一套 key 空间，靠 target_type 区分：QQBot 的群 id 与用户 id
  // 形状不同（群是 selfId:openid），但没必要依赖这一点
  const type = e.message_type === "private" && !e.group_id ? "direct" : "group"
  const target = type === "direct" ? e.user_id : e.group_id
  if (target == null) return

  const key = keyOf(selfId || e.self_id, type, target)
  // 覆盖同会话的旧记录，used 归零：新消息自带一份完整的回复额度
  recent.set(key, { id: String(e.message_id), at: Date.now(), used: 0 })
  dirty.add(key)

  if (recent.size > MAX) evict()
}

/**
 * 超上限时清理：先删过期的，还超就按时间删最旧的
 *
 * 删掉的都标脏，让 flush 把库里那行也删了 —— 否则这些行要等下次重启的 db.prune
 * 才会被清掉。用满的行现在留在内存里（见 take()），这里是它们的主要出口。
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
 * 取一个可用于被动回复的 id
 *
 * 每取一次记一次数，取满该场景的 MAX_USES 后 id 作废（超出的会被平台拒收）。
 * 过期的行直接从内存删掉并标脏；用满的行留着当凭据，理由见下面那条注释。
 *
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

  // 过期就直接丢掉：留着只会在下次查询时再判一遍
  if (Date.now() - hit.at > WINDOW_MS) {
    recent.delete(key)
    dirty.add(key)
    return ""
  }

  // 注意：用满的行要留在内存里当「不可用」的凭据，不能删 —— 删掉的话 flush 只会发 DELETE，
  // 库里那行的 used 还是上一轮的旧值（通常 0）。DELETE 没落地就重启，initPassive 的守卫读到 0
  // 直接放行，这个 id 会被重新灌进内存再用一轮，撞 40034128。留着则 used=上限 走正常 save 落盘，
  // 守卫读到的就是真值，删除退化成单纯的回收空间
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
  // 又回到内存里的（同会话来了新消息）不能删：那行下面会被 save 覆盖成新 id
  for (const key of pendingRemove) if (!recent.has(key)) gone.add(key)
  dirty.clear()
  pendingRemove.clear()

  try {
    if (rows.length) await db.save(rows)
    // 过期与被 evict 挤掉的行从库里删掉。这一步只是回收空间：用满的行不再靠删除
    // 保证正确性（见 take() 里那段），删不成也只是库里多留几行过期数据，
    // initPassive 的 minAt 过滤与 db.prune 都会把它们挡在外面
    if (gone.size) await db.remove([...gone])
  } catch (err) {
    makeLog("debug", ["被动回复：回写失败", err], "GsCore")
    // save 抛了 remove 根本没跑，两边都要重试；写的是绝对值、删的是按 key，都幂等
    for (const r of rows) dirty.add(r.key)
    for (const key of gone) pendingRemove.add(key)
  }
}

/** 初始化：开库、灌历史、起定时回写 */
export async function initPassive(): Promise<void> {
  const ok = await db.open()
  if (!ok) return

  try {
    const min = Date.now() - WINDOW_MS
    const rows = await db.load(min)
    for (const r of rows) {
      if (!r.id) continue
      // used 必须跟着载入：重启不该把已经用掉的次数抹平，否则一个 id 就可能
      // 被带满上限以上，超出的那几条被平台拒收。老库没有这一列，读出来是
      // undefined，按 0 算。门槛按场景取 —— 用统一值会让单聊 used=4 的行被载回
      // 内存，然后被 take() 当第 5 次用掉，正是这里要挡的
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

/** 停掉并刷盘。测试与退出钩子用 */
export async function stopPassive(): Promise<void> {
  if (timer) clearInterval(timer)
  timer = null
  await flush()
  await db.close()
}

/**
 * @description 当前还能带 id 发的会话数，供 #早柚状态 显示，并经面板 API 下发
 * 注意：不能直接返回 recent.size —— 用满的行现在留在内存里当「不可用」凭据（见 take），
 * 过期的行也要等下次访问才清掉。#早柚状态 把它印成「N 个会话可用」，数进去就是虚报
 *（面板目前只收下这个数字，没有渲染）
 */
export function passiveCount(): number {
  const now = Date.now()
  let n = 0
  for (const [key, v] of recent)
    if (now - v.at <= WINDOW_MS && v.used < MAX_USES[typeOfKey(key)]) n += 1
  return n
}

/** 是否在落盘 */
export function passivePersisted(): boolean {
  return db.available()
}
