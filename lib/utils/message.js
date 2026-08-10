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
