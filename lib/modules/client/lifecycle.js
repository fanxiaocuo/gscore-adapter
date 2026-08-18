/**
 * 客户端生命周期
 */
import { config, configFile, enabled, getWsConnections, wsEnabled } from "../../config/index.js";
import { GsCoreClient } from "./GsCoreClient.js";
import { clients } from "./state.js";
import { onYunzaiMessage, onYunzaiNotice } from "./hooks.js";
import { expandConnections } from "./expand.js";
import { routeKey } from "../../utils/url.js";
import { makeLog } from "../../utils/compat.js";
let hooked = false;
/** 注册事件钩子（只注册一次） */
function hook() {
    if (hooked)
        return;
    Bot.on("message", onYunzaiMessage);
    Bot.on("notice", onYunzaiNotice);
    hooked = true;
}
/** 启动单个连接（同一路由已有客户端则跳过） */
export function startClient(conf) {
    if (conf.enable === false)
        return null;
    const rt = conf;
    const hasSourceIndex = Number.isInteger(rt.sourceIndex) && Number(rt.sourceIndex) >= 0;
    const sourceLabel = hasSourceIndex ? `连接 #${Number(rt.sourceIndex) + 1}` : "(未命名)";
    const name = rt.runtimeName || conf.name || sourceLabel;
    if (!conf.url) {
        makeLog("error", `连接 ${name} 缺少 url，已跳过`, "GsCore");
        return null;
    }
    // 去重按路由而不是按显示名：两条不同路由的连接可能显示名相同（都没写 name 的
    // 直传、或用户手写重名），按名字去重会把其中一条静默丢掉 —— 而它们连的是核心
    // 侧两个不同的客户端，都该起来。同路由才是真的不能起两条（后连上的顶掉先连上的）。
    const key = rt.runtimeKey || routeKey(rt.runtimeUrl || String(conf.url));
    if (clients.some(c => c.runtimeKey === key))
        return null;
    hook();
    const c = new GsCoreClient(conf);
    if (!rt.runtimeName && !conf.name)
        c.name = name;
    clients.push(c);
    c.connect();
    return c;
}
/**
 * 这条逻辑连接现在有几条运行时客户端在跑
 *
 * 各入口改完配置要回一句「运行时连接：N 条」，而它们过去报的是 `startSource()` 的
 * 返回值 —— **本次新起了几条**。收敛之后这两个数不再相等：一条没变的连接会被原地
 * 留着，新起数是 0，而它明明连着。报 0 就成了「已启用连接 X，但没有可起的运行时
 * 连接，请检查绑定账号」，把人打发去查一个不存在的问题。
 *
 * 所以话术要的一直是「现在有几条」，按 sourceIndex 现数即可。
 */
export function countSource(sourceIndex) {
    return clients.filter(c => c.sourceIndex === sourceIndex).length;
}
/**
 * 打展开诊断
 *
 * 级别按 skipped 分：bind/exclude 撞与共享 /ws/Yunzai 这两条之后连接照常跑，
 * 打成 error 会让一条正在正常收发的连接看着像坏了（面板上同一条曾经因此
 * 显示「已连接」却顶着「有连接没能启动」的红框）。
 *
 * @param only 只打属于这条来源的。面板每个开关都走一次展开，而展开必须喂完整
 *   列表 —— 早先是把全部错误重打一遍：点一下与本次操作无关的开关，控制台就再刷
 *   一遍别条连接的冲突报错，看着像刚出的新故障。别条的错误在启动时与面板整包里
 *   都给了，不靠这里重复。
 */
function logErrors(errors, only) {
    for (const error of errors)
        if (only === undefined || error.sourceIndex === only)
            makeLog(error.skipped ? "error" : "warn", error.message, "GsCore");
}
/**
 * 当前配置对应的目标计划
 *
 * 总开关关掉时目标就是「一条都不连」—— 让「关掉适配器」与「删光连接」在协调器
 * 眼里是同一件事，不必在每个调用点各写一次前置判断（漏写的那个就是「关了还在连」）。
 */
export function planClients(list = getWsConnections()) {
    if (!enabled() || !wsEnabled())
        return { runtime: [], errors: [] };
    return expandConnections(list);
}
/**
 * 这条客户端的连接行为是不是变了 —— 变了就只能停掉重起
 *
 * 分界线是「这个字段在什么时候被读」：
 *
 *   握手时读一次      runtimeUrl（含非 token 查询参数）、token、inlineToken
 *                    —— 见 GsCoreClient.connect。换 conf 只会让**下一次**重连用上
 *                    新值，而正在跑的这条还带着旧凭据，核心侧可能已经拒了它，
 *                    两边状态不一致且没有任何提示。
 *   每次用时现读      bind / exclude（accept 逐条消息读）、reconnect_interval /
 *                    max_reconnect_attempts（每次退避现读）—— 换掉 conf 引用就生效。
 *
 * 所以只有前一组进这个判断。为后一组断线是白丢消息：重连有 5 秒起步的退避，
 * 期间的上下行是真的没了。
 *
 * runtimeUrl 与 runtimeKey 的区别正在于查询参数：自定义路径那支会保留 `tenant`、
 * `access_token` 这类参数（见 utils/url.ts），它们进握手，所以要比全串。
 */
function behaviorChanged(client, next) {
    const cur = client.conf;
    if (client.target !== next.runtimeUrl)
        return true;
    if (String(cur.token ?? "") !== String(next.token ?? ""))
        return true;
    return (cur.inlineToken === true) !== (next.inlineToken === true);
}
/**
 * 把运行中的客户端收敛到目标计划
 *
 * 为什么要声明式的收敛，而不是各入口手工停起
 * ------
 * 原来每个配置入口自己组合 `stopSource(i)` + `shiftSourceIndex(i)` + `startSource(i)`。
 * 这套动作隐含「一次改动只影响被改的那一条」，而事实不是：
 *
 * - 路由仲裁是全局「前项优先」的（见 expand.ts 的 claim）。删掉第 1 条会**释放**
 *   它占的路由，第 2 条这才起得来 —— 而 stopSource(0) + shiftSourceIndex(0) 压根
 *   不会去起第 2 条。症状是「删掉了冲突的那条，被顶掉的那条还是不连」，得手动
 *   #早柚重连，而用户没有理由知道这一步。
 * - `连接 #N` 是按下标现拼的显示名，删掉前面一条之后后面每条都变 —— 客户端里存的
 *   还是旧名字，面板/状态图与配置对不上。
 * - 反过来，改个名字**不该**让一条正在正常收发的连接断线重连。
 *
 * 判据是 runtimeKey（规范化路由）而不是显示名：名字会随改名与下标位移变，
 * 路由不会。按名字比就会把一条没动过的连接判成「删掉旧的再起一条新的」。
 *
 * 顺序是先停后起，不能反
 * ------
 * 停掉的那条可能正占着新那条要用的路由（改地址、账号大小写换写法）。先起会撞上
 * startClient 的同路由去重而静默失败，然后旧那条才被停掉 —— 结果是两条都没了。
 */
export function reconcileClients(plan) {
    const ret = { started: 0, stopped: 0, restarted: 0, updated: 0, kept: 0 };
    // 计划本身按 runtimeKey 唯一（expand 的 claim 保证），这里 first-wins 只是防御：
    // 直接调协调器的调用方（测试、将来的新入口）不一定过 expand
    const want = new Map();
    for (const conn of plan)
        if (!want.has(conn.runtimeKey))
            want.set(conn.runtimeKey, conn);
    /** 已经由现存客户端认领的键，剩下的就是要新建的 */
    const adopted = new Set();
    /** 行为变了、停掉之后要按新配置重建的键。它们不算「新增」 */
    const restarting = new Set();
    for (let i = clients.length - 1; i >= 0; i--) {
        const client = clients[i];
        const next = want.get(client.runtimeKey);
        if (!next) {
            client.close();
            clients.splice(i, 1);
            ret.stopped++;
            continue;
        }
        if (behaviorChanged(client, next)) {
            // 不认领：这一轮的最后会按新配置重新建一个
            client.close();
            clients.splice(i, 1);
            restarting.add(client.runtimeKey);
            ret.restarted++;
            continue;
        }
        adopted.add(client.runtimeKey);
        const changed = client.name !== next.runtimeName ||
            client.sourceIndex !== next.sourceIndex ||
            client.account !== next.account;
        // conf 一律换成新的：懒读的那些字段（bind/exclude/重连参数）就这样生效
        client.conf = next;
        client.name = next.runtimeName;
        client.sourceIndex = next.sourceIndex;
        client.account = next.account;
        if (changed)
            ret.updated++;
        else
            ret.kept++;
    }
    // 按计划顺序起，客户端列表的次序才跟着配置走（面板与状态图直接按这个顺序展示）
    for (const conn of plan) {
        if (adopted.has(conn.runtimeKey))
            continue;
        if (startClient(conn) && !restarting.has(conn.runtimeKey))
            ret.started++;
    }
    return ret;
}
/**
 * 配置变更后的统一收敛入口
 *
 * 所有改配置的地方（指令、面板、锅巴、watcher）写盘之后调这一个函数。按来源精确
 * 停起的那套旧 API（`stopSource` / `startSource` / `shiftSourceIndex` / 按显示名的
 * `stopClient`）已经删掉，不是留着不用 —— 它们全都建立在「一次改动只影响被改的那
 * 一条」这个不成立的前提上（理由见 {@link reconcileClients}），留在导出面上迟早会
 * 有新入口照着用。手动重连仍在，那是客户端自己的 `restart()`，与收敛无关。
 *
 * @param sourceIndex 本次改动的来源序号，只用来收窄诊断日志的范围（见 {@link logErrors}）
 */
export function applyConnections(opts = {}) {
    const { runtime, errors } = planClients();
    logErrors(errors, opts.sourceIndex);
    return reconcileClients(runtime);
}
/** 按当前配置重建所有连接（用于 #早柚重载） */
export function reloadClients() {
    stopClients();
    startClients();
    return clients.length;
}
export function startClients() {
    hook();
    // 迁移提示要在起连接之前、且不受「有没有连接起来」影响
    // ------
    // 默认配置里带着一条示例 connections，而运行时是深合并的：配置只写了
    // 旧键 client.ws_connections（3.2 短暂用过的名字）时，connections 由默认值
    // 补齐 —— 于是连接**能起来**，起的却是默认那条 ws://127.0.0.1:8765/ws/Yunzai，
    // 用户自己那条地址/token/bind 全都没生效。
    //
    // 正常情况下 config/upgrade.ts 已在启动时把旧键迁回 connections，走到这里
    // 说明迁移没成功（多半是新旧两个键同时存在，那时不敢擅自合并）。
    if (Array.isArray(config.client?.ws_connections))
        makeLog("error", [
            "配置里的 client.ws_connections 是旧键名，已改回 client.connections，该键不再生效。",
            `请把其中的连接并入 client.connections 后删除该键（${configFile}）`,
        ].join("\n"), "GsCore");
    if (wsEnabled()) {
        const { runtime, errors } = planClients();
        logErrors(errors);
        reconcileClients(runtime);
    }
    if (clients.length) {
        makeLog("mark", `早柚核心客户端启动 ${clients.length} 个连接`, "GsCore");
        return;
    }
    makeLog("warn", "早柚核心客户端没有可用连接", "GsCore");
}
export function stopClients() {
    for (const c of clients)
        c.close();
    clients.length = 0;
}
