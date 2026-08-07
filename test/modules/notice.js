/**
 * meta event（非消息事件）验证
 *
 * 覆盖入群 / 退群 / 戳一戳三种事件的上报。
 *
 * 核心侧消费方式（已对 gsuid_core/handler.py 源码核对）：
 *   _extract_meta_segment: if seg.type and seg.type.startswith("meta-")
 *   msg_process:           event.meta_event_type = _msg.type[len("meta-"):]
 *   并会用 data.user_id / data.group_id 回填顶层缺失字段，供权限与黑白名单使用
 *
 * ⚠ 事件形状：本 fork 的 notice 与 OneBot 原生不同。
 *   plugins/adapter/OneBotv11.js:1330-1333 把 notice_type 按 _ 拆成两段：
 *     group_increase -> notice_type="group", sub_type="increase"
 *   ICQQ 原生即是此形状。故下面用的是 sub_type 而非 notice_type，不是笔误；
 *   写成 notice_type === "group_increase" 在本项目上恒为 false。
 *
 * 运行：node plugins/gscore-adapter/test/meta.js
 */
import { WebSocketServer } from "ws"

/* ==================== 桩 ==================== */

globalThis.logger = { red: s => s, blue: s => s, cyan: s => s, logger: {} }

const logs = []

globalThis.Bot = {
  bots: {},
  uin: ["10001"],
  adapter: [],
  wsf: Object.create(null),
  makeLog(level, msg, id) {
    const s = Array.isArray(msg) ? msg.join(" ") : String(msg)
    logs.push({ level, msg: s, id })
    if (level !== "debug") console.log(`  [${level}] ${id ? `<${id}> ` : ""}${s}`)
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
  on() {},
  once() {},
  sendMasterMsg: async () => {},
}

globalThis.segment = {
  button: (...data) => ({ type: "button", data }),
  markdown: data => ({ type: "markdown", data }),
  image: file => ({ type: "image", file }),
  at: qq => ({ type: "at", qq }),
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

/* ==================== 开始 ==================== */

const { noticeToMeta, metaToGscore } = await import("../../lib/modules/notice/index.js")

console.log("\n=== 1. 事件映射（本 fork 的 sub_type 形状）===")

const join = noticeToMeta({
  post_type: "notice",
  notice_type: "group",
  sub_type: "increase",
  self_id: "10001",
  user_id: "20002",
  group_id: "30003",
  operator_id: "40004",
})
check("入群 -> user_join_group", join?.eventName === "user_join_group", join?.eventName)
check(
  "入群带 user_id/group_id",
  join?.data.user_id === "20002" && join?.data.group_id === "30003",
  JSON.stringify(join?.data),
)
check("operator_id 存在时写入", join?.data.operator_id === "40004")
check(
  "入退群不含 sub_type（原始值已被 OneBotv11.js:1333 覆盖）",
  !("sub_type" in (join?.data || {})),
)

const leave = noticeToMeta({
  post_type: "notice",
  notice_type: "group",
  sub_type: "decrease",
  self_id: "10001",
  user_id: "20002",
  group_id: "30003",
})
check("退群 -> user_exit_group", leave?.eventName === "user_exit_group", leave?.eventName)
check("无 operator_id 时不写脏字段", !("operator_id" in (leave?.data || {})))

const groupPoke = noticeToMeta({
  post_type: "notice",
  notice_type: "group",
  sub_type: "poke",
  self_id: "10001",
  operator_id: "20002",
  target_id: "10001",
  group_id: "30003",
})
check("群戳一戳 -> poke", groupPoke?.eventName === "poke")
check("群戳一戳带 group_id", groupPoke?.data.group_id === "30003")
check("戳人者取 operator_id", groupPoke?.data.user_id === "20002", groupPoke?.data.user_id)

const friendPoke = noticeToMeta({
  post_type: "notice",
  notice_type: "friend",
  sub_type: "poke",
  self_id: "10001",
  operator_id: "20002",
  target_id: "10001",
})
check("私聊戳一戳 -> poke", friendPoke?.eventName === "poke")
check("私聊戳一戳不带 group_id", !("group_id" in friendPoke.data))

// 数字 id 是常见输入（框架内部多处用 Number）
const numeric = noticeToMeta({
  post_type: "notice",
  notice_type: "group",
  sub_type: "increase",
  self_id: 10001,
  user_id: 20002,
  group_id: 30003,
})
check(
  "所有 id 归一为 string",
  Object.values(numeric.data).every(v => typeof v === "string"),
  JSON.stringify(numeric.data),
)

console.log("\n=== 2. 丢弃逻辑 ===")

check(
  "入群缺 group_id -> null",
  noticeToMeta({
    post_type: "notice",
    notice_type: "group",
    sub_type: "increase",
    self_id: "10001",
    user_id: "20002",
  }) === null,
)
check(
  "缺 user_id -> null",
  noticeToMeta({
    post_type: "notice",
    notice_type: "group",
    sub_type: "increase",
    self_id: "10001",
    group_id: "30003",
  }) === null,
)
check(
  "未映射事件（ban）-> null",
  noticeToMeta({
    post_type: "notice",
    notice_type: "group",
    sub_type: "ban",
    self_id: "10001",
    user_id: "20002",
    group_id: "30003",
  }) === null,
)
check(
  "非 notice 事件 -> null",
  noticeToMeta({ post_type: "message", notice_type: "group", sub_type: "increase" }) === null,
)

console.log("\n=== 3. poke 的 target_id 兜底 ===")

check("target_id 存在时原样使用", groupPoke.data.target_id === "10001")
const pokeNoTarget = noticeToMeta({
  post_type: "notice",
  notice_type: "friend",
  sub_type: "poke",
  self_id: "10001",
  operator_id: "20002",
})
check(
  "target_id 缺失时兜底为 bot 自己",
  pokeNoTarget.data.target_id === "10001",
  pokeNoTarget.data.target_id,
)

console.log("\n=== 4. 上报包结构 ===")

const evt = {
  post_type: "notice",
  notice_type: "group",
  sub_type: "increase",
  self_id: "10001",
  user_id: "20002",
  group_id: "30003",
}
const pkg = metaToGscore(evt, join, "onebot", { isMaster: false })
console.log("  ->", JSON.stringify(pkg).slice(0, 300))

check("段 type 带 meta- 前缀", pkg.content[0].type === "meta-user_join_group", pkg.content[0].type)
check("data 为 dict 原样透传", pkg.content[0].data === join.data)
check("msg_id 为空串、sender 为空对象", pkg.msg_id === "" && !Object.keys(pkg.sender).length)
check("非主人 user_pm=6", pkg.user_pm === 6)
check(
  "主人 user_pm=1",
  metaToGscore(evt, join, "onebot", { isMaster: true }).user_pm === 1,
)
check("有 group_id -> user_type=group", pkg.user_type === "group" && pkg.group_id === "30003")

const dm = metaToGscore(
  { post_type: "notice", self_id: "10001" },
  friendPoke,
  "onebot",
  {},
)
check("无 group_id -> user_type=direct", dm.user_type === "direct" && dm.group_id === null)

/* ==================== 端到端 ==================== */

console.log("\n=== 5. 端到端 ===")

const received = []
const wss = new WebSocketServer({ port: 18766 })
wss.on("connection", ws => {
  ws.on("message", (data, isBinary) => received.push({ data: JSON.parse(data.toString()), isBinary }))
})

const { GsCoreClient } = await import("../../lib/modules/client/index.js")

const client = new GsCoreClient({ name: "meta-test", url: "ws://127.0.0.1:18766/ws/Yunzai" })
client.connect()
await new Promise(r => setTimeout(r, 400))
check("客户端已连接", client.status === 1, `status=${client.status}`)

client.sendMeta(evt, join, false)
await new Promise(r => setTimeout(r, 300))

check("核心收到 meta 事件", received.length === 1, `收到 ${received.length} 帧`)
check(
  "上行是二进制帧（core.py 用 receive_bytes）",
  received[0]?.isBinary === true,
  `isBinary=${received[0]?.isBinary}`,
)
check(
  "帧内容为 meta-user_join_group",
  received[0]?.data.content[0].type === "meta-user_join_group",
  received[0]?.data.content[0].type,
)

client.close()
wss.close()

console.log(`\n=== 结果：${pass} 通过，${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
