/**
 * 中转计数
 *
 * 为什么要有
 * ----------
 * #早柚状态 原来只答「连上了没有」，而这个插件的本职是**中转消息**。
 * 连接显示「已连接」但一条消息都没过去，是个很常见的故障（过滤器配错、
 * bind/exclude 写反、only_reply_at 开着但群里没人 @），光看连接状态发现不了。
 * 有了上行/下行计数，「连着但不通」一眼就能看出来。
 *
 * 为什么放模块级而不是挂在 GsCoreClient 上
 * ----------------------------------------
 * reloadClients 会把 clients 整个重建（lifecycle.ts reloadClients），挂在实例上的
 * 计数会跟着归零。累计值放模块级才能跨重载存活。按连接名分桶的那份也放这里，
 * 同名连接重建后计数能接上——连接名就是它的身份（lifecycle 用它去重）。
 *
 * 落盘：内存是权威值，sqlite 是副本
 * --------------------------------
 * 原来不落盘，理由是「进程重启归零与运行时长的语义一致」。但那让「累计中转」
 * 实际等于「本次运行中转」，两行数字（今日 / 累计）在刚启动时永远相等，
 * 而它想回答的恰恰是「这个适配器到底转了多少东西」这种跨重启的问题。
 *
 * 关键约束是 count() 在**每条消息的热路径**上（GsCoreClient 三处），
 * snapshot() / forName() 又在出图和文本回退里同步调用。所以不能把它们改成
 * async——那样三个调用点连同整条渲染链路都要改成异步，还会把一次数据库往返
 * 塞进消息转发的关键路径里。
 *
 * 因此分两层：
 *   - 内存：唯一权威值，读写都是同步的，签名和以前一样
 *   - sqlite：启动时灌进内存，之后按脏标记定时回写（见 db.ts）
 *
 * 代价是掉电可能丢最后几秒的计数。对一个展示用的数字，这个代价换来的是
 * 热路径零开销，值得。
 */
import { makeLog } from "@/utils/compat"
import { type Counters, zero, add, today } from "./counters.js"
import * as db from "./db.js"

export type { Counters } from "./counters.js"

/** 累计（跨重启，= 全部明细之和） */
const total = zero()
/** 今日 */
let daily = zero()
/** daily 属于哪一天 */
let dailyDay = today()
/** 按连接名分桶的累计值 */
const byName = new Map<string, Counters>()

/**
 * 今日按连接名分桶的值，也就是要回写的那些行
 *
 * 只有「今天」的行会变——过去的天数已经定死了，灌进 total / byName 之后
 * 不必留在内存里。key 是连接名，空串表示无归属。
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
 * 跨日则把今日计数翻页
 *
 * 用惰性判断而不是定时器：没有消息经过时不需要翻页，读取时再判一次就够，
 * 也省掉一个常驻 setInterval。
 *
 * 翻页时 todayRows 也要清空，且**先把待写的刷掉**——否则昨天的行会被
 * 当成今天的 day 值写进去。
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

  // count() 是同步的，这里只能 fire-and-forget。但把 promise 记下来，
  // 让 stopStats / 退出钩子能等它落完（db.ts 内部已把写操作串行化，
  // 不会和定时回写抢事务）
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

/** 记一次收发。同步，热路径 */
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

/** 读取快照。返回副本，调用方拿去排版不会改到内部状态 */
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

/** 某条连接的累计计数 */
export function forName(name: string): Counters {
  return { ...(byName.get(name) || zero()) }
}

/** 把脏行回写。失败只记 debug——计数丢一轮不值得打扰用户 */
async function flush() {
  if (!dirty.size) return
  const rows = pendingRows()
  // 先清脏标记再写：写的过程中新来的计数会重新标脏，
  // 而 rows 里已是当时的绝对值，下一轮写的也是绝对值，不会丢
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
 * 初始化：打开数据库、把历史灌进内存、起回写定时器
 *
 * 在 src/index.ts 里 await 掉。灌入必须在客户端连上之前完成，
 * 否则先到的几条消息会被随后的 load 覆盖掉。
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

  // 退出前把最后一批刷下去。beforeExit 在事件循环空了才触发，
  // 能跑异步；exit 上只能跑同步代码，写不进去
  process.once("beforeExit", () => {
    stopStats().catch(() => {})
  })
}

/** 清空计数（内存与数据库）。供 #早柚清空统计 用 */
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

/** 停掉回写定时器并刷盘。测试用，也是退出钩子的实现 */
export async function stopStats() {
  if (timer) clearInterval(timer)
  timer = null
  await lastRollover
  await flush()
  await db.close()
}
