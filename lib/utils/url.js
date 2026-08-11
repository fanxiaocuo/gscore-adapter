/**
 * 连接地址规范化
 *
 * 指令（apps/admin.ts）与 web 面板（modules/webadapter）都要用同一套规则，
 * 所以放在这儿而不是各写一份 —— 两处规则不一致时，同一个地址在两个入口
 * 会被存成不同的串，`find()` 按名字/序号定位又刚好看不出来。
 */
/**
 * 补全成完整的 ws 路由
 *
 * 允许只填 `host:port`：核心的路由是 `/ws/{bot_id}`，路径为空时按 `/ws/Yunzai` 补。
 * 解析不了就原样返回，交给下游报错 —— 这里不是校验入口。
 */
export function normalizeUrl(url) {
    if (!url)
        return "";
    url = String(url).trim();
    if (!/^wss?:\/\//i.test(url))
        url = `ws://${url}`;
    try {
        const u = new URL(url);
        if (u.pathname === "/" || u.pathname === "")
            u.pathname = "/ws/Yunzai";
        return u.toString();
    }
    catch {
        return url;
    }
}
/**
 * 校验并规范化，非法时抛错
 *
 * 面板收的是任意 HTTP 请求体，不能像指令那样默认使用者是主人且大致会写对。
 * 只放行 ws / wss：http 地址填进来连不上、且错误发生在重连循环里不易发现；
 * 而 `file:` 这类协议更是不该出现在配置里。
 */
export function requireWsUrl(url) {
    const s = normalizeUrl(url);
    if (!s)
        throw new Error("连接地址不能为空");
    let u;
    try {
        u = new URL(s);
    }
    catch {
        throw new Error(`连接地址无法解析：${url}`);
    }
    if (u.protocol !== "ws:" && u.protocol !== "wss:")
        throw new Error("连接地址仅支持 ws:// 或 wss://");
    return s;
}
