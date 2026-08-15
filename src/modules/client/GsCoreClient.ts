import { WebSocket } from "ws"
import { config, resolveBotId } from "@/config"
import { STATUS_TEXT, GS_LOG_RE, DEFAULT_MAX_RECONNECT } from "@/constants"
import { logStr, sendError, sendMessageId } from "@/utils"
import { redactUrl } from "@/utils/url"
import { makeLog } from "@/utils/compat"
import { setLocalHint } from "@/utils/fileServer.js"
import { yunzaiToGscore, gscoreToYunzai } from "@/modules/convert"
import { metaToGscore, metaLogStr, type MetaEvent } from "@/modules/notice"
import { count } from "@/modules/stats/index.js"
import { isQQBot, take } from "@/modules/passive"
import type {
  AdapterEvent,
  MessageSend,
  SendBot,
  SendTarget,
  WsConnection,
  RuntimeWsConnection,
  SendSegment,
} from "@/types"
import { getBot } from "@/utils/bots.js"
import { echoKey, markSent } from "./echo.js"

/**
 * 段类型摘要，例如 "image×1,text×1"
 *
 * 只统计类型与个数。下行日志里绝不能出现媒体正文或鉴权信息：图片走 base64
 * 时一条消息就是几十万字符，外链形态又可能带查询参数形式的凭据。
 * 而排查「图片没发出去」真正需要的只是「这条消息里有没有 image 段」。
 */
function segSummary(message: any[]): string {
  const n = new Map<string, number>()
  for (const s of message) {
    const t = typeof s === "string" ? "text" : String(s?.type || "unknown")
    n.set(t, (n.get(t) || 0) + 1)
  }
  return [...n].map(([t, c]) => `${t}×${c}`).join(",")
}

/**
 * 被动发送要的是「完整的会话上下文」
 *
 * QQBot-Plugin 的各条发送函数直接从 target 上取字段，缺一项就在插件内部抛出来 ——
 * 那时异常信息指向 QQBot-Plugin，很难看出是这边 pick 出来的对象不完整。
 *
 * 逐条对应实际读的字段，不能笼统查 group_id：
 *   sendGroupMsg   data.group_id   （index.js:1051 一带）
 *   sendFriendMsg  data.user_id
 *   sendGuildMsg   data.channel_id （index.js:1022-1024）
 * 频道尤其要紧 —— pickGuild（index.js:1333-1350）显式给的是 guild_id/channel_id，
 * group_id 只可能从 `...gl.get()` 展开里捎来。查 group_id 等于查了个与该发送函数
 * 无关的字段：真正要用的 channel_id 没查，可能缺的 group_id 反倒成了硬条件，
 * 于是频道的被动回复会被静默降级成普通发送，日志里只写「无被动窗口」。
 */
function passiveReady(target: SendTarget, type: "direct" | "group", targetId: string): boolean {
  // 直接读字段，不再 `as Record<string, unknown>`：那个断言等于 any，
  // 这几项现在在 SendTarget 上有声明（见 types/Bot.ts）
  if (!target.self_id || !target.bot) return false
  if (type === "direct") return !!target.user_id
  return targetId.startsWith("qg_") ? !!target.channel_id : !!target.group_id
}

/**
 * QQBot 这一条下行「有没有投出去哪怕一条」
 *
 * 不能只用 sendError 来决定回不回退
 * ------
 * QQBotAdapter.sendMsg（index.js:805-865）把一条下行拆成多个消息组逐个发，
 * 失败只 `rets.error.push(err)` 就返回剩余的，接着是四级阶梯重试（原样重试 →
 * 换 markdown 形态重建 → legacy makeMsg 兜底）。而 **rets.error 全程没有任何
 * 清空动作** —— 首轮失败、后续成功的发送，返回的仍是
 * `{ message_id:[非空], data:[非空], error:[旧错误] }`。
 *
 * sendError 只要 error 数组有真值就判失败，于是「QQBot 自己已经重试成功」会被
 * 当成失败：doSend 再整条发一遍，用户看到两条。ww帮助 是 text+image 走 raw
 * markdown，首轮被拒本就是常态（四级阶梯的存在即是证据），这条路很热。
 *
 * 判据用 rets.data 而不是 message_id：index.js:821 是 `if (ret.id) push(ret.id)`，
 * 已投递但响应不带 id 时 message_id 会是空的；而 820 行 `rets.data.push(ret)`
 * 每次成功投递都执行。这也与 utils/send.ts 里「缺 message_id 不得判失败」一致。
 *
 * 形状不认识时必须退回旧判据，不能一律当「没投出去」
 * ------
 * 只认 `data` 数组的话，返回值形状一变（换版本、换实现、或 isQQBot 认到别的
 * 适配器）就会变成「每条消息都回退再发一遍」—— 那比现在这个偶发重复更糟，
 * 且是无条件发生。所以只有拿到 `data` 数组这个确切证据时才用它下判断，
 * 其余情况沿用 sendError：至少不比改动前差。
 */
function qqbotDelivered(ret: any): boolean {
  if (Array.isArray(ret?.data)) return ret.data.length > 0
  return !sendError(ret)
}

export class GsCoreClient {
  conf: WsConnection | RuntimeWsConnection
  name: string
  sourceIndex: number
  account: string | null
  target: string
  /** 0 未连接/已停止 1 已连接 2 连接中 3 断线待重连 */
  status: 0 | 1 | 2 | 3
  retry: number
  stop: boolean
  ws: WebSocket | null
  // 用 undefined 而非 null 作空值：clear{Timeout,Interval} 接受 undefined，
  // 传 null 在 strict 下会被拒，而运行时两者都是无操作。
  timer?: NodeJS.Timeout
  hbTimer?: NodeJS.Timeout
  aliveTimer?: NodeJS.Timeout
  lastPong: number

  constructor(conf: WsConnection | RuntimeWsConnection) {
    this.conf = conf
    const rt = conf as Partial<RuntimeWsConnection>
    // 运行时连接自带唯一名称与最终地址；直接传逻辑连接时退回旧行为。
    // 退路里的地址过 redactUrl：name 会进日志，而逻辑连接的地址可能内联着 ?token=
    this.name = rt.runtimeName || conf.name || redactUrl(conf.url)
    this.target = rt.runtimeUrl || String(conf.url || "")
    this.sourceIndex = typeof rt.sourceIndex === "number" ? rt.sourceIndex : -1
    this.account = rt.account ?? null
    /** 0 未连接/已停止 1 已连接 2 连接中 3 断线待重连 */
    this.status = 0
    this.retry = 0
    this.stop = false
    this.ws = null
    this.timer = undefined
    this.hbTimer = undefined
    this.aliveTimer = undefined
    this.lastPong = 0
  }

  /**
   * 可读状态，供**文字**指令显示（#早柚状态 / #早柚连接列表 的文本回复）
   *
   * 重连次数拼在括号里是因为那些回复只有一行、没有别的地方放。措辞跟出图与面板
   * 对齐成「已重连」：写「重连 N 次」会被读成「还要重连 N 次」，而这里说的是已经
   * 重连过的次数。三处话术一旦分叉，同一个数在三个界面上像三种计量。
   *
   * 面板不用这个 getter —— 它另有 retry 字段并单独渲一个标签，用了就是把同一个数
   * 在一行里写两遍（见 webadapter 的 status_text）。
   */
  get statusText() {
    return STATUS_TEXT[this.status] + (this.retry ? `(已重连${this.retry}次)` : "")
  }

  /** 早柚核心用 ?token= 查询参数鉴权，不使用请求头 */
  get url() {
    const url = this.target
    const inlineToken = (this.conf as Partial<RuntimeWsConnection>).inlineToken === true
    const token = String(this.conf.token ?? "")
    if (!inlineToken && !token) return url
    try {
      const u = new URL(url)
      if (inlineToken || !u.searchParams.has("token")) u.searchParams.set("token", token)
      return u.toString()
    } catch {
      if (/[?&]token=/.test(url)) return url
      return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
    }
  }

  log(level: string, msg: any) {
    makeLog(level, msg, `GsCore:${this.name}`, true)
  }

  connect() {
    if (this.stop) return
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    )
      return

    this.status = 2
    try {
      // maxPayload 必须显式给。ws 的默认是 100MiB，而超限不是「丢掉这一帧」——
      // receiver.js:418/514 会抛 RSV 错误并把整条连接拆掉，表现为无缘无故断线重连，
      // 日志里只有一个 code=1009，很难查。
      // 参照 GenshinUID 的 Python 客户端（client.py: max_size=2**26）取 64MiB：
      // 核心下发图片走 base64，base64 会把体积放大 4/3，64MiB 够放约 48MiB 的原图，
      // 远超 media_max_size 的默认值，同时比 100MiB 更早暴露异常大的载荷。
      // handshakeTimeout 同样必须显式给。不给就退化到 OS 的 TCP 超时，
      // 防火墙黑洞掉 SYN 时可以卡在 CONNECTING 好几分钟，期间 status 一直是 2，
      // close 事件不来，scheduleReconnect 也就永远不触发，表现为「连接中」假死。
      // 参照 GenshinUID 的 Python 客户端（client.py: open_timeout=60）取 60s。
      //
      // 刻意不给任何 TLS 选项。wss:// 本身是通的（utils/url.ts 两个入口都放行，
      // ws 库自己做 TLS，token 照旧走查询参数），带正经证书的核心直接就能连；
      // 缺的只有**自签 / 私有 CA** —— 那种证书会在握手阶段挂在
      // DEPTH_ZERO_SELF_SIGNED_CERT 上，日志里只有一句「连接错误」然后进重连循环。
      // 需要时用 NODE_EXTRA_CA_CERTS 启动云崽，别在这里塞 rejectUnauthorized: false：
      // 那是把中间人防护整个关掉，而这个选项一旦加进配置就会被人复制到公网连接上。
      this.ws = new WebSocket(this.url, {
        maxPayload: 64 * 1024 * 1024,
        handshakeTimeout: 60000,
      })
    } catch (err) {
      this.log("error", ["创建连接失败，请检查地址", err])
      return this.scheduleReconnect(-1)
    }

    this.ws.on("open", () => this.onOpen())
    this.ws.on("message", data => this.onMessage(data))
    this.ws.on("close", (code, reason) => this.onClose(code, reason))
    this.ws.on("error", err => this.log("error", ["连接错误", err?.message || err]))
    this.ws.on("pong", () => (this.lastPong = Date.now()))
  }

  onOpen() {
    const wasReconnect = this.status === 2 && this.retry > 0
    this.status = 1
    this.retry = 0
    this.lastPong = Date.now()
    // 记下这条连接走的本机地址：内置文件服务用它拼外链 host，
    // 比硬写 127.0.0.1 靠谱（核心常在 Docker 或另一台机器上）
    setLocalHint((this.ws as any)?._socket?.localAddress)
    this.log("mark", wasReconnect ? "重连成功" : "已连接")
    this.startHeartbeat()
    if (wasReconnect && config.notify_master) this.notify(`${this.name} 重连成功`)
  }

  notify(msg: string) {
    try {
      const ret = Bot.sendMasterMsg?.(`[早柚核心] ${msg}`)
      if (ret?.catch) ret.catch(() => {})
    } catch {}
  }

  startHeartbeat() {
    this.stopHeartbeat()
    const iv = Number(config.client?.heartbeat) || 0
    if (iv > 0) {
      this.hbTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          try {
            this.ws.ping()
          } catch {}
        }
      }, iv * 1000)
    }

    // 超时检测依赖 pong 刷新 lastPong，而 pong 只会因我们发 ping 而来。
    // 故 iv === 0（不发 ping）时必须一并关掉检测，否则 lastPong 永不更新，
    // Date.now() - lastPong 必然超阈值 → 无条件 terminate → 断线重连死循环。
    const to = Number(config.client?.heartbeat_timeout) || 0
    if (iv > 0 && to > 0) {
      this.aliveTimer = setInterval(
        () => {
          if (this.status === 1 && Date.now() - this.lastPong > to * 1000) {
            this.log("warn", `心跳超时 ${to}s，主动断开重连`)
            try {
              this.ws.terminate()
            } catch {}
          }
        },
        Math.max(5, to / 3) * 1000,
      )
    }
  }

  stopHeartbeat() {
    clearInterval(this.hbTimer)
    clearInterval(this.aliveTimer)
    this.hbTimer = undefined
    this.aliveTimer = undefined
  }

  /**
   * @param reason ws 给的是 Buffer（对端可以不带原因，那就是个空 Buffer）；
   *               下面靠 `reason?.length` 判空再拼进日志，不必先转字符串
   */
  onClose(code: number, reason: Buffer) {
    this.stopHeartbeat()
    const wasOnline = this.status === 1
    this.status = 3

    // close() 主动关闭时不摘监听器，close 事件仍会走到这里。
    // 通知必须在 stop 判断之后，否则 reloadClients() 逐个 close 会给主人
    // 刷 N 条"已断开"，而实际只是重载配置。
    if (this.stop) {
      this.status = 0
      return
    }

    this.log("warn", `连接已关闭 code=${code}${reason?.length ? ` reason=${reason}` : ""}`)
    if (wasOnline && config.notify_master) this.notify(`${this.name} 已断开`)
    this.scheduleReconnect(code)
  }

  /** @param code 关闭码；创建连接就失败时调用方传 -1（没有关闭码可言） */
  scheduleReconnect(code: number) {
    if (this.stop) {
      this.status = 0
      return
    }

    // ?? 而不是 ||：配了 0 是「显式要无限重连」，不能被兜成默认值。
    // 字段缺失（老配置、手写的连接项）按默认次数算，与新装用户一致
    const max = Number(this.conf.max_reconnect_attempts ?? DEFAULT_MAX_RECONNECT)
    if (max > 0 && this.retry >= max) {
      this.status = 0
      return this.log("error", `达到最大重连次数 ${max}，停止重连（可用 #早柚重连 恢复）`)
    }

    // ws-plugin components/Client.js:314 在 code === 1005 时彻底放弃重连。
    // 1005 = No Status Received，只是对端关闭时没带状态码（Python 侧重启很常见），
    // 完全是可恢复状态，这里继续重连，只额外打一条说明日志。
    if (code === 1005) this.log("warn", "对端未提供关闭码(1005)，通常是核心重启，继续重连")

    this.retry++
    // 指数退避：base * 2^(retry-1)，封顶 base 的 12 倍（默认 5s → 最长 60s）。
    // 默认次数（5）下最多累计约 2.3 分钟；配成无限重试时退避让它收敛到低频探活，
    // 而不是以固定间隔一直打日志、占连接。
    const base = Number(this.conf.reconnect_interval) || 5
    const wait = Math.min(base * 2 ** (this.retry - 1), base * 12) * 1000
    this.log("info", `${wait / 1000}s 后进行第 ${this.retry} 次重连`)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.connect(), wait)
  }

  close() {
    this.stop = true
    this.stopHeartbeat()
    clearTimeout(this.timer)
    try {
      this.ws?.close(1000)
    } catch {}
    this.status = 0
  }

  restart() {
    this.stop = false
    this.retry = 0
    clearTimeout(this.timer)
    this.stopHeartbeat()
    try {
      this.ws?.terminate()
    } catch {}
    this.ws = null
    this.connect()
  }

  /** 本连接是否接管该 self_id */
  accept(self_id: string | number) {
    const id = String(self_id)
    const exclude = this.conf.exclude || []
    if (exclude.length && exclude.some(i => String(i) === id)) return false
    const bind = this.conf.bind || []
    if (bind.length && !bind.some(i => String(i) === id)) return false
    return true
  }

  /* ---------- 上行：云崽 -> 早柚核心 ---------- */
  /** @param selfId 已由 hooks 的 resolveSelfId 解析过，非空；e.self_id 可能是 null */
  async sendReceive(e: AdapterEvent, isMaster: boolean, selfId = String(e.self_id ?? "")) {
    if (this.status !== 1 || this.ws?.readyState !== WebSocket.OPEN) return false

    const botId = resolveBotId(e, this.conf, selfId)
    const data = await yunzaiToGscore(e, botId, { isMaster, selfId })
    if (!data) return false

    // 早柚核心 core.py 用 websocket.receive_bytes() 读取，必须发二进制帧
    // 只在真的发出去时计数：send 在 readyState 不是 OPEN 时返回 false，
    // 那种情况下这条消息并没有中转成功，计进去会让「连着但不通」的故障看不出来
    if (!this.send(data)) return false
    count("up", this.name)
    makeLog("debug", `上报早柚核心：${logStr(data.content)}`, `${selfId} => ${this.name}`, true)
    return true
  }

  /**
   * 上行：非消息事件（入群/退群/戳一戳）
   * 单向通知，核心不回执，发出即完成。
   */
  sendMeta(e: AdapterEvent, meta: MetaEvent, isMaster: boolean, selfId = String(e.self_id ?? "")) {
    if (this.status !== 1 || this.ws?.readyState !== WebSocket.OPEN) return false

    const data = metaToGscore(e, meta, resolveBotId(e, this.conf, selfId), { isMaster, selfId })
    if (!data) return false

    if (!this.send(data)) return false
    count("event", this.name)
    makeLog("debug", `上报早柚核心事件：${metaLogStr(meta)}`, `${selfId} => ${this.name}`, true)
    return true
  }

  /**
   * 发一帧到核心。
   * 必须是二进制：核心 core.py 的读循环是 websocket.receive_bytes()，
   * 而 ws 库对 string 发的是文本帧(opcode 1)，Starlette 那边取不到 "bytes" 键会直接报错。
   *
   * @param data 上行帧。标 unknown 而不是 `MessageReceive`：撤回回执那一帧的
   *             content 放的是 `recall_message_id` 段（协议里是独立结构，
   *             见 {@link RecallReceipt}），套不进 MessageReceive.content。
   *             这里只负责序列化，帧的形状由各调用点自己保证。
   */
  send(data: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(Buffer.from(JSON.stringify(data), "utf8"))
    return true
  }

  /**
   * 回执：核心 bot.py 的 target_send 在 wait_recall 时会带 echo 下发，
   * 并在 _recall_waiters 里等一个 recall_message_id 回来（RECALL_WAIT_TIMEOUT=10s）。
   * 连续 3 次拿不到就会把本适配器标记为 _supports_recall=False，永久关掉撤回能力，
   * 所以即使发送失败也要回一帧（id 给 null），让核心的 future 立刻结束。
   */
  sendRecallReceipt(data: MessageSend, id: string | string[] | null) {
    if (!data.echo) return
    this.send({
      bot_id: data.bot_id,
      bot_self_id: data.bot_self_id,
      msg_id: "",
      user_type: data.target_type || "group",
      group_id: data.target_type === "group" ? data.target_id : null,
      user_id: data.target_type === "direct" ? String(data.target_id ?? "") : "",
      sender: {},
      user_pm: 6,
      content: [{ type: "recall_message_id", data: { echo: data.echo, id } }],
    })
  }

  /**
   * 核心下发的控制指令（bot.py 的 _Bot.unsend / _Bot.ban）。
   * 注意拼写是 excute_ 不是 execute_，核心源码即如此。
   * 两者都只在 content 长度为 1 时出现。
   * @returns 是否已作为控制指令处理
   */
  async handleControl(data: MessageSend, bot: SendBot) {
    const list: SendSegment[] = Array.isArray(data.content) ? data.content : []
    if (list.length !== 1) return false
    const seg = list[0]

    if (seg?.type === "excute_delete_message") {
      const id = seg.data?.message_id
      try {
        // 撤回接口在各适配器上位置不一：优先群/好友对象，退化到 bot 级
        const target: SendTarget | undefined =
          data.target_type === "direct"
            ? bot.pickFriend?.(Number(data.target_id) || data.target_id)
            : bot.pickGroup?.(Number(data.target_id) || data.target_id)
        const fn = target?.recallMsg || bot.recallMsg
        if (!fn) return this.log("warn", "当前适配器不支持撤回消息"), true
        await fn.call(target?.recallMsg ? target : bot, id)
        this.log("info", `已撤回消息 ${id}`)
      } catch (err) {
        this.log("error", ["撤回消息失败", err])
      }
      return true
    }

    if (seg?.type === "excute_ban_user") {
      const d = seg.data || ({} as typeof seg.data)
      const duration = Number(d.duration) || 0
      try {
        const group: SendTarget | undefined = bot.pickGroup?.(Number(d.group_id) || d.group_id)
        if (!group?.muteMember) return this.log("warn", "当前适配器不支持禁言"), true
        await group.muteMember(Number(d.user_id) || d.user_id, duration)
        this.log("info", `${duration ? `禁言 ${duration}s` : "解除禁言"}：${d.user_id}@${d.group_id}`)
      } catch (err) {
        this.log("error", ["禁言操作失败", err])
      }
      return true
    }

    return false
  }

  /**
   * 实际发送
   *
   * QQBot 上尽量走**被动回复**：带上该会话最近一条入站消息的 id，让这条回复在
   * 客户端里挂到用户那条消息下（显示为引用）。核心下发不带原消息 id，
   * 所以那个 id 由 modules/passive 自己记着。
   *
   * 为什么不直接 target.sendMsg
   * -------------------------
   * QQBot-Plugin 的 pick* 返回的 sendMsg 只收一个参数
   * （index.js:1114 `sendMsg: msg => this.sendGroupMsg(i, msg)`），第三个 event
   * 参数被吃掉了 —— 从 pick 出来的对象上没法传被动回复凭据。而 adapter 上的
   * sendGroupMsg(data, msg, event) 收得到，所以这条路径直接调它，
   * 把 pick 出来的对象当上下文传进去（QQBot-Plugin 内部也正是这么用的）。
   *
   * 失败即回退：被动回复用的 id 可能已被平台判为过期（4 分半的窗口是估算，
   * 时钟与网络延迟都算不进去），也可能这条会话不支持。那种情况下退回普通发送，
   * 宁可丢掉引用形态，不能让消息发不出去。
   */
  async doSend(
    target: SendTarget,
    message: any[],
    bot: SendBot,
    data: MessageSend,
    targetId: string,
  ) {
    // 摘要在三条路径上共用：走了哪条、有没有回退，日后只看日志就能复盘
    const summary = segSummary(message)
    const type = data.target_type === "direct" ? "direct" : "group"
    const brief = `${this.name} => ${data.bot_self_id}, ${type} ${targetId}, ${summary}`

    if (!isQQBot(bot)) {
      this.log("debug", `下行发送：${brief}`)
      return await target.sendMsg(message)
    }

    // 先确认有能收 event 的发送函数、且目标带齐上下文，再去 take —— take 会记一次
    // 使用次数（同一个 id 只能带 5 次），顺序反了会在「这条路径走不通」时白耗额度，
    // 后面那几段本来还能挂到原消息上的回复反而掉出引用形态
    const fn = this.passiveSender(bot.adapter, type, targetId)
    const msgId =
      fn && passiveReady(target, type, targetId) ? take(data.bot_self_id, type, targetId) : ""
    if (!fn || !msgId) {
      this.log("debug", `下行发送（无被动窗口）：${brief}`)
      return await target.sendMsg(message)
    }

    try {
      const ret = await fn(target, message, { id: msgId })
      // 只在「一条都没投出去」时才回退。QQBot 内部四级阶梯自愈过的发送带着陈旧
      // error 回来，照 sendError 判会重发整条 —— 详见 qqbotDelivered 的注释
      if (qqbotDelivered(ret)) {
        this.log("debug", `下行发送（被动回复）：${brief}`)
        return ret
      }
      this.log("debug", `被动回复未投出，改为不带 id 发送：${brief}`)
    } catch (err) {
      this.log("debug", [`被动回复异常，改为不带 id 发送：${brief}`, err])
    }
    // 回退复用同一个 message 引用是安全的：QQBot-Plugin 的 makeMsg(index.js:699-804)、
    // makeRawMarkdownMsg(293-460)、makeGuildMsg(883-970) 都先 `i = {...i}` 浅拷贝段
    // 再改，并往新建数组 push，不回写入参。唯一按引用透传的是 raw 段（758/392），
    // 而本插件下行从不产出 raw（convert/toYunzai.ts:56-100），该例外不可达。
    return await target.sendMsg(message)
  }

  /**
   * 取能接收 event 参数的发送函数
   *
   * QQBot-Plugin 有四条发送路径，按目标形状分派（同它自己 pickGroup/pickFriend
   * 里的判断，index.js:1051/1103）：
   *   群       sendGroupMsg
   *   好友     sendFriendMsg
   *   频道     sendGuildMsg    —— group_id 带 qg_ 前缀
   *   频道私聊 sendDirectMsg   —— **不走被动回复**，见下
   *
   * 频道私聊排除在外：sendDirectMsg 会在缺 guild_id 时先去 createDirectSession
   * 建会话并改写 data（index.js:995-1007），把它塞进被动回复这条路径要连带处理
   * 那段副作用，收益（频道私聊本就少）不值这个风险。它照常走 target.sendMsg。
   *
   * @returns 找不到对应函数返回 null，调用方回退
   */
  passiveSender(adapter: any, type: "direct" | "group", targetId: string) {
    if (!adapter) return null
    const isGuild = targetId.startsWith("qg_")

    // 频道私聊：不接
    if (type === "direct" && isGuild) return null

    const name = type === "direct" ? "sendFriendMsg" : isGuild ? "sendGuildMsg" : "sendGroupMsg"
    const fn = adapter[name]
    if (typeof fn !== "function") return null
    return (t: SendTarget, msg: any[], event: { id: string }) => fn.call(adapter, t, msg, event)
  }

  /* ---------- 下行：早柚核心 -> 云崽 ---------- */
  /**
   * @param raw ws 的 message 事件载荷。核心发的是二进制帧（Buffer），
   *            但 ws 的类型把碎片帧的 Buffer[] 与 ArrayBuffer 也算进来，
   *            所以统一 toString 而不假定是 Buffer
   */
  async onMessage(raw: import("ws").RawData) {
    let data: MessageSend
    try {
      data = JSON.parse(raw.toString())
    } catch (err) {
      return this.log("error", ["解码数据失败", String(raw).slice(0, 300), err])
    }

    const bot: SendBot | null = getBot(data.bot_self_id)

    // 控制指令优先，它们不走消息转换，也不需要回执
    try {
      if (bot && (await this.handleControl(data, bot))) return
    } catch (err) {
      return this.log("error", ["处理控制指令错误", err])
    }

    // 回执必须在 finally 里发：核心 bot.py 的 target_send 在 wait_recall 时
    // 等一个 recall_message_id（RECALL_WAIT_TIMEOUT=10s），连续 3 次拿不到就会
    // 把本适配器标记为 _supports_recall=False，永久关掉撤回能力。
    // 参照 GenshinUID 的 Python 客户端（client.py 用 try/finally 保证同一件事）：
    // 无论找不到目标、内容为空还是发送抛错，都必须回一帧。
    let recallId: string | string[] | null = null
    try {
      if (!bot) {
        const account = String(data.bot_self_id ?? "").trim() || "(空)"
        this.log("error", `找不到机器人账号 ${account}`)
        return
      }
      // 纯日志帧要在 pick 之前挡掉：核心下发 log 段时 target_id 常是占位值，
      // 走到下面 pick 不到目标就会误报「找不到发送目标」。
      // 这里只判类型不做转换 —— gscoreToYunzai 会写日志、上传转发，跑两遍就重复了。
      const segs = Array.isArray(data.content) ? data.content : [data.content]
      if (segs.length && segs.every(i => i?.type && GS_LOG_RE.test(i.type))) {
        await gscoreToYunzai(data.content)
        return
      }

      // 先 pick 目标再转换：node 段在 Miao 上必须靠 target 的原生
      // makeForwardMsg 才能制作转发（Bot 上那个继承自 ICQQ，调用即抛）。
      const targetId = String(data.target_id ?? "")
      let target: SendTarget | undefined
      let tag: string

      if (data.target_type === "direct") {
        target = bot.pickFriend(Number(targetId) || targetId)
        tag = `好友 ${targetId}`
      } else {
        // 复合 id 先原样传：QQ 频道的 group_id 是 `qg_{guild}-{channel}`，
        // QQBot-Plugin 靠 qg_ 前缀分派到 pickGuild（index.js:1103），拆开就找不到了。
        let g = bot.pickGroup(Number(targetId) || targetId)
        // 退化取末段只对「纯粹用 - 连接两段数字」的复合 id 有意义。
        // qg_ 开头的绝不能拆 —— 拆出来的 channel_id 在 pickGroup 里会走进
        // 普通群分支，pick 到一个不存在的群。
        if (!g?.sendMsg && targetId.includes("-") && !targetId.startsWith("qg_")) {
          const last = targetId.split("-").at(-1)
          g = bot.pickGroup(Number(last) || last)
        }
        target = g
        tag = `群 ${targetId}`
      }

      if (!target?.sendMsg) {
        return this.log("error", `找不到发送目标 ${data.target_type}:${targetId}`)
      }

      const { message, quote, logOnly } = await gscoreToYunzai(data.content, target)
      if (logOnly || !message.length) return

      // 修复 ws-plugin 的 bug：上游算出 quote 却从未使用，引用回复全部失效
      if (quote) message.unshift(segment.reply(quote))

      markSent(echoKey(data.bot_self_id, targetId, message))
      makeLog(
        "info",
        `早柚核心消息：${logStr(message)}`,
        `${this.name} => ${data.bot_self_id}, ${tag}`,
        true,
      )
      const ret = await this.doSend(target, message, bot, data, targetId)

      // 计数放在 await 之后：sendMsg 抛错说明没发出去，那不算一次成功中转。
      // 纯日志帧和空消息在上面就 return 了，不会计进来。
      //
      // 但「没抛错」不等于成功：Milky 的 callApi 失败时返回
      // { retcode: -1, status: "failed", error }（Milky.js:424-434）而从不抛，
      // OneBot 系同理。只 await 不看返回值会把失败记成成功中转，
      // 而「连着但不通」恰是这个计数该抓到的情况。判定见 utils/send.ts。
      const err = sendError(ret)
      // QQBot 的「部分成功」不能当整体失败
      // ------
      // 它的 rets.error 从不清空（见 qqbotDelivered），四级阶梯自愈过的发送带着
      // 陈旧 error 回来。照 err 直接 return 有三重后果：误报一条 error 级「发送失败」、
      // 漏掉 count("down")、并且丢掉 recallId —— 而消息其实已经发出去了，
      // 核心侧的定时撤回就此失效（正是下面那条注释担心的 latch 语义）。
      // 所以这里只降级为 warn，计数与撤回 id 照常走。
      if (err && isQQBot(bot) && qqbotDelivered(ret)) {
        this.log(
          "warn",
          `发送部分失败（已投出，QQBot 内部重试过）：${err}（${segSummary(message)}）`,
        )
      } else if (err) {
        // 带上段类型摘要：「发送失败」最常见的成因是某类段被平台拒收（图片尤甚），
        // 有摘要才分得清是整条没发出去还是某种段不被接受
        this.log("error", `发送失败：${err}（${segSummary(message)}）`)
        // 不计数，但仍要走 finally 里的回执 —— 漏回会被核心 latch 成「不支持撤回」
        return
      }

      count("down", this.name)
      // 核心用这个 id 实现定时撤回；取不到就回 null，别让它干等 10s。
      // 可能是数组（ICQQ-Plugin 风控重试会拆多组），协议允许，原样透传
      recallId = sendMessageId(ret)
    } catch (err) {
      this.log("error", ["处理下行消息错误", err])
    } finally {
      this.sendRecallReceipt(data, recallId)
    }
  }
}
