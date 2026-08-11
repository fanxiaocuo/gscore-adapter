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
/** 从发送返回值里提取失败原因；成功返回空串 */
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
 */
export function sendMessageId(ret) {
    if (ret == null || typeof ret !== "object")
        return null;
    if (Array.isArray(ret)) {
        const ids = ret.map(i => sendMessageId(i)).flat().filter(Boolean);
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
