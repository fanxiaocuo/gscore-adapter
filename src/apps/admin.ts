import {
  accountPlatform,
  config,
  saveConfig,
  getWsConnections,
  appendConnection,
  updateConnection,
  removeConnection,
  enabled,
  wsEnabled,
} from "@/config"
// 注意：只 import 子文件，不碰 @/modules/client barrel —— 那个 barrel 里 framework.ts 有顶层 await 且路径相对 cwd，
// 从云崽根目录跑会给真实 bot 的配置挂上监听
import { applyConnections, countSource } from "@/modules/client/lifecycle"
import { clients } from "@/modules/client/state"
import { expandConnections, sourceLabel } from "@/modules/client/expand"
import { MEDIA_SIZE_MAX, STATUS_TEXT, pickByStatus } from "@/constants"
import { makeLog } from "@/utils/compat"
import { mergeEndpointQuery, redactUrl, requireWsUrl } from "@/utils/url"
import { resolveSelfId } from "@/utils/message"
// 中文设置项的表与解析单独一个模块，理由见 utils/settings.ts 的文件头
import { CN_LABEL, CN_NAMES, doneLine, parseCN } from "@/utils/settings"
import { renderConfig, renderHelp, renderList, renderSettings } from "@/modules/render/pages"
import { helpText, rulesFor, stripArg } from "@/modules/render/commands"
import {
  botmapWriter,
  editBotmapWriter,
  isEnabled,
  planAdd,
  planEdit,
  type ConnInput,
  type PlanError,
} from "@/modules/connections/plan"
import type { YunzaiEvent } from "@/types"
/** @description 关闭状态下不热启动连接 */
function clientMode() {
  return enabled()
}

/**
 * @description 「起了 0 条」时补一句成因；没有额外要说的就回空串
 * clientMode() 只查总开关 enable，而运行时目标还要求 client.enable_ws（见 lifecycle.planClients）。后者关着时
 * 各处回复只会剩一个 0，既没错也没用 —— 用户看不出该去改哪个开关。
 * 只查 enable_ws：三个调用点都已经在 clientMode() 里面，enable 必然是开的，再判一次就是永远走不到的死分支。
 */
function idleReason(): string {
  return wsEnabled() ? "" : "\nclient.enable_ws 为 false，ws 客户端整体没启用"
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** @description 单条连接的字段，由 #早柚添加连接 / #早柚修改连接 消费 */
const CONNECTION_KEYS = [
  "name",
  "url",
  "token",
  "bot_id",
  // 账号白名单。添加时 bind=<账号>；修改时还支持 bind+= 追加、bind-= 移除，多个账号可用 + / | / ; / 、分隔
  "bind",
  // 账号黑名单（优先级高于 bind），语法与 bind 相同。
  // 注意：必须留在这张白名单里 —— 帮助图一直把它列为可用参数，而不在 KV_KEYS 里的串不会被认成 key=value，
  // add() 会把 `exclude=123` 当成地址候选去解析
  "exclude",
  "enable",
  "reconnect_interval",
  "max_reconnect_attempts",
]

/** @description 全局字段，由 #早柚设置 消费 */
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
 * @description 字段简写，只加在长字段和最常用的两项上
 * max_reconnect_attempts=5 在手机上敲一遍要二十多个字符，而这条指令的使用者多半正蹲在群里救一个连不上的核心。
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
 * @description 可用的 key=value 选项名。限定白名单，否则 ws://host 里的 "ws:" 会被当成 key
 * 两类合在一起解析，各命令再挑自己认的那部分 —— 这样用错命令时能给出指向性提示，而不是笼统的「未知项」。
 */
const KV_KEYS = [...CONNECTION_KEYS, ...GLOBAL_KEYS, ...Object.keys(KV_ALIAS)]
// (\\+|-)? 是 bind 的追加/移除后缀（bind+= / bind-=）。
// 注意：这里是模板字符串不是正则字面量，`\+` 会在字符串阶段被吃成 `+`，正则变成 `(+|-)?` 直接语法错误、
// 模块一 import 就抛 —— 必须写成 `\\+`
const KV_RE = new RegExp(`^(${KV_KEYS.join("|")})(\\+|-)?[=:：](.*)$`, "i")

type ListOp = "add" | "remove" | "replace"
type ParsedKV = Record<string, string> & { bind_op?: ListOp; exclude_op?: ListOp }

/** @description 从命令里解析 key=value，支持中英文冒号/等号；简写归一成正式字段名 */
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

/** @description bind / exclude 的多个账号用不与 key=value 分片冲突的符号分隔 */
function splitIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[+|;；、]+/)
        .map(x => x.trim())
        .filter(Boolean),
    ),
  ]
}

/** @description bind 不再接受 all；null 表示需要给用户明确报错 */
function parseBind(value: string): string[] | null {
  if (value.trim().toLowerCase() === "all") return null
  return splitIds(value)
}

/**
 * @description 把解析好的 key=value 映射成共用核心的输入
 * 注意：token 的空值即清空（映射成 null，落盘删键）—— 与面板的 clear_token 是同一个落盘结果，
 * 只是两边输入习惯不同；enable 与两个数字字段原样透传，解析与校验都在 plan 里
 * 注意：name 的空值当没填 —— 空写的 `name=` 从来不改名（原先是 `if (kv.name)`），不借这次重构悄悄
 * 给它加上「清空连接名」的语义
 * @param url add() 要把「第一个不含 = 的片段」当地址，所以由调用方给
 */
function toInput(kv: ParsedKV, url?: string): ConnInput {
  return {
    url,
    name: kv.name || undefined,
    token: kv.token !== undefined ? kv.token || null : undefined,
    enable: kv.enable,
    reconnect_interval: kv.reconnect_interval,
    max_reconnect_attempts: kv.max_reconnect_attempts,
    bind: kv.bind !== undefined ? { ids: splitIds(kv.bind), op: kv.bind_op } : undefined,
    exclude:
      kv.exclude !== undefined ? { ids: splitIds(kv.exclude), op: kv.exclude_op } : undefined,
    bot_id: kv.bot_id,
  }
}

/**
 * @description 把校验错误渲染成聊天话术
 * 注意：只有这三个码因层而异（它们引用 key=value 语法），其余自带 message —— 别把相同文案在这里和面板各抄一遍
 * @param usage 地址错误时附的用法提示，各指令不同
 */
function sayError(err: PlanError, from: "add" | "edit"): string {
  switch (err.code) {
    case "bot_id_without_bind":
      return "请先 bind=<账号> 再设平台"
    case "bind_all_unsupported":
      return "bind=all 已不再支持：请写明要接入的账号"
    case "list_op_empty":
      return `${err.field}${err.op === "add" ? "+=" : "-="} 需要填写${
        err.op === "add" ? "至少一个账号" : "要移除的账号"
      }`
    case "url_invalid":
      return from === "add"
        ? `${err.message}\n用法：#早柚添加连接 127.0.0.1:8765（只填 host:port 即可）`
        : err.message
    default:
      return err.message
  }
}

/**
 * @description 「平台标识：…」那一行，念的是写盘后的实际表
 * 注意：只念落盘值，不复述输入 —— 输入和结果并不必然相同（mapKey 可能因键类型把值写到另一处，或干脆
 * 判定不该写）。念输入就会出现「平台标识：A=qqgroup」这样一句看不出问题的假话
 */
function mappedLine(ids: string[], suffix = ""): string {
  const mapped = ids
    .map(id => (config.bot_id_map?.[id] ? `${id}=${config.bot_id_map[id]}` : ""))
    .filter(Boolean)
  return mapped.length ? `平台标识：${mapped.join("、")}${suffix}\n` : ""
}

/** @description 是否为 key=value 片段（用于把剩下的那个片段认作地址） */
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
      rule: rulesFor("admin"),
    })
  }

  /**
   * @description 帮助：优先出图，渲染失败（没装 Chromium、截图超时等）回落纯文本
   * 两者同源于 render/commands.ts 的 HELP_GROUPS，不会出现图文不一致。
   */
  async help(e: YunzaiEvent) {
    const img = await renderHelp()
    return e.reply(img || helpText())
  }

  /**
   * @description 当前配置总览（不带参数的 #早柚设置）
   * 注意：它必须有自己那条空参数规则 —— 带参数那条的 `(.+)` 要求至少一个字符，空参数匹配不上任何规则，
   * 插件压根不会被触发，表现是「没渲染也没数据」。渲染失败时回落成一行行文本，与 set() 的失败路径一致。
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

  /** @description 按名字或 1 起的序号定位连接。序号即 client.connections 的下标 +1 */
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
    const raw = stripArg("admin", "add", e.msg)
    if (!raw)
      return e.reply(
        "用法：#早柚添加连接 127.0.0.1:8765\n" +
          "只填 host:port 即可，其余留空取默认。\n" +
          "可选：n=名字 t=token id=平台标识\n" +
          "bind=账号1+账号2 指定接入账号（至少一个）\n详见 #早柚帮助",
      )

    const kv = parseKV(raw)
    // 第一个不含 = 的片段视为地址
    const urlPart = raw.split(/[\s,，]+/).find(s => s && !isKV(s))
    const list = getWsConnections()

    // 注意：用 resolveSelfId 而不是裸 e.self_id —— 后者可能为 null，那时 String(null) 会把 "null" 当账号写进白名单
    const selfId = resolveSelfId(e)
    // bind=all 的拒绝留在指令层：它是 key=value 语法的遗留写法，面板没有对应的输入
    if (kv.bind !== undefined && parseBind(kv.bind) === null)
      return e.reply("bind=all 已不再支持：请写明要接入的账号")

    // 校验与算 patch 都在 modules/connections/plan，与面板共用同一套规则
    const plan = planAdd(toInput(kv, kv.url || urlPart), list, selfId ? [selfId] : [])
    if (!plan.ok) return e.reply(sayError(plan.errors[0], "add"))
    const requested = plan.requested || []
    const explicit = plan.explicit || ""

    if (plan.merge) {
      const { index, existing, patch, freed, nextBind, nextUrl, nextEnable } = plan.merge
      try {
        updateConnection(
          index,
          patch,
          botmapWriter(nextBind, requested, explicit),
          // 停用的连接派生不出运行时连接，那时不能要求「这个账号保存后要连上」
          nextEnable && requested.length
            ? requested.map(account => ({ sourceIndex: index, account, action: "绑定" }))
            : undefined,
        )
      } catch (err) {
        makeLog("error", ["写入配置失败", err], "GsCore")
        return e.reply(`保存失败：${errorMessage(err)}`)
      }
      // 无条件收敛，不必先判 clientMode()：适配器关着时目标计划本来就是空的（planClients 查总开关）
      applyConnections({ sourceIndex: index })
      // 注意：数现在有几条而不是这次新起了几条 —— 合并只加账号，原有那几条会被原地留着（started 为 0），
      // 照新起数说话就成了「运行时连接：0 条」，而它们明明连着
      const runningMerge = countSource(index)
      return e.reply(
        `已把账号 ${requested.join("、")} 绑到连接 ${sourceLabel(existing, index)}\n` +
          `核心地址：${redactUrl(nextUrl)}\n` +
          `当前绑定：${nextBind.length ? nextBind.join("、") : "未绑定账号"}\n` +
          // 悄悄改掉 exclude 会让用户下次看配置时莫名其妙，这里明说一句
          (freed?.length ? `已从排除名单移出：${freed.join("、")}\n` : "") +
          // 状态被这条指令翻过来的话也要说 —— 首装时它就是从出厂的停用状态被打开的
          (patch.enable !== undefined ? `连接状态：${patch.enable ? "已启用" : "已停用"}\n` : "") +
          mappedLine(nextBind) +
          (clientMode()
            ? `运行时连接：${runningMerge} 条，稍后可用 #早柚状态 查看${
                runningMerge ? "" : idleReason()
              }`
            : "配置已保存"),
      )
    }

    const { conf, sourceIndex } = plan.create!
    try {
      appendConnection(
        conf,
        botmapWriter(requested, requested, explicit),
        conf.enable === false
          ? []
          : requested.length
            ? requested.map(account => ({ sourceIndex, account, action: "新增" }))
            : undefined,
      )
    } catch (err) {
      makeLog("error", ["写入配置失败", err], "GsCore")
      return e.reply(`保存失败：${errorMessage(err)}`)
    }

    // 注意：按全局展开再筛自己那条，不是 expandConnections([conf]) —— 孤立展开看不到路由冲突（全局前项优先），
    // 会把已经被别人占掉、实际不会连的地址也列进「将连接：」。新连接刚 append 完，就在列表末尾
    const expanded = expandConnections(getWsConnections())
    const routes = expanded.runtime
      .filter(r => r.sourceIndex === sourceIndex)
      .map(r => redactUrl(r.runtimeUrl))
    // 一条都没派生出来时把原因带上：这行以前只是消失，用户看到「已添加连接」加一个再也不出现的连接，无处可查
    const skipped = expanded.errors.filter(x => x.sourceIndex === sourceIndex).map(x => x.message)
    // 无条件收敛（适配器关着时目标计划为空，见 applyConnections），再数这条现在跑着几条
    applyConnections({ sourceIndex })
    const runningNew = countSource(sourceIndex)
    return e.reply(
      `已添加连接 ${conf.name}\n核心地址：${redactUrl(conf.url)}\n` +
        `绑定账号：${requested.join("、") || "（无）"}\n` +
        (routes.length ? `将连接：${routes.join("\n　　　　")}\n` : "") +
        (skipped.length ? `未生效：${skipped.join("\n　　　　")}\n` : "") +
        (mappedLine(requested, "（按账号记入 bot_id_map）") ||
          (requested.length ? "平台标识：未识别，上报时按 bot_id_map 推断\n" : "")) +
        (runningNew
          ? `运行时连接：${runningNew} 条，稍后可用 #早柚状态 查看`
          : clientMode()
            ? `配置已保存，可用 #早柚重连 启动${idleReason()}`
            : "适配器当前已禁用（enable: false）。发 #早柚设置适配器开启 即可启用"),
    )
  }

  async edit(e: YunzaiEvent) {
    const raw = stripArg("admin", "edit", e.msg)
    const kv = parseKV(raw)
    const target = raw.split(/[\s,，]+/).find(s => s && !isKV(s))
    if (!target || !Object.keys(kv).some(k => CONNECTION_KEYS.includes(k)))
      return e.reply(
        "用法：#早柚修改连接 <名字|序号> bind+=<账号>\n" +
          "bind=账号1+账号2 替换（至少留一个账号），bind+=账号 追加，bind-=账号 移除\n" +
          "exclude 同语法（排除账号，优先级高于 bind）\n" +
          "也可修改 url、token、enable、interval、retry；id= 按账号写入 bot_id_map",
      )

    const hit = this.find(target)
    if (!hit) return e.reply(`找不到连接「${target}」，用 #早柚连接列表 查看`)
    // bind=all 的拒绝留在指令层：它是 key=value 语法的遗留写法，面板没有对应的输入
    if (kv.bind !== undefined && parseBind(kv.bind) === null)
      return e.reply("bind=all 已不再支持：请写明要接入的账号")

    // 地址由调用方给成品：本层要把旧地址的查询参数搬过去，面板那边要先判「这一栏动过没有」，两种判定不同。
    // requireWsUrl 会抛（协议错、解析不了），而这一步在写盘之外，抛出去就是一条框架级异常日志而不是回给用户的话。
    // 注意：协议门吃的是用户新填的原串，搬参数必须发生在门之后 —— mergeEndpointQuery 是容错的（旧地址解析不了
    // 就静默回退成新地址），垫在 requireWsUrl 前面就等于让协议门去校验一个派生串，门放行的范围会跟着 merge
    // 悄悄变。放在门之后不削弱校验：merge 只往 searchParams 里补名字，协议、主机、路径一概不碰。
    let urlOverride: string | undefined
    if (kv.url) {
      try {
        urlOverride = mergeEndpointQuery(hit.conf.url, requireWsUrl(kv.url))
      } catch (err) {
        return e.reply(errorMessage(err))
      }
    }

    // 校验与算 patch 都在 modules/connections/plan，与面板共用同一套规则
    const plan = planEdit(toInput(kv), hit, urlOverride)
    if (!plan.ok) return e.reply(sayError(plan.errors[0], "edit"))
    const { patch, nextBind, nextExclude, nextEnable } = plan.merge!
    const requested = plan.requested || []
    const explicit = plan.explicit || ""

    try {
      updateConnection(
        hit.index,
        patch,
        editBotmapWriter(nextBind, explicit, hit.conf.bot_id, kv.bind !== undefined),
        // 停用的连接派生不出运行时连接，那时不能要求「这个账号保存后要连上」；
        // bind-= 的意图是减账号，拿剩下的去要求「保存后必须连上」是反的（requested 已排除这种情况）
        !nextEnable
          ? []
          : requested.length
            ? requested.map(account => ({ sourceIndex: hit.index, account, action: "绑定" }))
            : [{ sourceIndex: hit.index, action: "修改" }],
      )
    } catch (err) {
      return e.reply(`保存失败：${errorMessage(err)}`)
    }
    const changed = Object.keys(patch)

    applyConnections({ sourceIndex: hit.index })
    const next = getWsConnections()[hit.index]
    // 真起得来才报「运行时连接」；停用或适配器关着时只能说会展开成几条
    const willRun = isEnabled(next) && clientMode()
    const runningNow = willRun
      ? // 注意：数现在跑着几条而不是这次新起了几条 —— 改名字之类不影响握手的改动，收敛会把客户端原地留着
        //（started 为 0），照新起数说话就会回一句「运行时连接：0 条」
        countSource(hit.index)
      : next
        ? // 用 enable:true 展开：expandConnections 对 enable === false 直接短路，照原样传进去「停用了几个账号
          // 的连接」永远算出 0 条 —— 而这句话想说的正是「重新启用后会变成几条」
          expandConnections([{ ...next, enable: true }]).runtime.length
        : 0

    const lines = [
      `已修改连接 ${next?.name || hit.conf.name}`,
      changed.map(k => `${k} 已更新`).join("，"),
      willRun ? `运行时连接：${runningNow} 条` : `将展开 ${runningNow} 条运行时连接（当前未启动）`,
    ]
    // 改完把最终绑定念出来：bind+=/-= 是增量操作，用户看不到合并后的全貌
    if (kv.bind !== undefined)
      lines.push(`当前绑定：${nextBind.length ? nextBind.join("、") : "未绑定账号"}`)
    if (kv.bot_id) {
      // 注意：同样只念写盘后的实际表（理由见 mappedLine）—— 这里虽然走的是 force，值也不保证等于输入：
      // mapKey 挑的键可能与用户手改 yaml 留下的另一行并排，解析回 JS 时靠后的那行赢
      const mapped = mappedLine(nextBind)
      lines.push(
        mapped
          ? `平台标识已按账号记入 bot_id_map：${mapped.replace(/^平台标识：|\n$/g, "")}`
          : `平台标识 ${kv.bot_id} 未能写入 bot_id_map，请检查配置里的 bot_id_map`,
      )
    }
    if (kv.exclude !== undefined)
      lines.push(`当前排除：${nextExclude.length ? nextExclude.join("、") : "无"}`)
    return e.reply(lines.filter(Boolean).join("\n"))
  }

  async del(e: YunzaiEvent) {
    const key = stripArg("admin", "del", e.msg)
    const hit = this.find(key)
    if (!hit) return e.reply(`找不到连接「${key}」，用 #早柚连接列表 查看`)

    try {
      removeConnection(hit.index)
    } catch (err) {
      return e.reply(`保存失败：${errorMessage(err)}`)
    }

    // 注意：这里刻意不带 sourceIndex —— 被删的这条已经不在配置里，而删掉它会释放它占的路由、后面某条被顶掉的
    // 连接这才起得来（路由仲裁是全局前项优先），那条的展开诊断也该照常打。下标位移不用自己推：收敛按新计划
    // 整体覆盖 sourceIndex / name / account
    applyConnections()
    // 没起名字的连接只有地址可报，别再拼一个 undefined 进去
    return e.reply(
      hit.conf.name
        ? `已删除连接 ${hit.conf.name}（${redactUrl(hit.conf.url)}）`
        : `已删除连接 ${redactUrl(hit.conf.url)}`,
    )
  }

  async list(e: YunzaiEvent) {
    const img = await renderList()
    if (img) return e.reply(img)

    // 文本回退
    const list = getWsConnections()
    if (!list.length) return e.reply("还没有配置任何连接\n用 #早柚添加连接 <地址> 添加")

    const msg = [`早柚核心连接（共 ${list.length} 个）  ${enabled() ? "已启用" : "已禁用"}`]
    list.forEach((c, i) => {
      // 一条配置会按绑定账号派生多条运行时连接，状态必须按来源聚合。
      // 注意：聚合规则走 constants 的 pickByStatus，与出图、面板共用一份 —— 别在这里自己写一套
      // 「有一条 status===1 就报已连接」，那正是 pickByStatus 被抽出来要消除的漂移
      const live = clients.filter(x => x.sourceIndex === i)
      const lead = pickByStatus(live)
      // 各账号里最坏的那个重连次数。非根路径的兼容连接尤其要它：那条只有一条运行时连接、account 为 null，
      // 下面的账号明细按 account 筛，不在这里带出来重连次数就一处也不剩
      const retry = live.reduce((n, x) => Math.max(n, x.retry), 0)
      const unconnected = live.filter(x => x.status !== 1).length
      // 「已连接」但有账号没连上时要说出来：那恰恰是要人动手的情况，而聚合把它藏了
      const notes: string[] = []
      if (lead?.status === 1 && unconnected) notes.push(`${unconnected} 个账号未连接`)
      if (retry) notes.push(`已重连 ${retry} 次`)
      // 注意：后缀只挂在有活客户端那条分支上 —— 停用与未启动的行要的是干净的「已停用」/「未启动」
      const state =
        c.enable === false
          ? "已停用"
          : !lead
            ? "未启动"
            : STATUS_TEXT[lead.status] + (notes.length ? `（${notes.join("、")}）` : "")
      const accounts = (c.bind ?? []).map(id => {
        const p = accountPlatform(id)
        return p ? `${id}(${p})` : String(id)
      })
      // 账号级明细：哪个号连上了、哪个号还在重连，聚合状态看不出来。只列账号级连接（account 非 null）——
      // 兼容连接只派生一条，它的状态就是上面那个聚合值，重连次数由 state 的 notes 带出去
      const detail = live
        .filter(x => x.account)
        .map(x => `\n     ${x.account}: ${x.statusText}`)
        .join("")
      msg.push(
        // 这一行不用 sourceLabel：它的兜底是 `连接 #N`，而序号已经是行首那个 `${i + 1}.` 了，拼出来就是
        // 「1. 连接 #1」。行首序号本身就是 find() 认的键
        `\n\n${i + 1}. ${c.name || "(未命名)"}  [${state}]` +
          `\n   ${redactUrl(c.url)}` +
          (c.token ? "\n   token: 已设置" : "") +
          `\n   bind: ${accounts.length ? accounts.join("、") : "未绑定账号"}` +
          detail,
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
    const key = stripArg("admin", on ? "enable" : "disable", e.msg)
    const hit = this.find(key)
    if (!hit) return e.reply(`找不到连接「${key}」，用 #早柚连接列表 查看`)

    try {
      updateConnection(
        hit.index,
        { enable: on },
        undefined,
        on ? [{ sourceIndex: hit.index, action: "启用" }] : [],
      )
    } catch (err) {
      return e.reply(`保存失败：${errorMessage(err)}`)
    }

    // 开关两个方向都先收敛，且不看 clientMode()：适配器关着时目标计划本来就是空的，无条件调才能保证
    // 「关掉适配器之后又拨了开关」不留幽灵客户端
    const result = applyConnections({ sourceIndex: hit.index })

    if (on) {
      if (!clientMode())
        return e.reply(
          `已启用连接 ${sourceLabel(hit.conf, hit.index)}\n但适配器本体已禁用（enable: false），客户端未运行`,
        )
      // 注意：报「现在有几条」而不是这次新起了几条 —— 重复开启一条已经连着的连接，收敛会认出它没变而原地留着
      // （started 是 0），照 started 说话就会走到下面那句「没有可起的运行时连接，请检查绑定账号」，而绑定明明是好的
      const running = countSource(hit.index)
      if (running)
        return e.reply(`已启用连接 ${sourceLabel(hit.conf, hit.index)}，正在连接 ${running} 条`)
      // 真的 0 条：要么没有效账号，要么 ws 总开关关着，两者的下一步动作不一样
      return e.reply(
        `已启用连接 ${sourceLabel(hit.conf, hit.index)}，但没有可起的运行时连接` +
          (idleReason() || "\n请检查绑定账号（#早柚连接列表 可看）"),
      )
    }
    // 注意：用这次收敛真停掉的条数，而不是停之前 countSource 一把 —— 后者会把「本来就没起来」的也算成断开
    // （停用一条从未连上的连接会回「断开 2 条」）
    const stopped = result.stopped
    return e.reply(
      `已停用连接 ${sourceLabel(hit.conf, hit.index)}${stopped ? `，断开 ${stopped} 条` : ""}`,
    )
  }

  async set(e: YunzaiEvent) {
    const raw = stripArg("admin", "set", e.msg)
    // 注意：英文 key=value 优先，一个都没中再试中文写法 —— 反过来会让 `#早柚设置 media_max_size=2097152`
    // 白跑一遍中文解析，而且两种写法的优先级要稳定（老写法必须继续按字节收）
    const kv = parseKV(raw)
    if (!Object.keys(kv).length) Object.assign(kv, parseCN(raw))
    // 写了参数但两种写法都没解析出来（拼错字段名、忘了开关词）。空参数走 show()，到不了这里
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
              // 只开关定时检查，间隔/延迟属于调参，留给配置文件与锅巴面板。cron 一直在跑，开关只影响 tick()
              // 里那一句判断，所以改完立刻生效
              doc.setIn(["update_check", "enable"], v === "true")
              done.push(doneLine(k, v === "true"))
              break
            case "media_max_size": {
              const n = Number(v)
              if (!n || n < 1024) {
                // 两种写法的下限是同一个字节数，但提示要贴着用户刚才敲的那种单位：中文写法收 MB，
                // 说「大于 1024」他会以为要填 1024 MB
                errs.push(`最大媒体大小至少 1 KB（中文写法单位为 MB），收到 ${v}`)
                break
              }
              if (n > MEDIA_SIZE_MAX) {
                // 中文写法收 MB，所以上限也报 MB —— 面板与锅巴现在同样按 MB 收，这一支拦的是手写
                // yaml 的人与旧习惯（`最大媒体大小 10485760`），报字节数他看不出自己填的是 10 TB
                errs.push(
                  `最大媒体大小最多 ${MEDIA_SIZE_MAX / 1048576} MB（中文写法单位为 MB），收到 ${v}`,
                )
                break
              }
              doc.setIn(["media_max_size"], n)
              // 报换算后的值，用户才知道 `最大媒体大小 2` 到底写进去多少
              done.push(`${CN_LABEL[k] || k} = ${(n / 1024 / 1024).toFixed(2)} MB`)
              break
            }
            default:
              // KV_KEYS 混了两类字段，这个 switch 只处理全局字段。落到 default 的若是连接级字段，说明用户
              // 没写错字段名、只是用错了命令 —— 回一句「未知项」会让人以为字段不存在，白白去翻文档
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

    // 无论成功、失败、还是没有改动，都渲染图片 —— 跟其他页一样的质感
    const img = await renderSettings(done, errs)
    if (img) return e.reply(img)
    return e.reply([...done, ...errs].join("\n") || "没有可保存的设置")
  }
}
