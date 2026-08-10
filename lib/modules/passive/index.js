/**
 * QQBot 被动回复
 *
 * 问题
 * ----
 * QQ 官方 Bot 把发消息分成两类：
 *   被动回复  带上用户那条消息的 msg_id，不计入主动推送额度
 *   主动推送  不带，**有严格的每月配额**，超了直接发不出去
 *
 * 早柚核心下发的是「给某个会话发这些内容」，不带原消息 id —— 于是所有下发都会
 * 走主动推送。而核心插件的绝大多数回复其实都是用户刚发指令触发的，本该算被动。
 *
 * 做法
 * ----
 * 记住每个会话最近一条**入站**消息的 id，下发时如果它还在 5 分钟窗口内，
 * 就当作被动回复发出去。思路取自 xiowo/yunzai-gscore-adapter（它用 redis，
 * 这里换 sqlite，理由见 db.ts）。
 *
 * 为什么用完就删
 * -------------
 * QQ 的被动回复额度是「一条用户消息可以回 5 次」，但**没有公开接口能查还剩几次**。
 * 保守起见一个 id 只用一次：用过即失效，下一条下发若没有新的入站消息就走主动推送。
 * 重复用同一个 id 超过 5 次会被平台拒收，那比多烧一次主动额度更糟 ——
 * 后者只是消耗配额，前者是消息发不出去。
 *
 * 只对 QQBot 生效
 * --------------
 * 其它适配器没有这个概念，传 event 参数进去多半被忽略（也可能踩到未知分支），
 * 所以按适配器 name 严格限定。
 */
import { makeLog } from "../../utils/compat.js";
import * as db from "./db.js";
/**
 * 被动回复窗口
 *
 * QQ 官方文档给的是 5 分钟。取 4 分 30 秒留一点余量 —— 时间戳来自本机时钟，
 * 与平台判定之间还有网络与处理延迟，卡着 5 分钟发过去可能刚好过期。
 */
const WINDOW_MS = 270_000;
/** key -> { id, at }。内存是权威值 */
const recent = new Map();
/** 待回写的 key */
const dirty = new Set();
let timer = null;
/** 回写间隔。比 stats 短一些：这些行本身只活 4 分半 */
const FLUSH_MS = 5_000;
/**
 * 上限：会话数
 *
 * 单个 id 只有 4 分半的寿命，正常规模下 Map 里不会有太多条。但「每分钟几千个群
 * 各来一条」这种量级下仍可能堆积，所以给个硬顶，超了就清掉最旧的一批。
 */
const MAX = 2000;
function keyOf(selfId, targetType, targetId) {
    return `${selfId}:${targetType}:${targetId}`;
}
/** 是不是 QQBot 适配器 */
export function isQQBot(bot) {
    return String(bot?.adapter?.name || "") === "QQBot";
}
/**
 * QQBot 的 message_id 是否可用于被动回复
 *
 * `event_*` 前缀的是事件 id（入群、按钮回调等），不是消息 id，拿它当被动回复
 * 的凭据会被平台拒收。空值与 0 同理。判据取自参考实现的 isValidQQBotMessageId。
 */
export function isValidId(id) {
    if (id == null)
        return false;
    const s = String(id);
    if (!s || s === "0" || s === "null" || s === "undefined")
        return false;
    return !s.startsWith("event_");
}
/**
 * 记一条入站消息
 *
 * 在上报给核心的同一处调用（每条入站消息都会经过），所以必须是同步且极轻的。
 */
export function remember(e) {
    if (!isQQBot(e?.bot))
        return;
    if (!isValidId(e?.message_id))
        return;
    // 私聊与群用同一套 key 空间，靠 target_type 区分：QQBot 的群 id 与用户 id
    // 形状不同（群是 selfId:openid），但没必要依赖这一点
    const type = e.message_type === "private" && !e.group_id ? "direct" : "group";
    const target = type === "direct" ? e.user_id : e.group_id;
    if (target == null)
        return;
    const key = keyOf(e.self_id, type, target);
    recent.set(key, { id: String(e.message_id), at: Date.now() });
    dirty.add(key);
    if (recent.size > MAX)
        evict();
}
/** 超上限时清理：先删过期的，还超就按时间删最旧的 */
function evict() {
    const now = Date.now();
    for (const [k, v] of recent)
        if (now - v.at > WINDOW_MS)
            recent.delete(k);
    if (recent.size <= MAX)
        return;
    const sorted = [...recent.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of sorted.slice(0, recent.size - MAX))
        recent.delete(k);
}
/**
 * 取一个可用于被动回复的 id，**取出即删**
 *
 * @returns 窗口内没有可用 id 时返回空串（调用方照常走主动推送）
 */
export function take(selfId, targetType, targetId) {
    const key = keyOf(selfId, targetType, targetId);
    const hit = recent.get(key);
    if (!hit)
        return "";
    // 过期就直接丢掉：留着只会在下次查询时再判一遍
    if (Date.now() - hit.at > WINDOW_MS) {
        recent.delete(key);
        dirty.add(key);
        return "";
    }
    recent.delete(key);
    dirty.add(key);
    return hit.id;
}
/** 把脏行回写。已从内存删掉的 key 在库里也删掉 */
async function flush() {
    if (!dirty.size)
        return;
    const rows = [];
    const gone = [];
    for (const key of dirty) {
        const v = recent.get(key);
        if (v)
            rows.push({ key, id: v.id, at: v.at });
        else
            gone.push(key);
    }
    dirty.clear();
    try {
        if (rows.length)
            await db.save(rows);
        // 已消费/已过期的行必须真的从库里删掉：留着的话重启后会被重新灌进内存
        // 并再用一次 —— 那正是「一个 id 只用一次」要避免的
        if (gone.length)
            await db.remove(gone);
    }
    catch (err) {
        makeLog("debug", ["被动回复：回写失败", err], "GsCore");
    }
}
/** 初始化：开库、灌历史、起定时回写 */
export async function initPassive() {
    const ok = await db.open();
    if (!ok)
        return;
    try {
        const min = Date.now() - WINDOW_MS;
        const rows = await db.load(min);
        for (const r of rows) {
            if (!r.id)
                continue;
            recent.set(r.key, { id: r.id, at: Number(r.at) });
        }
        if (rows.length)
            makeLog("debug", `被动回复：载入 ${recent.size} 条会话记录`, "GsCore");
        // 顺手清掉过期行
        await db.prune(min);
    }
    catch (err) {
        makeLog("error", ["被动回复：载入失败", err], "GsCore");
    }
    timer = setInterval(flush, FLUSH_MS);
    timer.unref?.();
    process.once("beforeExit", () => {
        stopPassive().catch(() => { });
    });
}
/** 停掉并刷盘。测试与退出钩子用 */
export async function stopPassive() {
    if (timer)
        clearInterval(timer);
    timer = null;
    await flush();
    await db.close();
}
/** 当前记着多少条会话，供 #早柚状态 显示 */
export function passiveCount() {
    return recent.size;
}
/** 是否在落盘 */
export function passivePersisted() {
    return db.available();
}
