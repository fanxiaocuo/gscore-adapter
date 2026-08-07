/**
 * gscore-adapter 端到端验证
 * 用 mock 早柚核心 + 桩 Bot 全局，跑真实的 convert.js / client.js
 * 运行：node plugins/gscore-adapter/test/e2e.js
 */
import { WebSocketServer } from "ws"

/* ==================== 桩 Bot / segment / logger ==================== */

const logs = []
const sent = [] // 被"发送"出去的消息

globalThis.logger = {
  red: s => s,
  blue: s => s,
  cyan: s => s,
  logger: {},
}

const bots = {}

globalThis.Bot = {
  bots,
  uin: ["10001"],
  adapter: [],
  wsf: Object.create(null),
  makeLog(level, msg, id) {
    logs.push({ level, msg: Array.isArray(msg) ? msg.join(" ") : String(msg), id })
    console.log(`  [${level}] ${id ? `<${id}> ` : ""}${Array.isArray(msg) ? msg.join(" ") : msg}`)
  },
  String(d) {
    if (typeof d === "string") return d
    try {
      return JSON.stringify(d)
    } catch {
      return String(d)
    }
  },
  async Buffer(file, opts = {}) {
    if (Buffer.isBuffer(file)) return file
    const s = String(file)
    if (s.startsWith("base64://")) return Buffer.from(s.slice(9), "base64")
    if (/^https?:\/\//.test(s)) return opts.http ? s : Buffer.from("fake-remote")
    return Buffer.from(`fake:${s}`)
  },
  async fileToUrl(file, opts = {}) {
    return `http://127.0.0.1:2536/File/${opts.name || "x"}`
  },
  makeForwardMsg(msg) {
    return { type: "node", data: msg }
  },
  pickFriend(id) {
    return {
      sendMsg: m => {
        sent.push({ kind: "friend", id, msg: m })
        return { message_id: "f1" }
      },
    }
  },
  pickGroup(id) {
    return {
      sendMsg: m => {
        sent.push({ kind: "group", id, msg: m })
        return { message_id: "g1" }
      },
    }
  },
  on() {},
  once() {},
  sendMasterMsg: async () => {},
}

globalThis.segment = {
  custom: (type, data) => ({ type, ...data }),
  raw: data => ({ type: "raw", data }),
  button: (...data) => ({ type: "button", data }),
  markdown: data => ({ type: "markdown", data }),
  image: (file, name) => ({ type: "image", file, name }),
  at: (qq, name) => ({ type: "at", qq, name }),
  record: (file, name) => ({ type: "record", file, name }),
  video: (file, name) => ({ type: "video", file, name }),
  file: (file, name) => ({ type: "file", file, name }),
  reply: (id, text, qq, time, seq) => ({ type: "reply", id, text, qq, time, seq }),
}

/* ==================== 断言 ==================== */

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`)
  } else {
    fail++
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

/* ==================== 开始 ==================== */

const { yunzaiToGscore, gscoreToYunzai, msgToGscore } = await import("../../lib/modules/convert/index.js")

console.log("\n=== 1. 上行：云崽事件 -> MessageReceive ===")

const groupEvent = {
  post_type: "message",
  message_type: "group",
  self_id: "10001",
  user_id: "20002",
  group_id: "30003",
  message_id: "msg-1",
  sender: { user_id: "20002", nickname: "测试", role: "admin" },
  message: [
    { type: "at", qq: "10001" },
    { type: "text", text: "#原神深渊" },
    { type: "image", url: "https://example.com/a.png", width: 100, height: 200 },
  ],
}

const up = await yunzaiToGscore(groupEvent, "onebot", { isMaster: false })
console.log("  ->", JSON.stringify(up).slice(0, 300))

check("bot_id/bot_self_id 正确", up.bot_id === "onebot" && up.bot_self_id === "10001")
check("user_type=group + group_id", up.user_type === "group" && up.group_id === "30003")
check("群管理 user_pm=3", up.user_pm === 3, `实际 ${up.user_pm}`)
check("msg_id 为字符串", up.msg_id === "msg-1")
check(
  "content 段序正确 at/text/image/image_size",
  up.content.map(i => i.type).join(",") === "at,text,image,image_size",
  up.content.map(i => i.type).join(","),
)
check("远程图片走 link://", up.content[2].data.startsWith("link://https://"), up.content[2].data)
check("image_size 携带宽高", JSON.stringify(up.content[3].data) === "[100,200]")

const upMaster = await yunzaiToGscore(groupEvent, "onebot", { isMaster: true })
check("主人在群里也是 user_pm=1（短路）", upMaster.user_pm === 1, `实际 ${upMaster.user_pm}`)

const upPrivate = await yunzaiToGscore(
  { ...groupEvent, message_type: "private", group_id: undefined },
  "onebot",
  {},
)
check(
  "私聊 user_type=direct 且 group_id 为空",
  upPrivate.user_type === "direct" && upPrivate.group_id === null,
)
check("普通成员 user_pm=6", upPrivate.user_pm === 6)

// 引用消息置顶
const upQuote = await yunzaiToGscore({ ...groupEvent, source: { message_id: "src-9" } }, "onebot", {})
check(
  "引用消息作为 content 首元素",
  upQuote.content[0].type === "reply" && upQuote.content[0].data === "src-9",
)

// 小图走 base64
const upB64 = await msgToGscore([{ type: "image", file: "base64://aGVsbG8=" }])
check("本地图片走 base64://", upB64[0].data.startsWith("base64://"), upB64[0].data)

console.log("\n=== 2. 下行：MessageSend -> 云崽消息（两个 bug 修复） ===")

// Bug B：log 段之后的正文必须保留
const downLog = await gscoreToYunzai([
  { type: "log_info", data: "core says hi" },
  { type: "text", data: "pong" },
  { type: "image", data: "base64://aGVsbG8=" },
])
check(
  "Bug B 修复：log 之后的正文没被吞掉",
  downLog.message.length === 2 && downLog.message[0] === "pong",
  JSON.stringify(downLog.message),
)
check("logOnly=false（还有正文）", downLog.logOnly === false)

const onlyLog = await gscoreToYunzai([{ type: "log_warning", data: "just a log" }])
check("纯 log 消息 logOnly=true", onlyLog.logOnly === true && onlyLog.message.length === 0)

// Bug A：quote 必须能被取出
const downQuote = await gscoreToYunzai([
  { type: "reply", data: "mid-42" },
  { type: "text", data: "回复你" },
])
check("Bug A：quote 被正确解析出来", downQuote.quote === "mid-42", String(downQuote.quote))

// 媒体前缀
const media = await gscoreToYunzai([
  { type: "image", data: "link://example.com/x.png" },
  { type: "image", data: "base64://aGk=" },
  { type: "image", data: "rawBase64Data" },
  { type: "record", data: "base64://cmVj" },
  { type: "video", data: "base64://dmlk" },
])
check("link:// 剥离并补 http://", media.message[0].file === "http://example.com/x.png", media.message[0].file)
check("base64:// 原样透传", media.message[1].file === "base64://aGk=")
check("裸 base64 补前缀", media.message[2].file === "base64://rawBase64Data", media.message[2].file)
check(
  "record/video 支持（ws-plugin 直接丢弃）",
  media.message[3].type === "record" && media.message[4].type === "video",
)

// image_size 附加到上一张图
const sized = await gscoreToYunzai([
  { type: "image", data: "base64://aGk=" },
  { type: "image_size", data: [640, 480] },
])
check(
  "image_size 附加到上一个 image",
  sized.message[0].width === 640 && sized.message[0].height === 480,
)

// file 段按首个 | 切分
const fileSeg = await gscoreToYunzai([{ type: "file", data: "报告.pdf|YmFzZTY0fGRhdGE=" }])
check(
  "file 段按首个 | 切分",
  fileSeg.message[0].name === "报告.pdf" && fileSeg.message[0].file === "base64://YmFzZTY0fGRhdGE=",
  JSON.stringify(fileSeg.message[0]),
)

// 按钮
const btn = await gscoreToYunzai([
  {
    type: "buttons",
    data: [
      { text: "帮助", data: "#帮助", action: 2, permisson: 2 },
      { text: "链接", data: "https://e.com", action: 0, permisson: 1 },
      { text: "回调", data: "cb", action: 1, permisson: 0, specify_user_ids: ["123"] },
    ],
  },
])
const rows = btn.message[0].data
check("扁平按钮按每行 2 个切分", rows.length === 2 && rows[0].length === 2 && rows[1].length === 1)
check("action 0/1/2 -> link/callback/input", rows[0][0].input === "#帮助" && rows[0][1].link === "https://e.com")
check("permisson 1 -> admin", rows[0][1].permission === "admin")
check("permisson 0 -> 指定用户", JSON.stringify(rows[1][0].permission) === '["123"]')

// 反向：云崽按钮 -> Button（permisson 拼写）
const btnUp = await msgToGscore([
  { type: "button", data: [[{ text: "A", input: "#a" }, { text: "B", link: "https://b.com", permission: "admin" }]] },
])
check("按钮上行使用协议拼写 permisson", "permisson" in btnUp[0].data[0][0])
check("按钮上行 action 正确", btnUp[0].data[0][0].action === 2 && btnUp[0].data[0][1].action === 0)
check("按钮上行 permission:admin -> permisson:1", btnUp[0].data[0][1].permisson === 1)

// node 拍平
const nodeUp = await msgToGscore([
  { type: "node", data: [{ message: [{ type: "text", text: "a" }] }, { message: [{ type: "text", text: "b" }] }] },
])
check("node 拍平且不嵌套", nodeUp[0].type === "node" && nodeUp[0].data.every(i => i.type !== "node"))

console.log("\n=== 3. 客户端：连接 / 重连 / 1005 / 收发 ===")

const wss = new WebSocketServer({ port: 18765 })
const received = []
wss.on("connection", (ws, req) => {
  console.log(`  mock core: 收到连接 ${req.url}`)
  ws.on("message", d => {
    const m = JSON.parse(d.toString())
    received.push(m)
    ws.send(
      JSON.stringify({
        bot_id: m.bot_id,
        bot_self_id: m.bot_self_id,
        msg_id: m.msg_id,
        target_type: m.user_type,
        target_id: m.group_id ?? m.user_id,
        content: [
          { type: "log_info", data: "mock core: received" },
          { type: "reply", data: m.msg_id },
          { type: "text", data: "pong" },
        ],
      }),
    )
  })
})

const { GsCoreClient } = await import("../../lib/modules/client/index.js")

const client = new GsCoreClient({
  name: "test",
  url: "ws://127.0.0.1:18765/ws/Yunzai",
  token: "secret",
  reconnect_interval: 1,
  max_reconnect_attempts: 0,
})

check("token 拼进 ?token= 查询参数", client.url.includes("token=secret"), client.url)

client.connect()
await new Promise(r => setTimeout(r, 400))
check("客户端已连接", client.status === 1, `status=${client.status}`)

await client.sendReceive(groupEvent, false)
await new Promise(r => setTimeout(r, 400))

check("核心收到 MessageReceive", received.length === 1)
check("下行消息已发出", sent.length === 1, `sent=${sent.length}`)
if (sent.length) {
  const m = sent[0].msg
  // 数字化与框架 Bot.pickGroup 的 `Number(id) || id` 一致
  check("下行走 pickGroup", sent[0].kind === "group" && String(sent[0].id) === "30003", `${sent[0].kind}/${sent[0].id}`)
  check("Bug A 修复：quote 被前置为 segment.reply", m[0]?.type === "reply" && m[0].id === "msg-1", JSON.stringify(m[0]))
  check("Bug B 修复：log 之后的 pong 仍然发出", m.includes("pong"), JSON.stringify(m))
}

// 回环防护：把刚发出去的内容当作新入站事件
const echoEvent = {
  ...groupEvent,
  message_id: "echo-1",
  user_id: "10001", // 自己发的
  message: [{ type: "text", text: "pong" }],
}
const before = received.length
await client.sendReceive(echoEvent, false)
await new Promise(r => setTimeout(r, 200))
// sendReceive 本身不过滤（过滤在 shouldForward），这里只验证 client 仍可用
check("回环事件不会打断客户端", client.status === 1)

// 1005 重连
console.log("\n  -- 触发 1005 关闭 --")
const logCountBefore = logs.length
for (const ws of wss.clients) ws.close() // 不带状态码 -> 1005
await new Promise(r => setTimeout(r, 300))
const closeLogs = logs.slice(logCountBefore).map(l => l.msg).join(" | ")
check("1005 后继续重连（未放弃）", closeLogs.includes("继续重连"), closeLogs.slice(0, 200))

await new Promise(r => setTimeout(r, 1500))
check("1005 后确实重连成功", client.status === 1, `status=${client.status}`)

client.close()
wss.close()

console.log(`\n=== 结果：${pass} 通过，${fail} 失败 ===\n`)
process.exit(fail ? 1 : 0)
