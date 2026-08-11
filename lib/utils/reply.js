/**
 * 引用回复的 message_id 解析
 *
 * 为什么需要专门一层
 * ------------------
 * 各适配器表达「这条消息引用了谁」的方式完全不统一，而早柚核心只要一个
 * message_id 字符串（当键用，见 toGscore.ts 里那段注释）：
 *
 *   适配器            引用信息在哪                             有 message_id 吗
 *   ICQQ-Plugin       e.source = {user_id,time,seq,rand,...}   **没有**
 *   OneBotv11         reply 段 -> dealEvent 派生 e.reply_id     有
 *   Milky             reply 段（message_seq）                   有
 *   Satori            reply 段                                  有
 *   ComWeChat         reply 段（带额外 user_id）                 有
 *
 * 原实现只看 `e.source?.message_id` 与 `e.reply_id`，而 ICQQ **两者都没有**：
 * icqq 的 source 由 message.js:157-166 从 proto type 45 构造，字段只有
 * user_id / time / seq / rand / message，没有 message_id；而 e.reply_id 由框架
 * dealEvent 从 **reply 段**派生，偏偏 icqq 的 parser 永不产出 reply 段
 * （ICQQ-Plugin 用自己的 Model/parser.js 覆盖了 icqq 自带的那份，同样不产出）。
 * 于是两个分支在 ICQQ 上双双不可达 —— 引用回复完全传不到核心，且不报错。
 *
 * ICQQ 上怎么补出来
 * ----------------
 * icqq 自己的 message_id 就是拿 (gid, uin, seq, rand, time) 算出来的
 * （message.js:382 `genGroupMessageId(...)`、:300 `genDmMessageId(...)`），
 * 而 source 里正好有 user_id / seq / rand / time。所以能用同一个函数反算回去，
 * 且必然与我们当初上报那条消息时用的 msg_id 一致 —— 这一点是关键，核心拿它当键
 * 去查自己缓存的图，键不一致等于没有。
 *
 * 这两个函数从 `Bot[self_id].icqq` 上取（ICQQ-Plugin 挂在 Bot 代理上，
 * index.js:868），**按能力探测**：拿不到就跳过，不去 import icqq
 * —— 本插件不依赖它，而且用户可能根本没装 ICQQ-Plugin。
 *
 * 已知不精确之处：`source.rand` 取自 `uuid2rand(q[8]?.[3] || 0)`，上游字段缺失时
 * 会是 0，算出的 id 与真实 message_id 不符。这种情况下核心查不到缓存，
 * 行为退化成「没有引用」—— 与修复前一致，不会更糟。
 */
import { makeLog } from "./compat.js";
/** 从消息数组里找 reply 段的 id */
function fromReplySegment(e) {
    for (const i of e?.message || []) {
        if (i?.type !== "reply")
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
