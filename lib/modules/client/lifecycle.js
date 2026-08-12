/**
 * 客户端生命周期
 */
import { config, configFile, getWsConnections, wsEnabled } from "../../config/index.js";
import { GsCoreClient } from "./GsCoreClient.js";
import { clients } from "./state.js";
import { onYunzaiMessage, onYunzaiNotice } from "./hooks.js";
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
/** 启动单个连接（已存在同名则跳过） */
export function startClient(conf) {
    if (conf.enable === false)
        return null;
    if (!conf.url) {
        makeLog("error", `连接 ${conf.name || "(未命名)"} 缺少 url，已跳过`, "GsCore");
        return null;
    }
    if (clients.some(c => c.name === (conf.name || conf.url)))
        return null;
    hook();
    const c = new GsCoreClient(conf);
    clients.push(c);
    c.connect();
    return c;
}
/** 停止并移除单个连接 */
export function stopClient(name) {
    const idx = clients.findIndex(c => c.name === name);
    if (idx === -1)
        return false;
    clients[idx].close();
    clients.splice(idx, 1);
    return true;
}
/** 按当前配置重建所有连接（用于 #早柚重载） */
export function reloadClients() {
    stopClients();
    startClients();
    return clients.length;
}
export function startClients() {
    hook();
    if (wsEnabled()) {
        for (const conf of getWsConnections())
            startClient(conf);
    }
    if (clients.length) {
        makeLog("mark", `早柚核心客户端启动 ${clients.length} 个连接`, "GsCore");
        return;
    }
    // 一条连接都没起来时，先看是不是配置还停在 3.1 之前的 client.connections。
    // 那个字段不再被读取（3.2 改名为 ws_connections），光说「没有可用连接」的话
    // 用户会去查网络，而配置文件里明明写着一条连接。
    if (Array.isArray(config.client?.connections))
        makeLog("error", [
            "配置里的 client.connections 已废弃，不再生效。",
            `请把它改名为 client.ws_connections（${configFile}），或发 #早柚添加连接 <地址> 重新添加`,
        ].join("\n"), "GsCore");
    else
        makeLog("warn", "早柚核心客户端没有可用连接", "GsCore");
}
export function stopClients() {
    for (const c of clients)
        c.close();
    clients.length = 0;
}
