import { config, saveConfig, getConnections } from "@/config"
import { clients, startClient, stopClient } from "@/modules/client"
import { STATUS_TEXT } from "@/constants"
import { makeLog } from "@/utils/compat"
import { normalizeUrl } from "@/utils/url"
import { renderHelp, renderList } from "@/modules/render/pages"
import { helpText } from "@/modules/render/commands"

/** 关闭状态下不热启动连接 */
function clientMode() {
  return config.mode !== "off"
}

/** 单条连接的字段，由 #早柚添加连接 / #早柚修改连接 消费 */
const CONNECTION_KEYS = [
  "name",
  "url",
  "token",
  "bot_id",
  "enable",
  "reconnect_interval",
  "max_reconnect_attempts",
]

/** 全局字段，由 #早柚设置 消费 */
const GLOBAL_KEYS = [
  "mode",
  "only_reply_at",
  "report_private",
  "report_group",
  "report_meta",
  "notify_master",
  "media_max_size",
  "update_check",
]

/**
 * 可用的 key=value 选项名。限定白名单，否则 ws://host 里的 "ws:" 会被当成 key。
 * 两类合在一起解析，各命令再挑自己认的那部分——这样用错命令时能给出
 * 指向性提示，而不是笼统的"未知项"。
 */
const KV_KEYS = [...CONNECTION_KEYS, ...GLOBAL_KEYS]
const KV_RE = new RegExp(`^(${KV_KEYS.join("|")})[=:：](.*)$`, "i")

/** 从命令里解析 key=value，支持中英文冒号/等号 */
function parseKV(text): Record<string, string> {
  const out: Record<string, string> = {}
  for (const seg of text.split(/[\s,，]+/)) {
    if (!seg) continue
    const m = seg.match(KV_RE)
    if (m) out[m[1].toLowerCase()] = m[2]
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
        { reg: "^#?早柚(核心)?设置\\s*(.+)$", fnc: "set", permission: "master" },
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
    if (!raw) return e.reply("用法：#早柚添加连接 <地址> [name=x] [token=x]\n详见 #早柚帮助")

    const kv = parseKV(raw)
    // 第一个不含 = 的片段视为地址
    const urlPart = raw.split(/[\s,，]+/).find(s => s && !isKV(s))
    const url = normalizeUrl(kv.url || urlPart)
    if (!url) return e.reply("没解析出地址，用法：#早柚添加连接 ws://127.0.0.1:8765/ws/Yunzai")

    const list = getConnections()
    if (list.some(c => c.url === url)) return e.reply(`该地址已存在：${url}`)

    let name = kv.name || `core${list.length + 1}`
    if (list.some(c => c.name === name)) name = `${name}-${Date.now().toString(36).slice(-4)}`

    const conf = {
      name,
      url,
      token: kv.token || null,
      bot_id: kv.bot_id || null,
      enable: true,
      reconnect_interval: Number(kv.reconnect_interval) || 5,
      max_reconnect_attempts: Number(kv.max_reconnect_attempts) || 0,
      bind: [],
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
        (started
          ? "已开始连接，稍后可用 #早柚状态 查看"
          : clientMode()
            ? "配置已保存，可用 #早柚重连 启动"
            : `当前模式为 ${config.mode}，未启用客户端。改 #早柚设置 mode=client 后重启生效`),
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

    const msg = [`早柚核心连接（共 ${list.length} 个）  模式：${config.mode}`]
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
        return e.reply(`已启用连接 ${hit.conf.name}\n但当前模式为 ${config.mode}，客户端未运行`)
      startClient({ ...hit.conf, enable: true })
      return e.reply(`已启用连接 ${hit.conf.name}，正在连接`)
    }
    stopClient(hit.conf.name)
    return e.reply(`已停用连接 ${hit.conf.name}`)
  }

  async set(e) {
    const raw = e.msg.replace(/^#?早柚(核心)?设置\s*/, "").trim()
    const kv = parseKV(raw)
    if (!Object.keys(kv).length)
      return e.reply(`用法：#早柚设置 mode=client\n可设：${GLOBAL_KEYS.join(" / ")}`)

    const done: string[] = []
    const errs: string[] = []

    try {
      saveConfig(doc => {
        for (const [k, v] of Object.entries(kv)) {
          switch (k) {
            case "mode":
              if (!["client", "off"].includes(v)) {
                errs.push(`mode 只能是 client/off，收到 ${v}`)
                break
              }
              doc.setIn(["mode"], v)
              done.push(`mode = ${v}（需重启生效）`)
              break
            case "only_reply_at":
              doc.setIn(["filter", "only_reply_at"], v === "true")
              done.push(`only_reply_at = ${v === "true"}`)
              break
            // 三个上报方向开关：都在 filter 下，改完即时生效（每条消息都读一遍配置）
            case "report_private":
            case "report_group":
            case "report_meta":
              doc.setIn(["filter", k], v === "true")
              done.push(`${k} = ${v === "true"}`)
              break
            case "notify_master":
              doc.setIn(["notify_master"], v === "true")
              done.push(`notify_master = ${v === "true"}`)
              break
            case "update_check":
              // 只开关定时检查，间隔/延迟属于调参，留给配置文件与锅巴面板。
              // 定时任务的 cron 一直在跑，开关只影响 tick() 里那一句判断，
              // 所以改完立刻生效，不需要重启
              doc.setIn(["update_check", "enable"], v === "true")
              done.push(`update_check = ${v === "true"}`)
              break
            case "media_max_size": {
              const n = Number(v)
              if (!n || n < 1024) {
                errs.push(`media_max_size 需为大于 1024 的数字，收到 ${v}`)
                break
              }
              doc.setIn(["media_max_size"], n)
              done.push(`media_max_size = ${n}`)
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
                errs.push(`未知项 ${k}，可设置：${GLOBAL_KEYS.join(" / ")}`)
              }
          }
        }
      })
    } catch (err: any) {
      return e.reply(`保存失败：${err.message}`)
    }

    return e.reply(
      [done.length ? `已设置：\n${done.join("\n")}` : "", errs.length ? `\n失败：\n${errs.join("\n")}` : ""]
        .join("")
        .trim() || "没有任何改动",
    )
  }
}
