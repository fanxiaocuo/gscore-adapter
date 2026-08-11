import { saveConfig, getConnections, enabled } from "@/config"
import { clients, startClient, stopClient } from "@/modules/client"
import { DEFAULT_MAX_RECONNECT, STATUS_TEXT } from "@/constants"
import { makeLog } from "@/utils/compat"
import { normalizeUrl } from "@/utils/url"
import { resolveSelfId } from "@/utils/message"
import { guessPlatform } from "@/utils/platform"
// 中文设置项的表与解析单独一个模块，理由见 utils/settings.ts 的文件头
import { CN_LABEL, CN_NAMES, doneLine, parseCN } from "@/utils/settings"
import { renderConfig, renderHelp, renderList, renderSettings } from "@/modules/render/pages"
import { helpText } from "@/modules/render/commands"

/** 关闭状态下不热启动连接 */
function clientMode() {
  return enabled()
}

/** 单条连接的字段，由 #早柚添加连接 / #早柚修改连接 消费 */
const CONNECTION_KEYS = [
  "name",
  "url",
  "token",
  "bot_id",
  // 账号白名单。默认取「发指令的那个 Bot」，写 bind=all 表示不限账号，
  // bind=<账号> 指定别的 Bot。多个账号请直接编辑配置文件（这里只收一个值，
  // 因为 parseKV 是按空白与逗号切片的，列表进不来）
  "bind",
  "enable",
  "reconnect_interval",
  "max_reconnect_attempts",
]

/** 全局字段，由 #早柚设置 消费 */
const GLOBAL_KEYS = [
  "enable",
  "only_reply_at",
  "report_private",
  "report_group",
  "report_meta",
  "notify_master",
  "media_max_size",
  "update_check",
]

/**
 * 字段简写
 *
 * max_reconnect_attempts=5 在手机上敲一遍要二十多个字符，而这条指令的使用者
 * 多半正蹲在群里救一个连不上的核心。简写只加在**长字段**和最常用的两项上：
 * 单字母全部避开有歧义的（b 既像 bind 又像 bot_id，索引不进来）。
 */
const KV_ALIAS: Record<string, string> = {
  n: "name",
  t: "token",
  id: "bot_id",
  interval: "reconnect_interval",
  retry: "max_reconnect_attempts",
}

/**
 * 可用的 key=value 选项名。限定白名单，否则 ws://host 里的 "ws:" 会被当成 key。
 * 两类合在一起解析，各命令再挑自己认的那部分——这样用错命令时能给出
 * 指向性提示，而不是笼统的"未知项"。
 */
const KV_KEYS = [...CONNECTION_KEYS, ...GLOBAL_KEYS, ...Object.keys(KV_ALIAS)]
const KV_RE = new RegExp(`^(${KV_KEYS.join("|")})[=:：](.*)$`, "i")

/** 从命令里解析 key=value，支持中英文冒号/等号；简写归一成正式字段名 */
function parseKV(text): Record<string, string> {
  const out: Record<string, string> = {}
  for (const seg of text.split(/[\s,，]+/)) {
    if (!seg) continue
    const m = seg.match(KV_RE)
    if (!m) continue
    const key = m[1].toLowerCase()
    out[KV_ALIAS[key] || key] = m[2]
  }
  return out
}

/** 是否为 key=value 片段（用于把剩下的那个片段认作地址） */
function isKV(seg) {
  return KV_RE.test(seg)
}

export default class GsCoreAdmin extends plugin {
  constructor() {
    super({
      name: "早柚核心连接管理",
      dsc: "命令式增删改查早柚核心 ws 连接",
      event: "message",
      priority: 500,
      rule: [
        { reg: "^#?早柚(核心)?(添加|新增)连接\\s*(.+)$", fnc: "add", permission: "master" },
        { reg: "^#?早柚(核心)?(删除|移除)连接\\s*(.+)$", fnc: "del", permission: "master" },
        { reg: "^#?早柚(核心)?连接列表$", fnc: "list", permission: "master" },
        { reg: "^#?早柚(核心)?(开启|启用)连接\\s*(.+)$", fnc: "enable", permission: "master" },
        { reg: "^#?早柚(核心)?(关闭|停用)连接\\s*(.+)$", fnc: "disable", permission: "master" },
        // 空参数单独一条规则，且排在带参数那条前面。
        // 合成一条 `(.*)` 会让 e.msg.replace 之后的 raw 为空串，两种语义混在
        // 一个函数里；分开写则 set() 拿到的一定是有内容的参数串
        { reg: "^#?早柚(核心)?设置$", fnc: "show", permission: "master" },
        { reg: "^#?早柚(核心)?设置\\s*(.+)$", fnc: "set", permission: "master" },
        { reg: "^#?早柚(核心)?(配置|当前配置)$", fnc: "show", permission: "master" },
        { reg: "^#?早柚(核心)?帮助$", fnc: "help", permission: "master" },
      ],
    })
  }

  /**
   * 帮助
   *
   * 优先出图；渲染失败（没装 Chromium、截图超时等）回落纯文本。
   * 两者同源于 render/commands.ts 的 HELP_GROUPS，不会出现图文不一致。
   */
  async help(e) {
    const img = await renderHelp()
    return e.reply(img || helpText())
  }

  /**
   * 当前配置总览（不带参数的 #早柚设置 / #早柚配置）
   *
   * 原来这条走的是带参数那个规则，`(.+)` 要求至少一个字符，空参数根本匹配不上
   * 任何规则——插件不会被触发，所以「没渲染也没数据」。现在单独一条规则接到这里。
   *
   * 渲染失败时回落成一行行文本，与 set() 的失败路径一致。
   */
  async show(e) {
    const img = await renderConfig()
    if (img) return e.reply(img)
    return e.reply(
      `早柚核心适配器  ${enabled() ? "已启用" : "已禁用"}\n` +
        `连接 ${getConnections().length} 个\n\n` +
        `改配置：#早柚设置<项目><开启/关闭>\n` +
        `可设：${CN_NAMES}\n` +
        `例：#早柚设置适配器开启 · #早柚设置最大媒体大小 2`,
    )
  }

  /** 按名字或 1 起的序号定位连接 */
  find(key) {
    const list = getConnections()
    key = String(key).trim()
    const idx = Number(key)
    if (Number.isInteger(idx) && idx >= 1 && idx <= list.length)
      return { index: idx - 1, conf: list[idx - 1] }
    const i = list.findIndex(c => c.name === key)
    return i > -1 ? { index: i, conf: list[i] } : null
  }

  async add(e) {
    const raw = e.msg.replace(/^#?早柚(核心)?(添加|新增)连接\s*/, "").trim()
    if (!raw)
      return e.reply(
        "用法：#早柚添加连接 127.0.0.1:8765\n" +
          "只填 host:port 即可，其余留空取默认。\n" +
          "可选：n=名字 t=token id=平台标识\n详见 #早柚帮助",
      )

    const kv = parseKV(raw)
    // 第一个不含 = 的片段视为地址
    const urlPart = raw.split(/[\s,，]+/).find(s => s && !isKV(s))
    const url = normalizeUrl(kv.url || urlPart)
    if (!url) return e.reply("没解析出地址，用法：#早柚添加连接 ws://127.0.0.1:8765/ws/Yunzai")

    const list = getConnections()
    if (list.some(c => c.url === url)) return e.reply(`该地址已存在：${url}`)

    let name = kv.name || `core${list.length + 1}`
    if (list.some(c => c.name === name)) name = `${name}-${Date.now().toString(36).slice(-4)}`

    // 默认把连接绑到「收到这条指令的那个机器人」
    // ------
    // bind 是 self_id 白名单（GsCoreClient.accept），空数组表示所有 Bot 都往这条
    // 连接上报。多 Bot 共存时那个默认值意味着：管理员在 A 号上加的连接，B 号的
    // 消息也会跟着进同一个核心，而 bind 只能事后手动补 —— 指令里根本没有这个字段。
    // ws-plugin 同样的位置是把 e.self_id 推进 i.uin（apps/admin.js:310）。
    //
    // 注意别拿 bot_id 当这个用：那是发给核心的**平台**标识（onebot / qqgroup），
    // 与账号不是一回事，见 config/resolveBotId。
    //
    // resolveSelfId 而不是裸 e.self_id：后者可能为 null（见 utils/message.ts），
    // 那时 String(null) 会把 "null" 当账号写进白名单，这条连接就再也收不到消息。
    // 解析不出账号时留空数组 —— 宁可退回「不限账号」的旧行为，也不写一个错的。
    const selfId = resolveSelfId(e)
    const bind = kv.bind ? (kv.bind === "all" ? [] : [kv.bind]) : selfId ? [selfId] : []

    // 平台标识：用户没写 id= 就按账号形状推一次
    // ------
    // 原来一律留空，靠上报时 resolveBotId 查 bot_id_map。那张表只认适配器 id/name，
    // QQBot 的 appid 与非 QQ 平台的账号（wx_ / tg_ / dc_）在表里根本没有键，
    // 全部被 default: onebot 兜掉 —— 核心侧收到的平台就是错的。
    // guessPlatform 按账号前缀与 appid 形状判断，见 utils/platform.ts。
    //
    // 推不出仍写 null（与改动前一致）：那时候留给运行时按 bot_id_map 走，
    // 比在这里写死一个可能错的值好。
    const botId = kv.bot_id || (selfId ? guessPlatform(selfId, globalThis.Bot?.[selfId]) : "")

    const conf = {
      name,
      url,
      token: kv.token || null,
      bot_id: botId || null,
      enable: true,
      reconnect_interval: Number(kv.reconnect_interval) || 5,
      // retry=0 要能写进去（那是「无限重连」的显式选择），所以不能用 `|| 默认值` ——
      // Number("0") 是 0、falsy，会被兜回默认值
      max_reconnect_attempts: Number.isFinite(Number(kv.max_reconnect_attempts || NaN))
        ? Number(kv.max_reconnect_attempts)
        : DEFAULT_MAX_RECONNECT,
      bind,
      exclude: [],
    }

    try {
      saveConfig(doc => {
        if (!doc.hasIn(["client", "connections"])) doc.setIn(["client", "connections"], [])
        doc.getIn(["client", "connections"]).add(doc.createNode(conf))
      })
    } catch (err: any) {
      makeLog("error", ["写入配置失败", err], "GsCore")
      return e.reply(`保存失败：${err.message}`)
    }

    const started = clientMode() ? startClient(conf) : null
    return e.reply(
      `已添加连接 ${name}\n地址：${url}\n` +
        // 把绑定结果说出来：这是这条指令唯一不来自用户输入的字段，
        // 不显示的话多 Bot 环境里没人知道它到底绑到了哪个号
        (bind.length ? `绑定账号：${bind.join("、")}（bind=all 可改为不限）\n` : "账号：不限\n") +
        // 平台标识同理 —— 它现在也可能不来自用户输入
        (kv.bot_id
          ? `平台标识：${botId}\n`
          : botId
            ? `平台标识：${botId}（自动识别，可用 id= 覆盖）\n`
            : "平台标识：未识别，上报时按 bot_id_map 推断\n") +
        (started
          ? "已开始连接，稍后可用 #早柚状态 查看"
          : clientMode()
            ? "配置已保存，可用 #早柚重连 启动"
            : "适配器当前已禁用（enable: false）。发 #早柚设置适配器开启 即可启用"),
    )
  }

  async del(e) {
    const key = e.msg.replace(/^#?早柚(核心)?(删除|移除)连接\s*/, "").trim()
    const hit = this.find(key)
    if (!hit) return e.reply(`找不到连接「${key}」，用 #早柚连接列表 查看`)

    try {
      saveConfig(doc => doc.deleteIn(["client", "connections", hit.index]))
    } catch (err: any) {
      return e.reply(`保存失败：${err.message}`)
    }

    stopClient(hit.conf.name)
    return e.reply(`已删除连接 ${hit.conf.name}（${hit.conf.url}）`)
  }

  async list(e) {
    const img = await renderList()
    if (img) return e.reply(img)

    // 文本回退
    const list = getConnections()
    if (!list.length) return e.reply("还没有配置任何连接\n用 #早柚添加连接 <地址> 添加")

    const msg = [`早柚核心连接（共 ${list.length} 个）  ${enabled() ? "已启用" : "已禁用"}`]
    list.forEach((c, i) => {
      const live = clients.find(x => x.name === c.name)
      const state = c.enable === false ? "已停用" : STATUS_TEXT[live?.status ?? 0] || "未启动"
      msg.push(
        `\n\n${i + 1}. ${c.name}  [${state}]` +
          `\n   ${c.url}` +
          (c.token ? "\n   token: 已设置" : "") +
          (c.bot_id ? `\n   bot_id: ${c.bot_id}` : "") +
          (live?.retry ? `\n   已重连 ${live.retry} 次` : ""),
      )
    })
    return e.reply(msg.join(""))
  }

  async enable(e) {
    return this.toggle(e, true)
  }

  async disable(e) {
    return this.toggle(e, false)
  }

  async toggle(e, on) {
    const key = e.msg.replace(/^#?早柚(核心)?(开启|启用|关闭|停用)连接\s*/, "").trim()
    const hit = this.find(key)
    if (!hit) return e.reply(`找不到连接「${key}」，用 #早柚连接列表 查看`)

    try {
      saveConfig(doc => doc.setIn(["client", "connections", hit.index, "enable"], on))
    } catch (err: any) {
      return e.reply(`保存失败：${err.message}`)
    }

    if (on) {
      if (!clientMode())
        return e.reply(
          `已启用连接 ${hit.conf.name}\n但适配器本体已禁用（enable: false），客户端未运行`,
        )
      startClient({ ...hit.conf, enable: true })
      return e.reply(`已启用连接 ${hit.conf.name}，正在连接`)
    }
    stopClient(hit.conf.name)
    return e.reply(`已停用连接 ${hit.conf.name}`)
  }

  async set(e) {
    const raw = e.msg.replace(/^#?早柚(核心)?设置\s*/, "").trim()
    // 英文 key=value 优先，一个都没中再试中文写法。反过来（先试中文）会让
    // `#早柚设置 media_max_size=2097152` 这种含「设置项中文名之外的字」的串
    // 白跑一遍解析，而且两种写法的优先级要稳定：老写法必须继续按字节收
    const kv = parseKV(raw)
    if (!Object.keys(kv).length) Object.assign(kv, parseCN(raw))
    // 写了参数但两种写法都没解析出来（拼错字段名、忘了开关词）。空参数走 show()，
    // 到不了这里
    if (!Object.keys(kv).length)
      return e.reply(
        `没解析出可设置的项：${raw}\n` +
          `用法：#早柚设置适配器开启\n` +
          `可设：${CN_NAMES}\n` +
          `英文写法仍可用（${GLOBAL_KEYS.join(" / ")}）\n` +
          `不带参数发 #早柚设置 可查看当前配置`,
      )

    const done: string[] = []
    const errs: string[] = []

    try {
      saveConfig(doc => {
        for (const [k, v] of Object.entries(kv)) {
          switch (k) {
            case "enable":
              if (!["true", "false"].includes(v)) {
                errs.push(`适配器开关只能是 开启/关闭，收到 ${v}`)
                break
              }
              doc.setIn(["enable"], v === "true")
              done.push(doneLine(k, v === "true"))
              break
            case "only_reply_at":
              doc.setIn(["filter", "only_reply_at"], v === "true")
              done.push(doneLine(k, v === "true"))
              break
            // 三个上报方向开关：都在 filter 下，改完即时生效（每条消息都读一遍配置）
            case "report_private":
            case "report_group":
            case "report_meta":
              doc.setIn(["filter", k], v === "true")
              done.push(doneLine(k, v === "true"))
              break
            case "notify_master":
              doc.setIn(["notify_master"], v === "true")
              done.push(doneLine(k, v === "true"))
              break
            case "update_check":
              // 只开关定时检查，间隔/延迟属于调参，留给配置文件与锅巴面板。
              // 定时任务的 cron 一直在跑，开关只影响 tick() 里那一句判断，
              // 所以改完立刻生效，不需要重启
              doc.setIn(["update_check", "enable"], v === "true")
              done.push(doneLine(k, v === "true"))
              break
            case "media_max_size": {
              const n = Number(v)
              if (!n || n < 1024) {
                // 两种写法的下限是同一个字节数，但提示要贴着用户刚才敲的那种单位：
                // 中文写法收 MB，说「大于 1024」他会以为要填 1024 MB
                errs.push(`最大媒体大小至少 1 KB（中文写法单位为 MB），收到 ${v}`)
                break
              }
              doc.setIn(["media_max_size"], n)
              // 报换算后的值，用户才知道 `最大媒体大小 2` 到底写进去多少
              done.push(`${CN_LABEL[k] || k} = ${(n / 1024 / 1024).toFixed(2)} MB`)
              break
            }
            default:
              // KV_KEYS 混了两类字段：前 7 个是连接级（#早柚添加连接 / #早柚修改连接
              // 才认），这里的 switch 只处理全局字段。落到 default 的若是连接级字段，
              // 说明用户没写错字段名、只是用错了命令，回一句"未知项"会让人以为
              // 字段不存在，白白去翻文档。
              if (CONNECTION_KEYS.includes(k)) {
                errs.push(`${k} 是连接级配置，请用 #早柚添加连接 或 #早柚修改连接`)
              } else {
                errs.push(`未知项 ${k}，可设置：${CN_NAMES}`)
              }
          }
        }
      })
    } catch (err: any) {
      return e.reply(`保存失败：${err.message}`)
    }

    // 无论成功、失败、还是没有改动，都渲染图片——跟其他页一样的质感
    const img = await renderSettings(done, errs)
    return e.reply(img)
  }
}
