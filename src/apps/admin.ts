import {
  config,
  saveConfig,
  getWsConnections,
  appendConnection,
  updateConnection,
  removeConnection,
  enabled,
  type ConnectionPatch,
} from "@/config"
import { clients, startClient, stopClient } from "@/modules/client"
import { DEFAULT_MAX_RECONNECT, STATUS_TEXT } from "@/constants"
import { makeLog } from "@/utils/compat"
import { findDuplicate, requireWsUrl } from "@/utils/url"
import { resolveSelfId } from "@/utils/message"
import { guessPlatform } from "@/utils/platform"
// 中文设置项的表与解析单独一个模块，理由见 utils/settings.ts 的文件头
import { CN_LABEL, CN_NAMES, doneLine, parseCN } from "@/utils/settings"
import { renderConfig, renderHelp, renderList, renderSettings } from "@/modules/render/pages"
import { helpText } from "@/modules/render/commands"
import type { WsConnection, YunzaiEvent } from "@/types"
/** 关闭状态下不热启动连接 */
function clientMode() {
  return enabled()
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 单条连接的字段，由 #早柚添加连接 / #早柚修改连接 消费 */
const CONNECTION_KEYS = [
  "name",
  "url",
  "token",
  "bot_id",
  // 账号白名单。添加时 bind=<账号> 或 bind=all；修改时还支持 bind+=<账号>
  // 追加、bind-=<账号> 移除，多个账号可用 + / | / ; / 、分隔。
  "bind",
  // 账号黑名单（优先级高于 bind），语法与 bind 相同。
  // 必须在白名单里：帮助图一直把它列为可用参数，而不在 KV_KEYS 里的串
  // 不会被认成 key=value —— add() 会把 `exclude=123` 当成地址候选去解析
  "exclude",
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
// (\\+|-)? 是 bind 的追加/移除后缀（bind+= / bind-=）。这里是模板字符串不是正则
// 字面量，`\+` 会在字符串阶段被吃成 `+`，正则变成 `(+|-)?` 直接语法错误，
// 模块一 import 就抛 —— 必须写成 `\\+`
const KV_RE = new RegExp(`^(${KV_KEYS.join("|")})(\\+|-)?[=:：](.*)$`, "i")

type ListOp = "add" | "remove" | "replace"
type ParsedKV = Record<string, string> & { bind_op?: ListOp; exclude_op?: ListOp }

/** 从命令里解析 key=value，支持中英文冒号/等号；简写归一成正式字段名 */
function parseKV(text: string): ParsedKV {
  const out: ParsedKV = {}
  for (const seg of text.split(/[\s,，]+/)) {
    if (!seg) continue
    const m = seg.match(KV_RE)
    if (!m) continue
    const key = KV_ALIAS[m[1].toLowerCase()] || m[1].toLowerCase()
    out[key] = m[3]
    // bind / exclude 是账号列表，+= / -= 的增删语义记在旁挂属性上
    if (key === "bind" || key === "exclude")
      Object.defineProperty(out, `${key}_op`, {
        value: m[2] === "+" ? "add" : m[2] === "-" ? "remove" : "replace",
        enumerable: false,
        configurable: true,
      })
  }
  return out
}

/** bind / exclude 的多个账号用不与 key=value 分片冲突的符号分隔 */
function splitIds(value: string): string[] {
  return [...new Set(value.split(/[+|;；、]+/).map(x => x.trim()).filter(Boolean))]
}

/** bind 额外认 all（不限账号 = 空数组）；exclude 没有这个语义，直接用 splitIds */
function parseBind(value: string): string[] {
  if (value.toLowerCase() === "all") return []
  return splitIds(value)
}

/**
 * 对账号列表应用 += / -= / 整体替换
 * @returns 新数组（已去重）；-= 移空是合法结果，由调用方决定要不要提示
 */
function applyListOp(current: string[], ids: string[], op: ListOp | undefined): string[] {
  if (op === "add") return [...new Set([...current, ...ids])]
  if (op === "remove") return current.filter(id => !ids.includes(id))
  return [...new Set(ids)]
}

/** 是否为 key=value 片段（用于把剩下的那个片段认作地址） */
function isKV(seg: string) {
  return KV_RE.test(seg)
}

export default class GsCoreAdmin extends plugin<"message"> {
  constructor() {
    super({
      name: "早柚核心连接管理",
      dsc: "命令式增删改查早柚核心 ws 连接",
      event: "message",
      priority: 500,
      rule: [
        { reg: "^#?早柚(核心)?(添加|新增)连接\\s*(.+)$", fnc: "add", permission: "master" },
        { reg: "^#?早柚(核心)?(修改|编辑)连接\\s*(.+)$", fnc: "edit", permission: "master" },
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
  async help(e: YunzaiEvent) {
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
  async show(e: YunzaiEvent) {
    const img = await renderConfig()
    if (img) return e.reply(img)
    return e.reply(
      `早柚核心适配器  ${enabled() ? "已启用" : "已禁用"}\n` +
        `连接 ${getWsConnections().length} 个\n\n` +
        `改配置：#早柚设置<项目><开启/关闭>\n` +
        `可设：${CN_NAMES}\n` +
        `例：#早柚设置适配器开启 · #早柚设置最大媒体大小 2`,
    )
  }

  /** 按名字或 1 起的序号定位连接。序号即 client.connections 的下标 +1 */
  find(key: string | number) {
    const list = getWsConnections()
    key = String(key).trim()
    const idx = Number(key)
    if (Number.isInteger(idx) && idx >= 1 && idx <= list.length)
      return { index: idx - 1, conf: list[idx - 1] }
    const i = list.findIndex(c => c.name === key)
    return i > -1 ? { index: i, conf: list[i] } : null
  }

  async add(e: YunzaiEvent) {
    const raw = e.msg.replace(/^#?早柚(核心)?(添加|新增)连接\s*/, "").trim()
    if (!raw)
      return e.reply(
        "用法：#早柚添加连接 127.0.0.1:8765\n" +
          "只填 host:port 即可，其余留空取默认。\n" +
          "可选：n=名字 t=token id=平台标识\n" +
          "bind=账号1+账号2 指定转发哪些机器人，bind=all 不限\n详见 #早柚帮助",
      )

    const kv = parseKV(raw)
    // 第一个不含 = 的片段视为地址
    const urlPart = raw.split(/[\s,，]+/).find(s => s && !isKV(s))

    const list = getWsConnections()

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
    //
    // parseBind 而不是整串塞进数组：bind=123+456 是两个账号，原来会被存成
    // 一个叫 "123+456" 的账号，哪个 Bot 都匹配不上；"all"/"ALL" 的大小写也归一了。
    const selfId = resolveSelfId(e)
    const bind = kv.bind ? parseBind(kv.bind) : selfId ? [selfId] : []

    // 只填 host:port 时补出的路径段带上账号，两个 Bot 才能同时连一个核心，
    // 理由见 normalizeUrl。bind=all（不限账号）时不带 —— 那条连接不属于某个账号。
    // 必须排在 bind 之后：段里用的就是它绑的那个账号
    //
    // 走 requireWsUrl 而不是裸 normalizeUrl：协议校验只有那一处（见该函数），
    // http:// 会带着换算好的 ws 地址抛出来，直接把话回给用户就是可用的建议
    let url: string
    try {
      url = requireWsUrl(kv.url || urlPart, bind.length === 1 ? bind[0] : null)
    } catch (err) {
      return e.reply(
        `${errorMessage(err)}\n用法：#早柚添加连接 127.0.0.1:8765（只填 host:port 即可）`,
      )
    }

    // 平台标识分两处落：显式 id= 写进连接，自动识别的写进 bot_id_map
    // ------
    // 为什么不都写进连接的 bot_id
    // -------------------------
    // resolveBotId 的第一行是 `if (conf?.bot_id) return conf.bot_id` —— 连接级的值
    // 短路掉后面所有按账号的解析。而这里的自动识别只看得到「发这条指令的那个号」，
    // 一条连接却可以 bind 多个账号，且它们的平台可能不同（ICQQ 号是 onebot、
    // QQBot 号是 qqgroup）。把猜出来的值写进连接，等于替所有 bind 的账号都断言了
    // 同一个平台：日后往 bind 里加一个别的平台的号，它的消息就会被按错的平台上报，
    // 而且是静默的。
    //
    // 所以自动识别的结果按账号记到 bot_id_map 里（那张表本来就是 self_id 精确匹配
    // 优先，见 resolveBotId），连接的 bot_id 只留给用户显式 id= —— 那是他自己的
    // 断言「这条连接一律按这个平台上报」，短路是对的。
    //
    // 多个账号平台相同的情形不会让这张表膨胀得难看：同平台的键各写一行，值一样，
    // 而适配器级的粗粒度键（QQ: onebot）仍在表里覆盖没被单独记过的号。
    const guessed = selfId ? guessPlatform(selfId, globalThis.Bot?.[selfId]) : ""
    const botId = kv.bot_id || ""

    // 判重按 (核心, 账号) 而不是只看地址，理由见 findDuplicate。
    // 必须排在 bind 算出来之后 —— 判重要用它
    const dup = findDuplicate(list, url, bind)
    if (dup) {
      const had = dup.bind?.length ? dup.bind.join("、") : "不限账号"
      return e.reply(
        `这个核心已经加过了：${dup.name}\n` +
          `已绑定：${had}\n` +
          (bind.length
            ? `本次要绑 ${bind.join("、")}，与它重复。\n` +
              `想让别的机器人也连这个核心，就在那个号上发这条指令。`
            : `本次是「不限账号」，会与它重复上报。\n` +
              `想按账号分开，用 bind=<账号> 指定。`),
      )
    }

    let name = kv.name || `core${list.length + 1}`
    if (list.some(c => c.name === name)) name = `${name}-${Date.now().toString(36).slice(-4)}`

    // 标 WsConnection 而不是让它自己推：空的 exclude 会被推成 never[]（TS7018），
    // 而这个对象要同时写进 yaml 与传给 startClient，写错字段名不该等到运行时才发现
    const conf: WsConnection = {
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
      exclude: kv.exclude ? splitIds(kv.exclude) : [],
    }

    // 自动识别出的平台按账号记一笔，与连接写在同一次保存里
    // ------
    // 只在「这个账号还没有记录」时写：那张表是用户可以手改的，他改过的值不该被
    // 一条添加连接指令悄悄改回去。也不写进连接的 bot_id，理由见上面 guessed 那段。
    const mapped = selfId && guessed && !config.bot_id_map?.[selfId] ? guessed : ""

    try {
      // 自动识别的平台映射与连接写在同一次保存里。
      // setIn 会把缺失的中间层补出来，bot_id_map 整个不存在时也不用先建
      appendConnection(conf, doc => {
        if (mapped) doc.setIn(["bot_id_map", String(selfId)], mapped)
      })
    } catch (err) {
      makeLog("error", ["写入配置失败", err], "GsCore")
      return e.reply(`保存失败：${errorMessage(err)}`)
    }

    const started = clientMode() ? startClient(conf) : null
    return e.reply(
      `已添加连接 ${name}\n地址：${url}\n` +
        // 把绑定结果说出来：这是这条指令唯一不来自用户输入的字段，
        // 不显示的话多 Bot 环境里没人知道它到底绑到了哪个号
        (bind.length ? `绑定账号：${bind.join("、")}（bind=all 可改为不限）\n` : "账号：不限\n") +
        // 路径段带账号是「多个 Bot 能同时连一个核心」的关键（核心按这一段区分连接），
        // 但用户只填了 host:port，不说他不会知道地址被改过
        (bind.length === 1 && url.includes(`/ws/Yunzai-${bind[0]}`)
          ? `路径已按账号区分，其他机器人可连同一个核心\n`
          : "") +
        // 平台标识落在哪儿要说清楚：连接级会盖掉所有账号，表里的只管这一个号。
        // 用户看不到这个区别的话，多账号时排查不动
        (kv.bot_id
          ? `平台标识：${botId}（本连接一律按它上报，含日后加进 bind 的账号）\n`
          : mapped
            ? `平台标识：${mapped}（自动识别，已按账号 ${selfId} 记入 bot_id_map）\n`
            : selfId && config.bot_id_map?.[selfId]
              ? `平台标识：${config.bot_id_map[selfId]}（bot_id_map 里已有 ${selfId} 的记录）\n`
              : "平台标识：未识别，上报时按 bot_id_map 推断\n") +
        (started
          ? "已开始连接，稍后可用 #早柚状态 查看"
          : clientMode()
            ? "配置已保存，可用 #早柚重连 启动"
            : "适配器当前已禁用（enable: false）。发 #早柚设置适配器开启 即可启用"),
    )
  }

  async edit(e: YunzaiEvent) {
    const raw = e.msg.replace(/^#?早柚(核心)?(修改|编辑)连接\s*/, "").trim()
    const kv = parseKV(raw)
    const target = raw.split(/[\s,，]+/).find(s => s && !isKV(s))
    if (!target || !Object.keys(kv).some(k => CONNECTION_KEYS.includes(k)))
      return e.reply(
        "用法：#早柚修改连接 <名字|序号> bind+=<账号>\n" +
          "bind=账号1+账号2 替换，bind+=账号 追加，bind-=账号 移除，bind=all 表示不限账号\n" +
          "exclude 同语法（排除账号，优先级高于 bind）\n" +
          "也可修改 url、token、bot_id、enable、interval、retry",
      )

    const hit = this.find(target)
    if (!hit) return e.reply(`找不到连接「${target}」，用 #早柚连接列表 查看`)
    let nextBind = Array.isArray(hit.conf.bind) ? hit.conf.bind.map(String) : []
    if (kv.bind !== undefined) {
      const ids = parseBind(kv.bind)
      if (kv.bind_op === "add" && !ids.length)
        return e.reply("bind+= 需要填写至少一个账号；不限账号请用 bind=all")
      if (kv.bind_op === "remove" && !ids.length) return e.reply("bind-= 需要填写要移除的账号")
      nextBind = applyListOp(nextBind, ids, kv.bind_op)
    }
    let nextExclude = Array.isArray(hit.conf.exclude) ? hit.conf.exclude.map(String) : []
    if (kv.exclude !== undefined) {
      const ids = splitIds(kv.exclude)
      if ((kv.exclude_op === "add" || kv.exclude_op === "remove") && !ids.length)
        return e.reply(`exclude${kv.exclude_op === "add" ? "+=" : "-="} 需要填写至少一个账号`)
      nextExclude = applyListOp(nextExclude, ids, kv.exclude_op)
    }

    // requireWsUrl 会抛（协议错、解析不了），而这一步在写盘之外，
    // 抛出去就是一条框架级异常日志而不是回给用户的话
    let nextUrl: string
    try {
      nextUrl = kv.url ? requireWsUrl(kv.url) : hit.conf.url
    } catch (err) {
      return e.reply(errorMessage(err))
    }
    const duplicate = findDuplicate(
      getWsConnections().filter((_, i) => i !== hit.index),
      nextUrl,
      nextBind,
    )
    if (duplicate)
      return e.reply(`修改后会与连接 ${duplicate.name} 的核心地址和绑定账号重复，已取消保存`)

    // 字段校验都在写盘之前做完：报错要作为一句话回给用户，不能等 updateConnection
    // 写到一半才抛。patch 的键序即回复里「xx 已更新」的顺序
    const patch: ConnectionPatch = {}
    if (kv.url) patch.url = nextUrl
    if (kv.name) patch.name = kv.name
    if (kv.token !== undefined) patch.token = kv.token || null
    if (kv.bot_id !== undefined) patch.bot_id = kv.bot_id || null
    if (kv.enable !== undefined) {
      if (!["true", "false"].includes(kv.enable.toLowerCase()))
        return e.reply("enable 只能是 true 或 false")
      patch.enable = kv.enable.toLowerCase() === "true"
    }
    if (kv.reconnect_interval !== undefined) {
      const n = Number(kv.reconnect_interval)
      if (!Number.isFinite(n) || n < 0) return e.reply("reconnect_interval 应为 0 或正数")
      patch.reconnect_interval = n
    }
    if (kv.max_reconnect_attempts !== undefined) {
      const n = Number(kv.max_reconnect_attempts)
      if (!Number.isFinite(n)) return e.reply("max_reconnect_attempts 应为数字")
      patch.max_reconnect_attempts = n
    }
    if (kv.bind !== undefined) patch.bind = nextBind
    if (kv.exclude !== undefined) patch.exclude = nextExclude

    try {
      updateConnection(hit.index, patch)
    } catch (err) {
      return e.reply(`保存失败：${errorMessage(err)}`)
    }
    const changed = Object.keys(patch)

    stopClient(hit.conf.name || hit.conf.url)
    const next = getWsConnections()[hit.index]
    if (next?.enable !== false && clientMode()) startClient(next)

    const lines = [
      `已修改连接 ${next?.name || hit.conf.name}`,
      changed.map(k => `${k} 已更新`).join("，"),
    ]
    if (kv.bind !== undefined) {
      // 改完把最终绑定念出来：bind+=/-= 是增量操作，用户看不到合并后的全貌
      lines.push(`当前绑定：${nextBind.length ? nextBind.join("、") : "不限账号"}`)
      if (!nextBind.length && kv.bind_op === "remove")
        lines.push("绑定已清空，本连接现在转发所有机器人的消息；如非本意请用 bind+= 加回")
      // 连接级 bot_id 会替 bind 里所有账号断言同一个平台（resolveBotId 第一优先级）。
      // 往一条固定了平台的连接里加第二个账号是最容易踩错的组合：另一个平台的
      // 账号消息会被静默按错的平台上报，所以这里必须说一声
      const finalBotId = kv.bot_id !== undefined ? kv.bot_id : hit.conf.bot_id
      if (finalBotId && nextBind.length > 1)
        lines.push(
          `注意：本连接的平台标识固定为 ${finalBotId}，bind 里所有账号都按它上报。` +
            `若账号平台不同，发 #早柚修改连接 ${next?.name || hit.index + 1} bot_id= 清掉，改为按账号自动识别`,
        )
    }
    if (kv.exclude !== undefined)
      lines.push(`当前排除：${nextExclude.length ? nextExclude.join("、") : "无"}`)
    return e.reply(lines.filter(Boolean).join("\n"))
  }

  async del(e: YunzaiEvent) {
    const key = e.msg.replace(/^#?早柚(核心)?(删除|移除)连接\s*/, "").trim()
    const hit = this.find(key)
    if (!hit) return e.reply(`找不到连接「${key}」，用 #早柚连接列表 查看`)

    try {
      removeConnection(hit.index)
    } catch (err) {
      return e.reply(`保存失败：${errorMessage(err)}`)
    }

    stopClient(hit.conf.name)
    return e.reply(`已删除连接 ${hit.conf.name}（${hit.conf.url}）`)
  }

  async list(e: YunzaiEvent) {
    const img = await renderList()
    if (img) return e.reply(img)

    // 文本回退
    const list = getWsConnections()
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
          (c.bind?.length ? `\n   bind: ${c.bind.join("、")}` : "") +
          (live?.retry ? `\n   已重连 ${live.retry} 次` : ""),
      )
    })
    return e.reply(msg.join(""))
  }

  async enable(e: YunzaiEvent) {
    return this.toggle(e, true)
  }

  async disable(e: YunzaiEvent) {
    return this.toggle(e, false)
  }

  async toggle(e: YunzaiEvent, on: boolean) {
    const key = e.msg.replace(/^#?早柚(核心)?(开启|启用|关闭|停用)连接\s*/, "").trim()
    const hit = this.find(key)
    if (!hit) return e.reply(`找不到连接「${key}」，用 #早柚连接列表 查看`)

    try {
      updateConnection(hit.index, { enable: on })
    } catch (err) {
      return e.reply(`保存失败：${errorMessage(err)}`)
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

  async set(e: YunzaiEvent) {
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
    } catch (err) {
      return e.reply(`保存失败：${errorMessage(err)}`)
    }

    // 无论成功、失败、还是没有改动，都渲染图片——跟其他页一样的质感
    const img = await renderSettings(done, errs)
    if (img) return e.reply(img)
    return e.reply([...done, ...errs].join("\n") || "没有可保存的设置")
  }
}
