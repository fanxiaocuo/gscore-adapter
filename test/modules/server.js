/**
 * 服务端方向验证：模拟早柚核心作为 ws 客户端连入云崽
 * 运行：node plugins/gscore-adapter/test/server.js
 */
import { WebSocketServer, WebSocket } from "ws"

globalThis.logger = { red: s => s, blue: s => s, cyan: s => s, logger: {} }

const events = []
const logs = []

globalThis.Bot = {
  adapter: [],
  wsf: Object.create(null),
  bots: {},
  uin: [],
  makeLog(level, msg, id) {
    const s = Array.isArray(msg) ? msg.join(" ") : String(msg)
    logs.push(s)
    console.log(`  [${level}] ${id ? `<${id}> ` : ""}${s}`)
  },
  String(d) {
    if (typeof d === "string") return d
    try {
      return JSON.stringify(d)
    } catch {
      return String(d)
    }
  },
  async Buffer(f) {
    return Buffer.isBuffer(f) ? f : Buffer.from(String(f))
  },
  async fileToUrl() {
    return "http://127.0.0.1:2536/File/x"
  },
  makeForwardMsg: m => ({ type: "node", data: m }),
  em(name, data) {
    events.push({ name, data })
    console.log(`  Bot.em("${name}") user=${data.user_id} group=${data.group_id ?? "-"}`)
  },
  on() {},
  once() {},
}

globalThis.segment = {
  image: (file, name) => ({ type: "image", file, name }),
  at: qq => ({ type: "at", qq }),
  reply: id => ({ type: "reply", id }),
  file: (file, name) => ({ type: "file", file, name }),
  record: file => ({ type: "record", file }),
  video: file => ({ type: "video", file }),
  markdown: data => ({ type: "markdown", data }),
  button: (...data) => ({ type: "button", data }),
}

// Bot 是 Proxy：Bot[self_id] = x 要写进 Bot.bots
globalThis.Bot = new Proxy(globalThis.Bot, {
  get: (t, p) => t[p] ?? t.bots[p],
  set: (t, p, v) => {
    if (p in t) t[p] = v
    else t.bots[p] = v
    return true
  },
})

const { config } = await import("../../lib/config/index.js")
config.server = { ...config.server, path: "GsCore", id: "GsCore", name: "早柚核心" }

await import("../../lib/modules/server/index.js")
const adapter = Bot.adapter[0]
adapter.load()

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

console.log("\n=== 服务端：核心连入云崽 ===")
check("路由已注册", Array.isArray(Bot.wsf.GsCore) && Bot.wsf.GsCore.length === 1)

// 起一个 ws server，用注册好的处理器接管连接
const wss = new WebSocketServer({ port: 18766 })
wss.on("connection", ws => {
  // 框架 lib/bot.js 会挂这个方法；适配器现在不再走它（改为自己编码发帧），
  // 这里仍挂上，若被误用会被下面的断言抓到。
  ws.sendMsg = m => ws.send(typeof m === "string" ? m : JSON.stringify(m))
  for (const h of Bot.wsf.GsCore) h(ws)
})

const core = new WebSocket("ws://127.0.0.1:18766/GsCore")
const backToCore = []
// isBinary 是 ws 库给出的原始帧类型，用它验证下行帧
// 早柚核心 core.py 用 receive_bytes() 收，文本帧会被丢弃
const frames = []
core.on("message", (d, isBinary) => {
  frames.push(isBinary)
  backToCore.push(JSON.parse(d.toString()))
})
await new Promise(r => core.on("open", r))

// 核心上报一条群消息
core.send(
  JSON.stringify({
    bot_id: "mock",
    bot_self_id: "mockbot",
    msg_id: "m-1",
    user_type: "group",
    group_id: "12345",
    user_id: "99999",
    user_pm: 1,
    sender: { nickname: "tester" },
    content: [
      { type: "text", data: "#帮助" },
      { type: "image", data: "base64://aGk=" },
    ],
  }),
)
await new Promise(r => setTimeout(r, 400))

check("触发了 Bot.em", events.length >= 1, `events=${events.length}`)
const msgEvent = events.find(e => e.name === "message.group")
check("事件名为 message.group", !!msgEvent)
if (msgEvent) {
  const d = msgEvent.data
  check("gscore_origin 标记已打（回环防护）", d.gscore_origin === "GsCore", String(d.gscore_origin))
  check("复合 group_id", d.group_id === "group-12345", d.group_id)
  check("user_pm 透传到 sender", d.sender.user_pm === 1)
  check(
    "message 已归一化为对象",
    d.message.every(i => typeof i === "object" && i.type),
    JSON.stringify(d.message),
  )
  check(
    "image 段补了 url（dealEvent 读 i.url）",
    d.message.find(i => i.type === "image")?.url != null,
    JSON.stringify(d.message.find(i => i.type === "image")),
  )
  check("Bot 实例已注册", !!Bot.bots.mockbot)
}

// 回发：pickGroup(复合id).sendMsg 应拆回 target_type/target_id
console.log("\n=== 服务端：云崽回发给核心 ===")
await Bot.bots.mockbot.pickGroup("group-12345").sendMsg(["收到", { type: "at", qq: "99999" }])
await new Promise(r => setTimeout(r, 300))

check("核心收到 MessageSend", backToCore.length === 1, `count=${backToCore.length}`)
check("下行为二进制帧（core.py 用 receive_bytes 收）", frames[0] === true, `isBinary=${frames[0]}`)
if (backToCore.length) {
  const s = backToCore[0]
  console.log("  ->", JSON.stringify(s))
  check("复合 id 已拆回 target_type=group", s.target_type === "group", s.target_type)
  check("target_id 为真实群号", s.target_id === "12345", s.target_id)
  check(
    "content 段正确",
    s.content.map(i => i.type).join(",") === "text,at",
    s.content.map(i => i.type).join(","),
  )
}

// 私聊方向
await Bot.bots.mockbot.pickFriend("99999").sendMsg("私聊回复")
await new Promise(r => setTimeout(r, 300))
check(
  "私聊 target_type=direct",
  backToCore[1]?.target_type === "direct" && backToCore[1]?.target_id === "99999",
  JSON.stringify(backToCore[1]),
)
check("私聊下行同为二进制帧", frames[1] === true, `isBinary=${frames[1]}`)

core.close()
wss.close()

// ---- binary: false 逃生开关 ----
// 适配器每次发送时读 config.server.binary，所以直接改配置即可，
// 不用再靠带 query 的 import 拿独立模块实例。
console.log("\n=== 服务端：binary=false 退回文本帧 ===")
{
  config.server.binary = false

  const wss2 = new WebSocketServer({ port: 18767 })
  wss2.on("connection", ws => ws.on("message", d => adapter.message(d, ws)))

  const core2 = new WebSocket("ws://127.0.0.1:18767/")
  const frames2 = []
  core2.on("message", (d, isBinary) => frames2.push(isBinary))
  await new Promise(r => core2.on("open", r))

  core2.send(
    JSON.stringify({
      bot_id: "mock2",
      bot_self_id: "mockbot2",
      msg_id: "m-2",
      user_type: "direct",
      group_id: null,
      user_id: "88888",
      user_pm: 1,
      sender: { nickname: "t2" },
      content: [{ type: "text", data: "hi" }],
    }),
  )
  await new Promise(r => setTimeout(r, 400))

  await Bot.bots.mockbot2.pickFriend("88888").sendMsg("文本帧回复")
  await new Promise(r => setTimeout(r, 300))
  check("binary=false 时下行为文本帧", frames2[0] === false, `isBinary=${frames2[0]}`)

  core2.close()
  wss2.close()
}

console.log(`\n=== 结果：${pass} 通过，${fail} 失败 ===\n`)
process.exit(fail ? 1 : 0)
