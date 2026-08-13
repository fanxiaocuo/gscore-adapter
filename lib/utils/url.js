/**
 * 连接地址规范化
 *
 * 指令（apps/admin.ts）与 web 面板（modules/webadapter）都要用同一套规则，
 * 所以放在这儿而不是各写一份 —— 两处规则不一致时，同一个地址在两个入口
 * 会被存成不同的串，`find()` 按名字/序号定位又刚好看不出来。
 */
/**
 * 路径段里允许出现的字符
 *
 * 核心把这一段直接当字典键（active_ws[bot_id]）与日志前缀用，不做任何转义，
 * 所以只放行确定安全的字符，其余一律换 `-`：账号本身可能带前缀（`tg_`、`qg_`）
 * 甚至冒号，落进 URL 路径会改变语义。
 */
function safeSeg(s) {
    return String(s).replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-+|-+$/g, "");
}
/**
 * 补全成完整的路由
 *
 * 允许只填 `host:port`：核心的路由是 `/ws/{bot_id}`，路径为空时按这里补。
 * 解析不了就原样返回，交给下游报错 —— 这里不是校验入口。
 *
 * 为什么补的这一段要带账号
 * --------------------
 * 原来一律补成 `/ws/Yunzai`，于是两个 Bot 连同一个核心时用的是同一个路径段。
 * 核心侧 `GsServer.connect()` 是 `self.active_ws[bot_id] = websocket` 无条件覆盖
 * （gsuid_core/server.py:490），active_bot 也是同一个键：后连上的把前一个的 socket
 * 顶掉，前者从此收不到下行消息，看起来就是「其他机器人不能同时连同个核心」。
 *
 * 这一段和协议里的 bot_id 是两件事，别混：
 *   - 路径段        —— 核心区分**连接**的键，就是这里补的东西
 *   - bot_id        —— MessageReceive 里的**平台**标识（onebot / qqgroup …）
 *   - bot_self_id   —— MessageReceive 里的**账号**
 * 后两者每条消息都由 toGscore 单独填，与路径段互不影响。
 *
 * 补路径不看协议
 * ------------
 * `http://host:port` 也会被补成 `/ws/Yunzai-<账号>`。这里不做协议校验（那是
 * requireWsUrl 的事），补完再交给它拒掉；而补过路径的完整地址正好让它能给出
 * 一个可以直接用的 ws:// 建议，不必拿半截 host:port 猜。
 *
 * @param url    用户填的地址
 * @param selfId 这条连接绑定的机器人账号，用来生成唯一路径段；留空则退回 `Yunzai`
 */
export function normalizeUrl(url, selfId) {
    if (!url)
        return "";
    url = String(url).trim();
    // 只在「没写协议」时补 ws://。原来是「不是 ws/wss 就补」，于是 http://h:1/ws 被
    // 拼成 ws://http//h:1/ws —— 一个能解析、host 是 "http" 的合法 URL，requireWsUrl
    // 的协议校验因此永远看到 ws: 而放行，连接直到重连循环里才失败。
    // 带协议的原样留下，交给 requireWsUrl/requireUrl 去校验
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url))
        url = `ws://${url}`;
    try {
        const u = new URL(url);
        if (u.pathname === "/" || u.pathname === "") {
            // 按账号补出唯一路径段
            const seg = selfId ? safeSeg(selfId) : "";
            u.pathname = seg ? `/ws/Yunzai-${seg}` : "/ws/Yunzai";
        }
        return u.toString();
    }
    catch {
        return url;
    }
}
/**
 * 找出与「同一地址 + 同一账号」冲突的既有连接
 *
 * 为什么不是按地址判重
 * ------------------
 * 原来两个入口都写 `list.some(c => c.url === url)`。多 Bot 共存时这是错的：在 A 号
 * 上加过 127.0.0.1:8765，再到 B 号上加同一个核心就被顶回「该地址已存在」，而用户
 * 想要的恰恰是第二条——两条连接地址相同、bind 各是一个账号，各转发自己那份消息。
 *
 * 判重的单位因此是 (核心, 账号)：同一个核心且账号集合有交集才算重复。bind 为空
 * 表示「不限账号」，与任何账号都算交集（它已经把那个账号的消息带进这个核心了）。
 *
 * 「同一个核心」按 origin 比，不是按整个 URL
 * -------------------------------------
 * 路径段现在带账号（见 normalizeUrl），两条指向同一个核心的连接 URL 本来就不同，
 * 比整串等于永远不重复。更具体地：老配置里那条是 `/ws/Yunzai`，同一个账号再加一次
 * 会补出 `/ws/Yunzai-<账号>`，字符串不等 —— 判重就漏了，用户会拿到两条连着同一个
 * 核心的连接，每条消息进去两遍。
 *
 * @param list 既有连接
 * @param url  已 normalizeUrl 过的地址
 * @param bind 新连接的账号白名单，空数组 = 不限
 * @returns 冲突的那条，没有则 undefined
 */
export function findDuplicate(list, url, bind) {
    const want = new Set(bind.map(String));
    const target = coreKey(url);
    return list.find(c => {
        if (coreKey(c.url) !== target)
            return false;
        const has = (Array.isArray(c.bind) ? c.bind : []).map(String);
        // 任一侧不限账号 -> 覆盖对方，算重复
        if (!has.length || !want.size)
            return true;
        return has.some(id => want.has(id));
    });
}
/**
 * 一个核心的身份：协议 + 主机 + 端口
 *
 * 路径段不参与 —— 它现在标的是「哪个 Bot 的连接」而不是「哪个核心」。token 也不参与：
 * 同一个核心换个 token 仍是同一个核心。解析不了就退回原串比较。
 */
function coreKey(url) {
    if (!url)
        return "";
    try {
        return new URL(String(url)).origin.toLowerCase();
    }
    catch {
        return String(url).trim().toLowerCase();
    }
}
/**
 * 校验并规范化，非法时抛错
 *
 * 两个添加入口（apps/admin 的 add、webadapter 的 addConnection）都只走这一个门，
 * 面板尤其需要：它收的是任意 HTTP 请求体，不能像指令那样默认使用者是主人且大致
 * 会写对。
 *
 * 为什么必须在这里拦掉 http://
 * -------------------------
 * `http://` 落盘后**不会**在建连时报协议错：ws@8 会把 `http:` 改写成 `ws:`
 * （node_modules/ws/lib/websocket.js:700-704），于是它变成一次朝那个地址发起的
 * WebSocket 握手。本机实测拿到 403，接着进重连循环，而日志里没有一句说得出
 * 协议填错了 —— 用户会去查网络、查 token、查防火墙。所以宁可在入口拒掉，
 * 并把地址换算成 ws 形式一起给出去。
 */
export function requireWsUrl(url, selfId) {
    const s = normalizeUrl(url, selfId);
    if (!s)
        throw new Error("连接地址不能为空");
    let u;
    try {
        u = new URL(s);
    }
    catch {
        throw new Error(`连接地址无法解析：${url}`);
    }
    if (u.protocol === "http:" || u.protocol === "https:")
        throw new Error(`不支持 http://，早柚核心只能用 WebSocket 连。请改用：${s.replace(/^http/i, "ws")}`);
    if (!["ws:", "wss:"].includes(u.protocol))
        throw new Error("连接地址仅支持 ws:// / wss://");
    return s;
}
