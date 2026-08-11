/**
 * 消息与事件钩子
 *
 * 回环防护共三层，详见 README「回环防护」一节。
 */
import { config } from "../../config/index.js";
import { isFromGsCore, eventText, passFilter, passDirection } from "../../utils/index.js";
import { noticeToMeta } from "../../modules/notice/index.js";
import { remember } from "../../modules/passive/index.js";
import { makeLog } from "../../utils/compat.js";
import { clients } from "./state.js";
import { echoKey, isEcho } from "./echo.js";
import { isMasterUser } from "./framework.js";
function shouldForward(e) {
    if (e.post_type !== "message")
        return false;
    if (!e.user_id || !e.self_id)
        return false;
    // 1) 适配器回显自己发出的消息
    if (String(e.user_id) === String(e.self_id))
        return false;
    if (e.message_sent || e.sub_type === "self")
        return false;
    // 2) 来源是早柚核心适配器，或事件带 gscore_origin 标记
    //    不挡就是 Core -> 云崽 -> Core 死循环
    if (isFromGsCore(e))
        return false;
    // 3) 刚由本客户端代发的内容被回显
    if (isEcho(echoKey(e.self_id, e.group_id ?? e.user_id, e.message || [])))
        return false;
    // 会话方向开关（report_private / report_group），比黑白名单粗一档
    if (!passDirection(e))
        return false;
    if (!passFilter(e))
        return false;
    const f = config.filter || {};
    const text = eventText(e);
    if (f.block_prefix?.length && f.block_prefix.some(i => text.startsWith(i)))
        return false;
    if (f.block_include?.length && f.block_include.some(i => text.includes(i)))
        return false;
    // 仅回复 @ / 前缀，只作用于群聊
    if (f.only_reply_at && (e.message_type === "group" || e.isGroup)) {
        const atBot = (e.message || []).some(i => i?.type === "at" && String(i.qq) === String(e.self_id));
        const hasPrefix = (f.prefix || []).some(i => text.startsWith(i));
        if (!atBot && !hasPrefix)
            return false;
    }
    return true;
}
export async function onYunzaiMessage(e) {
    try {
        if (!clients.length)
            return;
        // 记入站 message_id 供 QQBot 被动回复用。放在 shouldForward 之前：
        // 被过滤掉的消息（如 only_reply_at 没命中）同样能作为被动回复的凭据 ——
        // 用户确实刚发过话，5 分钟窗口是开着的，与我们要不要上报给核心无关。
        // 内部自带适配器与 id 有效性判断，非 QQBot 直接返回。
        remember(e);
        if (!shouldForward(e))
            return;
        // 主人判定的两框架差异见 framework.ts。
        // 只读不写 e.isMaster：TRSS 的 setter 会拦截告警，Miao 则是普通赋值
        const isMaster = isMasterUser(e.self_id, e.user_id, e);
        for (const c of clients) {
            if (c.status !== 1)
                continue;
            if (!c.accept(e.self_id))
                continue;
            await c.sendReceive(e, isMaster);
        }
    }
    catch (err) {
        makeLog("error", ["上报早柚核心错误", err], "GsCore");
    }
}
/**
 * notice 专用守卫。
 * 不复用 shouldForward：其中的回显检测、文本前缀、only_reply_at
 * 都建立在 e.message 上，notice 没有 message 数组。
 */
function shouldForwardNotice(e) {
    if (e.post_type !== "notice")
        return false;
    if (!e.self_id)
        return false;
    // 事件总开关：核心侧没装消费 meta 事件的插件时，关掉能省掉全部无用上报
    if (config.filter?.report_meta === false)
        return false;
    // 来源是早柚核心方向的 Bot —— 不挡就是 Core -> 云崽 -> Core 死循环
    if (isFromGsCore(e))
        return false;
    // 方向开关同样作用于事件：只关心群事件时不必收私聊戳一戳
    if (!passDirection(e))
        return false;
    return passFilter(e);
}
export async function onYunzaiNotice(e) {
    try {
        if (!clients.length)
            return;
        if (!shouldForwardNotice(e))
            return;
        const meta = noticeToMeta(e);
        if (!meta) {
            // 群禁言、群头衔、消息撤回等大量事件都会走到这里，用 debug 免得刷屏
            return makeLog("debug", `未映射的事件：${e.notice_type}.${e.sub_type}`, "GsCore", true);
        }
        // 不传 e：这里判定的是事件涉及的用户（meta.data.user_id），
        // 与 e.user_id 可能不同（如"某人被踢"），不能采信框架对 e 算出的结论
        const isMaster = isMasterUser(e.self_id, meta.data.user_id);
        for (const c of clients) {
            if (c.status !== 1)
                continue;
            if (!c.accept(e.self_id))
                continue;
            // 单个连接炸掉不影响其余连接
            try {
                c.sendMeta(e, meta, isMaster);
            }
            catch (err) {
                makeLog("error", ["上报事件错误", err], `GsCore:${c.name}`);
            }
        }
    }
    catch (err) {
        makeLog("error", ["上报早柚核心事件错误", err], "GsCore");
    }
}
