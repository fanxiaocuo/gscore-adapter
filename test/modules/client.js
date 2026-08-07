/**
 * 早柚核心协议细节验证（针对 gsuid_core 源码核对过的行为）
 *
 * 覆盖 e2e.js 没测到的四件事：
 *   1. 上行必须是二进制帧    —— core.py: await websocket.receive_bytes()
 *   2. log_WARNING/SUCCESS   —— segment.py: Literal["INFO","WARNING","ERROR","SUCCESS"]
 *   3. excute_ 控制指令      —— bot.py: _Bot.unsend / _Bot.ban
 *   4. echo -> recall_message_id 回执 —— bot.py: _Bot.resolve_recall
 *
 * 运行：node plugins/gscore-adapter/test/protocol.js
 */
import { WebSocketServer } from "ws"

/* ==================== 桩 ==================== */

globalThis.logger = { red: s => s, blue: s => s, cyan: s => s, logger: {} }

const logs = []
const acts = [] // 记录 recall / mute 等动作

globalThis.Bot = {
  bots: {},
  uin: ["10001"],
  adapter: [],
  wsf: Object.create(null),
  makeLog(level, msg, id) {
    const s = Array.isArray(msg) ? msg.join(" ") : String(msg)
    logs.push({ level, msg: s, id })
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
  pickFriend(id) {
    return {
      sendMsg: m => {
        acts.push({ kind: "friend", id, msg: m })
        return { message_id: "friend-mid" }
      },
      recallMsg: mid => acts.push({ kind: "recall-friend", id, mid }),
    }
  },
  pickGroup(id) {
    return {
      sendMsg: m => {
        acts.push({ kind: "group", id, msg: m })
        return { message_id: "group-mid" }
      },
      recallMsg: mid => acts.push({ kind: "recall", id, mid }),
      muteMember: (uid, dur) => acts.push({ kind: "mute", id, uid, dur }),
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
  record: file => ({ type: "record", file }),
  video: file => ({ type: "video", file }),
  file: (file, name) => ({ type: "file", file, name }),
  reply: id => ({ type: "reply", id }),
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

/* ==================== mock 早柚核心 ==================== */

// 严格模拟 core.py：只接受二进制帧，收到文本帧视为协议错误
const inbound = [] // { binary: boolean, data: object }
const wss = new WebSocketServer({ port: 18777 })
let coreWs = null
wss.on("connection", ws => {
  coreWs = ws
  ws.on("message", (raw, isBinary) => {
    inbound.push({ binary: isBinary, data: JSON.parse(raw.toString()) })
  })
})

const { GsCoreClient } = await import("../../lib/modules/client/index.js")

const client = new GsCoreClient({
  name: "t",
  url: "ws://127.0.0.1:18777/ws/Yunzai",
  reconnect_interval: 1,
})
client.connect()
await new Promise(r => setTimeout(r, 400))
check("已连接", client.status === 1, `status=${client.status}`)

/* ---------- 1. 二进制帧 ---------- */

console.log("\n=== 1. 上行帧类型（core.py 用 receive_bytes）===")

await client.sendReceive(
  {
    post_type: "message",
    message_type: "group",
    self_id: "10001",
    user_id: "20002",
    group_id: "30003",
    message_id: "m1",
    sender: { user_id: "20002", nickname: "x" },
    message: [{ type: "text", text: "hi" }],
  },
  false,
)
await new Promise(r => setTimeout(r, 200))

check("核心收到 1 帧", inbound.length === 1, `count=${inbound.length}`)
check(
  "是二进制帧（文本帧会让 receive_bytes 报错）",
  inbound[0]?.binary === true,
  `binary=${inbound[0]?.binary}`,
)
check("内容仍是合法 JSON", inbound[0]?.data?.content?.[0]?.data === "hi")

/* ---------- 2. log 级别映射 ---------- */

console.log("\n=== 2. log_WARNING / log_SUCCESS 级别映射 ===")

const before = logs.length
await client.onMessage(
  JSON.stringify({
    bot_self_id: "10001",
    target_type: "group",
    target_id: "30003",
    content: [
      { type: "log_WARNING", data: "警告内容" },
      { type: "text", data: "正文还在" },
    ],
  }),
)
await new Promise(r => setTimeout(r, 100))

const warnLog = logs.slice(before).find(l => l.msg.includes("警告内容"))
check("log_WARNING 映射为 warn（而非静默降级 info）", warnLog?.level === "warn", `level=${warnLog?.level}`)

const successBefore = logs.length
await client.onMessage(
  JSON.stringify({
    bot_self_id: "10001",
    target_type: "group",
    target_id: "30003",
    content: [{ type: "log_SUCCESS", data: "成功内容" }],
  }),
)
const okLog = logs.slice(successBefore).find(l => l.msg.includes("成功内容"))
check("log_SUCCESS 映射为 mark", okLog?.level === "mark", `level=${okLog?.level}`)

// Bug B 回归：log 段不能吞掉后面的正文
check(
  "log 段之后的正文照常发送（Bug B）",
  acts.some(a => a.kind === "group" && JSON.stringify(a.msg).includes("正文还在")),
  JSON.stringify(acts),
)

/* ---------- 3. 控制指令 ---------- */

console.log("\n=== 3. excute_ 控制指令（注意不是 execute_）===")

await client.onMessage(
  JSON.stringify({
    bot_self_id: "10001",
    target_type: "group",
    target_id: "30003",
    content: [{ type: "excute_delete_message", data: { message_id: "to-recall" } }],
  }),
)
await new Promise(r => setTimeout(r, 100))
check(
  "excute_delete_message 触发撤回",
  acts.some(a => a.kind === "recall" && a.mid === "to-recall"),
  JSON.stringify(acts.filter(a => a.kind.startsWith("recall"))),
)

await client.onMessage(
  JSON.stringify({
    bot_self_id: "10001",
    target_type: "group",
    target_id: "30003",
    content: [
      { type: "excute_ban_user", data: { user_id: "20002", group_id: "30003", duration: 600 } },
    ],
  }),
)
await new Promise(r => setTimeout(r, 100))
check(
  "excute_ban_user 触发禁言 600s",
  acts.some(a => a.kind === "mute" && a.dur === 600),
  JSON.stringify(acts.filter(a => a.kind === "mute")),
)

await client.onMessage(
  JSON.stringify({
    bot_self_id: "10001",
    target_type: "group",
    target_id: "30003",
    content: [
      { type: "excute_ban_user", data: { user_id: "20002", group_id: "30003", duration: 0 } },
    ],
  }),
)
await new Promise(r => setTimeout(r, 100))
check(
  "duration=0 为解除禁言",
  acts.filter(a => a.kind === "mute" && a.dur === 0).length === 1,
)

const ctrlSent = acts.filter(a => a.kind === "group" && JSON.stringify(a.msg).includes("excute"))
check("控制指令不会被当成普通消息发出去", ctrlSent.length === 0, JSON.stringify(ctrlSent))

/* ---------- 4. echo 回执 ---------- */

console.log("\n=== 4. echo -> recall_message_id 回执 ===")

inbound.length = 0
await client.onMessage(
  JSON.stringify({
    bot_id: "onebot",
    bot_self_id: "10001",
    target_type: "group",
    target_id: "30003",
    echo: "42",
    content: [{ type: "text", data: "带回执的消息" }],
  }),
)
await new Promise(r => setTimeout(r, 200))

const receipt = inbound.find(f => f.data?.content?.[0]?.type === "recall_message_id")
check("带 echo 时回了 recall_message_id", !!receipt, JSON.stringify(inbound.map(i => i.data)))
check("回执 echo 原样带回", receipt?.data?.content?.[0]?.data?.echo === "42")
check(
  "回执携带真实 message_id",
  receipt?.data?.content?.[0]?.data?.id === "group-mid",
  JSON.stringify(receipt?.data?.content?.[0]?.data),
)
check("回执也是二进制帧", receipt?.binary === true)

// 发送失败时也必须回执，否则核心会等满 10s、连续 3 次后永久关闭撤回能力
inbound.length = 0
await client.onMessage(
  JSON.stringify({
    bot_id: "onebot",
    bot_self_id: "10001",
    target_type: "group",
    target_id: "30003",
    echo: "43",
    content: [], // 空内容 -> 发不出去
  }),
)
await new Promise(r => setTimeout(r, 200))
const nullReceipt = inbound.find(f => f.data?.content?.[0]?.type === "recall_message_id")
check("发送失败时仍回执（id=null）", nullReceipt?.data?.content?.[0]?.data?.id === null, JSON.stringify(nullReceipt?.data))

// 无 echo 时不应产生回执噪音
inbound.length = 0
await client.onMessage(
  JSON.stringify({
    bot_self_id: "10001",
    target_type: "group",
    target_id: "30003",
    content: [{ type: "text", data: "无回执" }],
  }),
)
await new Promise(r => setTimeout(r, 200))
check("无 echo 时不发回执", inbound.length === 0, `count=${inbound.length}`)

/* ---------- 5. group 段与未知段 ---------- */

// bot.py:433 在 group_id 非空时给**每一帧**都附 Message("group", group_id)。
// 它是定位 ID 不是正文（docs 08-special-platforms.md:37），漏掉会被 String()
// 成群号发出去 —— 每条群消息尾巴上挂一串数字，是最显眼的一类回归。
console.log("\n=== 5. group 段不得当作正文（bot.py:433）===")

acts.length = 0
await client.onMessage(
  JSON.stringify({
    bot_id: "onebot",
    bot_self_id: "10001",
    target_type: "group",
    target_id: "30003",
    content: [
      { type: "text", data: "正文" },
      { type: "group", data: "30003" },
    ],
  }),
)
await new Promise(r => setTimeout(r, 200))

const sent = acts.find(a => a.kind === "group")
check("消息已发出", !!sent, JSON.stringify(acts))
const flat = (sent?.msg || []).map(m => (typeof m === "string" ? m : m?.text ?? "")).join("")
check("正文保留", flat.includes("正文"), JSON.stringify(sent?.msg))
check("群号未混进正文", !flat.includes("30003"), JSON.stringify(sent?.msg))

// 红线 14（docs 10-pitfalls.md:75）：不支持的类型 warning + 跳过，不抛异常。
// template_markdown 的 data 是 dict，早期的 push(String(data)) 会打印 [object Object]
console.log("\n=== 6. 未知段 warning 跳过（红线 14）===")

acts.length = 0
logs.length = 0
await client.onMessage(
  JSON.stringify({
    bot_id: "onebot",
    bot_self_id: "10001",
    target_type: "group",
    target_id: "30003",
    content: [
      { type: "text", data: "有效正文" },
      { type: "template_markdown", data: { template_id: "tpl", para: { k: "v" } } },
    ],
  }),
)
await new Promise(r => setTimeout(r, 200))

const sent2 = acts.find(a => a.kind === "group")
const flat2 = (sent2?.msg || []).map(m => (typeof m === "string" ? m : m?.text ?? "")).join("")
check("未知段不阻断整条消息", flat2.includes("有效正文"), JSON.stringify(sent2?.msg))
check("未打印 [object Object]", !flat2.includes("[object Object]"), JSON.stringify(sent2?.msg))
check(
  "有 warning 且指名类型",
  logs.some(l => l.level === "warn" && l.msg.includes("template_markdown")),
  JSON.stringify(logs.map(l => `${l.level}:${l.msg}`)),
)

/* ==================== 收尾 ==================== */

client.close()
coreWs?.close()
wss.close()
console.log(`\n=== 结果：${pass} 通过，${fail} 失败 ===\n`)
process.exit(fail ? 1 : 0)
