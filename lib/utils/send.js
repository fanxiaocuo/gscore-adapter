/**
 * 发送结果判定
 *
 * 为什么不能只靠「没抛错就算成功」
 * ------------------------------
 * 各适配器的 sendMsg 失败语义分两派：
 *
 *   抛错派    ICQQ（icqq 内部 ApiRejection）、QQBot-Plugin 的多数路径
 *   返回派    OneBot 系与 Milky —— Milky 的 callApi 在 catch 里造一个
 *             { retcode: -1, status: "failed", error } 返回（Milky.js:424-434），
 *             **从不抛**。ws-plugin 的 fork 也为此专门加了 normalizeSendResult。
 *
 * 原实现是 `await target.sendMsg(...)` 之后直接 count("down")，于是返回派的失败
 * 会被记成一次成功中转，撤回回执还回一个 null。后果是「连着、计数在涨、消息没到」
 * —— 而中转计数这个功能的全部意义就是发现「连着但不通」，这恰好是它该抓到的情况。
 *
 * 判定依据（保守）
 * --------------
 * 只在**明确有失败信号**时判失败，判不出来一律算成功：
 *   - retcode 存在且非 0（OneBot 约定：0 成功）
 *   - status 是 "failed"（OneBot / Milky 都用这个字面量）
 *   - error 字段为真
 * 不拿「取不到 message_id」当失败 —— 很多适配器成功时也不返回 id（stdin、
 * 部分 OneBot 实现），那样会把正常发送大面积误判成失败。
 */
/**
 * 从发送返回值里提取失败原因；成功返回空串
 *
 * @param ret 各适配器 sendMsg 的返回值。标 any 是诚实的：这个函数存在的理由
 *            就是各适配器返回形状不统一（见上面的说明），所有字段读取都得
 *            先当「可能没有」处理，标个联合类型只会让每次读取都要先收窄
 */
export function sendError(ret) {
    // undefined / null：多数适配器成功时也这样，不能算失败
    if (ret == null)
        return "";
    if (typeof ret !== "object")
        return "";
    // 数组：QQBot-Plugin 与 ICQQ-Plugin 在拆多条发送时返回数组，
    // 逐个看，任一失败即整体失败（部分成功也该让用户知道）
    if (Array.isArray(ret)) {
        for (const i of ret) {
            const err = sendError(i);
            if (err)
                return err;
        }
        return "";
    }
    if (ret.error) {
        // error 可能是 Error、字符串，也可能是 ICQQ-Plugin 那种数组
        if (Array.isArray(ret.error)) {
            const first = ret.error.find(Boolean);
            if (first)
                return String(first?.message || first);
            // error 是空数组：ICQQ-Plugin 多组发送时恒带这个字段，空的表示没出错
        }
        else {
            return String(ret.error?.message || ret.error);
        }
    }
    if (ret.status === "failed")
        return String(ret.msg || ret.wording || "status: failed");
    // retcode 只在存在时判：0 成功是 OneBot 约定，没有这个字段的适配器不参与判定
    if (ret.retcode != null && Number(ret.retcode) !== 0)
        return String(ret.msg || ret.wording || `retcode: ${ret.retcode}`);
    return "";
}
/**
 * 从发送返回值里取消息 id，供撤回回执用
 *
 * 核心用它实现定时撤回。可能是数组 —— ICQQ-Plugin 在风控时会把整条载荷重打成
 * 转发重试，多组发送返回 `{ message_id: [], data: [], error: [] }`。
 * 协议的 RecallReceipt.id 本身允许 string[]，所以数组原样透传，
 * 只把空数组归一成 null（那等于没拿到）。
 *
 * @param ret 同 {@link sendError}，形状因适配器而异
 */
export function sendMessageId(ret) {
    if (ret == null || typeof ret !== "object")
        return null;
    if (Array.isArray(ret)) {
        const ids = ret
            .map(i => sendMessageId(i))
            .flat()
            .filter(Boolean);
        return ids.length ? (ids.length === 1 ? ids[0] : ids) : null;
    }
    const id = ret.message_id ?? ret.msg_id ?? ret.id;
    if (id == null)
        return null;
    if (Array.isArray(id)) {
        const ids = id.filter(i => i != null && i !== "").map(String);
        return ids.length ? (ids.length === 1 ? ids[0] : ids) : null;
    }
    return id === "" ? null : String(id);
}
/**
 * 把发送返回值分成四态
 *
 * 为什么不能只有一个「投出去了吗」的布尔
 * ------
 * QQBotAdapter.sendMsg（index.js:805-865）把一条下行拆成多个消息组逐个发，
 * 失败只 `rets.error.push(err)` 就返回剩余的，接着是四级阶梯重试（原样重试 →
 * 换 markdown 形态重建 → legacy makeMsg 兜底）。而 **rets.error 全程没有任何
 * 清空动作** —— 首轮失败、后续成功的发送，返回的仍是
 * `{ message_id:[非空], data:[非空], error:[旧错误] }`。
 *
 * 于是 `data.length > 0` 这一个布尔要同时回答两个不同的问题：
 *   「要不要整条重发」   —— 已经投出去一部分就不能重发，会复制成功的那部分
 *   「算不算一次完整成功」 —— 投出去一部分不等于整条完成
 * 旧实现用它同时当这两个判据，结果把「半条」计成了一次完整中转 ——
 * 而中转计数的全部意义就是发现「连着但不通」，这恰好是它该抓到的情况。
 *
 * 分组总数拿不到，所以 `data` 与 `error` 同时非空时**证不出**整条完成：
 * 「自愈成功」与「有一组永久失败」在返回值上是同一个形状。一律判 partial，
 * 处置上不重发、取撤回 id、但不计完整成功 —— 宁可少计，不能把半条当整条。
 *
 * 判据用 `rets.data` 而不是 `message_id`：index.js:821 是 `if (ret.id) push(ret.id)`，
 * 已投递但响应不带 id 时 message_id 会是空的；而 820 行 `rets.data.push(ret)`
 * 每次成功投递都执行。这也与本文件开头「缺 message_id 不得判失败」一致。
 *
 * 形状不认识时必须退回 sendError，不能一律当「没投出去」
 * ------
 * 只认 `data` 数组的话，返回形状一变（换版本、换实现、或 isQQBot 认到别的
 * 适配器）就会变成「每条消息都回退再发一遍」—— 那比偶发重复更糟，且是无条件
 * 发生。所以只有拿到 `data` 数组这个确切证据时才下分组级判断，其余情况归
 * `unknown`，由 {@link deliveryDelivered} / {@link deliveryComplete} 沿用
 * sendError 的保守语义：至少不比改动前差。
 *
 * @param ret 同 {@link sendError}，形状因适配器而异
 */
export function classifyDelivery(ret) {
    const error = sendError(ret);
    // 顶层数组：QQBot-Plugin 与 ICQQ-Plugin 拆多条发送时返回数组。
    // 逐项分类再归并 —— 旧实现在这个形状上与 { data: [...] } 结论相反
    // （sendError 认为整体失败，于是把已经成功的那几条又发一遍）
    if (Array.isArray(ret)) {
        const parts = ret.map(i => classifyDelivery(i));
        const delivered = parts.some(p => p.delivered != null)
            ? parts.reduce((n, p) => n + (p.delivered ?? 0), 0)
            : null;
        const bad = parts.find(p => p.error);
        if (!bad) {
            // 每项都没有失败信号。只有项项都拿到确切证据才敢说 complete，
            // 空数组同理归 unknown（没有任何成员可判）
            const proven = parts.length > 0 && parts.every(p => p.kind === "complete");
            return { kind: proven ? "complete" : "unknown", error: "", delivered };
        }
        const anyOk = parts.some(p => !p.error);
        return { kind: anyOk ? "partial" : "failed", error: bad.error, delivered };
    }
    const delivered = Array.isArray(ret?.data) ? ret.data.length : null;
    if (delivered == null)
        return { kind: "unknown", error, delivered: null };
    if (!error)
        return { kind: "complete", error: "", delivered };
    return { kind: delivered > 0 ? "partial" : "failed", error, delivered };
}
/**
 * 这次投递有没有把内容送出去 —— 决定要不要整条回退重发
 *
 * partial 也算「送出去了」：已经有分组成功，整条重发会复制那部分内容。
 * 上游没有提供可精确重试的失败分组，所以宁可少一段也不复制。
 */
export function deliveryDelivered(d) {
    if (d.kind === "unknown")
        return !d.error;
    return d.kind !== "failed";
}
/**
 * 能不能算一次完整下行成功 —— 决定 count("down") 与正常撤回回执
 *
 * 只有 complete 算。unknown 沿用 sendError 的保守语义（判不出失败即成功），
 * 否则换个返回形状就会让计数大面积归零。
 */
export function deliveryComplete(d) {
    if (d.kind === "unknown")
        return !d.error;
    return d.kind === "complete";
}
