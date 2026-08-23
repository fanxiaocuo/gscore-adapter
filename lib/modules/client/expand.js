import { readIds } from "../../utils/ids.js";
import { isAutoYunzaiPath, materializeAccountUrl, normalizeEndpoint, routeKey, } from "../../utils/url.js";
/** @description bind 去重保序 - exclude，并报出两边都写了的账号 */
export function effectiveAccounts(conf) {
    const bind = readIds(conf.bind);
    const excluded = new Set(readIds(conf.exclude));
    const accounts = [];
    const conflicts = [];
    for (const id of bind) {
        if (excluded.has(id))
            conflicts.push(id);
        else
            accounts.push(id);
    }
    return { accounts, conflicts };
}
/**
 * @description 这条逻辑连接在日志、错误话术与运行时名字里的显示名
 * 注意：没起名字时用来源序号，绝不退回 url —— 地址可能内联 `?token=`，而这串既进日志也回前端
 */
export function sourceLabel(conf, sourceIndex) {
    return conf.name || `连接 #${sourceIndex + 1}`;
}
/**
 * @description 账号级运行时连接的显示名，也是计数分桶（stats.forName）的键
 * 注意：各展示点必须共用这一个拼法，自己拼的话症状是计数恒为 0 而连接显示正常，没有任何报错。
 * 注意：停起与复用按 {@link RuntimeWsConnection.runtimeKey} 比而不是按名字，否则改个名字就是一次无谓的断线重连。
 */
export function accountRuntimeName(label, account) {
    return `${label} [${account}]`;
}
function parseEndpoint(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:")
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/**
 * @description 把地址里的鉴权参数摘进配置字段，运行时目标本身不携带凭据
 * 有值的内联参数优先于 token 字段；空写的 `?token=` 不算提供凭据，只在 token 字段也为空时按原形状复现。
 * 注意：这里的 `searchParams.has` 问的是「有没有参数形状要复现」，utils/url.ts 的 inlineToken() 问的是
 * 「有没有凭据」，两者有意不同 —— 合并会得到「面板说已配 token，握手却发空 token」。
 */
function detachInlineToken(url, configured) {
    const present = url.searchParams.has("token");
    const inline = url.searchParams.get("token") || "";
    url.searchParams.delete("token");
    const wins = present && (!!inline || !String(configured ?? ""));
    return {
        runtimeUrl: url.toString(),
        ...(wins ? { token: inline, inlineToken: true } : {}),
    };
}
/** @description 自动端点仅指 pathname 为空或根路径；显式非根路径按自定义兼容连接处理 */
function isRootEndpoint(url) {
    return url.pathname === "" || url.pathname === "/";
}
/**
 * @description 是不是「自动端点」：地址能解析成 ws/wss 且 pathname 为空或根
 * 自动端点按有效账号逐条派生连接；非根路径只起一条兼容连接，bind 在它上头是转发过滤器而不是路由来源。
 * 两者对「改了 bind 之后要重启哪些客户端」的答案不一样，所以调用方需要能问这一句。
 */
export function isAutomaticEndpoint(conf) {
    const url = normalizeEndpoint(conf.url);
    if (!url)
        return false;
    const parsed = parseEndpoint(url);
    return !!parsed && isRootEndpoint(parsed);
}
/**
 * @description 自动端点必须至少有一个有效账号；通过返回 null，不通过返回给用户看的话术
 * 指令与面板共用这一入口，避免 bind/exclude 的有效账号规则漂移。
 */
export function requireAccounts(conf) {
    const url = normalizeEndpoint(conf.url);
    if (!url)
        return "缺少核心地址";
    const parsed = parseEndpoint(url);
    if (!parsed)
        return "核心地址无法解析或不是 WebSocket 地址";
    if (!isRootEndpoint(parsed))
        return null;
    if (effectiveAccounts(conf).accounts.length)
        return null;
    return ("自动连接至少要绑定一个机器人账号：核心侧的客户端标识就是 /ws/Yunzai-<账号>。\n" +
        "请用 bind=<账号> 指定；不想连了请停用或删除整条连接");
}
export function expandConnections(list) {
    const runtime = [];
    const errors = [];
    const taken = new Map();
    const named = new Map();
    /**
     * @description 认领一条运行时连接：路由与运行时名字都唯一才收下
     * 注意：runtimeKey 只在这里算一次并全程带着走，别让各 emit 点自己算 —— 分叉后的症状是
     * 冲突报了但客户端仍被复用，或反过来。
     */
    const claim = (conn) => {
        const key = routeKey(conn.runtimeUrl);
        const prev = taken.get(key);
        if (prev) {
            errors.push({
                // 记在被跳过的那条名下：留下的那条好好地跑着，起不来的是这一条
                sourceIndex: conn.sourceIndex,
                skipped: true,
                message: `连接路径冲突，已保留 ${prev.runtimeName}（来源 #${prev.sourceIndex + 1}），` +
                    `跳过 ${conn.runtimeName}（来源 #${conn.sourceIndex + 1}）。` +
                    `核心侧后连上的会顶掉先连上的，请检查绑定账号或自定义路径。`,
            });
            return;
        }
        /**
         * 运行时名字也必须唯一：路由唯一并不蕴含名字唯一
         *
         * 注意：{@link accountRuntimeName} 不含 host，两条同名连接绑同一账号却指向不同核心时 routeKey
         * 不撞而名字撞；名字是 stats.forName 的分桶键，重名会让两条连接的收发计数混在一起。
         * 注意：检查放在这里而不是各 edit 入口 —— 锅巴整表保存与手改 yaml 都绕得过入口，
         * 而这里是所有入口的必经之路。跳过而不自动改名，免得面板上的名字与配置对不上。
         */
        const namedAt = named.get(conn.runtimeName);
        if (namedAt !== undefined) {
            errors.push({
                sourceIndex: conn.sourceIndex,
                skipped: true,
                message: `运行时名字冲突：来源 #${namedAt + 1} 与来源 #${conn.sourceIndex + 1} ` +
                    `都叫 ${conn.runtimeName}，已跳过后者。名字是计数与展示的键，重名会让这一条的` +
                    `收发计数与另一条混在一起。请给其中一条连接改个名字。`,
            });
            return;
        }
        taken.set(key, { runtimeName: conn.runtimeName, sourceIndex: conn.sourceIndex });
        named.set(conn.runtimeName, conn.sourceIndex);
        runtime.push({ ...conn, runtimeKey: key });
    };
    list.forEach((conf, sourceIndex) => {
        if (conf.enable === false)
            return;
        const label = sourceLabel(conf, sourceIndex);
        // fail = 有运行时连接没起来；warn = 报出来但连接照常跑（见 ExpandError.skipped）
        const fail = (message) => errors.push({ sourceIndex, skipped: true, message });
        const warn = (message) => errors.push({ sourceIndex, skipped: false, message });
        const url = normalizeEndpoint(conf.url);
        if (!url) {
            fail(`连接 ${label} 缺少 url，已跳过`);
            return;
        }
        const parsed = parseEndpoint(url);
        if (!parsed) {
            fail(`连接 ${label} 的 url 无法解析或不是 WebSocket 地址，已跳过`);
            return;
        }
        const { accounts, conflicts } = effectiveAccounts(conf);
        if (conflicts.length) {
            warn(`连接 ${label} 的账号 ${conflicts.join("、")} 同时出现在 bind 与 exclude，按 exclude 处理`);
        }
        // 自定义路径与旧 Yunzai 路径只起一条兼容连接，路径原样不动。
        if (!isRootEndpoint(parsed)) {
            if (isAutoYunzaiPath(parsed.pathname) && !accounts.length) {
                warn(`连接 ${label} 仍使用共享路径 ${parsed.pathname}，多个机器人会互相顶掉。` +
                    `请改为只填 host:port 并补上绑定账号。`);
            }
            const { runtimeUrl, ...auth } = detachInlineToken(parsed, conf.token);
            claim({
                ...conf,
                ...auth,
                sourceIndex,
                account: null,
                runtimeName: label,
                runtimeUrl,
                automatic: false,
                bind: accounts,
            });
            return;
        }
        if (!accounts.length) {
            fail(`连接 ${label} 没有可用的绑定账号，已跳过。请至少绑定一个机器人账号。`);
            return;
        }
        // 根端点的内联凭据同样要摘进 token 字段，否则同一份配置写成自定义路径能连、写成核心地址连不上。
        // 注意：派生地址要从摘干净的 endpoint 上长出来，不能拿原串再走一遍 —— materializeAccountUrl
        // 有意保留无害查询参数（mode=、网关路由参数），清不掉凭据。它那边仍显式删 token，是第二道防线。
        const { runtimeUrl: endpoint, ...auth } = detachInlineToken(parsed, conf.token);
        for (const account of accounts) {
            let runtimeUrl;
            try {
                runtimeUrl = materializeAccountUrl(endpoint, account);
            }
            catch {
                fail(`连接 ${label} 的账号编码失败，已跳过`);
                continue;
            }
            claim({
                ...conf,
                ...auth,
                sourceIndex,
                account,
                runtimeName: accountRuntimeName(label, account),
                runtimeUrl,
                automatic: true,
                // 收窄成单账号：客户端 accept(self_id) 仍是最后防线。
                bind: [account],
            });
        }
    });
    return { runtime, errors };
}
