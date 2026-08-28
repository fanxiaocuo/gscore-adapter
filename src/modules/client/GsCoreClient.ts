import { WebSocket } from "ws"
import { config, resolveBotId } from "@/config"
import {
  STATUS_TEXT,
  GS_LOG_RE,
  DEFAULT_MAX_RECONNECT,
  MAX_TIMER_DELAY,
  reconnectBase,
} from "@/constants"
import {
  logStr,
  sendMessageId,
  classifyDelivery,
  deliveryComplete,
  deliveryDelivered,
} from "@/utils"
import { redactUrl, routeKey } from "@/utils/url"
import { makeLog } from "@/utils/compat"
import { setLocalHint } from "@/utils/fileServer.js"
import { yunzaiToGscore, gscoreToYunzai } from "@/modules/convert"
import { metaToGscore, metaLogStr, type MetaEvent } from "@/modules/notice"
import { count } from "@/modules/stats/index.js"
import { eventIdOf, isEventId, isQQBot, take } from "@/modules/passive"
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
 * @description 段类型摘要，例如 "image×1,text×1"
 * 只统计类型与个数：下行日志里绝不能出现媒体正文或鉴权信息（base64 图片一条就是几十万字符，外链可能带
 * 查询参数形式的凭据），而排查「图片没发出去」真正需要的只是「这条消息里有没有 image 段」。
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
 * @description 被动发送要的是「完整的会话上下文」：目标上缺一项字段，QQBot-Plugin 就在自己内部抛出来
 * 逐条对应各发送函数实际读的字段：sendGroupMsg 读 group_id、sendFriendMsg 读 user_id、sendGuildMsg 读 channel_id。
 * 注意：不能笼统查 group_id —— 频道那支真正要用的 channel_id 没查，可能缺的 group_id 反倒成了硬条件，
 * 于是频道的被动回复会被静默降级成普通发送，日志里只写「无被动窗口」。
 */
function passiveReady(target: SendTarget, type: "direct" | "group", targetId: string): boolean {
  // 直接读字段，不再 `as Record<string, unknown>`：那个断言等于 any，这几项现在在 SendTarget 上有声明
  if (!target.self_id || !target.bot) return false
  if (type === "direct") return !!target.user_id
  return targetId.startsWith("qg_") ? !!target.channel_id : !!target.group_id
}

/*
 * 下行投递判定见 utils/send.ts 的 classifyDelivery
 *
 * 注意：这里别再放一个本地的「投出去了」判据。曾有一个 `data.length > 0` 的版本被 doSend 与 onMessage
 * 各判一套，而「至少一个分组成功」既答不了「要不要重发」也答不了「算不算完整成功」，它把半条消息计成了
 * 一次完整中转。现在两条路径共用 classifyDelivery + deliveryDelivered / deliveryComplete，判据只有一份。
 */

export class GsCoreClient {
  conf: WsConnection | RuntimeWsConnection
  name: string
  /**
   * 稳定身份，见 {@link RuntimeWsConnection.runtimeKey}
   *
   * reconcileClients 拿它跟目标计划比对，决定这条客户端是留着、原地改元信息、
   * 还是停掉重起。名字与 sourceIndex 都会随「改名 / 删掉前面一条」变，只有它不变。
   */
  runtimeKey: string
  sourceIndex: number
  account: string | null
  target: string
  /** 0 未连接/已停止 1 已连接 2 连接中 3 断线待重连 */
  status: 0 | 1 | 2 | 3
  retry: number
  stop: boolean
  ws: WebSocket | null
  // 用 undefined 而非 null 作空值：clear{Timeout,Interval} 接受 undefined，传 null 在 strict 下会被拒
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
    // 逻辑连接直传时自己算一次：手动重连那条路会拿裸 conf 造客户端，没有 key 的话
    // 它在下一次 reconcile 里会被判成「不在计划里」而被停掉
    this.runtimeKey = rt.runtimeKey || routeKey(this.target)
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
   * @description 可读状态，供文字指令显示（#早柚状态 / #早柚连接列表 的文本回复）
   * 措辞与出图、面板对齐成「已重连」：写「重连 N 次」会被读成「还要重连 N 次」，而这里说的是已经重连过的次数。
   * 注意：面板不用这个 getter —— 它另有 retry 字段并单独渲一个标签，用了就是把同一个数在一行里写两遍。
   */
  get statusText() {
    return STATUS_TEXT[this.status] + (this.retry ? `(已重连${this.retry}次)` : "")
  }

  /** @description 早柚核心用 ?token= 查询参数鉴权，不使用请求头 */
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
      // maxPayload 与 handshakeTimeout 都必须显式给，取值参照 GenshinUID 的 Python 客户端
      // （client.py: max_size=2**26、open_timeout=60）。
      // ws 默认 maxPayload 是 100MiB，而超限不是「丢掉这一帧」—— receiver.js 会抛 RSV 错误并把整条连接
      // 拆掉，表现为无缘无故断线重连，日志里只有一个 code=1009，很难查。不给 handshakeTimeout 则退化到
      // OS 的 TCP 超时，防火墙黑洞掉 SYN 时能卡在 CONNECTING 好几分钟：status 一直是 2、close 事件不来、
      // scheduleReconnect 永不触发，表现为「连接中」假死。
      //
      // 注意：刻意不给任何 TLS 选项。wss:// 本身是通的，带正经证书的核心直接就能连，缺的只有自签 / 私有
      // CA —— 需要时用 NODE_EXTRA_CA_CERTS 启动云崽，别在这里塞 rejectUnauthorized: false，那是把中间人
      // 防护整个关掉，而这个选项一旦加进配置就会被人复制到公网连接上。
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
    // 记下这条连接走的本机地址：内置文件服务用它拼外链 host，比硬写 127.0.0.1 靠谱
    // （核心常在 Docker 或另一台机器上）
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

    // 注意：超时检测依赖 pong 刷新 lastPong，而 pong 只会因我们发 ping 而来 —— iv === 0（不发 ping）时
    // 必须一并关掉检测，否则 lastPong 永不更新，必然超阈值 → 无条件 terminate → 断线重连死循环
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
   * @description 连接关闭：主动停的直接落到 status 0，否则打日志、通知主人并排重连
   * @param reason ws 给的是 Buffer（对端可以不带原因，那就是个空 Buffer），靠 `reason?.length` 判空即可
   */
  onClose(code: number, reason: Buffer) {
    this.stopHeartbeat()
    const wasOnline = this.status === 1
    this.status = 3

    // close() 主动关闭时不摘监听器，close 事件仍会走到这里。注意：通知必须在 stop 判断之后，
    // 否则 reloadClients() 逐个 close 会给主人刷 N 条"已断开"，而实际只是重载配置
    if (this.stop) {
      this.status = 0
      return
    }

    this.log("warn", `连接已关闭 code=${code}${reason?.length ? ` reason=${reason}` : ""}`)
    if (wasOnline && config.notify_master) this.notify(`${this.name} 已断开`)
    this.scheduleReconnect(code)
  }

  /**
   * @description 排一次指数退避重连
   * @param code 关闭码；创建连接就失败时调用方传 -1（没有关闭码可言）
   */
  scheduleReconnect(code: number) {
    if (this.stop) {
      this.status = 0
      return
    }

    // ?? 而不是 ||：配了 0 是「显式要无限重连」，不能被兜成默认值。字段缺失按默认次数算
    const max = Number(this.conf.max_reconnect_attempts ?? DEFAULT_MAX_RECONNECT)
    if (max > 0 && this.retry >= max) {
      this.status = 0
      return this.log("error", `达到最大重连次数 ${max}，停止重连（可用 #早柚重连 恢复）`)
    }

    // 注意：1005 = No Status Received，只是对端关闭时没带状态码（Python 侧重启很常见），完全可恢复，
    // 所以继续重连、只多打一条说明。ws-plugin 在这个码上彻底放弃重连，别照抄
    if (code === 1005) this.log("warn", "对端未提供关闭码(1005)，通常是核心重启，继续重连")

    this.retry++
    // 指数退避：base * 2^(retry-1)，封顶 base 的 12 倍（默认 5s → 最长 60s）。配成无限重试时
    // 退避让它收敛到低频探活，而不是以固定间隔一直打日志、占连接
    // 注意：上下界都要夹 —— 手改 yaml 那条路没有任何校验，负数会算出负延时，而大得离谱的值会超过
    // setTimeout 的上限被回退成 1ms，两头都是热重连循环
    const base = reconnectBase(this.conf.reconnect_interval)
    const wait = Math.min(base * 2 ** (this.retry - 1) * 1000, base * 12000, MAX_TIMER_DELAY)
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

  /** @description 本连接是否接管该 self_id */
  accept(self_id: string | number) {
    const id = String(self_id)
    const exclude = this.conf.exclude || []
    if (exclude.length && exclude.some(i => String(i) === id)) return false
    const bind = this.conf.bind || []
    if (bind.length && !bind.some(i => String(i) === id)) return false
    return true
  }

  /* ---------- 上行：云崽 -> 早柚核心 ---------- */
  /**
   * @description 上行：把云崽的消息事件转成核心帧发出去
   * @param selfId 已由 hooks 的 resolveSelfId 解析过，非空；e.self_id 可能是 null
   */
  async sendReceive(e: AdapterEvent, isMaster: boolean, selfId = String(e.self_id ?? "")) {
    if (this.status !== 1 || this.ws?.readyState !== WebSocket.OPEN) return false

    const botId = resolveBotId(e, this.conf, selfId)
    const data = await yunzaiToGscore(e, botId, { isMaster, selfId })
    if (!data) return false

    // 只在真的发出去时计数：send 在 readyState 不是 OPEN 时返回 false，那种情况下这条消息
    // 并没有中转成功，计进去会让「连着但不通」的故障看不出来
    if (!this.send(data)) return false
    count("up", this.name)
    makeLog("debug", `上报早柚核心：${logStr(data.content)}`, `${selfId} => ${this.name}`, true)
    return true
  }

  /**
   * @description 上行：非消息事件（入群/退群/戳一戳）。单向通知，核心不回执，发出即完成
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
   * @description 发一帧到核心，必须是二进制帧
   * 核心 core.py 的读循环是 websocket.receive_bytes()，而 ws 库对 string 发的是文本帧(opcode 1)，
   * Starlette 那边取不到 "bytes" 键会直接报错。
   * @param data 上行帧。标 unknown 而不是 `MessageReceive`：撤回回执那一帧的 content 放的是
   *             `recall_message_id` 段（协议里是独立结构，见 {@link RecallReceipt}），套不进
   *             MessageReceive.content。这里只负责序列化，帧的形状由各调用点自己保证
   */
  send(data: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(Buffer.from(JSON.stringify(data), "utf8"))
    return true
  }

  /**
   * @description 撤回回执：核心 bot.py 的 target_send 在 wait_recall 时会带 echo 下发并等一个
   * recall_message_id 回来（RECALL_WAIT_TIMEOUT=10s）
   * 注意：即使发送失败也要回一帧（id 给 null）—— 连续 3 次拿不到，核心就把本适配器标记为
   * _supports_recall=False，永久关掉撤回能力。
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
   * @description 核心下发的控制指令（bot.py 的 _Bot.unsend / _Bot.ban），两者都只在 content 长度为 1 时出现
   * 注意：拼写是 excute_ 不是 execute_，核心源码即如此。
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
        if (!fn) return (this.log("warn", "当前适配器不支持撤回消息"), true)
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
        if (!group?.muteMember) return (this.log("warn", "当前适配器不支持禁言"), true)
        await group.muteMember(Number(d.user_id) || d.user_id, duration)
        this.log(
          "info",
          `${duration ? `禁言 ${duration}s` : "解除禁言"}：${d.user_id}@${d.group_id}`,
        )
      } catch (err) {
        this.log("error", ["禁言操作失败", err])
      }
      return true
    }

    return false
  }

  /**
   * @description 实际发送：QQBot 上尽量走被动回复，带上该会话最近一条入站消息的 id，让回复显示为引用
   * 核心下发不带原消息 id，所以那个 id 由 modules/passive 自己记着。失败即回退普通发送 —— 那个 id 可能已被
   * 平台判为过期，宁可丢掉引用形态，不能让消息发不出去。
   * 注意：不能直接用 target.sendMsg —— QQBot-Plugin 的 pick* 返回的 sendMsg 只收一个参数，第三个 event
   * 参数被吃掉了，从 pick 出来的对象上没法传被动回复凭据；所以这条路径直接调 adapter 上的
   * sendGroupMsg(data, msg, event)，把 pick 出来的对象当上下文传进去。
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

    // 注意：先确认有能收 event 的发送函数、且目标带齐上下文，再去 take —— take 会记一次使用次数
    // （上限按场景分档，群 5 / 单聊 4，见 passive 的 MAX_USES），顺序反了会在「这条路径走不通」时白耗额度
    const fn = this.passiveSender(bot.adapter, type, targetId)
    const msgId =
      fn && passiveReady(target, type, targetId) ? take(data.bot_self_id, type, targetId) : ""
    if (!fn || !msgId) {
      this.log("debug", `下行发送（无被动窗口）：${brief}`)
      return await target.sendMsg(message)
    }

    try {
      /*
       * 交互事件走 `event_id`，消息走 `id` —— 两个不同的字段，不能混。
       * QQBot-Plugin 的发送函数第三参同时认这两个键（index.js:1386），而官方接口对按钮回调
       * 这类交互只收 event_id；填进 id 里平台不认，那次被动回复白费。
       * 前缀由 modules/passive 原样存着，剥前缀的活在它那儿（eventIdOf）
       */
      const event = isEventId(msgId) ? { event_id: eventIdOf(msgId) } : { id: msgId }
      const ret = await fn(target, message, event)
      // 只在「一条都没投出去」时才回退：QQBot 内部自愈过的发送带着陈旧 error 回来，照 sendError
      // 判会重发整条；部分成功的也不能重发，那会复制已经投出去的分组 —— 见 utils/send.ts 的 classifyDelivery
      if (deliveryDelivered(classifyDelivery(ret))) {
        this.log("debug", `下行发送（被动回复）：${brief}`)
        return ret
      }
      this.log("debug", `被动回复未投出，改为不带 id 发送：${brief}`)
    } catch (err) {
      this.log("debug", [`被动回复异常，改为不带 id 发送：${brief}`, err])
    }
    // 回退复用同一个 message 引用是安全的：QQBot-Plugin 的 makeMsg / makeRawMarkdownMsg / makeGuildMsg
    // 都先浅拷贝段再改、往新建数组 push，不回写入参。唯一按引用透传的是 raw 段，而本插件下行从不产出 raw
    return await target.sendMsg(message)
  }

  /**
   * @description 取能接收 event 参数的发送函数，按目标形状分派到 sendGroupMsg / sendFriendMsg / sendGuildMsg
   * 频道靠 group_id 上的 qg_ 前缀识别，同 QQBot-Plugin 自己 pickGroup/pickFriend 里的判断。
   * 注意：频道私聊（sendDirectMsg）有意排除 —— 它会在缺 guild_id 时先 createDirectSession 建会话并改写 data，
   * 塞进被动回复这条路径要连带处理那段副作用，收益不值这个风险。它照常走 target.sendMsg。
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
    /*
     * 第三参是两种凭据之一：消息走 `id`、交互事件走 `event_id`（QQBot-Plugin 的发送函数
     * index.js:1386 同时认这两个键）。标成联合类型而不是 `{ id: string }` —— 后者会把
     * 交互事件那一支挡在编译期外，而它正是按钮回调唯一能用的形式
     */
    return (t: SendTarget, msg: any[], event: { id: string } | { event_id: string }) =>
      fn.call(adapter, t, msg, event)
  }

  /* ---------- 下行：早柚核心 -> 云崽 ---------- */
  /**
   * @description 下行：核心下发的一帧，转成云崽消息发给目标，并回一帧撤回回执
   * @param raw ws 的 message 事件载荷。核心发的是二进制帧（Buffer），但 ws 的类型把碎片帧的 Buffer[] 与
   *            ArrayBuffer 也算进来，所以统一 toString 而不假定是 Buffer
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

    // 注意：回执必须在 finally 里发 —— 无论找不到目标、内容为空还是发送抛错都要回一帧，
    // 漏回会被核心 latch 成「不支持撤回」（见 sendRecallReceipt）
    let recallId: string | string[] | null = null
    try {
      if (!bot) {
        const account = String(data.bot_self_id ?? "").trim() || "(空)"
        this.log("error", `找不到机器人账号 ${account}`)
        return
      }
      // 纯日志帧要在 pick 之前挡掉：核心下发 log 段时 target_id 常是占位值，走到下面 pick
      // 不到目标就会误报「找不到发送目标」。这里只判类型不做转换 —— gscoreToYunzai 会写日志、
      // 上传转发，跑两遍就重复了
      const segs = Array.isArray(data.content) ? data.content : [data.content]
      if (segs.length && segs.every(i => i?.type && GS_LOG_RE.test(i.type))) {
        await gscoreToYunzai(data.content)
        return
      }

      // 先 pick 目标再转换：node 段在 Miao 上必须靠 target 的原生 makeForwardMsg 才能制作转发
      // （Bot 上那个继承自 ICQQ，调用即抛）
      const targetId = String(data.target_id ?? "")
      let target: SendTarget | undefined
      let tag: string

      if (data.target_type === "direct") {
        target = bot.pickFriend(Number(targetId) || targetId)
        tag = `好友 ${targetId}`
      } else {
        // 复合 id 先原样传：QQ 频道的 group_id 是 `qg_{guild}-{channel}`，QQBot-Plugin 靠 qg_
        // 前缀分派到 pickGuild，拆开就找不到了
        let g = bot.pickGroup(Number(targetId) || targetId)
        // 注意：退化取末段只对「纯粹用 - 连接两段数字」的复合 id 有意义，qg_ 开头的绝不能拆 ——
        // 拆出来的 channel_id 会在 pickGroup 里走进普通群分支，pick 到一个不存在的群
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
      // 注意：「没抛错」也不等于成功 —— Milky 的 callApi 失败时返回 { retcode: -1, ... } 而从不抛，
      // OneBot 系同理，只 await 不看返回值会把失败记成成功中转，而「连着但不通」恰是这个计数该抓到的
      const delivery = classifyDelivery(ret)

      // 部分投出：不能计完整成功，也不能当整条失败
      // ------
      // QQBot 把一条下行拆成多个分组逐个发，`data` 与 `error` 同时非空时分不清「它自己重试成功了」
      // 还是「有一组永久失败」。处置取两者的交集：撤回 id 照回（消息确实出去了，漏回会让核心侧的
      // 定时撤回失效），但不计一次完整中转（宁可少计，不能把半条当整条）。
      if (delivery.kind === "partial") {
        const n = delivery.delivered == null ? "" : `已投出 ${delivery.delivered} 组，`
        this.log("error", `发送部分失败：${delivery.error}（${n}${segSummary(message)}）`)
        recallId = sendMessageId(ret)
        return
      }

      if (!deliveryComplete(delivery)) {
        // 带上段类型摘要：「发送失败」最常见的成因是某类段被平台拒收（图片尤甚），
        // 有摘要才分得清是整条没发出去还是某种段不被接受
        this.log("error", `发送失败：${delivery.error}（${segSummary(message)}）`)
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
