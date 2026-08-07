/**
 * 消息与事件钩子
 *
 * 回环防护共四层，详见 README「回环防护」一节。
 */
import { config } from "../../config/index.js";
import { isFromGsCore, eventText, passFilter } from "../../utils/index.js";
import { noticeToMeta } from "../../modules/notice/index.js";
import { clients } from "./state.js";
import { echoKey, isEcho } from "./echo.js";
import { cfg } from "./framework.js";
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
    // 2)+3) 来源是早柚核心方向的 Bot 或带 gscore_origin 标记
    //       不挡就是 Core -> 云崽 -> Core 死循环
    if (isFromGsCore(e))
        return false;
    // 4) 刚由本客户端代发的内容被回显
    if (isEcho(echoKey(e.self_id, e.group_id ?? e.user_id, e.message || [])))
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
        if (!shouldForward(e))
            return;
        // 不能写 e.isMaster —— lib/plugins/loader.js:404 的 setter 会拦截并打印告警
        // 这里照抄它 getter 的表达式，因为我们的监听器可能早于框架的 dealEvent
        const isMaster = !!cfg.master?.[e.self_id]?.includes(String(e.user_id));
        for (const c of clients) {
            if (c.status !== 1)
                continue;
            if (!c.accept(e.self_id))
                continue;
            await c.sendReceive(e, isMaster);
        }
    }
    catch (err) {
        Bot.makeLog("error", ["上报早柚核心错误", err], "GsCore");
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
    // 来源是早柚核心方向的 Bot —— 不挡就是 Core -> 云崽 -> Core 死循环
    if (isFromGsCore(e))
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
            return Bot.makeLog("debug", `未映射的事件：${e.notice_type}.${e.sub_type}`, "GsCore", true);
        }
        // 同 onYunzaiMessage：不能写 e.isMaster，loader.js:404 的 setter 会拦截告警
        const isMaster = !!cfg.master?.[e.self_id]?.includes(String(meta.data.user_id));
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
                Bot.makeLog("error", ["上报事件错误", err], `GsCore:${c.name}`);
            }
        }
    }
    catch (err) {
        Bot.makeLog("error", ["上报早柚核心事件错误", err], "GsCore");
    }
}
