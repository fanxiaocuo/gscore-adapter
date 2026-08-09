/**
 * 计数的数据形状
 *
 * 单独一个文件是为了断开 db.ts 与 index.ts 的循环引用：
 * db.ts 要 RelayRow（继承 Counters），index.ts 要 db 的读写函数，
 * 类型放在两者共同的下游就不成环了。
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

export const zero = (): Counters => ({ up: 0, event: 0, down: 0 })

/** 把 b 累加进 a（原地） */
export function add(a: Counters, b: Counters) {
  a.up += b.up
  a.event += b.event
  a.down += b.down
}

/** 本地日期 YYYY-MM-DD，用于按天分行 */
export function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
