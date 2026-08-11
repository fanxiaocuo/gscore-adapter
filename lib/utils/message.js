/**
 * 消息过滤与回环防护的共享工具
 */
import { config } from "../config/index.js";
import { isChannel } from "./session.js";
/**
 * 会话方向开关：私聊 / 群（含频道）
 *
 * 比黑白名单粗一档 —— 想「只让群消息过核心」时不必把所有私聊用户列进 black_user。
 * 默认都开（不配等于全上报），只有显式写 false 才拦。
 *
 * 频道算群：核心侧 channel 与 group 是两种 user_type，但从「要不要上报」的角度
 * 它们同属群聊语境，没必要再分一个开关。
 */
export function passDirection(e) {
    const f = config.filter || {};
    const isGroup = e?.message_type === "group" || e?.isGroup || isChannel(e) || e?.group_id != null;
    if (isGroup)
        return f.report_group !== false;
    return f.report_private !== false;
}
/** 群/用户黑白名单，消息与 meta 事件路径共用同一份 filter 配置 */
export function passFilter(e) {
    const f = config.filter || {};
    const gid = e.group_id != null ? String(e.group_id) : null;
    if (gid) {
        if (f.white_group?.length && !f.white_group.some(i => String(i) === gid))
            return false;
        if (f.black_group?.length && f.black_group.some(i => String(i) === gid))
            return false;
    }
    if (f.black_user?.length && f.black_user.some(i => String(i) === String(e.user_id)))
        return false;
    return true;
}
/** 事件来源是否为早柚核心方向的 Bot（回环防护第 2、3 层） */
export function isFromGsCore(e) {
    // 本插件已不含服务端方向，但框架或其他插件仍可能注册早柚核心适配器，
    // 其回显若不挡就是 Core -> 云崽 -> Core 死循环。这层判断很便宜，保留。
    const adapterId = e.bot?.adapter?.id || e.adapter_id;
    if (adapterId === "GSUIDCore" || adapterId === "GsCore")
        return true;
    return !!e.gscore_origin;
}
/** 提取事件中的纯文本，用于前缀/包含匹配 */
export function eventText(e) {
    return (e.message || [])
        .filter(i => i?.type === "text")
        .map(i => i.text)
        .join("")
        .trim();
}
/** 转成非空字符串，取不到给 "" */
export function str(v) {
    return v == null ? "" : String(v);
}
/**
 * 取事件所属的机器人账号，e.self_id 缺失时按顺序回退
 *
 * 为什么需要回退
 * ------------
 * self_id **完全由适配器填**，框架自己从不赋值。而框架的 prepareEvent
 * （lib/bot.js:313）第一行就是 `if (!this.bots[data.self_id]) return` ——
 * self_id 一旦为空，同一个事件连 bot / friend / group / member / adapter_id /
 * reply 都不会挂上。所以「self_id 是 null」从来不是单独一项缺失。
 *
 * 各适配器本身都填了（stdin.js:88、QQBot-Plugin 的四个事件构造点都是
 * bot 与 self_id 一起设）。实际丢失多发生在**中途重整过事件**的插件那里：
 * e.bot 是用 Object.defineProperty 挂的（lib/bot.js:315），不可枚举，
 * 于是 `{...e}` 这种浅拷贝会静默丢掉 bot —— 反过来也有丢 self_id 只留 bot 的。
 * 两种残缺形状互补，所以两边都查。
 *
 * 回退顺序
 * -------
 *   1. e.self_id      —— 适配器填的，最可信
 *   2. e.bot.uin      —— 浅拷贝丢了 self_id 但 bot 还在时（或反之）能救回来
 *   3. Bot.uin        —— **仅当全局只有一个 Bot 在线**
 *
 * 第 3 步的限制是有意的：Bot.uin 不是标量，是 Object.assign([], {toJSON,…})
 * （lib/bot.js:18）。它的 toJSON 在 length 为 2 时返回**最后一个**，
 * ≥3 时返回随机一个（缓存 60 秒）。也就是说多 Bot 在线时它给的是猜测，
 * 而猜错的后果比取不到更坏：消息会被算到另一个账号上，
 * hooks.ts 的自回显判断（user_id === self_id）随之失效，可能触发
 * Core -> 云崽 -> Core 回环。只有一个 Bot 时不存在歧义，才允许兜。
 *
 * 用 || 而不是 ??：空字符串 id 是可达的（QQBot 的 token 拆分若为空即得 ""），
 * 那种值同样该继续往下找，不能当成"取到了"。
 *
 * 一律 String()：Bot.uin 的自定义 toString 会转发到 toJSON，
 * 所以结果是字符串而非数组对象；但显式转一次，免得下游拿到 number 又去比字符串。
 */
export function resolveSelfId(e) {
    const own = e?.self_id;
    if (own != null && String(own))
        return String(own);
    const byBot = e?.bot?.uin;
    if (byBot != null && String(byBot))
        return String(byBot);
    // 只有一个 Bot 在线时才兜，理由见上
    const uin = globalThis.Bot?.uin;
    if (Array.isArray(uin) && uin.length === 1 && uin[0] != null)
        return String(uin[0]);
    return "";
}
