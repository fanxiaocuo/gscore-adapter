/**
 * 入口（真实逻辑）
 *
 * 由 index.js 转调，index.js 保持 .js 是因为框架 loader 只认
 * plugins/<name>/index.js（lib/plugins/loader.js:55）。
 */
import { config, configFile } from "@/config"
import { startClients } from "@/modules/client"
import { loadApps } from "@/modules/loader"

let mode = config.mode || "off"

// server / both 已移除：早柚核心 core.py 只有入站路由 @app.websocket("/ws/{bot_id}")，
// gss.connect() 首句即 websocket.accept()，全仓库没有任何出站连接——
// 核心永远不会主动来连云崽，服务端方向注册了也收不到东西。
// 老配置不报错、不静默，按 client 继续跑并提示改配置。
if (mode === "server" || mode === "both") {
  Bot.makeLog(
    "warn",
    `mode: ${mode} 已废弃（早柚核心不会主动连接云崽），已按 client 运行。请把配置改为 mode: client`,
    "GsCore",
  )
  mode = "client"
}

// 适配器 load() 早于 online。此时 Bot.bots 通常还是空的，
// 早到的 MessageSend 会经 Proxy 兜底到随机一个 bot，把消息发错账号；
// 且在框架 lib/events/message.js 之前注册 Bot.on("message") 会把我们排到
// 监听器队列最前，正是 e.isMaster 尚未定义的那个顺序。
if (mode === "client") Bot.once("online", () => startClients())

if (mode === "client") Bot.makeLog("info", "早柚核心适配器已载入", "GsCore")
else Bot.makeLog("warn", "早柚核心适配器已禁用（mode: off）", "GsCore")

export const { apps } = await loadApps()

export { configFile }
