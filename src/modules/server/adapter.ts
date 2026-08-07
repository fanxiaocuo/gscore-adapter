import { config, configFile } from "@/config"
import { USER_TYPES } from "@/constants"
import { logStr } from "@/utils"
import { msgToGscore, gscoreToYunzai, normalizeEventMsg } from "@/modules/convert"

const conf = config.server || {}

/**
 * 下行帧类型。
 *
 * 框架的 conn.sendMsg（lib/bot.js）对非 Buffer 入参会先 util.String() 再 send，
 * 发出的是**文本帧**。而早柚核心 core.py 的 /ws/{bot_id} 用 receive_bytes() 收，
 * 只认二进制帧 —— 两者不一致。
 *
 * 本插件 client 方向已显式 Buffer.from(...) 发二进制；server 方向此前沿用框架的
 * sendMsg，发的是文本。这里改为默认同样发二进制，让两个方向行为一致。
 *
 * 注意：server 方向的对端是"主动连入云崽的一方"，未必是 core.py 本体
 * （也可能是中继型适配器）。若你的对端明确要求文本帧，把配置里的
 * server.binary 设为 false 即可退回旧行为。
 * Node 的 ws 库收端 on("message") 两种帧都给 Buffer，通常无需关心。
 *
 * 每次发送时读，不在模块加载时求值 —— 那样改完配置得重启才生效，
 * 而这是个"对端不兼容"时用的逃生开关，理应改了就能用。
 */
const isBinary = () => (config.server || {}).binary !== false

export class GsCoreServerAdapter {
  id = conf.id || "GsCore"
  name = conf.name || "早柚核心"
  path = conf.path || "GsCore"

  /* ---------- 发送 ---------- */

  /**
   * 下发一条 MessageSend。
   *
   * 不走框架的 conn.sendMsg —— 那条路径对非 Buffer 会转成文本帧，
   * 与 client 方向（显式二进制）不一致。这里统一编码后再发，
   * 并保留框架同款的 debug 日志。
   */
  sendApi(bot, data) {
    const ws = bot.ws
    if (ws?.readyState !== 1) {
      Bot.makeLog("error", ["连接不可用，消息未发送", logStr(data)], this.id)
      return false
    }
    const text = Bot.String(data)
    Bot.makeLog("debug", ["消息", logStr(text)], `${this.id} => ${bot.uin}`, true)
    ws.send(isBinary() ? Buffer.from(text, "utf8") : text)
    return true
  }

  /**
   * 核心下发的控制指令（bot.py 的 _Bot.unsend / _Bot.ban）。
   * 拼写是 excute_ 不是 execute_，核心源码即如此，勿"修正"。
   * 两者都只在 content 长度为 1 时出现。
   *
   * 与 client 侧 GsCoreClient.handleControl 同构。
   * @returns 是否已作为控制指令处理
   */
  async handleControl(json, bot) {
    const list = Array.isArray(json.content) ? json.content : []
    if (list.length !== 1) return false
    const seg = list[0]
    const d = seg?.data || {}

    if (seg?.type === "excute_delete_message") {
      const id = d.message_id
      try {
        // 撤回接口在各适配器上位置不一：优先群/好友对象，退化到 bot 级
        const target =
          json.target_type === "direct"
            ? bot.pickFriend?.(Number(json.target_id) || json.target_id)
            : bot.pickGroup?.(Number(json.target_id) || json.target_id)
        const fn = target?.recallMsg || bot.recallMsg
        if (!fn) return Bot.makeLog("warn", "当前适配器不支持撤回消息", this.id), true
        await fn.call(target?.recallMsg ? target : bot, id)
        Bot.makeLog("info", `已撤回消息 ${id}`, this.id)
      } catch (err) {
        Bot.makeLog("error", ["撤回消息失败", err], this.id)
      }
      return true
    }

    if (seg?.type === "excute_ban_user") {
      const duration = Number(d.duration) || 0
      try {
        const group = bot.pickGroup?.(Number(d.group_id) || d.group_id)
        if (!group?.muteMember) return Bot.makeLog("warn", "当前适配器不支持禁言", this.id), true
        await group.muteMember(Number(d.user_id) || d.user_id, duration)
        Bot.makeLog(
          "info",
          `${duration ? `禁言 ${duration}s` : "解除禁言"}：${d.user_id}@${d.group_id}`,
          this.id,
        )
      } catch (err) {
        Bot.makeLog("error", ["禁言操作失败", err], this.id)
      }
      return true
    }

    return false
  }

  /**
   * 回执：核心 bot.py 的 target_send 在 wait_recall 时带 echo 下发，
   * 并在 _recall_waiters 里等一个 recall_message_id 回来（RECALL_WAIT_TIMEOUT=10s）。
   * 连续 3 次拿不到就会把本适配器标记为 _supports_recall=False，永久关掉撤回能力，
   * 所以即使发送失败也要回一帧（id 给 null），让核心的 future 立刻结束。
   *
   * 与 client 侧 GsCoreClient.sendRecallReceipt 同构，区别是发帧走 bot.ws。
   */
  sendRecallReceipt(bot, json, id) {
    if (!json.echo) return
    this.sendApi(bot, {
      bot_id: json.bot_id,
      bot_self_id: json.bot_self_id,
      msg_id: "",
      user_type: json.target_type || "group",
      group_id: json.target_type === "group" ? json.target_id : null,
      user_id: json.target_type === "direct" ? String(json.target_id ?? "") : "",
      sender: {},
      user_pm: 6,
      content: [{ type: "recall_message_id", data: { echo: json.echo, id } }],
    })
  }

  async sendMsg(data, target_type, target_id, msg) {
    const content = await msgToGscore(msg)
    Bot.makeLog(
      "info",
      `发送${target_type === "direct" ? "好友" : "群"}消息：${logStr(content)}`,
      `${data.self_id} => ${target_id}`,
      true,
    )
    data.bot.sendApi({
      bot_id: data.bot.bot_id,
      bot_self_id: data.bot.bot_self_id,
      msg_id: Date.now().toString(36),
      target_type,
      target_id: String(target_id),
      content,
    })
    return { message_id: Date.now().toString(36) }
  }

  sendFriendMsg(data, msg) {
    return this.sendMsg(data, "direct", data.user_id, msg)
  }

  sendGroupMsg(data, msg) {
    // group_id 是 `${user_type}-${真实id}` 的复合形式，发送时拆回
    const gid = String(data.group_id)
    const idx = gid.indexOf("-")
    const head = idx > -1 ? gid.slice(0, idx) : ""
    if (USER_TYPES.includes(head)) return this.sendMsg(data, head, gid.slice(idx + 1), msg)
    return this.sendMsg(data, "group", gid, msg)
  }

  /* ---------- pick ---------- */

  pickFriend(id, user_id) {
    const i: Record<string, any> = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id,
    }
    return {
      ...i,
      sendMsg: this.sendFriendMsg.bind(this, i),
      getAvatarUrl: () => i.avatar,
    }
  }

  pickMember(id, group_id, user_id) {
    const i = {
      ...Bot[id].fl.get(user_id),
      ...Bot[id].gml.get(group_id)?.get(user_id),
      self_id: id,
      bot: Bot[id],
      group_id,
      user_id,
    }
    return { ...this.pickFriend(id, user_id), ...i }
  }

  pickGroup(id, group_id) {
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      group_id,
    }
    return {
      ...i,
      sendMsg: this.sendGroupMsg.bind(this, i),
      pickMember: this.pickMember.bind(this, id, group_id),
    }
  }

  /* ---------- Bot 注册 ---------- */

  makeBot(data, ws) {
    // 必须留别名：下面 bot 对象里的 sendApi getter 有自己的 this（指向 bot，
    // 框架靠这个把 bot 自身当参数传进 sendApi），所以拿不到适配器实例。
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const adapter = this
    const bot: Record<string, any> = {
      adapter,
      ws,
      get sendApi() {
        return adapter.sendApi.bind(adapter, this)
      },
      uin: data.self_id,
      bot_id: data.raw.bot_id,
      bot_self_id: data.raw.bot_self_id,
      stat: { start_time: Date.now() / 1000 },
      version: { id: adapter.id, name: adapter.name },
      pickFriend: adapter.pickFriend.bind(adapter, data.self_id),
      get pickUser() {
        return this.pickFriend
      },
      pickMember: adapter.pickMember.bind(adapter, data.self_id),
      pickGroup: adapter.pickGroup.bind(adapter, data.self_id),
      fl: new Map(),
      gl: new Map(),
      gml: new Map(),
    }
    // @types/trss-yunzai 的 Client / Friend / Group / Member 是照 ICQQ 建模的，
    // 有 50+ 个成员；所有适配器注册的都是够用的子集，与框架实际约定一致。
    Bot[data.self_id] = bot as unknown as (typeof Bot)[string]
    data.bot = Bot[data.self_id]

    Bot.makeLog("mark", `${this.name}(${this.id}) 已连接`, data.self_id)
    Bot.em(`connect.${data.self_id}`, data)
  }

  /* ---------- 接收 ---------- */

  async message(raw, ws) {
    let json
    try {
      json = JSON.parse(raw)
    } catch (err) {
      return Bot.makeLog("error", ["解码数据失败", String(raw).slice(0, 300), err], this.id)
    }

    try {
      // 事件对象逐字段拼装，且要交给框架 em() 派发，
      // 形状随平台浮动，用宽松记录类型而非精确接口
      const data: Record<string, any> = {
        raw: json,
        self_id: json.bot_self_id,
        post_type: "message",
        message_id: json.msg_id,
        // 回环防护标记，client 方向依赖它
        gscore_origin: this.id,
        sender: {
          ...json.sender,
          user_id: json.user_id,
          user_pm: json.user_pm,
        },
        get user_id() {
          return this.sender.user_id
        },
        message: [],
        raw_message: "",
      }

      if (Bot[data.self_id]) {
        data.bot = Bot[data.self_id]
        data.bot.ws = ws
      } else {
        this.makeBot(data, ws)
      }

      // 控制指令优先，它们不走消息转换，也不是消息事件
      if (await this.handleControl(json, data.bot)) return

      data.bot.fl.set(data.user_id, {
        ...data.bot.fl.get(data.user_id),
        ...data.sender,
      })

      // 复用共享转换层
      const { message, quote, logOnly } = await gscoreToYunzai(json.content)
      // 纯 log_ 帧：gscoreToYunzai 已把内容打到日志，message 为空。
      // 不短路的话会派发一条空消息事件，下游插件按空消息处理。
      // client 侧 GsCoreClient.ts:330 对同一情况同样短路。
      // 带 echo 时仍要回执，否则核心会一直等到超时。
      if (logOnly || !message.length) return this.sendRecallReceipt(data.bot, json, null)
      if (quote) message.unshift(segment.reply(quote))
      data.message = normalizeEventMsg(message)
      data.raw_message = Bot.String(data.message)

      if (json.user_type === "direct") {
        data.message_type = "private"
        Bot.makeLog(
          "info",
          `好友消息：${data.raw_message}`,
          `${data.self_id} <= ${data.user_id}`,
          true,
        )
      } else {
        data.message_type = "group"
        // 复合 id：发送时由 sendGroupMsg 拆回
        data.group_id = `${json.user_type}-${json.group_id}`

        if (!data.bot.gl.has(data.group_id))
          data.bot.gl.set(data.group_id, { group_id: data.group_id })
        let gml = data.bot.gml.get(data.group_id)
        if (!gml) {
          gml = new Map()
          data.bot.gml.set(data.group_id, gml)
        }
        gml.set(data.user_id, { ...gml.get(data.user_id), ...data.sender })

        Bot.makeLog(
          "info",
          `群消息：${data.raw_message}`,
          `${data.self_id} <= ${data.group_id}, ${data.user_id}`,
          true,
        )
      }

      Bot.em(`${data.post_type}.${data.message_type}`, data)

      // 本方向是"核心把消息派发给云崽本地插件"，不是代发到平台，
      // 没有可供撤回的平台 message_id。但带 echo 时仍须回执，
      // 否则核心等满 RECALL_WAIT_TIMEOUT，连续 3 次后永久关闭撤回能力。
      this.sendRecallReceipt(data.bot, json, null)
    } catch (err) {
      // 出错也要回执，否则核心干等 10s。bot 可能还没建起来，取不到就跳过。
      if (Bot[json.bot_self_id]) this.sendRecallReceipt(Bot[json.bot_self_id], json, null)
      Bot.makeLog("error", ["处理消息错误", err], this.id)
    }
  }

  /* ---------- 注册 ---------- */

  load() {
    // 路由冲突检测。Bot.wsf[path] 是处理器数组，wsConnect 会遍历调用全部，
    // 两个处理器绑同一连接 = 每条消息被处理两次，且完全静默无报错。
    // 放在 load() 而非 import 时：所有适配器的 push 都在 PluginsLoader.load()
    // 的 Promise.allSettled 里，相对顺序无保证；load() 在其后统一执行。
    const dup = Bot.adapter.find(a => a !== this && a.path === this.path)
    const occupied = Array.isArray(Bot.wsf[this.path]) && Bot.wsf[this.path].length

    if (dup || occupied) {
      const tips = [
        `WebSocket 路由 ${logger.red(this.path)} 已被占用${dup ? `（${dup.name}/${dup.id}）` : ""}`,
        "两个处理器会同时绑定同一连接，导致每条消息被处理两次。",
        `请修改 ${configFile} 的 server.path，或删除 plugins/adapter/GSUIDCore.js`,
      ]
      if ((conf.on_conflict || "abort") !== "force") {
        Bot.makeLog("error", [...tips, "已放弃注册（on_conflict: abort）"], this.id)
        return
      }
      Bot.makeLog("warn", [...tips, "on_conflict: force，仍然注册"], this.id)
    }

    if (!Array.isArray(Bot.wsf[this.path])) Bot.wsf[this.path] = []
    // 框架给 handler 传的其余参数（req 等）本适配器不用，不再往下透传
    Bot.wsf[this.path].push(ws => ws.on("message", data => this.message(data, ws)))
    Bot.makeLog("mark", `早柚核心服务端已监听 /${this.path}`, this.id)
  }
}
