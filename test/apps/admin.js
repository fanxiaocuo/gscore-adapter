/**
 * 命令插件验证：增删改查 ws 连接 + yaml 注释保留
 * 在临时副本上操作，不动用户的 config.yaml
 * 运行：node plugins/gscore-adapter/test/admin.js
 */
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

// 路径由本文件位置推出，不用 process.cwd() 拼 plugins/gscore-adapter —— 那样
// 只有从框架根目录启动才对，直接 node test/apps/admin.js 会拼出双层路径
const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const realUser = path.join(pluginDir, "config", "config.yaml")
const tmpFile = path.join(os.tmpdir(), `gscore-test-${process.pid}.yaml`)
// 关键：在 import config 之前指向临时文件，绝不碰用户的 config.yaml
process.env.GSCORE_CONFIG = tmpFile

// 用默认配置初始化临时文件（config 模块找不到时会自己复制，这里显式一点）
fs.copyFileSync(path.join(pluginDir, "resources", "config", "default_config.yaml"), tmpFile)
const realBefore = fs.existsSync(realUser) ? fs.readFileSync(realUser, "utf8") : null

const userFile = tmpFile
function cleanup() {
  try {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
  } catch {}
}
process.on("exit", cleanup)

globalThis.logger = { red: s => s, blue: s => s, cyan: s => s, logger: {} }
globalThis.Bot = {
  adapter: [],
  wsf: Object.create(null),
  bots: {},
  uin: [],
  makeLog(level, msg, id) {
    console.log(`  [${level}] ${id ? `<${id}> ` : ""}${Array.isArray(msg) ? msg.join(" ") : msg}`)
  },
  String: d => (typeof d === "string" ? d : JSON.stringify(d)),
  on() {},
  once() {},
}
globalThis.segment = { reply: id => ({ type: "reply", id }) }

// plugin 基类桩
globalThis.plugin = class {
  constructor(opts) {
    Object.assign(this, opts)
  }
}

let pass = 0
let fail = 0
const check = (n, c, d) => {
  if (c) {
    pass++
    console.log(`  \x1b[32mPASS\x1b[0m ${n}`)
  } else {
    fail++
    console.log(`  \x1b[31mFAIL\x1b[0m ${n}${d ? ` — ${d}` : ""}`)
  }
}

const { config, getConnections } = await import("../../lib/config/index.js")
// 关掉客户端，避免测试真的去建立 ws 连接
config.mode = "off"
const Admin = (await import("../../lib/apps/admin.js")).default
const a = new Admin()

// 收集回复
let replied = ""
const mkEvent = msg => ({ msg, reply: t => ((replied = t), true) })

const before = getConnections().length

console.log("\n=== 添加连接 ===")
await a.add(mkEvent("#早柚添加连接 ws://127.0.0.1:9001/ws/Test name=测试核心 token=abc123"))
console.log(`  回复：${replied.replace(/\n/g, " / ")}`)

let list = getConnections()
check("连接数 +1", list.length === before + 1, `${before} -> ${list.length}`)
const added = list.find(c => c.name === "测试核心")
check("名字正确", !!added)
check("地址正确", added?.url === "ws://127.0.0.1:9001/ws/Test", added?.url)
check("token 已存", added?.token === "abc123", added?.token)
check("默认 enable=true", added?.enable === true)

console.log("\n=== yaml 注释是否保留 ===")
const yamlText = fs.readFileSync(userFile, "utf8")
check("顶部注释保留", yamlText.includes("早柚核心适配器 (gscore-adapter) 配置"))
check("运行模式注释保留", yamlText.includes("#   client : 云崽主动连接早柚核心"))
check("过滤段注释保留", yamlText.includes("仅在被 @ 或带前缀时才上报群消息"))
check("bot_id_map 注释保留", yamlText.includes("把云崽适配器 id 映射为早柚核心认识的 bot_id"))

console.log("\n=== 地址自动补全 ===")
await a.add(mkEvent("#早柚添加连接 192.168.1.10:8765 name=简写"))
const shortOne = getConnections().find(c => c.name === "简写")
check("host:port 自动补 ws:// 与 /ws/Yunzai", shortOne?.url === "ws://192.168.1.10:8765/ws/Yunzai", shortOne?.url)

console.log("\n=== 重复地址拒绝 ===")
await a.add(mkEvent("#早柚添加连接 ws://127.0.0.1:9001/ws/Test"))
check("重复地址被拒绝", replied.includes("已存在"), replied)

console.log("\n=== 连接列表 ===")
await a.list(mkEvent("#早柚连接列表"))
check("列表含新连接", replied.includes("测试核心") && replied.includes("简写"))
check("列表显示模式", replied.includes(`模式：${config.mode}`))

console.log("\n=== 停用 / 启用 ===")
await a.disable(mkEvent("#早柚关闭连接 测试核心"))
check("停用后 enable=false", getConnections().find(c => c.name === "测试核心")?.enable === false)
await a.enable(mkEvent("#早柚开启连接 测试核心"))
check("启用后 enable=true", getConnections().find(c => c.name === "测试核心")?.enable === true)

console.log("\n=== 按序号操作 ===")
const total = getConnections().length
await a.disable(mkEvent(`#早柚关闭连接 ${total}`))
check("序号定位生效", getConnections()[total - 1].enable === false)

console.log("\n=== 设置项 ===")
await a.set(mkEvent("#早柚设置 only_reply_at=true"))
check("only_reply_at 已改", config.filter.only_reply_at === true)
// server / both 已移除，client 与 off 是仅剩的两个合法值。
// 起始为 off（见上方），改成 client 才是一次真实的变更
await a.set(mkEvent("#早柚设置 mode=client"))
check("mode 已改", config.mode === "client", config.mode)
await a.set(mkEvent("#早柚设置 mode=both"))
check("已废弃的 both 被拒绝", replied.includes("失败") || replied.includes("只能是"), replied)
await a.set(mkEvent("#早柚设置 mode=nonsense"))
check("非法 mode 被拒绝", replied.includes("失败") || replied.includes("只能是"), replied)
check("非法值未写入", config.mode === "client", config.mode)
await a.set(mkEvent("#早柚设置 media_max_size=100"))
check("过小的 media_max_size 被拒绝", config.media_max_size !== 100)

console.log("\n=== 删除连接 ===")
await a.del(mkEvent("#早柚删除连接 测试核心"))
check("删除成功", !getConnections().some(c => c.name === "测试核心"))
await a.del(mkEvent("#早柚删除连接 不存在的名字"))
check("删除不存在的连接给出提示", replied.includes("找不到"), replied)

console.log("\n=== 帮助 ===")
await a.help(mkEvent("#早柚帮助"))
check("帮助含添加连接用法", replied.includes("#早柚添加连接"))

console.log("\n=== 用户真实配置未被触碰 ===")
const realAfter = fs.existsSync(realUser) ? fs.readFileSync(realUser, "utf8") : null
check("plugins/gscore-adapter/config/config/config.yaml 原封不动", realAfter === realBefore)
cleanup()

console.log(`\n=== 结果：${pass} 通过，${fail} 失败 ===\n`)
process.exit(fail ? 1 : 0)
