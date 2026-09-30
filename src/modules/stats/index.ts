/**
 * @description 中转消息的上行/下行计数，用来发现「连着但不通」
 * 放模块级而非挂 GsCoreClient 实例：reloadClients 会整个重建 clients（lifecycle.ts），
 * 实例上的计数会归零，模块级才能跨重载存活；按连接名分桶也放这里，连接名就是身份
 * （lifecycle 用它去重），同名重建后计数能接上。
 * 内存是权威值、sqlite 是副本：count() 在每条消息的热路径上（GsCoreClient 三处），
 * snapshot() / forName() 又在出图与文本回退里同步调用，不能改 async。故分两层——内存同步读写
 * （签名不变）、sqlite 启动时灌入之后按脏标记定时回写（见 db.ts）；代价是掉电丢最后几秒计数，换热路径零开销。
 */
import { makeLog } from "@/utils/compat"
import { type Counters, zero, add, today } from "./counters"
import * as db from "./db"

export type { Counters } from "./counters"

/** 累计（跨重启，= 全部明细之和） */
const total = zero()
/** 今日 */
let daily = zero()
/** daily 属于哪一天 */
let dailyDay = today()
/** 按连接名分桶的累计值 */
const byName = new Map<string, Counters>()

/**
 * 今日按连接名分桶的值，即要回写的行。只有今天的行会变，过去的天数灌进 total / byName
 * 后不必留内存。key 是连接名，空串表示无归属
 */
const todayRows = new Map<string, Counters>()

/** 有变化待回写的连接名 */
const dirty = new Set<string>()

/** 计数起点，用于「统计自 X 起」。落盘后是首次记账时刻，不是本次启动时刻 */
let since = Date.now()

/** 回写定时器 */
let timer: NodeJS.Timeout | null = null

/** 回写间隔：10 秒。热路径只改内存，攒一批再写 */
const FLUSH_MS = 10_000

/**
 * 跨日则把今日计数翻页。用惰性判断而非定时器，读取时再判一次就够，省掉常驻 setInterval。
 * 注意：翻页时 todayRows 要清空，且先把待写的刷掉，否则昨天的行会被写成今天的 day 值
 */
function rollover() {
  const d = today()
  if (d === dailyDay) return

  // 昨天最后一批还没回写的，用昨天的 day 落盘
  const pending = pendingRows()
  dailyDay = d
  daily = zero()
  todayRows.clear()
  dirty.clear()

  // count() 同步，只能 fire-and-forget；记下 promise 让 stopStats / 退出钩子能等它落完
  // （db.ts 已把写操作串行化，不会和定时回写抢事务）
  if (pending.length)
    lastRollover = db
      .save(pending)
      .catch(err => makeLog("debug", ["中转计数回写失败", err], "GsCore"))
}

/** 最近一次跨日回写，供退出时等待 */
let lastRollover: Promise<unknown> = Promise.resolve()

/** 取当前脏行的快照（带 day），供回写用 */
function pendingRows() {
  const rows: db.RelayRow[] = []
  for (const name of dirty) {
    const c = todayRows.get(name)
    if (c) rows.push({ day: dailyDay, name, ...c })
  }
  return rows
}

/** @description 记一次收发。同步，热路径 */
export function count(kind: keyof Counters, name?: string) {
  rollover()
  total[kind]++
  daily[kind]++

  const key = name || ""
  const row = todayRows.get(key) || zero()
  row[kind]++
  todayRows.set(key, row)
  dirty.add(key)

  if (name) {
    const c = byName.get(name) || zero()
    c[kind]++
    byName.set(name, c)
  }
}

/** @description 读取快照。返回副本，调用方拿去排版不会改到内部状态 */
export function snapshot() {
  rollover()
  return {
    total: { ...total },
    today: { ...daily },
    since,
    /** 计数是否在落盘（关掉时前端可以不显示「累计」的跨重启含义） */
    persisted: db.available(),
  }
}

/** @description 某条连接的累计计数 */
export function forName(name: string): Counters {
  return { ...(byName.get(name) || zero()) }
}

/** 把脏行回写。失败只记 debug——计数丢一轮不值得打扰用户 */
async function flush() {
  if (!dirty.size) return
  const rows = pendingRows()
  // 先清脏标记再写：写的过程中新计数会重新标脏，rows 里是当时的绝对值，下一轮写的也是绝对值，不会丢
  dirty.clear()
  try {
    await db.save(rows)
  } catch (err) {
    makeLog("debug", ["中转计数回写失败", err], "GsCore")
    // 写失败就把脏标记放回去，下轮重试。绝对值写入是幂等的
    for (const r of rows) dirty.add(r.name)
  }
}

/**
 * @description 初始化：打开数据库、把历史灌进内存、起回写定时器
 * 在 src/index.ts 里 await。灌入必须在客户端连上前完成，否则先到的几条消息会被随后的 load 覆盖
 */
export async function initStats() {
  const ok = await db.open()
  if (!ok) return

  try {
    const rows = await db.load()
    const d = today()

    for (const r of rows) {
      const c: Counters = { up: r.up, event: r.event, down: r.down }
      add(total, c)
      if (r.name) {
        const b = byName.get(r.name) || zero()
        add(b, c)
        byName.set(r.name, b)
      }
      // 今天的行还会继续变，留在 todayRows 里接着累加
      if (r.day === d) {
        add(daily, c)
        todayRows.set(r.name, c)
      }
    }

    since = await db.metaSince(since)
    dailyDay = d

    if (rows.length)
      makeLog(
        "debug",
        `中转计数已载入：${rows.length} 行，累计上行 ${total.up + total.event}、下行 ${total.down}`,
        "GsCore",
      )
  } catch (err) {
    makeLog("error", ["中转计数：载入历史失败", err], "GsCore")
  }

  timer = setInterval(flush, FLUSH_MS)
  // 定时器不该拖着进程不退出：这只是个后台回写
  timer.unref?.()

  // 退出前刷最后一批。用 beforeExit（事件循环空了才触发，能跑异步）而非 exit（只能跑同步，写不进去）
  process.once("beforeExit", () => {
    stopStats().catch(() => {})
  })
}

/** @description 清空计数（内存与数据库）。供 #早柚清空统计 用 */
export async function resetStats() {
  for (const k of ["up", "event", "down"] as const) {
    total[k] = 0
    daily[k] = 0
  }
  byName.clear()
  todayRows.clear()
  dirty.clear()
  since = Date.now()
  dailyDay = today()

  await db.clear()
  await db.metaSince(since)
}

/** @description 停掉回写定时器并刷盘。测试用，也是退出钩子的实现 */
export async function stopStats() {
  if (timer) clearInterval(timer)
  timer = null
  await lastRollover
  await flush()
  await db.close()
}
