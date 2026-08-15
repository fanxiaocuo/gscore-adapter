/**
 * 页面装配
 *
 * 把配置与运行时状态整理成组件要的形状，再交给 render()。
 * 单独一层是为了让 apps/*.ts 只写一行调用，也方便未来加新页面。
 */
import { accountPlatform, config, getWsConnections, enabled } from "@/config"
import { type RuntimeWsConnection, type WsConnection } from "@/types"
import { clients } from "@/modules/client"
import { expandConnections, effectiveAccounts, readIds } from "@/modules/client/expand.js"
import { botProfile } from "@/utils/bots.js"
import { DEFAULT_MAX_RECONNECT, STATUS_TEXT, pickByStatus } from "@/constants"
import { PluginName } from "@/dir"
import { forwardMode, missingBotApis } from "@/utils/compat"
import { fileServerEnabled, pendingFiles } from "@/utils/fileServer.js"
import { inlineToken, redactUrl } from "@/utils/url.js"
import { forName, snapshot } from "@/modules/stats/index.js"
import { passiveCount } from "@/modules/passive/index.js"
import { Help } from "./components/Help.js"
import { Status, type ConnRow, type StatusPanel } from "./components/Status.js"
import {
  Settings,
  type SettingFacts,
  type SettingGroup,
} from "./components/Settings.js"
import { Changelog } from "./components/Changelog.js"
import { About } from "./components/About.js"
import type { Commit, UpdateInfo } from "@/modules/update/git.js"
import { HELP_GROUPS } from "./commands.js"
import { render } from "./index.js"
import { versionLabel, version as bareVersion } from "./version.js"
import { PLUGIN_LOGO, imageDataUri } from "./assets.js"
import {
  formatBytes,
  formatDuration,
  frameName,
  frameVersion,
  nodeVersion,
  releaseType,
  sysInfo,
} from "./env.js"
import { currentRelease, type Release } from "./changelog.js"

// 页面上显示的是 git describe 风格的串（v2.1.0-2-gc6522ee / v2.1.0+40f2dd4），
// 不是裸的 package.json 版本号——三个分支的裸版本号是同一个，区分不出来。
const version = versionLabel()

/** 本地时间戳，页脚用 */
function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 卡片上显示的地址：脱敏后再画进图里
 *
 * 状态图会被发到群里，凭据落进截图是永久留痕。空地址仍回空串 —— redactUrl 对空
 * 输入回的是「(空)」，那是给错误话术用的措辞，卡片这一行留空即可。
 */
function shownUrl(url?: string): string {
  return url ? redactUrl(url) : ""
}

/**
 * 按状态码给出色调
 *
 * enabled 默认真：只有卡片主行有「整条连接被停用」这个状态，账号级子行没有
 * ——停用的连接根本不展开运行时连接，一条子行都不会出现。
 */
function tone(status: number, enabled = true): ConnRow["tone"] {
  if (!enabled) return "off"
  if (status === 1) return "on"
  if (status === 2 || status === 3) return "warn"
  return "err"
}

/**
 * 收发量求和
 *
 * 计数按**运行时**名字存（stats 的 count() 收的就是 client.name），所以一条逻辑
 * 连接要把它派生出的每条运行时连接逐个取出来再加。拿逻辑名去问的话，账号级连接
 * 一条都对不上，这张图上永远是 ↑0 ↓0。
 *
 * 计数活得比客户端长：clients 会被 #早柚重载 整个重建，而计数按名字存在模块级，
 * 所以这里查的是名字，不问客户端还在不在。
 */
function sumCounters(names: string[]): { up: number; down: number } {
  let up = 0
  let down = 0
  for (const name of names) {
    const n = forName(name)
    // 上行把消息与事件合并成一个数：这一行只回答「有没有东西发上去」
    up += n.up + n.event
    down += n.down
  }
  return { up, down }
}

/**
 * 一条账号级运行时连接的子行
 *
 * 不接「逻辑连接是否启用」：子行只由 expandConnections 的产物生成，而它对
 * `enable === false` 的行直接 return（expand.ts:149），所以走到这里的一定是启用的。
 * 曾经带过这个参数并为它写了「已停用」分支，那个分支永远走不到。
 *
 * @param detail 与 {@link collect} 同义：只有 #早柚状态 才把收发计数摆进来
 */
function runtimeRow(
  rt: RuntimeWsConnection,
  detail: boolean,
): NonNullable<ConnRow["runtime"]>[number] {
  const live = clients.find(x => x.name === rt.runtimeName)
  const status = live?.status ?? 0

  const meta: string[] = []
  // 措辞与主行的聚合值同一套：两处指的是同一个数（主行取各账号里最大的那个），
  // 一处写「重连 N 次」一处写「已重连 N 次」会让人以为是两种不同的计量
  if (live?.retry) meta.push(`已重连 ${live.retry} 次`)
  if (detail) {
    const n = sumCounters([rt.runtimeName])
    meta.push(`↑${n.up} ↓${n.down}`)
    // 与主行同一条判据：不发 ping 时 lastPong 停在建连那一刻，显示出来会被
    // 误读成「卡了很久」
    if (status === 1 && live?.lastPong && Number(config.client?.heartbeat) > 0)
      meta.push(`心跳 ${Math.round((Date.now() - live.lastPong) / 1000)}s 前`)
  }

  return {
    // 显示账号而不是 runtimeName：后者是 `${连接名} [${账号}]`，连接名就在卡片顶上
    // 那一行，每条子行再重复一遍只会把这一列撑宽。兼容连接（account 为 null）
    // 只派生一条、走不到子行，回退只是为了不出现空名字
    name: rt.account || rt.runtimeName,
    // 只取 pathname，与面板 RuntimeConnView.path 同一个来源。runtimeUrl 本身已经
    // 净化过（expand 的 detachInlineToken 把 ?token= 摘回配置字段），但仍不取整串：
    // 这张图会发进群里，哪天上游又把鉴权参数放回地址，它就直接印在截图上了。
    // 更不能用 client.target / client.url —— 后者的 getter 会把 token 拼进查询串
    path: new URL(rt.runtimeUrl).pathname || "/",
    // 组件折叠子行时要按状态挑，光给文案和色调排不出名次
    status,
    state: live ? STATUS_TEXT[status] || String(status) : "未启动",
    tone: tone(status),
    meta,
  }
}

/**
 * 汇总连接的运行状态
 *
 * 为什么要先展开一遍
 * ----------------
 * 配置里一条「核心地址 + 绑定账号」在运行时是 N 条 ws（一个账号一条），
 * 而客户端的名字是 `${连接名} [${账号}]`（expand.ts 的 accountRuntimeName）。
 * 拿逻辑 name 去比 client.name 永远配不上 —— 于是每条自动连接在这张图上都显示
 * 「未启动」、收发计数恒为 0，而它其实连着并且在转发。所以这里必须走同一套展开，
 * 用运行时名字去找客户端与计数。
 *
 * @param detail 是否往 meta 里加运行时明细（收发计数、心跳年龄）。
 *   只有 #早柚状态 要；#早柚连接列表 与 #早柚帮助 问的是「配了哪些连接」，
 *   加进去反而把配置信息挤没了。
 */
function collect(detail = false) {
  const list = getWsConnections()
  // 展开只做一次：expandConnections 是全局裁决（路由冲突先到先得），逐条各展开一次
  // 既拿不到全局上下文，也会把同一批错误重复算 n 遍。它是纯函数（errors 只是返回值，
  // 函数体内不打任何日志），渲染路径调它没有副作用 —— 也正因如此这里刻意**不**把
  // errors 打进日志：启停那条路径（lifecycle 的 startSource）已经报过一次了，
  // 出图再报一次只是重复噪音。要看原因去 Web 面板，那边整包带着 errors
  const { runtime } = expandConnections(list)

  // 停用的连接今天转过的量：拿它**本该有**的运行时名字去问
  // ------
  // 计数按运行时名字存（`早柚核心 [111]`），而停用的行根本不展开
  // （expand.ts:149 对 `enable === false` 直接 return），于是没有任何键可查 ——
  // 逻辑名（`早柚核心`）从来不是任何客户端的名字，问它必然是 ↑0 ↓0，等于对一条
  // 刚被停用的连接说「它什么都没干过」。所以再展开一份「假设全部启用」的副本，
  // 把停用行本该派生出的名字捞回来。
  //
  // 必须整份列表一起展开：sourceIndex 与未命名连接的 `连接 #N` 标签都按下标算，
  // 单独展开一行会把序号错开、名字对不上。expandConnections 是纯函数（errors 只是
  // 返回值），多跑一次没有副作用；循环外只跑一次，别搬进 map 里逐行展开。
  // 只有 detail 用得上这些数，也只有存在停用行时才值得跑
  const wouldBe = new Map<number, string[]>()
  if (detail && list.some(c => c.enable === false))
    for (const r of expandConnections(list.map(c => ({ ...c, enable: true }))).runtime) {
      const at = wouldBe.get(r.sourceIndex)
      if (at) at.push(r.runtimeName)
      else wouldBe.set(r.sourceIndex, [r.runtimeName])
    }

  const rows: ConnRow[] = list.map((c, i) => {
    // 按来源序号收本条派生出的运行时连接。这一层只做「本条派生出的是哪几个」：
    // runtime 全都出自 expandConnections，里头的 sourceIndex 无条件就是 forEach 的
    // 下标，不会是 -1，所以它筛不掉任何「来路不明」的东西。真正把野客户端挡在外面的
    // 是下一行 —— 按 runtimeName 去 clients 里认人，名字对不上的一概不算这条连接的
    const views = runtime.filter(r => r.sourceIndex === i)
    // 反过来从 clients 里筛而不是逐条 find：展开出来的连接与活着的客户端未必一一
    // 对应（#早柚重载 会整个重建 clients，某个账号也可能被单独停掉），从 clients
    // 出发得到的就是「此刻真的在跑的那些」，顺序也是启动顺序
    const live = clients.filter(x => views.some(r => r.runtimeName === x.name))
    const enabled = c.enable !== false
    // 状态是聚合值：任一账号连上就算这个核心通了。规则与 Web 面板共用一份
    // （constants 的 pickByStatus），否则会出现「面板说通了、状态图说没连上」
    const lead = pickByStatus(live)
    const status = lead?.status ?? 0
    const state = !enabled
      ? "已停用"
      : live.length
        ? STATUS_TEXT[status] || String(status)
        : "未启动"
    // 各账号里最差的那个重连次数。与 state 同时看会显得矛盾（A 已连接、B 在重连时
    // 是「已连接 + 已重连 5 次」），但这一行的用途正是「这条核心有账号在挣扎」；
    // 逐账号的准确值在下面的子行里
    const retry = live.reduce((n, x) => Math.max(n, x.retry), 0)

    const meta: string[] = []
    // 内联在地址里的凭据也算配过：地址的查询串规范化时会一起留下（核心地址与自定义
    // 路径都留），那种配置的 c.token 是空的。只看 c.token 的话，
    // 排查时这张图会对一条其实配了凭据的连接说「没设 token」，把人引向错误方向
    if (c.token || inlineToken(c.url) !== null) meta.push("token 已设置")
    if (retry) meta.push(`已重连 ${retry} 次`)
    // bind 账号带上档案（头像/昵称）渲染成胶囊，替代原来的纯文本标签：
    // 多 Bot 排查「消息为什么没进核心」第一个要看的就是这条连接绑了谁，
    // 头像比一串号好认。离线账号 botProfile 会按号回退 qlogo，仍有图有名
    //
    // 铺的是 readIds 归一化之后的 bind（去空白、去重、丢空项），与子行同一个来源。
    // 直接铺 c.bind 的话，`bind: [111, 111, 222]` 会出三个胶囊却只有两条子行，
    // 第三个看着像渲染丢了 —— 这正是下面那句「标出被排除的」要消除的困惑，
    // 而重复项还会让两个胶囊撞上同一个 React key。
    //
    // 被 exclude 的号仍然出胶囊、另外标一下（conflicts 正是「bind 与 exclude 都写了」
    // 的那些）：它确实绑了，只是不会连，藏掉反而看不出配置写矛盾了
    const excluded = new Set(effectiveAccounts(c).conflicts)
    const bound = readIds(c.bind)
    const bots = bound.length
      ? bound.map(id => {
          const p = botProfile(id)
          const platform = accountPlatform(id)
          const off = excluded.has(id)
          return { ...p, ...(platform ? { platform } : {}), ...(off ? { excluded: true } : {}) }
        })
      : undefined
    if (c.exclude?.length) meta.push(`exclude: ${c.exclude.length}`)

    // 一条都没有时补一句「怎么办」
    // ------
    // 没配 token / bind / exclude 的连接（默认配置就是这样）meta 是空数组，
    // 卡片只剩名字和地址两行，右边一大片空。而这种卡片恰好最需要一句提示：
    // 停用的要说明怎么启用，未启动的要说明重载。有内容时不加——那句话对已经
    // 连上的连接没有意义，只会挤占位置。bind 胶囊也算内容
    if (meta.length === 0 && !bots) {
      if (!enabled) meta.push(`用 #早柚启用连接 ${c.name || i + 1} 恢复`)
      else if (!live.length) meta.push("尚未建立连接，可用 #早柚重载 重试")
      else meta.push("未配置 token / bind / exclude，按默认规则中转")
    }

    if (detail) {
      // 一条运行时连接都没有时用「本该有」的那些名字（见上面的 wouldBe）：
      // 停用的行取不到活着的运行时名字，但它今天转过的量确实记在那些名字下。
      // 两者互斥地取，不会重复累加
      const n = sumCounters(views.length ? views.map(r => r.runtimeName) : wouldBe.get(i) || [])
      meta.push(`↑${n.up} ↓${n.down}`)
      // 心跳年龄：lastPong 只在收到 pong 时刷新，而 pong 只因我们发 ping 而来。
      // 关掉 heartbeat 时它永远停在连接建立那一刻，显示出来会被误读成「卡了很久」，
      // 所以只在真的在 ping 时才给这一项。
      //
      // 多账号时这是**代表账号**（pickByStatus 选出的那条）的心跳，不是全部账号的
      // ——心跳本来只对单条 ws 说得通，取最大/最小都会让人以为是整条连接的值。
      // 逐账号的准确值在下面的子行里
      if (lead?.status === 1 && lead.lastPong && Number(config.client?.heartbeat) > 0)
        meta.push(`心跳 ${Math.round((Date.now() - lead.lastPong) / 1000)}s 前`)
    }

    return {
      index: i + 1,
      name: c.name || shownUrl(c.url),
      // 不用 client.url —— 那个 getter 会把 token 拼进查询参数，截图会外泄凭据。
      // 配置里的 c.url 也不能原样用：normalizeEndpoint 不动查询串（核心地址与自定义
      // 路径都留着，凭据可能就写在里面），于是 `ws://host:port/ws/Custom?token=xxx`
      // 这种配置的凭据就在 c.url 里
      url: shownUrl(c.url),
      state,
      tone: tone(status, enabled),
      meta,
      bots,
      // 只派生出一条时不给子行：卡片右侧那个胶囊就是它，重复渲染只是噪音。
      // 面板（webui/main.tsx:386）的判据是 `runtime.length > 0 && (open ||
      // runtime.length > 1)` —— 单条也能点开看，且不管多少条都全部列出；这张图
      // 严格一些是因为画布固定、没有交互：既点不开，也没有滚动条能往下翻
      runtime: views.length > 1 ? views.map(r => runtimeRow(r, detail)) : undefined,
    }
  })

  const online = rows.filter(r => r.tone === "on").length
  const off = rows.filter(r => r.tone === "off").length
  return { rows, online, off, total: rows.length }
}

/** 渲染帮助图 */
export async function renderHelp() {
  const { total, online } = collect()

  return render({
    name: "help",
    title: "早柚核心适配器 帮助",
    view: palette =>
      Help({
        title: PluginName,
        version,
        enabled: enabled(),
        palette,
        time: stamp(),
        summary: [
          { key: "CONNECTIONS", value: String(total), sub: "已配置连接" },
          { key: "ONLINE", value: String(online), sub: "当前在线" },
          {
            key: "COMMANDS",
            value: String(HELP_GROUPS.reduce((n, g) => n + g.items.length, 0)),
            sub: "可用指令",
          },
          { key: "REPLY AT", value: config.filter?.only_reply_at ? "ON" : "OFF", sub: "仅响应 @" },
        ],
        groups: HELP_GROUPS,
      }),
  })
}

/** 渲染连接列表图 */
export async function renderList() {
  const { rows, total, online, off } = collect()

  return render({
    name: "list",
    // 这一页不折叠子行（纵向有地方放），于是它没有任何高度上限：3 条连接各绑
    // 12 个号就比原来多出上千像素。过高的图不少 QQ 适配器会拒发或压成马赛克，
    // 所以交给 multiPage 切页 —— 与 renderChangelog 同一个理由
    multiPage: true,
    title: "早柚核心 连接列表",
    view: palette =>
      Status({
        title: PluginName,
        version,
        enabled: enabled(),
        heading: "CONNECTIONS",
        ghost: "LINKS",
        palette,
        time: stamp(),
        rows,
        summary: [
          { key: "TOTAL", value: String(total), sub: "连接总数" },
          { key: "ONLINE", value: String(online), sub: "已连接" },
          { key: "DISABLED", value: String(off), sub: "已停用" },
          { key: "HEARTBEAT", value: `${config.client?.heartbeat ?? 0}s`, sub: "ping 间隔" },
        ],
      }),
  })
}

/** 条目数摘要：空数组说「全部」而不是「0」，避免读成「一个都不转」 */
function countOf(list: unknown[] | undefined, all = "全部"): string {
  const n = list?.length || 0
  return n ? `${n} 项` : all
}

/** 开关类配置统一显示 */
const onOff = (v: unknown) => (v ? "开" : "关")

/**
 * 状态页的分组明细
 *
 * 为什么状态页要有这些
 * ------------------
 * 原来这页只有 4 个统计卡 + 连接卡片，信息量比 #早柚版本 还少，而它本该是
 * 排障的第一站。这里补的三块对应三类最常见的「连着但不对」：
 *   中转情况 —— 连接绿了但一条消息都没过去（计数为 0 一眼可见）
 *   消息过滤 —— 过滤规则把消息挡了（只在群里不响应时最容易忘掉 only_reply_at）
 *   媒体与运行 —— 图片发不出、大文件失败（media/file 上限、文件服务是否在跑）
 *
 * 隐私边界与 env.ts sysInfo 一致：这张图会发到群里。所以过滤规则只报**条数**，
 * 不报具体的群号、用户号、前缀内容；token 只在连接卡片上标「已设置」，不出现值。
 *
 * 第四块「运行环境」
 * ----------------
 * .st-panels 是两列网格（styles/pages/status.ts），三块明细排下来第四格是空的，
 * 右下角一大片留白。
 * 补的是宿主环境——它和前三块是一类问题的两面：前三块答「适配器自己配成什么样」，
 * 这块答「它跑在什么上面」。排障时「转发慢/发不出」经常是内存吃满或 Node 版本太旧，
 * 而不是适配器配错。
 *
 * 与 #早柚版本 的重复是有意的：那页是「插件的身份证」，一次看清楚就不用再看；
 * 这页是随手一敲的运行快照，不该为了去重逼用户再发一条命令。取值同源
 * （env.ts sysInfo），措辞压到一行以适配 kv 两列的窄栏。
 */
function statusPanels(): StatusPanel[] {
  const s = snapshot()
  const f = config.filter || {}
  const sys = sysInfo()
  const hb = Number(config.client?.heartbeat) || 0
  const to = Number(config.client?.heartbeat_timeout) || 0

  return [
    {
      title: "中转情况",
      key: "RELAY",
      items: [
        { k: "上行消息", v: `${s.today.up} 今日 / ${s.total.up} 累计` },
        { k: "上行事件", v: `${s.today.event} 今日 / ${s.total.event} 累计` },
        { k: "下行消息", v: `${s.today.down} 今日 / ${s.total.down} 累计` },
        { k: "统计自", v: formatDuration((Date.now() - s.since) / 1000) + "前" },
      ],
    },
    {
      title: "消息过滤",
      key: "FILTER",
      items: [
        // 三个方向开关放最前：它们是最粗的一刀，也是「核心收不到某类消息」时
        // 第一个该看的地方。合成一行以免把这块挤到五行以上
        {
          k: "上报 私聊/群/事件",
          v: `${onOff(f.report_private !== false)} / ${onOff(f.report_group !== false)} / ${onOff(f.report_meta !== false)}`,
        },
        { k: "仅响应 @", v: onOff(f.only_reply_at) },
        { k: "触发前缀", v: countOf(f.prefix, "无") },
        { k: "屏蔽前缀 / 关键词", v: `${f.block_prefix?.length || 0} / ${f.block_include?.length || 0}` },
        { k: "群白名单 / 黑名单", v: `${countOf(f.white_group)} / ${f.black_group?.length || 0} 项` },
        { k: "用户黑名单", v: countOf(f.black_user, "无") },
      ],
    },
    {
      // 「运行时长 / 内存占用」挪到下面的运行环境块了：那两项讲的是宿主进程，
      // 和媒体上限、文件服务不是一类。这块现在只管消息里的附件怎么走。
      title: "媒体与文件",
      key: "MEDIA",
      items: [
        { k: "媒体内联上限", v: formatBytes(Number(config.media_max_size) || 0) },
        { k: "文件大小上限", v: formatBytes(Number(config.file_max_size) || 0) },
        {
          k: "内置文件服务",
          v: fileServerEnabled() ? `开 · 暂存 ${pendingFiles()} 个` : "关",
        },
        { k: "心跳 / 超时", v: hb ? `${hb}s / ${to ? `${to}s` : "关"}` : "关" },
        { k: "合并转发", v: fwdLabel() },
        // QQBot 被动回复：记着多少个会话能让回复挂到用户那条消息上。
        // 只在真的有记录时显示 —— 没装 QQBot 的用户看到这一行会莫名其妙
        ...(passiveCount() > 0
          ? [{ k: "被动回复窗口", v: `${passiveCount()} 个会话可用` }]
          : []),
      ],
    },
    {
      title: "运行环境",
      key: "RUNTIME",
      items: [
        { k: "运行框架", v: frameVersion() ? `${frameName()} v${frameVersion()}` : frameName() },
        { k: "Node.js", v: `v${nodeVersion()}` },
        { k: "操作系统", v: `${sys.platform} · ${sys.arch}` },
        // 只给核心数，不给型号：型号串（Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz）
        // 有 40 多字符，在 kv 的窄栏里会折成两三行，把整块的行距节奏打乱。
        // 排障要看的也是「几核」——单核跑满和 16 核闲着是两回事。型号在 #早柚版本 上有。
        { k: "处理器", v: `${sys.cpuCores} 核心` },
        // 百分比放前面：一眼要看的是「满不满」，具体数字是佐证
        { k: "内存占用", v: `${sys.memoryPercent}% · ${sys.usedMemory}/${sys.totalMemory}` },
        { k: "本进程", v: `${sys.processUptime} · ${sys.processRss}` },
      ],
    },
  ]
}

/**
 * 设置菜单的分组
 *
 * 分组依据从「配置文件里挨着谁」换成了「指令能不能改它」
 * ------------------------------------------------
 * 原来这里出的是状态页那套两列 kv，四块按配置树分（总开关与连接 / 过滤 / 媒体 /
 * 更新），每块末尾挂一行「改法」。问题是那行改法与它修饰的那五六项并列，读起来
 * 像第七个配置项；而块里既有指令能改的开关，也有只能在配置文件里改的调参
 * （心跳、外链有效期、检查间隔），两者长得完全一样。
 *
 * 现在前三组只放**指令能改的项**，一行一项、右侧一个开关胶囊或取值，说明那行
 * 直接给出改它的指令；改不了但仍该看见的项挪进 settingFacts() 的只读块。
 *
 * 隐私边界与 statusPanels 一致：这张图会发到群里，所以名单只报条数，
 * 不出现群号、用户号、前缀内容与 token。
 */
function settingGroups(): SettingGroup[] {
  const f = config.filter || {}
  const u = config.update_check || {}

  return [
    {
      title: "总开关",
      key: "CORE",
      rows: [
        {
          name: "适配器",
          dsc: "关掉则完全不连核心 · #早柚设置适配器开启 / 关闭",
          icon: "settings",
          on: enabled(),
        },
        {
          name: "断线通知",
          dsc: "连接断开与重连成功时私聊通知主人 · #早柚设置断线通知开启",
          icon: "refresh",
          on: !!config.notify_master,
        },
      ],
    },
    {
      title: "消息上报",
      key: "REPORT",
      rows: [
        // 三个方向各占一行，不再合成 `开 / 开 / 关` 一格：那种写法要数到第几个
        // 斜杠才知道是哪个方向关着，而这页最常问的就是「为什么核心收不到消息」
        {
          name: "私聊上报",
          dsc: "把私聊消息转给核心 · #早柚设置私聊上报关闭",
          icon: "list",
          on: f.report_private !== false,
        },
        {
          name: "群聊上报",
          dsc: "含频道消息 · #早柚设置群聊上报关闭",
          icon: "list",
          on: f.report_group !== false,
        },
        {
          name: "事件上报",
          dsc: "入群、退群、戳一戳 · #早柚设置事件上报关闭",
          icon: "status",
          on: f.report_meta !== false,
        },
        {
          name: "仅响应 @",
          dsc: "群里只在被 @ 或带前缀时才上报 · #早柚设置仅响应at开启",
          icon: "search",
          on: !!f.only_reply_at,
        },
      ],
    },
    {
      title: "媒体与更新",
      key: "MEDIA",
      rows: [
        {
          name: "最大媒体大小",
          dsc: "超过这个体积改用外链 · #早柚设置最大媒体大小 2（单位 MB）",
          icon: "plus",
          value: formatBytes(Number(config.media_max_size) || 0),
        },
        {
          name: "更新检查",
          dsc: "定时查新提交并推送更新日志 · #早柚设置更新检查开启",
          icon: "arrowUp",
          on: !!u.enable,
        },
      ],
    },
  ]
}

/**
 * 只读信息
 *
 * 这些项指令改不了（要么是调参、要么是运行时事实），但排障时正是要看的。
 * 与上面的开关列表分开，是为了让「右侧有胶囊」这件事只代表「这项可以改」。
 */
function settingFacts(): SettingFacts[] {
  const f = config.filter || {}
  const u = config.update_check || {}
  const srv = config.file_server || {}
  const conns = getWsConnections()
  const hb = Number(config.client?.heartbeat) || 0
  const to = Number(config.client?.heartbeat_timeout) || 0

  return [
    {
      title: "连接与过滤",
      key: "LINKS",
      items: [
        { k: "连接数", v: `${conns.length} 条 · ${conns.filter(c => c.enable !== false).length} 条启用` },
        { k: "心跳 / 超时", v: hb ? `${hb}s / ${to ? `${to}s` : "关"}` : "关" },
        // 默认重连次数不再是无限，这页要说清楚——否则「连接自己停了」会被当成 bug
        { k: "重连", v: reconnectLabel(conns) },
        { k: "触发前缀", v: countOf(f.prefix, "无") },
        { k: "屏蔽前缀 / 关键词", v: `${f.block_prefix?.length || 0} / ${f.block_include?.length || 0} 项` },
        { k: "群白名单 / 黑名单", v: `${countOf(f.white_group)} / ${f.black_group?.length || 0} 项` },
      ],
    },
    {
      title: "文件与日志",
      key: "FILES",
      items: [
        { k: "文件大小上限", v: formatBytes(Number(config.file_max_size) || 0) },
        { k: "外链有效期", v: formatDuration(Number(config.link_expire) / 1000 || 0) },
        {
          k: "内置文件服务",
          v: srv.enable === false ? "关" : `开 · 端口 ${srv.port || "自动"}`,
        },
        { k: "自定义图床", v: config.upload_hook ? "已配置" : "未配置" },
        { k: "检查间隔 / 首检", v: `${Math.max(Number(u.interval) || 180, 30)} 分 / ${Number(u.delay) || 5} 分` },
        { k: "日志截断 base64", v: onOff(config.log_truncate !== false) },
      ],
    },
  ]
}

/**
 * 重连策略摘要
 *
 * 各连接可以各配一个次数，值不一致时不必逐条列出——那是 #早柚连接列表 的事。
 * 这里只回答「会不会停」：全都无限、全都有上限、还是混着。
 */
function reconnectLabel(conns: WsConnection[]): string {
  const base = Number(conns[0]?.reconnect_interval) || 5
  if (!conns.length) return `间隔 ${base}s 起 · 默认最多 ${DEFAULT_MAX_RECONNECT} 次`
  const caps = conns.map(c => Number(c.max_reconnect_attempts ?? DEFAULT_MAX_RECONNECT))
  const unlimited = caps.filter(n => !(n > 0)).length
  if (unlimited === caps.length) return `间隔 ${base}s 起 · 无限重连`
  const max = Math.max(...caps.filter(n => n > 0))
  return unlimited
    ? `间隔 ${base}s 起 · 最多 ${max} 次（${unlimited} 条无限）`
    : `间隔 ${base}s 起 · 最多 ${max} 次`
}

/** 合并转发走哪条路径，与 #早柚版本 同一套判定 */
function fwdLabel(): string {
  const fwd = forwardMode()
  return fwd === "native" ? "框架原生" : fwd === "target" ? "群/好友接口" : "不可用"
}

/**
 * 渲染当前配置图（不带参数的 #早柚设置）
 *
 * 与 #早柚状态 的分工：那页答「现在跑得怎么样」（连接状态、收发计数、心跳年龄），
 * 这页答「现在配成什么样」（每一项的取值，以及各自的改法）。所以这里不放任何
 * 运行时数字——重复的部分只会让两页都变长而信息没增加。
 *
 * 隐私边界与 statusPanels 一致：这张图会发到群里。所以 token 只说「已设置」、
 * 过滤名单只报条数、连接地址不带查询参数（那里可能拼着 token）。
 *
 * 换成 Settings 而不是继续借 Status：理由见 components/Settings.tsx 的文件头。
 * 也不再出上面那排四格大数字卡——ADAPTER / REPLY AT 两格与下面的开关行重复，
 * LINKS / HEARTBEAT 属于只读事实，都各归其位了。
 */
export async function renderConfig() {
  return render({
    name: "config",
    title: "早柚核心 当前配置",
    view: palette =>
      Settings({
        title: PluginName,
        version,
        enabled: enabled(),
        heading: "SETTINGS",
        ghost: "CONFIG",
        palette,
        time: stamp(),
        groups: settingGroups(),
        facts: settingFacts(),
      }),
  })
}

/**
 * 渲染设置结果图（#早柚设置 带参数）
 *
 * 与菜单页同一个组件，多一条顶部结果条：改完那次要先回答「刚才那条生效了吗」，
 * 再顺带把当前全貌摆出来（省掉一次 #早柚设置）。原来是把 done/errs 塞进
 * panels 当两块 kv 明细，与配置项混成一片，还得靠 ` = ` 把每行切回 key/value；
 * 现在结果整行原样显示，admin.ts 那边的文案怎么写就怎么出。
 *
 * done 收成功的、errs 收失败的（与 admin.ts set() 的同名数组一致）。
 */
export async function renderSettings(done: string[], errs: string[]) {
  return render({
    name: "settings",
    title: "早柚核心 设置已保存",
    view: palette =>
      Settings({
        title: PluginName,
        version,
        enabled: enabled(),
        heading: "SETTINGS",
        ghost: "SETTINGS",
        palette,
        time: stamp(),
        result: { done, errs },
        groups: settingGroups(),
        facts: settingFacts(),
        tip: errs.length ? "#早柚帮助 查看正确写法" : "#早柚设置 再看一次当前配置",
      }),
  })
}

/** 渲染状态图 */
export async function renderStatus() {
  const { rows, total, online } = collect(true)
  const s = snapshot()

  return render({
    name: "status",
    title: "早柚核心 适配器状态",
    // 不开 multiPage：加了三块明细后整页 CSS 高约 2030px、出图 3050px，本体的
    // 分片阈值是 4000px（renderers/puppeteer/lib/puppeteer.js:161），
    // 到不了阈值时 num 算出来仍是 1，开了只是白走一遍数组包裹的路径。
    // 帮助页 CSS 高 3900px 都还是单图，这页远没到该分片的量级。
    view: palette =>
      Status({
        title: PluginName,
        version,
        enabled: enabled(),
        heading: "STATUS",
        ghost: "STATUS",
        palette,
        time: stamp(),
        rows,
        // 概览页把账号级子行折叠到前几条：下面还压着四块分组明细，一条核心绑十几个
        // 号时全铺开会把它们挤到第二屏。要逐个核对走 #早柚连接列表 —— 那页不折叠
        compactRuntime: true,
        emptyTip: enabled()
          ? "用 #早柚添加连接 <地址> 添加"
          : "适配器已禁用\n用 #早柚设置适配器开启 启用",
        // 四格换成「开关 / 在线 / 上行 / 下行」：已停用的连接在卡片上自带
        // 「已停用」胶囊，不必再占一格，而收发量是这页最该先看到的数字。
        summary: [
          { key: "ADAPTER", value: enabled() ? "ON" : "OFF", sub: "适配器开关" },
          { key: "ONLINE", value: `${online}/${total}`, sub: "在线 / 总数" },
          { key: "UPLINK", value: String(s.today.up + s.today.event), sub: "今日上报核心" },
          { key: "DOWNLINK", value: String(s.today.down), sub: "今日核心下发" },
        ],
        panels: statusPanels(),
      }),
  })
}

/**
 * 本版变更最多显示几条
 *
 * 这页走单图（没开 multiPage），所以不会被分片，但也就没人替它兜底：不设限的话
 * 一个大版本二十几条能把图拉到近 6000px，而 index.ts 的 SCALE 注释里记着，
 * 过高的图不少 QQ 适配器会拒发或压成马赛克。12 条时出图 4135px，仍在能发的量级，
 * 也覆盖了目前所有已发布版本的实际条目数（最多的 2.0.0 是 11 条）。
 */
const CHANGE_LIMIT = 12

/** 按 CHANGE_LIMIT 裁剪变更条目，超出的在末尾留一句说明 */
function trimChanges(r: Release | null): Release | null {
  if (!r) return null

  let left = CHANGE_LIMIT
  const groups: Release["groups"] = []
  let dropped = 0

  for (const g of r.groups) {
    if (left <= 0) {
      dropped += g.items.length
      continue
    }
    const items = g.items.slice(0, left)
    dropped += g.items.length - items.length
    left -= items.length
    groups.push({ ...g, items })
  }

  // 省略的条目数明说，免得用户以为这版就改了这么多。
  // 挂在最后一个分类下而不是新起一节：它是个注脚，不是一类变更。
  if (dropped > 0 && groups.length)
    groups[groups.length - 1].items.push(`…另有 ${dropped} 条，详见 CHANGELOG.md`)

  return { ...r, groups }
}

/**
 * 渲染关于页（#早柚版本）
 *
 * 与 #早柚更新日志 的分工：那条命令答「代码更新到哪了」（git 提交列表，按提交），
 * 这条答「我是谁、跑在什么环境上、这版改了什么」（CHANGELOG.md，按发布）。
 * 两者数据源不同，所以这里不列任何 git 提交信息。
 */
export async function renderAbout() {
  const { total, online } = collect()
  const fv = frameVersion()
  const sys = sysInfo()

  // 缺失的 Bot 能力：兼容层能垫的都垫了，但 fileToUrl 垫不了，
  // 会真实影响大文件发送。这页顺带把探测结果摆出来，省得用户去翻启动日志。
  const missing = missingBotApis()
  const fwd = forwardMode()

  return render({
    name: "about",
    title: "早柚核心适配器 版本信息",
    view: palette =>
      About({
        title: PluginName,
        version,
        palette,
        time: stamp(),
        logo: imageDataUri(PLUGIN_LOGO),
        desc: "插件、框架与本地宿主的精简诊断快照",
        release: releaseType(),
        // 顺序即版面顺序，两列从左到右、从上到下铺。
        // 连接数这类会变的状态信息不放这页——那是 #早柚状态 答的问题。
        rows: [
          {
            key: "操作系统",
            value: sys.os,
            sub: `${sys.platform} · ${sys.arch}`,
          },
          {
            key: "运行框架",
            value: fv ? `${frameName()} v${fv}` : frameName(),
            sub: "按 Bot.uin 的形状判定：TRSS 存数组，喵崽继承 ICQQ 存单个数字",
          },
          {
            key: "Node.js 版本",
            value: `v${nodeVersion()}`,
            mono: true,
            sub: `V8 ${process.versions.v8}`,
          },
          {
            key: "运行状态",
            value: enabled() ? "已启用" : "已禁用",
            mono: true,
            sub: enabled()
              ? "云崽作为 ws 客户端主动连接核心"
              : "用 #早柚设置适配器开启 启用",
          },
          {
            key: "处理器",
            value: sys.cpuModel,
            sub: `${sys.cpuCores} 核心`,
          },
          {
            key: "运行时长",
            value: sys.processUptime,
            sub: `系统已运行 ${sys.systemUptime}`,
          },
          {
            key: "合并转发",
            value: fwd === "native" ? "框架原生" : fwd === "target" ? "群/好友接口" : "不可用",
            sub: "核心下发合并转发时走哪条路径",
          },
          {
            key: "框架能力",
            value: missing.length ? `缺少 ${missing.join("、")}` : "齐全",
            sub: missing.includes("fileToUrl")
              ? "无文件外链服务，超过 media_max_size 的大文件由插件内置服务代发"
              : "Bot 上所需的工具方法均可用",
          },
          {
            key: "已配置连接",
            value: `${total} 个`,
            sub: `${online} 个在线 · 详情见 #早柚连接列表`,
          },
        ],
        memory: {
          percent: sys.memoryPercent,
          used: sys.usedMemory,
          total: sys.totalMemory,
        },
        // 标题右侧速览：三项都是「此刻好不好」，和下面按项铺开的环境摘要不同——
        // 摘要要一条条读，这三格是扫一眼就走。取值都短（个数、百分比、时长），
        // 44px 下不会顶到标题
        glance: [
          { key: "LINKS", value: `${online}/${total}` },
          { key: "MEMORY", value: `${sys.memoryPercent}%` },
          { key: "UPTIME", value: sys.processUptime },
        ],
        // 传裸版本号（2.1.0）而不是 describe 串：CHANGELOG 的小节标题是纯 semver，
        // 拿 v2.1.0-2-gc6522ee-dirty 去比永远对不上
        changes: trimChanges(currentRelease(bareVersion)),
        // 四条铺满三列网格的两行（Docs 跨两列，见 About.tsx 的阈值判断）。
        // Repo 写死常量而不是读 git remote：远端地址可能内嵌凭据，
        // 与 renderChangelog 不显示仓库地址是同一条理由。
        links: [
          { key: "License", value: "GPL-3.0-only" },
          { key: "Repo", value: "github.com/fanxiaocuo/gscore-adapter" },
          { key: "Core", value: "github.com/Genshin-bots/gsuid_core" },
          { key: "Docs", value: "docs.sayu-bot.com/LinkBots/AdapterList.html" },
        ],
      }),
  })
}

/**
 * 渲染更新日志图
 *
 * 两种语境共用一张版式：
 *   - 有新提交（info.hasUpdate）：列远端比本地多的那些，语气是「可以更新了」
 *   - 已最新：列本地最近的提交，等价于本体 #更新日志 的内容
 * 判定哪种由调用方给的 info 决定，本函数只负责排版。
 *
 * @param info checkUpdate() 的结果
 * @param local 已最新时用来填充列表的本地提交
 */
export async function renderChangelog(info: UpdateInfo, local: Commit[] = []) {
  const has = info.hasUpdate
  const commits = has ? info.commits : local

  return render({
    name: "changelog",
    title: has ? "早柚核心适配器 有新版本" : "早柚核心适配器 更新日志",
    multiPage: true,
    view: palette =>
      Changelog({
        title: PluginName,
        version,
        heading: has ? "UPDATE" : "CHANGELOG",
        ghost: has ? "UPDATE" : "CHANGES",
        led: has ? "warn" : "on",
        rightKey: has ? "BEHIND" : "LOCAL",
        rightValue: has ? `${info.behind} commits` : info.local || "unknown",
        palette,
        time: stamp(),
        commits,
        summary: [
          {
            key: "STATUS",
            value: has ? "OUTDATED" : "LATEST",
            sub: has ? "有新提交" : "已是最新",
          },
          { key: "BEHIND", value: String(info.behind), sub: "落后提交数" },
          { key: "LOCAL", value: info.local || "-", sub: "本地 HEAD" },
          // 只显示引用名（origin/main），不显示仓库地址——地址可能内嵌凭据，
          // 抹除逻辑在 git.remoteUrl()，这里索性不引入这个风险面
          { key: "TRACKING", value: info.ref || "-", sub: "跟踪分支" },
        ],
        emptyTitle: has ? "有新提交" : "暂无提交记录",
        emptyTip: has
          ? `本地落后 ${info.behind} 个提交，但读取日志失败\n用 #早柚更新 直接拉取`
          : "插件目录可能不是 git 仓库，或仓库还没有任何提交",
        notice: info.error || undefined,
      }),
  })
}
