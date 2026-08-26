/**
 * @description 按账号取 Bot 实例与档案，对齐 yenai-plugin 的 `_getBotList` / `Bot[i]`
 * 注意：只读底层 `Bot.bots` 自有键，不走 TRSS 的 Proxy —— 它会优先返回框架/util 同名属性、
 * 并把未知属性重定向到在线实例，账号解析不能接受这两种兼容行为。
 * 注意：本文件的 s() 不能从 message.ts 引（那边 import 了 @/config，会成 config↔bots 的环）。
 * OneBotv11 先注册实例再异步填登录信息，所以 uin getter 可能暂时为空，只以注册表自有键为准。
 */
import { isQQBotAppId } from "./platform.js";
/** 安全字符串化：null/undefined 归空串 */
function s(v) {
    return v == null ? "" : String(v);
}
/**
 * @description 取某个账号的 Bot 实例，对不上返回 null，不拿别的号顶上
 * TRSS 只认 Bot.bots 的自有键；Miao 没有这张表，根 Bot.uin 与账号相等时根 Bot 就是该实例。
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
/** @description 纯数字 QQ 号 / QQBot appid 的形状 */
const QQ_NUMBER = /^\d{5,12}$/;
/**
 * @description 按 QQ 号取头像。号形状不对时回空串（调用方回退成首字圆）
 *
 * 两处渲染人脸的地方共用它：连接卡上的账号（{@link botProfile}）与面板选择器的候选
 * （webadapter 的 targetAvatar）。各写一份的话改了尺寸或域名只会改到一半，而 Avatar 组件
 * 加载失败会静默回退成首字圆 —— 半页新图半页旧图，没有任何报错。
 * 注意：这条**只认 QQ 号**。QQBot 的**用户** openid 绝不能走 `nk=`（那个参数只认 QQ 号，
 * 拿 `<appid>:<openid>` 去查会命中开头的 appid、于是每个用户都返回 Bot 自己那张头像），
 * 官方号的用户头像要 appid + openid 拼 `qqapp/` 那条。而 Bot **自己**（appid）走 `nk=` 是对的，
 * QQBot-Plugin 给 Bot 头像用的就是它
 */
export function qqAvatar(id, size = 100) {
    const sid = s(id);
    return QQ_NUMBER.test(sid) ? `https://q.qlogo.cn/g?b=qq&s=${size}&nk=${sid}` : "";
}
/**
 * @description 按账号取档案，离线账号也尽量给头像
 * 纯数字 QQ 号与官方 bot 的 appid 都能从 qlogo 按号取图。
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
    // isQQBotAppId 那一支是给形状特殊的 appid 兜的，QQ_NUMBER 认得的号由 qqAvatar 直接给
    if (!avatar && (QQ_NUMBER.test(sid) || isQQBotAppId(sid)))
        avatar = `https://q.qlogo.cn/g?b=qq&s=100&nk=${sid}`;
    return { id: sid, name: name || sid, avatar, online: !!bot };
}
/**
 * @description 当前在线的机器人清单，供面板的「添加绑定」候选
 * TRSS 的 Bot.uin 是数组、Miao 是单个数字；空串要滤掉（QQBot 的 token 拆分异常时会出现 "" 账号）。
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
