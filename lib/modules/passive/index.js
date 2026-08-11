/**
 * QQBot 被动回复
 *
 * 是什么
 * ------
 * QQ 官方 Bot 发消息时可以带上用户那条消息的 msg_id：
 *   带 msg_id  客户端里这条回复挂在用户那条消息下，显示为「引用」
 *   不带       作为一条独立消息发出，与上下文没有关联
 *
 * 早柚核心下发的是「给某个会话发这些内容」，不带原消息 id —— 于是所有下发都会
 * 变成独立消息。而核心插件的绝大多数回复其实都是用户刚发指令触发的，本该挂上去。
 *
 * > 历史：这个功能最早是为「省主动推送配额」做的 —— 当时官方对不带 msg_id 的
 * > 主动推送有严格的每月配额。现在两者一视同仁，配额不再是理由，留下它是为了
 * > 上面那个引用形态。凡是提「省额度」的说法都已过时。
 *
 * 做法
 * ----
 * 记住每个会话最近一条**入站**消息的 id，下发时如果它还在 5 分钟窗口内，
 * 就带上它发出去。思路取自 xiowo/yunzai-gscore-adapter（它用 redis，
 * 这里换 sqlite，理由见 db.ts）。
 *
 * 为什么限次
 * ---------
 * 官方对**同一个 msg_id** 能回几条有上限（5 条），回满之后再带它发会被平台拒收 ——
 * 那比不带 id 发出去糟得多：后者只是少了引用形态，前者是消息根本发不出去。
 * 所以每个 id 记一个使用计数，回满即视为不可用，之后的下发不带 id。
 * 计数由新的入站消息覆盖同会话记录时自然重置。
 * 参考 xiowo 的 86f9bad（他用 redis INCR + QQBOT_MESSAGE_ID_REPLY_LIMIT）。
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
/**
 * 同一个 msg_id 最多能带几次
 *
 * 官方上限是 5。取满 5 而不是保守地取 1：一条指令触发多段回复（正文 + 图 + 按钮）
 * 是核心插件的常态，只用一次的话后面几段就都掉出引用形态了。
 */
const MAX_USES = 5;
/** key -> { id, at, used }。内存是权威值 */
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
 * @param selfId 已由 resolveSelfId 解析过，与发到核心的 bot_self_id 对齐；
 *               不传则退回 e.self_id —— 与 sendReceive 产出的 bot_self_id 对不上时
 *               QQBot 被动回复的 message_id 就找不到，被动回复会失效。
 */
export function remember(e, selfId) {
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
    const key = keyOf(selfId || e.self_id, type, target);
    // 覆盖同会话的旧记录，used 归零：新消息自带一份完整的回复额度
    recent.set(key, { id: String(e.message_id), at: Date.now(), used: 0 });
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
 * 取一个可用于被动回复的 id
 *
 * 每取一次记一次数，取满 MAX_USES 后该 id 作废（平台会拒收第 6 条）。
 * 作废与过期都直接从内存删掉，并标脏让回写把库里那行也删了。
 *
 * @returns 没有可用 id 时返回空串（调用方照常发，只是不带 id）
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
    hit.used += 1;
    dirty.add(key);
    // 这一次仍然可用，但用掉之后就到顶了 —— 删掉，省得下次再查一遍
    if (hit.used >= MAX_USES)
        recent.delete(key);
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
            rows.push({ key, id: v.id, at: v.at, used: v.used });
        else
            gone.push(key);
    }
    dirty.clear();
    try {
        if (rows.length)
            await db.save(rows);
        // 已用满/已过期的行必须真的从库里删掉：留着的话重启后会被重新灌进内存
        // 并再用一次 —— 那正是 MAX_USES 要挡住的
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
            // used 必须跟着载入：重启不该把已经用掉的次数抹平，否则一个 id 就可能
            // 被带满 5 次以上，第 6 条起被平台拒收。老库没有这一列，读出来是
            // undefined，按 0 算
            const used = Number(r.used) || 0;
            if (used >= MAX_USES)
                continue;
            recent.set(r.key, { id: r.id, at: Number(r.at), used });
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
