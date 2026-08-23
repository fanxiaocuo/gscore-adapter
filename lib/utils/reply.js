import { makeLog } from "./compat.js";
/** 把 getReply / getChatHistory 的不同返回形状拍平成消息段数组。 */
function appendReplyParts(out, raw) {
    if (raw == null)
        return;
    if (Array.isArray(raw)) {
        for (const item of raw)
            appendReplyParts(out, item);
        return;
    }
    if (typeof raw === "string") {
        out.push(raw);
        return;
    }
    if (typeof raw === "object" && raw.message != null) {
        appendReplyParts(out, raw.message);
        return;
    }
    if (typeof raw === "object" && raw.type)
        out.push(raw);
}
/**
 * @description 把 QQBot 引用正文里的富文本标记 normalize 成纯文本
 * `content` 里混着表情 `<faceType=...>`（丢掉）与 at `[@名](mqqapi://...)`（只留显示名）；
 * 原样透传会污染核心的 `reply` 字段，命令匹配与 AI 上下文都受影响。
 */
function normalizeQQBotContent(content) {
    return content
        .replace(/<faceType=[^>]*>/g, "")
        .replace(/\[([^\]]*)\]\(mqqapi:\/\/[^)]*\)/g, "$1")
        .trim();
}
/**
 * @description QQBot 专用：从 `e.msg_elements` 取被引用消息，返回云崽形状的消息段
 * 返回云崽段而不是核心段，是为了让 msgToGscore 统一做媒体转换（base64 兜底、image_size 派生等）。
 */
function fromMsgElements(e) {
    const list = Array.isArray(e?.msg_elements) ? e.msg_elements : [];
    const out = [];
    for (const el of list) {
        if (el == null || typeof el !== "object")
            continue;
        const parts = [];
        const text = normalizeQQBotContent(String(el.content ?? ""));
        if (text)
            parts.push(text);
        const images = [];
        for (const a of Array.isArray(el.attachments) ? el.attachments : []) {
            const url = a?.url;
            if (!url)
                continue;
            const kind = String(a.content_type ?? "");
            // 注意：只提图片。引用块最终只回传 image / image_size / node，其余类型转了也会被丢掉；
            // 而 file 更糟 —— toGscoreFile 用的 toBuffer 没开 http 直通，会把整个 URL 下载成 base64
            // （可能是个 200MB 文件）再扔掉。所以非图片只在引用正文里留个标记。
            if (kind.startsWith("image/")) {
                images.push({
                    type: "image",
                    url,
                    name: a.filename,
                    width: a.width,
                    height: a.height,
                });
            }
            else if (kind === "voice") {
                // 有 ASR 文本就带上：那才是被引用语音的实际内容
                parts.push(a.asr_refer_text ? `[语音]${a.asr_refer_text}` : "[语音]");
            }
            else if (kind.startsWith("video/")) {
                parts.push("[视频]");
            }
            else if (kind === "file") {
                parts.push(a.filename ? `[文件]${a.filename}` : "[文件]");
            }
            else {
                makeLog("debug", [`引用附件 content_type 未识别，跳过：${kind}`], "GsCore", true);
            }
        }
        const merged = parts.join(" ").trim();
        if (merged)
            out.push({ type: "text", text: merged });
        out.push(...images);
    }
    return out;
}
/**
 * @description 事件里是否存在引用上下文（无 IO，可作为调 resolveReplyMessage 前的廉价判据）
 * 注意：不能拿「resolveReplyId 有值」当等价条件 —— QQBot 拿不到 message_id（msg_idx 不同源）；
 * 而 resolveReplyMessage 在有 getReply 的适配器上会发一次请求，不能对每条消息都白调。
 */
export function hasReplyContext(e) {
    if (resolveReplyId(e))
        return true;
    return Array.isArray(e?.msg_elements) && e.msg_elements.length > 0;
}
/**
 * @description 获取被引用消息的原始消息段：QQBot 直接读事件（省一次请求），TRSS 走 getReply，ICQQ 退到取一条聊天记录
 * 失败只丢引用正文，不影响 reply_id 与当前消息。
 */
export async function resolveReplyMessage(e) {
    const fromElements = fromMsgElements(e);
    if (fromElements.length)
        return fromElements;
    if (typeof e?.getReply === "function") {
        try {
            const out = [];
            appendReplyParts(out, await e.getReply());
            if (out.length)
                return out;
        }
        catch (err) {
            makeLog("debug", ["通过 getReply 获取引用消息失败", err], "GsCore", true);
        }
    }
    const src = e?.source;
    const group = e?.isGroup || e?.message_type === "group";
    const target = group ? e?.group : e?.friend;
    const cursor = group ? src?.seq : src?.time;
    if (cursor == null || typeof target?.getChatHistory !== "function")
        return [];
    try {
        const history = await target.getChatHistory(cursor, 1);
        const latest = Array.isArray(history) ? history.at(-1) : history;
        const out = [];
        appendReplyParts(out, latest);
        return out;
    }
    catch (err) {
        makeLog("debug", ["从聊天记录获取引用消息失败", err], "GsCore", true);
        return [];
    }
}
/** 从消息数组里找 reply 段的 id */
function fromReplySegment(e) {
    const list = Array.isArray(e?.message) ? e.message : e?.message != null ? [e.message] : [];
    for (const i of list) {
        if (typeof i !== "object" || i?.type !== "reply")
            continue;
        const id = i.id ?? i.message_id;
        if (id != null && id !== "")
            return String(id);
    }
    return "";
}
/**
 * @description ICQQ 专用：由 e.source 反算 message_id
 * @returns 算不出来返回空串
 */
function fromIcqqSource(e) {
    const src = e?.source;
    if (!src || src.seq == null)
        return "";
    // 注意：整个 icqq 模块挂在 Bot[uin].icqq 上（ICQQ-Plugin index.js:868），没有就说明
    // 不是 ICQQ 或版本变了 —— 两种情况都只能放弃，不猜。走 any 是因为它不属于框架契约。
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
            // pktnum 恒给 1：source 里没有这个信息，而分片消息在引用场景极少见。
            // 给错只会让核心查不到缓存，不会发错消息。
            return String(icqq.genGroupMessageId(gid, Number(src.user_id) || 0, seq, rand, time, 1));
        }
        if (typeof icqq.genDmMessageId === "function") {
            // 私聊 id 里存的是「对方账号」而非发送者（icqq message.js:297-300）：
            // 被引用那条若是自己发的（source.user_id === self_id），flag 取 1，否则 0。
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
 * @description 解析事件引用的消息 id，顺序即可信度：适配器直接给的 > 框架派生的 > 消息段里的 > 由 source 反算的
 * @returns 没有引用返回空串
 */
export function resolveReplyId(e) {
    // 1) 适配器直接在 source 上给了（非 ICQQ 的适配器可能有）
    if (e?.source?.message_id != null && e.source.message_id !== "")
        return String(e.source.message_id);
    // 2) 框架 dealEvent 从 reply 段派生
    if (e?.reply_id != null && e.reply_id !== "")
        return String(e.reply_id);
    // 3) 自己从消息段里找 —— 本插件的钩子注册在框架监听器之前，那时 e.reply_id 还没挂上
    const seg = fromReplySegment(e);
    if (seg)
        return seg;
    // 4) ICQQ：由 source 反算
    const icqqId = fromIcqqSource(e);
    if (icqqId)
        return icqqId;
    // 5) QQBot：只有 REFIDX 引用索引可用。它与 msg_id 不同源、核心查不到缓存，但仍上报 ——
    //    它是 QQ 侧真实的引用标识，能让下游「有没有引用」的判断成立；引用图靠随后单独上报的 image 段。
    const refIdx = e?.msg_elements?.[0]?.msg_idx;
    if (refIdx != null && refIdx !== "")
        return String(refIdx);
    return "";
}
