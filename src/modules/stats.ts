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
 * #早柚重载 会把 clients 整个重建（lifecycle.ts reloadClients），挂在实例上的
 * 计数会跟着归零。累计值放模块级才能跨重载存活。按连接名分桶的那份也放这里，
 * 同名连接重建后计数能接上——连接名就是它的身份（lifecycle 用它去重）。
 *
 * 不落盘：进程重启归零，这与「运行时长」的语义一致，也免得为一个展示用的
 * 数字引入写盘时机、并发写、文件损坏这些问题。
 */

/** 一组收发计数 */
export interface Counters {
  /** 上行：云崽 -> 早柚核心，消息 */
  up: number
  /** 上行：云崽 -> 早柚核心，非消息事件（入群/退群/戳一戳） */
  event: number
  /** 下行：早柚核心 -> 云崽，已成功发出的消息 */
  down: number
}

const zero = (): Counters => ({ up: 0, event: 0, down: 0 })

/** 本地日期 YYYY-MM-DD，用于判断要不要翻页 */
function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 累计（进程生命周期内） */
const total = zero()
/** 今日 */
let daily = zero()
/** daily 属于哪一天 */
let dailyDay = today()
/** 按连接名分桶的累计值 */
const byName = new Map<string, Counters>()

/** 计数起点，用于「统计自 X 起」 */
export const since = Date.now()

/**
 * 跨日则把今日计数翻页
 *
 * 用惰性判断而不是定时器：没有消息经过时不需要翻页，读取时再判一次就够，
 * 也省掉一个常驻 setInterval。
 */
function rollover() {
  const d = today()
  if (d === dailyDay) return
  dailyDay = d
  daily = zero()
}

/** 记一次收发 */
export function count(kind: keyof Counters, name?: string) {
  rollover()
  total[kind]++
  daily[kind]++
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
  }
}

/** 某条连接的累计计数 */
export function forName(name: string): Counters {
  return { ...(byName.get(name) || zero()) }
}
