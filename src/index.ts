/**
 * 入口（真实逻辑）
 *
 * 由 index.js 转调，index.js 保持 .js 是因为框架 loader 只认
 * plugins/<name>/index.js（lib/plugins/loader.js:55）。
 */
import { config, configFile } from "@/config"
import { startClients } from "@/modules/client"
import { loadApps } from "@/modules/loader"

const mode = config.mode || "off"

// 服务端：import 时 push 到 Bot.adapter，与 plugins/adapter/*.js 同一时机。
// 不能等 online —— Bot.wsf 的注册必须在 adapter.load() 里完成。
if (mode === "server" || mode === "both") await import("@/modules/server")

// 客户端：适配器 load() 早于 online。此时 Bot.bots 通常还是空的，
// 早到的 MessageSend 会经 Proxy 兜底到随机一个 bot，把消息发错账号；
// 且在框架 lib/events/message.js 之前注册 Bot.on("message") 会把我们排到
// 监听器队列最前，正是 e.isMaster 尚未定义的那个顺序。
if (mode === "client" || mode === "both") Bot.once("online", () => startClients())

if (mode === "off") Bot.makeLog("warn", "早柚核心适配器已禁用（mode: off）", "GsCore")
else Bot.makeLog("info", `早柚核心适配器已载入，模式：${mode}`, "GsCore")

export const { apps } = await loadApps()

export { configFile }
