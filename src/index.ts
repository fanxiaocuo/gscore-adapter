/**
 * 入口（真实逻辑）
 *
 * 由 index.js 转调，index.js 保持 .js 是因为框架 loader 只认
 * plugins/<name>/index.js（lib/plugins/loader.js:55）。
 */
import { configFile, enabled, markOnline, onConfigReload } from "@/config"
import { startClients, stopClients } from "@/modules/client"
import { loadApps } from "@/modules/loader"
import { checkConflicts } from "@/modules/conflict"
import { initStats } from "@/modules/stats"
import { initPassive } from "@/modules/passive"
import { makeLog } from "@/utils/compat"

// 适配器 load() 早于 online。此时还没有登录号，在全局 Bot 上调发送方法
// 会经 Proxy 重定向到 this.uin.toJSON()（0 个号是空串，3 个以上会抽一个），
// 把消息发错账号。
// `Bot[e.self_id]` 本身是该账号的实例（Proxy 的 target 就是 this.bots），
// 事件路径没问题；危险的是不带账号键、把全局 Bot 当某个号用。
// 且在框架 lib/events/message.js 之前注册 Bot.on("message") 会把我们排到
// 监听器队列最前，正是 e.isMaster 尚未定义的那个顺序。
//
// 所以连接一律等 online 再拉起。下面的热切换同样受这条约束：online 之前
// 把 enable 改成 true 只更新意图，真正的 startClients 仍由这个钩子发起。
let online = false
Bot.once("online", () => {
  online = true
  // 配置 watcher 那边也在等这一刻：手改 yaml 要收敛跑着的连接，而它在
  // online 之前必须一条都不碰（理由同上）。它自己 import 不到这个时点 ——
  // config 是最底层模块，求值时 Bot 未必装好，见 markOnline 上面的说明
  markOnline()
  if (!enabled()) return
  // 放在 startClients 之前：先让"可能重复上报"的告警出现在连接日志上方，
  // 用户看到"已连接"时才不会以为一切正常。checkConflicts 内部自带兜底，
  // 不会因读不到别人的配置而中断启动。
  checkConflicts()
  startClients()
})

// enable 热生效
// ------
// 原来这里是 `const on = enabled()`：启用与否在模块求值那一刻定死，之后无论
// 从指令、锅巴还是直接编辑 yaml 改它，都要重启云崽才算数。而「关掉总开关」
// 恰恰是出问题时最想立刻做的事，让人去重启整个框架并不合理。
//
// 现在改成跟着配置走。config 的 watcher 与 saveConfig 都会走到 onConfigReload，
// 所以三条改配置的路径（指令 / 锅巴 / 手改文件）自动都热生效。
//
// 只在**跨越**开关时动作：reload 会因为任何一项配置改动而触发，若每次都
// stop+start，改个 media_max_size 都会把所有连接断一遍。
let last = enabled()
onConfigReload(() => {
  const now = enabled()
  if (now === last) return
  last = now

  // online 之前不碰连接：此时还没有登录号，在全局 Bot 上发消息会发错账号，
  // 上面的钩子会在 online 时按最新的 enabled() 决定拉不拉起
  if (!online) return

  if (now) {
    checkConflicts()
    startClients()
    makeLog("mark", "适配器已启用（enable: true），连接已拉起", "GsCore")
  } else {
    stopClients()
    makeLog("mark", "适配器已禁用（enable: false），连接已全部断开", "GsCore")
  }
})

// 中转计数的历史必须在连接建立前灌进内存：晚于 startClients 的话，
// 先到的几条消息会被随后的 load 覆盖。initStats 内部不抛，
// 数据库不可用时自动退化成纯内存计数。
await initStats()

// 被动回复的会话记录同理：晚于 startClients 时，重启后 4 分半窗口内的下发会全部
// 不带 id，回复掉出引用形态。内部同样不抛。
await initPassive()

if (enabled()) makeLog("info", "早柚核心适配器已载入", "GsCore")
else makeLog("warn", "早柚核心适配器已禁用（enable: false，改配置即时生效）", "GsCore")

// 更新检查不在这里排期：它走本体的 task 机制，由 apps/update.ts 的 task 字段声明，
// 开关与间隔在 tick() 里按配置判，改配置即刻生效，无需重启。

export const { apps } = await loadApps()

export { configFile }
