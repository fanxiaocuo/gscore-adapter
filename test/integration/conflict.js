/**
 * 路由冲突检测验证
 * 不触碰用户的 config.yaml —— 直接篡改已加载的 config 对象
 * 运行：node plugins/gscore-adapter/test/conflict.js
 */

globalThis.logger = { red: s => s, blue: s => s, cyan: s => s, logger: {} }

const logs = []
globalThis.Bot = {
  adapter: [],
  wsf: Object.create(null),
  bots: {},
  uin: [],
  makeLog(level, msg) {
    const s = Array.isArray(msg) ? msg.join(" ") : String(msg)
    logs.push(`[${level}] ${s}`)
    console.log(`  [${level}] ${s}`)
  },
  on() {},
  once() {},
}
globalThis.segment = { reply: id => ({ type: "reply", id }) }

// 在 server.js 读取 config 之前，把 server.path 改成与既有适配器相同
const { config } = await import("../../lib/config/index.js")
config.server = { ...config.server, path: "GSUIDCore", id: "GsCore", on_conflict: "abort" }

// 模拟 plugins/adapter/GSUIDCore.js 已占用该路由
Bot.adapter.push({
  id: "GSUIDCore",
  name: "早柚核心",
  path: "GSUIDCore",
  load() {
    Bot.wsf.GSUIDCore = [() => {}]
  },
})
Bot.adapter[0].load()

console.log("\n=== 路由冲突检测（on_conflict: abort）===")
await import("../../lib/modules/server/index.js")
await Bot.adapter[1].load()

const conflicted = logs.some(l => l.includes("已被占用"))
const aborted = logs.some(l => l.includes("已放弃注册"))
const handlers = Bot.wsf.GSUIDCore.length

console.log(`\n  处理器数量：${handlers}`)
const ok = conflicted && aborted && handlers === 1
console.log(
  ok
    ? "  \x1b[32mPASS\x1b[0m 检测到冲突并放弃注册，路由未被重复绑定"
    : `  \x1b[31mFAIL\x1b[0m conflicted=${conflicted} aborted=${aborted} handlers=${handlers}`,
)

// force 模式应仍然注册
console.log("\n=== on_conflict: force ===")
const forced = Bot.adapter[1]
config.server.on_conflict = "force"
Object.assign(forced, { path: "GSUIDCore" })
await forced.load()
console.log(`\n  处理器数量：${Bot.wsf.GSUIDCore.length}`)
console.log(
  Bot.wsf.GSUIDCore.length === 2
    ? "  \x1b[32mPASS\x1b[0m force 模式下仍然注册（会双重处理，符合预期）"
    : "  \x1b[31mFAIL\x1b[0m",
)

process.exit(ok && Bot.wsf.GSUIDCore.length === 2 ? 0 : 1)
