/**
 * 按账号取 Bot 实例
 *
 * 对齐 yenai-plugin 的 `_getBotList` / `Bot[i]`（model/State/BotState.js）：
 * 事件上用 `e.self_id`，清单用 `Bot.uin`，实例始终按 self_id 精确取。
 *
 * TRSS 的 `Bot` 是 `new Proxy(this.bots, …)`（lib/bot.js:74），正常账号键上的
 * `Bot[self_id]` 就是 `this.bots[self_id]`。这里仍直接读底层 `Bot.bots`：
 * Proxy 还会优先返回框架 / util 的同名属性，并把未知属性重定向到在线实例，
 * 而账号解析不能接受这两种兼容行为。
 *
 * OneBotv11 会先注册实例、再异步填登录信息，所以实例的 uin getter 可能暂时为空。
 * 注册表自有键才是账号是否存在的依据，不再用 uin / adapter 形状二次猜测。
 */
import { isQQBotAppId } from "./platform.js";
/** 安全字符串化：null/undefined 归空串 */
function s(v) {
    return v == null ? "" : String(v);
}
/**
 * 取某个账号的 Bot 实例。对不上返回 null，不拿别的号顶上。
 *
 * TRSS 只认 Bot.bots 的自有键；Miao 没有这张表，根 Bot.uin 与账号相等时
 * 根 Bot 就是该账号实例。
 *
 * @param id 机器人账号（事件上的 self_id / Bot.uin 里的一项）
 */
export function getBot(id) {
    const sid = s(id).trim();
    if (!sid)
        return null;
    const B = globalThis.Bot;
    if (!B)
        return null;
    try {
        const bots = B.bots;
        if (bots && typeof bots === "object") {
            if (!Object.prototype.hasOwnProperty.call(bots, sid))
                return null;
            const hit = bots[sid];
            return hit && typeof hit === "object" ? hit : null;
        }
        // Miao-Yunzai：没有 bots 表，Bot 自身就是唯一账号
        if (B.uin != null && !Array.isArray(B.uin) && String(B.uin) === sid)
            return B;
    }
    catch {
        // 读注册表 / getter 出错一律当离线
    }
    return null;
}
/**
 * 按账号取档案。离线账号也尽量给头像：
 * 纯数字的 QQ 号 / 官方 bot 的 appid 都能从 qlogo 按号取图
 * （官方 bot 的写法与 QQBot-Plugin 给自己的头像一致）。
 */
export function botProfile(id) {
    const sid = s(id);
    const bot = getBot(sid);
    let name = "";
    let avatar = "";
    try {
        name = s(bot?.nickname) || s(bot?.info?.username);
        avatar = s(bot?.avatar) || s(bot?.info?.avatar);
    }
    catch {
        // nickname/avatar 是 getter，个别适配器实现可能抛；档案宁缺毋错
    }
    if (!avatar && (/^\d{5,12}$/.test(sid) || isQQBotAppId(sid)))
        avatar = `https://q.qlogo.cn/g?b=qq&s=100&nk=${sid}`;
    return { id: sid, name: name || sid, avatar, online: !!bot };
}
/**
 * 当前在线的机器人清单，供面板的「添加绑定」候选
 *
 * 与 yenai 相同：TRSS 的 Bot.uin 是数组（Object.assign([], …)），Miao 是单个数字。
 * 空串要滤掉：QQBot 的 token 拆分异常时可能出现 "" 账号。
 */
export function onlineBots() {
    const B = globalThis.Bot;
    if (!B)
        return [];
    const ids = Array.isArray(B.uin)
        ? [...new Set(Array.from(B.uin, x => s(x)))]
        : B.uin != null
            ? [s(B.uin)]
            : [];
    return ids.filter(Boolean).map(botProfile);
}
