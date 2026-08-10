/**
 * 计数的数据形状
 *
 * 单独一个文件是为了断开 db.ts 与 index.ts 的循环引用：
 * db.ts 要 RelayRow（继承 Counters），index.ts 要 db 的读写函数，
 * 类型放在两者共同的下游就不成环了。
 */
export const zero = () => ({ up: 0, event: 0, down: 0 });
/** 把 b 累加进 a（原地） */
export function add(a, b) {
    a.up += b.up;
    a.event += b.event;
    a.down += b.down;
}
/** 本地日期 YYYY-MM-DD，用于按天分行 */
export function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
