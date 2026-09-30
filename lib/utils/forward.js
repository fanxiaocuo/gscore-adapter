import { makeLog, toStr } from "./compat.js";
/** 把各家 getForwardMsg 的返回形状统一成 ForwardNode[]。 */
function toNodes(raw) {
    const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const out = [];
    for (const i of list) {
        if (i == null)
            continue;
        // 注意：OneBotv11 把 parseMsg 结果写回 i.message（OneBotv11.js:223-224），
        // 而 get_forward_msg 协议原字段叫 content —— 实现不一时两个都认；都没有就当整项本身是一个段。
        const message = typeof i === "object" ? (i.message ?? i.content ?? i) : i;
        const arr = Array.isArray(message) ? message : [message];
        if (!arr.length)
            continue;
        out.push(typeof i === "object" ? { ...i, message: arr } : { message: arr });
    }
    return out;
}
/** @description 取会话对象 —— getForwardMsg 只挂在 pickGroup / pickFriend 的返回上，Bot 上没有 */
function pickTarget(e) {
    const group = e?.isGroup || e?.message_type === "group";
    return group ? e?.group : e?.friend;
}
/**
 * @description 自己发一次请求取内容，翻译走宿主的 parseMsg
 * 注意：只发一个 action —— OneBotv11 的 sendApi 超时 60s 且到点会 ws.terminate()（OneBotv11.js:23-27），盲试第二个 action 被静默忽略就是一次断线
 */
async function fromSendApi(id, e) {
    const bot = e?.bot;
    if (typeof bot?.sendApi !== "function" || typeof bot?.adapter?.parseMsg !== "function")
        return [];
    const onebot = typeof pickTarget(e)?.getForwardMsg === "function";
    const action = onebot ? "get_forward_msg" : "get_forwarded_messages";
    const params = onebot ? { message_id: id } : { forward_id: id };
    try {
        const ret = await bot.sendApi(action, params);
        // 注意：两家失败姿势不同 —— OneBotv11 对非 0 retcode 直接 throw（OneBotv11.js:31-32），
        // Milky 的 callApi 在 retcode 缺失时补 0（Milky.js:403-405），所以既要 catch 也要查 retcode
        if (!ret || (ret.retcode != null && ret.retcode !== 0)) {
            makeLog("debug", [`${action} 未返回内容：${toStr(ret)}`], "GsCore", true);
            return [];
        }
        // OneBotv11 把响应包成读穿 data 的 Proxy（OneBotv11.js:34-36），两种取法都通
        const messages = ret.data?.messages ?? ret.messages;
        const out = [];
        for (const m of Array.isArray(messages) ? messages : []) {
            // 注意：只喂原始段 —— parseMsg 是 `{...i.data, type:i.type}`，对已翻译的段再跑一次会把
            // 正文抹成 `{type:"text"}`，所以不拿 m.message 兜底
            const message = bot.adapter.parseMsg(m?.segments ?? m?.content);
            if (Array.isArray(message) && message.length)
                out.push({ ...m, message });
        }
        return out;
    }
    catch (err) {
        makeLog("debug", [`通过 ${action} 获取合并转发失败`, err], "GsCore", true);
        return [];
    }
}
/**
 * @description 取合并转发的内容，返回云崽段而不是核心段
 * 让 msgToGscore 统一做媒体转换（base64 兜底、image_size 派生等），这里不碰核心协议。
 *
 * @param id 合并转发 id（Milky 的 forward_id / OneBot 的 message_id）
 * @param e  触发事件；不传（如从 node 内部转换时）就没有探测对象，直接放弃
 * @returns 取不到返回空数组，**不抛错** —— 调用方据此决定怎么降级
 */
export async function resolveForwardMessage(id, e) {
    if (!id)
        return [];
    const nodes = await fromSendApi(id, e);
    if (nodes.length)
        return nodes;
    // 兜底：只包了 getForwardMsg、bot 上没挂 sendApi 的适配器还能走这条
    // 注意：这条路不补翻译 —— 宿主漏翻译时拿到的仍是原始段，下游拍不出东西，落到空 node
    const target = pickTarget(e);
    if (typeof target?.getForwardMsg === "function") {
        try {
            return toNodes(await target.getForwardMsg(id));
        }
        catch (err) {
            makeLog("debug", ["通过 getForwardMsg 获取合并转发失败", err], "GsCore", true);
        }
    }
    return [];
}
