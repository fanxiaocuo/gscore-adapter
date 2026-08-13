import { makeLog } from "./compat.js";
/** 从消息数组里找 reply 段的 id */
function fromReplySegment(e) {
    for (const i of Array.isArray(e?.message) ? e.message : []) {
        if (typeof i !== "object" || i?.type !== "reply")
            continue;
        const id = i.id ?? i.message_id;
        if (id != null && id !== "")
            return String(id);
    }
    return "";
}
/**
 * ICQQ 专用：由 e.source 反算 message_id
 *
 * @returns 算不出来返回空串
 */
function fromIcqqSource(e) {
    const src = e?.source;
    if (!src || src.seq == null)
        return "";
    // ICQQ-Plugin 把整个 icqq 模块挂在 Bot[uin].icqq 上（index.js:868）。没有就说明
    // 不是 ICQQ，或者版本变了 —— 两种情况都只能放弃，不猜。
    // 走 any：@types/trss-yunzai 的 Client 上没有 icqq 字段（它是 ICQQ-Plugin 自己
    // 加的，不属于框架契约），按能力探测而不是让类型定义追着插件跑。
    const icqq = e.bot?.icqq ?? globalThis.Bot?.[e.self_id]?.icqq;
    if (!icqq)
        return "";
    const seq = Number(src.seq);
    const rand = Number(src.rand) || 0;
    const time = Number(src.time) || 0;
    if (!Number.isFinite(seq))
        return "";
    try {
        const gid = Number(e.group_id);
        if (gid && typeof icqq.genGroupMessageId === "function") {
            // pktnum 恒给 1：source 里没有这个信息，而分片消息（pktnum > 1）
            // 在引用场景极少见。给错只会让核心查不到缓存，不会发错消息。
            return String(icqq.genGroupMessageId(gid, Number(src.user_id) || 0, seq, rand, time, 1));
        }
        if (typeof icqq.genDmMessageId === "function") {
            // 私聊 id 里存的是「对方账号」而非发送者：icqq message.js:297-300
            //   opposite = from_id；from_id === 自己时 opposite = to_id 且 flag = 1
            // 收到的消息里对方恒为 e.user_id。被引用的那条若是自己发的（source.user_id
            // 等于 self_id），flag 取 1，否则 0。
            const self = String(e.self_id);
            const flag = String(src.user_id) === self ? 1 : 0;
            return String(icqq.genDmMessageId(Number(e.user_id) || 0, seq, rand, time, flag));
        }
    }
    catch (err) {
        makeLog("debug", ["由 source 反算引用 id 失败", err], "GsCore", true);
    }
    return "";
}
/**
 * 解析事件引用的消息 id
 *
 * 顺序即可信度：适配器直接给的 > 框架派生的 > 消息段里的 > 由 source 反算的。
 *
 * @returns 没有引用返回空串
 */
export function resolveReplyId(e) {
    // 1) 适配器直接在 source 上给了（非 ICQQ 的适配器可能有）
    if (e?.source?.message_id != null && e.source.message_id !== "")
        return String(e.source.message_id);
    // 2) 框架 dealEvent 从 reply 段派生
    if (e?.reply_id != null && e.reply_id !== "")
        return String(e.reply_id);
    // 3) 自己从消息段里找 —— 本插件的钩子可能早于 dealEvent 执行，
    //    那时 e.reply_id 还没挂上（lifecycle.ts 注册在框架监听器之前）
    const seg = fromReplySegment(e);
    if (seg)
        return seg;
    // 4) ICQQ：由 source 反算
    return fromIcqqSource(e);
}
