/**
 * @description 客户端生命周期
 */
import { config, configFile, enabled, getWsConnections, wsEnabled } from "../../config/index.js";
import { GsCoreClient } from "./GsCoreClient.js";
import { clients } from "./state.js";
import { onYunzaiMessage, onYunzaiNotice } from "./hooks.js";
import { expandConnections } from "./expand.js";
import { routeKey } from "../../utils/url.js";
import { makeLog } from "../../utils/compat.js";
let hooked = false;
/** @description 注册事件钩子（只注册一次） */
function hook() {
    if (hooked)
        return;
    Bot.on("message", onYunzaiMessage);
    Bot.on("notice", onYunzaiNotice);
    hooked = true;
}
/** @description 启动单个连接（同一路由已有客户端则跳过） */
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
    // 注意：去重按路由而不是按显示名 —— 两条不同路由的连接可能显示名相同，按名字去重会静默丢掉
    // 一条，而它们在核心侧是两个不同的客户端，都该起来。同路由才是真的不能起两条
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
 * @description 这条逻辑连接现在有几条运行时客户端在跑
 * 注意：各入口回话要的一直是「现在有几条」，不是「本次新起了几条」—— 一条没变的连接会被原地留着，
 * 新起数是 0，报 0 就成了「没有可起的运行时连接，请检查绑定账号」，把人打发去查一个不存在的问题。
 */
export function countSource(sourceIndex) {
    return clients.filter(c => c.sourceIndex === sourceIndex).length;
}
/**
 * @description 打展开诊断，级别按 skipped 分
 * 注意：bind/exclude 撞与共享 /ws/Yunzai 之后连接照常跑，打成 error 会让一条正在正常收发的连接看着像坏了。
 * @param only 只打属于这条来源的。面板每个开关都走一次展开，而展开必须喂完整列表 —— 全打一遍的话，
 *   点一下与本次操作无关的开关就会重刷别条连接的冲突报错，看着像刚出的新故障
 */
function logErrors(errors, only) {
    for (const error of errors)
        if (only === undefined || error.sourceIndex === only)
            makeLog(error.skipped ? "error" : "warn", error.message, "GsCore");
}
/**
 * @description 当前配置对应的目标计划
 * 总开关关掉时目标就是「一条都不连」—— 让「关掉适配器」与「删光连接」在协调器眼里是同一件事，
 * 不必在每个调用点各写一次前置判断（漏写的那个就是「关了还在连」）。
 */
export function planClients(list = getWsConnections()) {
    if (!enabled() || !wsEnabled())
        return { runtime: [], errors: [] };
    return expandConnections(list);
}
/**
 * @description 这条客户端的连接行为是不是变了 —— 变了就只能停掉重起
 * 分界线是「这个字段在什么时候被读」：握手时读一次的（runtimeUrl 含非 token 查询参数、token、inlineToken）
 * 进这个判断；每次用时现读的（bind/exclude、重连参数）换掉 conf 引用就生效，不必断线。
 * 注意：为后一组断线是白丢消息，重连有 5 秒起步的退避，期间的上下行是真的没了。
 * 注意：比 runtimeUrl 全串而不是 runtimeKey —— 自定义路径会保留 tenant、access_token 这类参数，它们进握手。
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
 * @description 把运行中的客户端收敛到目标计划
 * 声明式收敛而不是各入口手工停起：路由仲裁是全局「前项优先」的，删掉第 1 条会释放它占的路由、第 2 条这才
 * 起得来；`连接 #N` 是按下标现拼的显示名，删掉前面一条之后后面每条都变；而改个名字不该让一条正在正常收发
 * 的连接断线重连。
 * 注意：判据是 runtimeKey（规范化路由）而不是显示名 —— 名字会随改名与下标位移变，按名字比就会把一条没动过
 * 的连接判成「删掉旧的再起一条新的」。
 * 注意：顺序必须先停后起 —— 停掉的那条可能正占着新那条要用的路由，先起会撞上 startClient 的同路由去重而
 * 静默失败，结果两条都没了。
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
 * @description 配置变更后的统一收敛入口，所有改配置的地方写盘之后都调它
 * 注意：按来源精确停起的那套旧 API（stopSource / startSource / shiftSourceIndex）已删除而不是留着不用 ——
 * 它们都建立在「一次改动只影响被改的那一条」这个不成立的前提上（见 {@link reconcileClients}）。
 * @param sourceIndex 本次改动的来源序号，只用来收窄诊断日志的范围（见 {@link logErrors}）
 */
export function applyConnections(opts = {}) {
    const { runtime, errors } = planClients();
    logErrors(errors, opts.sourceIndex);
    return reconcileClients(runtime);
}
/** @description 按当前配置重建所有连接（reloadClients） */
export function reloadClients() {
    stopClients();
    startClients();
    return clients.length;
}
export function startClients() {
    hook();
    // 迁移提示要在起连接之前、且不受「有没有连接起来」影响：默认配置带着一条示例 connections，
    // 而运行时是深合并的 —— 只写了旧键 client.ws_connections 时连接能起来，起的却是默认那条，
    // 用户自己的地址/token/bind 全没生效。走到这里说明 config/upgrade.ts 的迁移没成功
    // （多半是新旧两个键同时存在，那时不敢擅自合并）。
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
