import { makeLog, toStr } from "./compat.js";
/** 把各家 getForwardMsg 的返回形状统一成 ForwardNode[]。 */
function toNodes(raw) {
    const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const out = [];
    for (const i of list) {
        if (i == null)
            continue;
        // OneBotv11 把 parseMsg 的结果写回 i.message（OneBotv11.js:223-224），但
        // get_forward_msg 协议原字段叫 content，实现不一时两个都认；都没有就当整项
        // 本身就是一个消息段。
        const message = typeof i === "object" ? (i.message ?? i.content ?? i) : i;
        const arr = Array.isArray(message) ? message : [message];
        if (!arr.length)
            continue;
        out.push(typeof i === "object" ? { ...i, message: arr } : { message: arr });
    }
    return out;
}
/** Milky：协议有 get_forwarded_messages，适配器没包装，走通用 sendApi + parseMsg。 */
async function fromMilky(id, e) {
    const bot = e?.bot;
    if (typeof bot?.sendApi !== "function" || typeof bot?.adapter?.parseMsg !== "function")
        return [];
    try {
        const ret = await bot.sendApi("get_forwarded_messages", { forward_id: id });
        // Milky 的 callApi 在 retcode 缺失时补 0（Milky.js:403-405），所以非 0 一定是
        // 真失败（含"不认识这个 action"）。silent 降级，不往用户日志里塞。
        if (!ret || ret.retcode !== 0) {
            makeLog("debug", [`get_forwarded_messages 未返回内容：${toStr(ret)}`], "GsCore", true);
            return [];
        }
        const out = [];
        for (const m of Array.isArray(ret.data?.messages) ? ret.data.messages : []) {
            const message = bot.adapter.parseMsg(m?.segments);
            if (!Array.isArray(message) || !message.length)
                continue;
            out.push({ ...m, message });
        }
        return out;
    }
    catch (err) {
        makeLog("debug", ["通过 get_forwarded_messages 获取合并转发失败", err], "GsCore", true);
        return [];
    }
}
/**
 * 取合并转发的内容。
 *
 * 返回云崽段而不是核心段，理由同 reply.ts 的 fromMsgElements：让 msgToGscore
 * 统一做媒体转换（base64 兜底、image_size 派生等），这里不碰核心协议。
 *
 * @param id 合并转发 id（Milky 的 forward_id / OneBot 的 message_id）
 * @param e  触发事件；不传（如从 node 内部转换时）就没有探测对象，直接放弃
 * @returns 取不到返回空数组，**不抛错** —— 调用方据此决定怎么降级
 */
export async function resolveForwardMessage(id, e) {
    if (!id)
        return [];
    // 群私各自的会话对象上探 —— pickGroup / pickFriend 返回的东西才带这个方法，
    // Bot 上没有（OneBotv11.js 的三处挂载全在 pick* 里）。
    const group = e?.isGroup || e?.message_type === "group";
    const target = group ? e?.group : e?.friend;
    if (typeof target?.getForwardMsg === "function") {
        try {
            const nodes = toNodes(await target.getForwardMsg(id));
            if (nodes.length)
                return nodes;
        }
        catch (err) {
            makeLog("debug", ["通过 getForwardMsg 获取合并转发失败", err], "GsCore", true);
        }
    }
    return fromMilky(id, e);
}
