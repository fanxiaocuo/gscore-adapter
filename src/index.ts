/**
 * 入口（真实逻辑）
 *
 * 由 index.js 转调，index.js 保持 .js 是因为框架 loader 只认
 * plugins/<name>/index.js（lib/plugins/loader.js:55）。
 */
import { configFile, enabled } from "@/config"
import { startClients } from "@/modules/client"
import { loadApps } from "@/modules/loader"
import { checkConflicts } from "@/modules/conflict"
import { initStats } from "@/modules/stats"
import { initPassive } from "@/modules/passive"
import { makeLog } from "@/utils/compat"

// 启用与否在加载时定下：连接只在 online 时拉起，改配置后要重启才生效。
// 老配置的 mode: client/off（以及更早的 server/both）已由 config/upgrade.ts
// 在读取前迁成 enable，这里不必再认那个字段。
const on = enabled()

// 适配器 load() 早于 online。此时 Bot.bots 通常还是空的，
// 早到的 MessageSend 会经 Proxy 兜底到随机一个 bot，把消息发错账号；
// 且在框架 lib/events/message.js 之前注册 Bot.on("message") 会把我们排到
// 监听器队列最前，正是 e.isMaster 尚未定义的那个顺序。
if (on)
  Bot.once("online", () => {
    // 放在 startClients 之前：先让"可能重复上报"的告警出现在连接日志上方，
    // 用户看到"已连接"时才不会以为一切正常。checkConflicts 内部自带兜底，
    // 不会因读不到别人的配置而中断启动。
    checkConflicts()
    startClients()
  })

// 中转计数的历史必须在连接建立前灌进内存：晚于 startClients 的话，
// 先到的几条消息会被随后的 load 覆盖。initStats 内部不抛，
// 数据库不可用时自动退化成纯内存计数。
await initStats()

// 被动回复的会话记录同理：晚于 startClients 时，重启后 4 分半窗口内的下发会全部
// 不带 id，回复掉出引用形态。内部同样不抛。
await initPassive()

if (on) makeLog("info", "早柚核心适配器已载入", "GsCore")
else makeLog("warn", "早柚核心适配器已禁用（enable: false）", "GsCore")

// 更新检查不在这里排期：它走本体的 task 机制，由 apps/update.ts 的 task 字段声明，
// 开关与间隔在 tick() 里按配置判，改配置即刻生效，无需重启。

export const { apps } = await loadApps()

export { configFile }
