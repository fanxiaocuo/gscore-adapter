/**
 * Web 面板：接 QQBot-Web-Adapter 的插件页
 *
 * 宿主是什么
 * ---------
 * `plugins/QQBot-Web-Adapter`（另一个插件）提供一个 web 控制台，并允许各插件往
 * 导航栏挂自己的页面：它开机及 `login` / `plugins/loaded` 时扫各插件下的
 * `webadapter/index.js`，import 后调 `export function init(ctx)`。
 * **本插件不自带 http 服务**，宿主没装时这个模块根本不会被加载，是死代码。
 * （真要自己起服务的场景见 utils/fileServer.ts，那是另一回事。）
 *
 * 契约要点（对宿主 index.js:307-332 与 page.md 核实过）
 * -------------------------------------------------
 * - 接口必须走 `ctx.registerApi`。它挂的是宿主的 Bot.express 并自动套
 *   `apiAuthGuard`（非内网 403、未登录 401）。裸 `Bot.express.get()` 会绕过鉴权。
 * - `registerPage({ src, style })` 是 iframe 模式，且 src/style/script 同时是
 *   **文件访问白名单** —— 页面里引用了但描述符没列的文件一律 403。
 * - iframe 里拿 API 前缀要用宿主注入的 `?__webBase=` 查询参数。
 *
 * 为什么不自己另写一套配置读写
 * -------------------------
 * 指令（apps/admin.ts）已经把「改配置 + 热生效」走通了，面板必须调同一批函数：
 * `saveConfig` 保留 yaml 注释，`startClient` / `stopClient` 精确启停单条连接。
 * 参考实现 xiowo/yunzai-gscore-adapter 的面板是 `YAML.stringify(config)` 整份覆盖，
 * 用户写在配置里的注释会被抹掉，这里不学。
 */
import { config, configFile, saveConfig, getConnections, enabled } from "@/config"
import { clients, startClient, stopClient, reloadClients } from "@/modules/client"
import { snapshot, forName } from "@/modules/stats/index.js"
import { passiveCount } from "@/modules/passive/index.js"
import { PluginName, ResPath } from "@/dir"
import { requireWsUrl } from "@/utils/url"
import { makeLog } from "@/utils/compat"
import { versionLabel } from "@/modules/render/version.js"
import { PLUGIN_LOGO } from "@/modules/render/assets.js"
import fs from "node:fs"
import path from "node:path"

/** 原型链污染防护：这三个键写进配置对象会污染 Object.prototype */
const BAD_KEYS = ["__proto__", "prototype", "constructor"]

/**
 * 连接的可序列化视图
 *
 * **不要整个 conf 扔给前端** —— 里面有 token。这里逐字段挑，token 只回一个
 * 布尔表示「配没配」，要改就重新填。同理不用 GsCoreClient 的 url getter，
 * 它会把 token 拼进查询参数。
 */
function connView(conf, i: number) {
  const live = clients.find(c => c.name === (conf.name || conf.url))
  const enabled = conf.enable !== false
  const counters = forName(conf.name || conf.url)
  return {
    index: i,
    name: conf.name || conf.url,
    url: conf.url || "",
    bot_id: conf.bot_id || "",
    enable: enabled,
    /** 只说明有没有配，不回原值 */
    has_token: !!conf.token,
    reconnect_interval: Number(conf.reconnect_interval) || 5,
    max_reconnect_attempts: Number(conf.max_reconnect_attempts) || 0,
    bind: Array.isArray(conf.bind) ? conf.bind : [],
    exclude: Array.isArray(conf.exclude) ? conf.exclude : [],
    status: live?.status ?? 0,
    // 「已停用」与「未启动」在状态码上都是 0，但成因不同，前端要分开显示
    status_text: !enabled ? "已停用" : live ? live.statusText : "未启动",
    retry: live?.retry ?? 0,
    up: counters.up + counters.event,
    down: counters.down,
  }
}

/** GET 回的整包 */
function payload() {
  const stats = snapshot()
  return {
    ok: true,
    plugin: { name: PluginName, version: versionLabel(), configFile },
    config: {
      enable: enabled(),
      heartbeat: Number(config.client?.heartbeat) || 0,
      heartbeat_timeout: Number(config.client?.heartbeat_timeout) || 0,
      notify_master: config.notify_master === true,
      media_max_size: Number(config.media_max_size) || 0,
      filter: {
        report_private: config.filter?.report_private !== false,
        report_group: config.filter?.report_group !== false,
        report_meta: config.filter?.report_meta !== false,
        only_reply_at: config.filter?.only_reply_at === true,
      },
    },
    connections: getConnections().map(connView),
    stats: {
      total: stats.total,
      today: stats.today,
      since: stats.since,
      persisted: stats.persisted,
      passive: passiveCount(),
    },
  }
}

/** 按名字或 index 定位，语义与 apps/admin.ts 的 find() 一致 */
function locate(key) {
  const list = getConnections()
  if (typeof key === "number" && Number.isInteger(key) && key >= 0 && key < list.length)
    return { index: key, conf: list[key] }
  const i = list.findIndex(c => (c.name || c.url) === String(key))
  return i > -1 ? { index: i, conf: list[i] } : null
}

/** 布尔字段：前端可能传 "true" 这种字符串 */
function bool(v, dflt: boolean): boolean {
  if (v === undefined || v === null || v === "") return dflt
  if (typeof v === "boolean") return v
  return v === "true" || v === 1 || v === "1"
}

/**
 * 保存全局设置
 *
 * 只认白名单里的键，逐个 setIn —— 不整份覆盖，用户配置里没写过的项继续
 * 继承默认值，写过的注释也留着。
 */
function saveGlobal(body) {
  const changed: string[] = []
  let needRestart = false

  saveConfig(doc => {
    if (body.enable !== undefined) {
      const v = bool(body.enable, true)
      if (v !== enabled()) needRestart = true
      doc.setIn(["enable"], v)
      changed.push("enable")
    }
    if (body.notify_master !== undefined) {
      doc.setIn(["notify_master"], bool(body.notify_master, false))
      changed.push("notify_master")
    }
    if (body.media_max_size !== undefined) {
      const n = Number(body.media_max_size)
      // 下限同指令那边：比 1KiB 还小的上限意味着所有媒体都走外链，多半是填错了
      if (!Number.isFinite(n) || n < 1024) throw new Error("media_max_size 不能小于 1024")
      doc.setIn(["media_max_size"], n)
      changed.push("media_max_size")
    }
    for (const k of ["heartbeat", "heartbeat_timeout"]) {
      if (body[k] === undefined) continue
      const n = Number(body[k])
      if (!Number.isFinite(n) || n < 0) throw new Error(`${k} 应为 0 或正整数`)
      doc.setIn(["client", k], n)
      changed.push(`client.${k}`)
    }
    const f = body.filter || {}
    for (const k of ["report_private", "report_group", "report_meta", "only_reply_at"]) {
      if (f[k] === undefined) continue
      doc.setIn(["filter", k], bool(f[k], true))
      changed.push(`filter.${k}`)
    }
  })

  // 心跳参数在建连时读，改了要重连才生效；其余项每条消息现读，即时生效
  const touchedClient = changed.some(k => k.startsWith("client."))
  if (touchedClient && enabled()) reloadClients()

  return { changed, needRestart, touchedClient }
}

/** 新增连接 */
function addConnection(body) {
  const url = requireWsUrl(body.url)
  const list = getConnections()
  if (list.some(c => c.url === url)) throw new Error("该地址已存在")

  let name = String(body.name || "").trim() || `core${list.length + 1}`
  if (list.some(c => (c.name || c.url) === name)) name = `${name}-${Date.now().toString(36)}`

  const conf: any = {
    name,
    url,
    token: String(body.token || ""),
    bot_id: String(body.bot_id || ""),
    enable: bool(body.enable, true),
    reconnect_interval: Number(body.reconnect_interval) || 5,
    max_reconnect_attempts: Number(body.max_reconnect_attempts) || 0,
    bind: Array.isArray(body.bind) ? body.bind : [],
    exclude: Array.isArray(body.exclude) ? body.exclude : [],
  }

  saveConfig(doc => {
    if (!doc.hasIn(["client", "connections"])) doc.setIn(["client", "connections"], doc.createNode([]))
    ;(doc.getIn(["client", "connections"]) as any).add(doc.createNode(conf))
  })

  if (enabled() && conf.enable) startClient(conf)
  return conf.name
}

/**
 * 改一条连接
 *
 * 改完先停后起：连接参数（url / token / bind）都是建连时读的，
 * 光改配置不重连的话面板显示已改、实际还连着老地址。
 */
function editConnection(body) {
  const hit = locate(body.key ?? body.index ?? body.name)
  if (!hit) throw new Error("找不到该连接")
  const path = ["client", "connections", hit.index]
  const oldName = hit.conf.name || hit.conf.url

  saveConfig(doc => {
    if (body.url !== undefined) doc.setIn([...path, "url"], requireWsUrl(body.url))
    if (body.name !== undefined) doc.setIn([...path, "name"], String(body.name).trim())
    if (body.bot_id !== undefined) doc.setIn([...path, "bot_id"], String(body.bot_id))
    // token 留空表示「不改」，不是「清空」—— 面板拿不到原值（GET 只回 has_token），
    // 把空串当清空会让每次保存都把 token 抹掉。要清空走 clear_token
    if (body.token) doc.setIn([...path, "token"], String(body.token))
    if (body.clear_token) doc.setIn([...path, "token"], "")
    if (body.enable !== undefined) doc.setIn([...path, "enable"], bool(body.enable, true))
    for (const k of ["reconnect_interval", "max_reconnect_attempts"]) {
      if (body[k] === undefined) continue
      const n = Number(body[k])
      if (!Number.isFinite(n)) throw new Error(`${k} 应为数字`)
      doc.setIn([...path, k], n)
    }
    for (const k of ["bind", "exclude"]) {
      if (body[k] === undefined) continue
      if (!Array.isArray(body[k])) throw new Error(`${k} 应为数组`)
      doc.setIn([...path, k], doc.createNode(body[k]))
    }
  })

  stopClient(oldName)
  const next = getConnections()[hit.index]
  if (enabled() && next?.enable !== false) startClient(next)
  return next?.name || oldName
}

/** 删一条 */
function delConnection(body) {
  const hit = locate(body.key ?? body.index ?? body.name)
  if (!hit) throw new Error("找不到该连接")
  const name = hit.conf.name || hit.conf.url
  saveConfig(doc => doc.deleteIn(["client", "connections", hit.index]))
  stopClient(name)
  return name
}

/** 开关一条 */
function toggleConnection(body) {
  const hit = locate(body.key ?? body.index ?? body.name)
  if (!hit) throw new Error("找不到该连接")
  const on = bool(body.enable, true)
  saveConfig(doc => doc.setIn(["client", "connections", hit.index, "enable"], on))
  const name = hit.conf.name || hit.conf.url
  if (on) {
    if (enabled()) startClient({ ...hit.conf, enable: true })
  } else stopClient(name)
  return name
}

/** 挡住原型污染键：面板收的是任意 JSON，不能直接信 */
function safeBody(body) {
  if (!body || typeof body !== "object") return {}
  for (const k of BAD_KEYS) if (Object.hasOwn(body, k)) delete body[k]
  return body
}

/**
 * 宿主入口
 *
 * 注意签名必须是具名导出 init（宿主取 `mod.init || mod.default`）。
 */
export function init(ctx) {
  const { registerPage, registerApi, logger } = ctx

  registerPage({
    id: "gscore-adapter",
    title: "早柚核心适配器",
    // 只能是 emoji：宿主用 textContent 渲染这颗图标（web/app.js:146 导航栏、
    // 171 移动端横幅），给图片路径会把路径本身当文字显示出来。
    // 插件 logo 放在页面内部 —— 标题区一张、favicon 一张，都走
    // /gscore-adapter/logo 接口。
    icon: "☄️",
    src: "page.html",
    // iframe 模式下宿主不会把 style/script 注入外层 DOM（页面自己 <link>/<script>
    // 引），但这两项同时是**文件访问白名单** —— /api/web-page/ 只放行描述符里
    // 列过的文件。少列一个，页面就会拿到 403（page.md:82）
    style: "page.css",
    // 产物名不能叫 page.js：宿主的 scanWebPages() 会把 webadapter/page.js
    // 当「约定式页面描述符」在 **Node 侧** import（index.js:291 的固定文件名
    // 列表 page.js / page.json / pages.js / pages.json）。而这份是浏览器 bundle，
    // 顶层就读 location，一 import 必然抛 `location is not defined`。
    // 报错只影响那次扫描（本模块仍由 index.js 正常初始化），但每次开机 /
    // login / plugins/loaded 都会刷一条 error 日志。
    script: "panel.js",
    priority: 40,
  })

  /** 统一的错误出口：错误信息回给前端，堆栈只进日志 */
  const guard = (fn, code = 400) => async (req, res) => {
    try {
      res.json(await fn(req))
    } catch (err: any) {
      makeLog("warn", ["web 面板：请求失败", err], "GsCore")
      logger?.warn?.(`[gscore-adapter] ${err?.message}`)
      res.status(code).json({ ok: false, error: String(err?.message || err) })
    }
  }

  registerApi("get", "/gscore-adapter/config", guard(() => payload(), 500))

  /**
   * 插件图标
   *
   * 页面里的 <img> 不能直接指向 resources/template/image/ —— 宿主的
   * /api/web-page/ 只放行描述符里列过的 src/style/script 三个文件（index.js:271-278），
   * 别的路径一律 403。所以图标由本插件自己回，走同一套鉴权。
   *
   * 顺带一提：导航栏那颗 icon 只能是 emoji。宿主用 textContent 渲染它
   * （web/app.js:146），给图片路径会被当字面量显示出来。
   */
  registerApi("get", "/gscore-adapter/logo", (_req, res) => {
    try {
      const file = path.join(ResPath, "template/image", PLUGIN_LOGO)
      const buf = fs.readFileSync(file)
      res.setHeader("Content-Type", "image/webp")
      // 图标随版本走，版本不变就不必重取
      res.setHeader("Cache-Control", "public, max-age=86400")
      res.end(buf)
    } catch {
      res.status(404).end()
    }
  })

  registerApi(
    "post",
    "/gscore-adapter/config",
    guard(req => {
      const r = saveGlobal(safeBody(req.body))
      return {
        ...payload(),
        message: r.changed.length
          ? `已保存 ${r.changed.length} 项${r.needRestart ? "，enable 需重启云崽生效" : ""}`
          : "没有需要保存的改动",
      }
    }),
  )

  registerApi(
    "post",
    "/gscore-adapter/connection",
    guard(req => {
      const body = safeBody(req.body)
      const action = String(body.action || "")
      let name: string
      switch (action) {
        case "add":
          name = addConnection(body)
          break
        case "edit":
          name = editConnection(body)
          break
        case "del":
          name = delConnection(body)
          break
        case "toggle":
          name = toggleConnection(body)
          break
        default:
          throw new Error(`未知操作 ${action}`)
      }
      return { ...payload(), message: `连接 ${name} 已${{ add: "添加", edit: "保存", del: "删除", toggle: "更新" }[action]}` }
    }),
  )

  registerApi(
    "post",
    "/gscore-adapter/reconnect",
    guard(() => {
      // 与 #早柚重连 一致：restart() 而不是 reloadClients()，
      // 后者会按配置重建实例，把「配置没变、只是想重连」变成一次重载
      for (const c of clients) c.restart()
      return { ...payload(), message: `已重连 ${clients.length} 个连接` }
    }),
  )

  makeLog("info", "web 面板已注册到 QQBot-Web-Adapter", "GsCore")
}

export default init
