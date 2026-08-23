/**
 * @description 消息过滤与回环防护的共享工具
 */
import { config } from "../config/index.js";
import { isChannel } from "./session.js";
/**
 * @description 会话方向开关：私聊 / 群（含频道），默认都开，只有显式写 false 才拦
 * 比黑白名单粗一档 —— 想「只让群消息过核心」时不必把所有私聊用户列进 black_user。
 * 频道算群：核心侧 channel 与 group 是两种 user_type，但从「要不要上报」看它们同属群聊语境。
 */
export function passDirection(e) {
    const f = config.filter || {};
    const isGroup = e?.message_type === "group" || e?.isGroup || isChannel(e) || e?.group_id != null;
    if (isGroup)
        return f.report_group !== false;
    return f.report_private !== false;
}
/** @description 群/用户黑白名单，消息与 meta 事件路径共用同一份 filter 配置 */
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
/**
 * @description 事件来源是否为早柚核心方向的 Bot（回环防护第 2、3 层）
 * 注意：本插件已不含服务端方向，但框架或其他插件仍可能注册早柚核心适配器，
 * 其回显不挡就是 Core → 云崽 → Core 死循环。这层判断很便宜，保留。
 */
export function isFromGsCore(e) {
    const adapterId = e.bot?.adapter?.id || e.adapter_id;
    if (adapterId === "GSUIDCore" || adapterId === "GsCore")
        return true;
    return !!e.gscore_origin;
}
/** @description 提取事件中的纯文本，用于前缀/包含匹配 */
export function eventText(e) {
    return (Array.isArray(e.message) ? e.message : [])
        .filter(i => typeof i === "object" && i?.type === "text")
        .map(i => (typeof i === "object" ? i.text : ""))
        .join("")
        .trim();
}
/** @description 转成非空字符串，取不到给 "" */
export function str(v) {
    return v == null ? "" : String(v);
}
/**
 * @description 取事件所属的机器人账号，按 e.self_id → e.bot.uin → 全局唯一 Bot 的顺序回退
 *
 * self_id 完全由适配器填，框架从不赋值；实际丢失多发生在中途重整过事件的插件那里
 * （e.bot 是 defineProperty 挂的不可枚举属性，`{...e}` 浅拷贝会静默丢掉它，反过来也有丢 self_id 的），
 * 两种残缺形状互补，所以两边都查。
 * 注意：第 3 步只在**全局只有一个 Bot 在线**时才兜 —— Bot.uin 的 toJSON 在多 Bot 时给的是猜测
 * （length 为 2 返回最后一个，≥3 随机一个），猜错会把消息算到别的账号上，
 * 使 hooks.ts 的自回显判断（user_id === self_id）失效，可能触发 Core → 云崽 → Core 回环。
 * 注意：用 || 而不是 ?? —— 空字符串 id 是可达的（QQBot token 拆分为空即得 ""），那种值该继续往下找。
 */
export function resolveSelfId(e) {
    const id = (value) => {
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint")
            return "";
        const result = String(value);
        return result || "";
    };
    const own = id(e?.self_id);
    if (own)
        return own;
    const byBot = id(e?.bot?.uin);
    if (byBot)
        return byBot;
    // 只有一个 Bot 在线时才兜，理由见上
    const uin = globalThis.Bot?.uin;
    if (Array.isArray(uin) && uin.length === 1)
        return id(uin[0]);
    if (!Array.isArray(uin))
        return id(uin);
    return "";
}
