/**
 * @description 回环防护：记下本插件刚代发出去的内容，防止被适配器回显后再次上报，构成 核心 -> 云崽 -> 核心 死循环
 */
import { ECHO_TTL, ECHO_MAX } from "../../constants/index.js";
const recentSent = new Map();
/**
 * @description 拼一条「刚发过什么」的指纹
 * @param target 群号或用户 id（哪一个都行，只要上下行两侧取的是同一个）
 * @param message 云崽 message，允许是裸字符串或单个段（见 {@link YunzaiMessage}），归一化在这里做而不是让
 *   两个调用点各写一遍。段的 text 之外只取 type：媒体段的 file 在上下行两侧形状不同（我们发的是 base64/
 *   路径，回显回来的是平台 url），拼进去就永远对不上
 */
export function echoKey(self_id, target, message) {
    const list = Array.isArray(message) ? message : [message];
    const text = list
        .map(i => (typeof i === "string" ? i : i?.type === "text" ? i.text : `[${i?.type}]`))
        .join("")
        .slice(0, 200);
    return `${self_id}:${target}:${text}`;
}
export function markSent(key) {
    recentSent.set(key, Date.now() + ECHO_TTL);
    if (recentSent.size > ECHO_MAX)
        evict();
}
/**
 * @description 超上限时清理：先删过期的，一条都没过期就按 exp 删最旧的一批
 * 注意：没有兜底那一步的话，500 条都还在 TTL 内时一条都删不掉，Map 会越过上限一直涨
 */
function evict() {
    const now = Date.now();
    for (const [k, exp] of recentSent)
        if (exp < now)
            recentSent.delete(k);
    if (recentSent.size <= ECHO_MAX)
        return;
    // TTL 是定值，exp 的先后就是写入的先后，不必另存时间戳
    const sorted = [...recentSent.entries()].sort((a, b) => a[1] - b[1]);
    for (const [k] of sorted.slice(0, recentSent.size - ECHO_MAX))
        recentSent.delete(k);
}
export function isEcho(key) {
    const exp = recentSent.get(key);
    if (!exp)
        return false;
    if (exp < Date.now()) {
        recentSent.delete(key);
        return false;
    }
    return true;
}
