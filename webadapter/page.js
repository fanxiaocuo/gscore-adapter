/**
 * 早柚核心适配器 · web 面板
 *
 * 宿主用 iframe 加载本页，并在 URL 上附 `?__webBase=`（如 /qqbot-web）。
 * 所有接口都在那个前缀下，且由宿主统一鉴权，这里不处理登录。
 *
 * 不引任何框架：整页就三块（统计、连接、设置），手写 DOM 比拉一个运行时划算，
 * 而且宿主的静态文件白名单只放行描述符里列过的文件，多一个 vendor 就多一行白名单。
 */
const WEB_BASE = new URLSearchParams(location.search).get("__webBase") || ""
const API = `${WEB_BASE}/api/gscore-adapter`

/** 当前整包数据 */
let state = null
/** 弹层在编辑哪一条；null 表示新增 */
let editing = null

const $ = id => document.getElementById(id)

// 图标经接口取（宿主的静态白名单只放行 page.html/css/js），
// 拿不到就一直藏着 —— 页面其余部分不依赖它
const logo = $("logo")
logo.onload = () => (logo.hidden = false)
logo.src = `${API}/logo`
// 标签页图标用同一张。iframe 里设 favicon 对外层标签页无效，但这个页面也可以
// 被直接打开（宿主的 /api/web-page/ 路由就能单独访问），那时它是有用的
$("favicon").href = `${API}/logo`

/** 文本一律走 textContent / 属性赋值，不拼 innerHTML —— 连接名与地址是用户输入 */
function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

function toast(msg, bad) {
  const t = $("toast")
  t.textContent = msg
  t.className = `toast${bad ? " bad" : ""}`
  t.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => (t.hidden = true), 4000)
}

async function api(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data
  try {
    data = await res.json()
  } catch {
    // 鉴权失败时宿主可能回 HTML 登录页而不是 JSON
    throw new Error(res.status === 401 || res.status === 403 ? "未登录或无权限" : `HTTP ${res.status}`)
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

function bytes(n) {
  if (!n) return "0 B"
  const u = ["B", "KiB", "MiB", "GiB"]
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n % 1 ? n.toFixed(1) : n} ${u[i]}`
}

/* ---------- 渲染 ---------- */

function renderStats() {
  const box = $("stats")
  box.textContent = ""
  const s = state.stats
  const on = state.connections.filter(c => c.status === 1).length
  const items = [
    ["连接", `${on}/${state.connections.length}`, "已连接 / 总数"],
    ["今日上行", String(s.today.up + s.today.event), `累计 ${s.total.up + s.total.event}`],
    ["今日下行", String(s.today.down), `累计 ${s.total.down}`],
    ["运行模式", state.config.mode === "off" ? "已关闭" : "client", s.persisted ? "计数已落盘" : "计数仅内存"],
  ]
  for (const [k, v, sub] of items) {
    const c = el("div", "card")
    c.append(el("div", "k", k), el("div", "v", v), el("div", "s", sub))
    box.append(c)
  }
}

function renderConns() {
  const box = $("conns")
  box.textContent = ""
  if (!state.connections.length) {
    box.append(el("p", "empty", "还没有连接。点「添加连接」，或直接发 #早柚添加连接 127.0.0.1:8765"))
    return
  }
  for (const c of state.connections) {
    const row = el("div", "conn")

    const dot = el("span", `dot s${c.enable ? c.status : "off"}`)
    const main = el("div", "cmain")
    main.append(el("div", "cname", c.name))
    main.append(el("div", "curl", c.url))

    const meta = el("div", "cmeta")
    meta.append(el("span", "tag", c.status_text))
    if (c.retry > 0) meta.append(el("span", "tag", `重连 ${c.retry} 次`))
    if (c.bot_id) meta.append(el("span", "tag", `bot_id ${c.bot_id}`))
    if (c.has_token) meta.append(el("span", "tag", "已配 token"))
    meta.append(el("span", "tag", `↑${c.up} ↓${c.down}`))
    main.append(meta)

    const acts = el("div", "cacts")
    const toggle = el("button", "btn", c.enable ? "停用" : "启用")
    toggle.onclick = () => act({ action: "toggle", key: c.index, enable: !c.enable })
    const edit = el("button", "btn", "编辑")
    edit.onclick = () => openModal(c)
    const del = el("button", "btn danger", "删除")
    del.onclick = () => {
      if (confirm(`删除连接「${c.name}」？`)) act({ action: "del", key: c.index })
    }
    acts.append(toggle, edit, del)

    row.append(dot, main, acts)
    box.append(row)
  }
}

/** 设置表单的字段表，渲染与收集共用一份 */
const FIELDS = [
  { k: "mode", label: "运行模式", type: "select", opts: [["client", "连接核心"], ["off", "关闭"]], hint: "改这项需重启云崽" },
  { k: "heartbeat", label: "心跳间隔（秒）", type: "number", hint: "0 关闭；改后自动重连" },
  { k: "heartbeat_timeout", label: "心跳超时（秒）", type: "number", hint: "0 关闭" },
  { k: "media_max_size", label: "媒体内联上限（字节）", type: "number", hint: "超过改用外链" },
  { k: "notify_master", label: "断线通知主人", type: "switch" },
  { k: "filter.report_private", label: "上报私聊", type: "switch" },
  { k: "filter.report_group", label: "上报群聊", type: "switch" },
  { k: "filter.report_meta", label: "上报进群/退群/戳一戳", type: "switch" },
  { k: "filter.only_reply_at", label: "仅被 @ 或带前缀才上报", type: "switch" },
]

const dig = (o, path) => path.split(".").reduce((a, k) => a?.[k], o)

function renderSettings() {
  const box = $("settings")
  box.textContent = ""
  for (const f of FIELDS) {
    const wrap = el("label", "field")
    wrap.append(el("span", "flabel", f.label))
    const v = dig(state.config, f.k)
    let input
    if (f.type === "select") {
      input = el("select")
      for (const [val, txt] of f.opts) {
        const o = el("option", null, txt)
        o.value = val
        input.append(o)
      }
      input.value = String(v)
    } else if (f.type === "switch") {
      input = el("input")
      input.type = "checkbox"
      input.checked = !!v
    } else {
      input = el("input")
      input.type = "number"
      input.value = String(v ?? 0)
    }
    input.dataset.k = f.k
    wrap.append(input)
    if (f.type === "number" && f.k === "media_max_size") {
      // 字节数直接看数字读不出量级，跟一行人类可读的
      const live = el("span", "fhint", bytes(Number(input.value)))
      input.oninput = () => (live.textContent = bytes(Number(input.value)))
      wrap.append(live)
    }
    if (f.hint) wrap.append(el("span", "fhint", f.hint))
    box.append(wrap)
  }
  $("cfgfile").textContent = `配置文件：${state.plugin.configFile}`
}

function render() {
  $("meta").textContent = `${state.plugin.name} ${state.plugin.version}`
  renderStats()
  renderConns()
  renderSettings()
}

/* ---------- 交互 ---------- */

async function load() {
  try {
    state = await api("/config")
    render()
  } catch (err) {
    toast(err.message, true)
  }
}

async function act(body) {
  try {
    const r = await api("/connection", body)
    state = r
    render()
    toast(r.message)
  } catch (err) {
    toast(err.message, true)
  }
}

/** 连接弹层的字段表 */
const CFIELDS = [
  { k: "name", label: "连接名", ph: "gsuid_core" },
  { k: "url", label: "地址", ph: "127.0.0.1:8765（自动补 /ws/Yunzai）" },
  { k: "token", label: "token", ph: "留空则不修改", type: "password" },
  { k: "bot_id", label: "bot_id", ph: "留空按 bot_id_map 推断" },
  { k: "reconnect_interval", label: "重连间隔（秒）", type: "number" },
  { k: "max_reconnect_attempts", label: "最大重连次数", type: "number", hint: "0 为无限" },
]

function openModal(conn) {
  editing = conn || null
  $("mtitle").textContent = conn ? `编辑：${conn.name}` : "添加连接"
  const box = $("mform")
  box.textContent = ""
  for (const f of CFIELDS) {
    const wrap = el("label", "field")
    wrap.append(el("span", "flabel", f.label))
    const input = el("input")
    input.type = f.type || "text"
    input.placeholder = f.ph || ""
    if (conn && f.k !== "token") input.value = String(conn[f.k] ?? "")
    if (!conn && f.k === "reconnect_interval") input.value = "5"
    if (!conn && f.k === "max_reconnect_attempts") input.value = "0"
    input.dataset.k = f.k
    wrap.append(input)
    if (f.hint) wrap.append(el("span", "fhint", f.hint))
    box.append(wrap)
  }
  $("mask").hidden = false
}

function closeModal() {
  $("mask").hidden = true
  editing = null
}

async function submitModal() {
  const body = { action: editing ? "edit" : "add" }
  if (editing) body.key = editing.index
  for (const input of $("mform").querySelectorAll("[data-k]")) {
    const v = input.value.trim()
    // token 留空在编辑时表示「不改」，新增时表示「没有」，两种都不必传
    if (!v && input.dataset.k === "token") continue
    body[input.dataset.k] = input.type === "number" ? Number(v) : v
  }
  try {
    const r = await api("/connection", body)
    state = r
    render()
    closeModal()
    toast(r.message)
  } catch (err) {
    toast(err.message, true)
  }
}

async function saveSettings() {
  const body = { filter: {} }
  for (const input of $("settings").querySelectorAll("[data-k]")) {
    const k = input.dataset.k
    const v = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value
    if (k.startsWith("filter.")) body.filter[k.slice(7)] = v
    else body[k] = v
  }
  try {
    const r = await api("/config", body)
    state = r
    render()
    toast(r.message)
  } catch (err) {
    toast(err.message, true)
  }
}

$("refresh").onclick = load
$("add").onclick = () => openModal(null)
$("save").onclick = saveSettings
$("mcancel").onclick = closeModal
$("mok").onclick = submitModal
$("mask").onclick = e => {
  if (e.target === $("mask")) closeModal()
}
$("reconnect").onclick = async () => {
  try {
    const r = await api("/reconnect", {})
    state = r
    render()
    toast(r.message)
  } catch (err) {
    toast(err.message, true)
  }
}

load()
// 连接状态会自己变（断线重连），定时刷一下；弹层开着时不刷，免得输入被覆盖
setInterval(() => {
  if ($("mask").hidden) load()
}, 10000)
