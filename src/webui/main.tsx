/**
 * @description Web 面板前端（React），与 modules/webadapter/（Node 侧接口）分属两端
 *
 * 由 Vite 打包成 webadapter/panel.js，样式从 styles.css 抽成 webadapter/page.css，宿主用 iframe
 * 加载 page.html 时引入。
 * 注意：必须打包而不是直接 import react —— 宿主的静态白名单只放行描述符里列过的三个文件名，
 * 放不进 node_modules，也没有 import map
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import type { BotProfile, ConnView, Payload, PayloadConfig } from "./api.js"
import { Avatar } from "./components/Avatar.js"
import { BotSwitchList } from "./components/BotSwitchList.js"
import { Switch } from "./components/Switch.js"
import { MONO, TAG } from "./ui.js"
import "./styles.css"

/** 宿主可能挂在 /qqbot-web 这类前缀下，接口前缀只能从它注入的查询参数取 */
const WEB_BASE = new URLSearchParams(location.search).get("__webBase") || ""
const API = `${WEB_BASE}/api/gscore-adapter`

async function api(path: string, body?: unknown): Promise<Payload> {
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    // 鉴权失败时宿主回的是 HTML 登录页，不是 JSON
    throw new Error(
      res.status === 401 || res.status === 403 ? "未登录或无权限" : `HTTP ${res.status}`,
    )
  }
  const result = data as { ok?: boolean; error?: string }
  if (!res.ok || result.ok === false) throw new Error(result.error || `HTTP ${res.status}`)
  return data as Payload
}

/** catch 到的是 unknown，统一取一句能显示的话 */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function bytes(n: number) {
  if (!n) return "0 B"
  const u = ["B", "KiB", "MiB", "GiB"]
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n % 1 ? n.toFixed(1) : n} ${u[i]}`
}

/** 全局设置的字段表，渲染与收集共用 */
const FIELDS = [
  { k: "enable", label: "启用适配器", type: "switch", hint: "关掉则完全不连核心，改完即时生效" },
  { k: "heartbeat", label: "心跳间隔（秒）", type: "number", hint: "0 关闭；改后自动重连" },
  { k: "heartbeat_timeout", label: "心跳超时（秒）", type: "number", hint: "0 关闭" },
  { k: "media_max_size", label: "媒体内联上限", type: "bytes", hint: "超过改用外链" },
  { k: "notify_master", label: "断线通知主人", type: "switch" },
  { k: "filter.report_private", label: "上报私聊", type: "switch" },
  { k: "filter.report_group", label: "上报群聊", type: "switch" },
  { k: "filter.report_meta", label: "上报进群/退群/戳一戳", type: "switch" },
  { k: "filter.only_reply_at", label: "仅被 @ 或带前缀才上报", type: "switch" },
]

/**
 * @description 连接弹层的字段表
 * 注意：type "list" 的绑定账号与弹层里那组开关（BotSwitchList）读写的是**同一个** form.bind ——
 * 输入框是手填入口（离线且从没绑过的账号不在开关列表里），不存在两份状态
 */
const CFIELDS = [
  { k: "name", label: "连接名", ph: "gsuid_core" },
  {
    k: "url",
    label: "核心地址",
    ph: "127.0.0.1:8765",
    hint: "只填 host:port，运行时按绑定账号生成 /ws/Yunzai-<账号>",
  },
  { k: "token", label: "token", ph: "留空则不修改", type: "password" },
  { k: "reconnect_interval", label: "重连间隔（秒）", type: "number", min: 1 },
  {
    k: "max_reconnect_attempts",
    label: "最大重连次数",
    type: "number",
    hint: "默认 5，填 0 为无限重连",
  },
  {
    k: "bind",
    label: "绑定账号",
    ph: "至少一个账号，多个用逗号分隔",
    type: "list",
    hint: "与下方开关同一份数据，离线账号可以手填",
  },
  {
    k: "exclude",
    label: "排除账号",
    ph: "留空为不排除，多个用逗号分隔",
    type: "list",
    hint: "优先级高于绑定账号",
  },
]

/** 逗号分隔的文本 <-> 数组。中英文逗号都收，顺手去空项 */
const toList = (s: string) =>
  s
    .split(/[,，]/)
    .map(v => v.trim())
    .filter(Boolean)

/**
 * @description 按点号路径取值，供 FIELDS 里的 `filter.xxx` 用
 * 注意：返回 unknown 而不是 any —— 标 any 会让 `form[x.k]` 直接进 JSX 而不报错（对象会渲染成崩溃）
 */
const dig = (o: unknown, path: string): unknown => {
  let value = o
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

/*
 * 复用的 utility 组合，抽成常量免得各处手抄跑偏。只有本文件用到的留在这儿，
 * 组件也要用的（MONO / TAG）在 ui.ts。
 * 注意：形状与配色分开写 —— 同一属性的两个 utility 写在一起时，谁生效由样式表里的先后
 * 决定而非 className 的顺序，所以变体不叠加基础色
 */
const BTN_SHAPE = "cursor-pointer rounded-[8px] border px-[14px] py-[6px] text-[13px]"
const BTN = `${BTN_SHAPE} border-border bg-surface text-fg hover:border-primary`
/* 主按钮不跟 hover 描边：原样式表里 .btn.primary 排在 .btn:hover 之后，同权重下后者不生效 */
const BTN_PRIMARY = `${BTN_SHAPE} border-transparent bg-primary text-white`
const BTN_DANGER = `${BTN_SHAPE} border-border bg-surface text-fg hover:border-danger hover:text-danger`
const INPUT = "rounded-[8px] border border-border bg-bg px-[10px] py-[7px] text-[13px] text-fg"
const HINT = "mt-[2px] text-[12px] text-muted"
const FHINT = "text-[11px] text-muted"
const FIELD = "flex flex-col gap-[4px]"
const GRID = "grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[12px]"
const PANEL =
  "mb-[16px] rounded-[12px] border border-border bg-surface p-[16px] shadow-[var(--shadow)]"
/* 面板头的「靠右」变体：margin 上 12 下 0，与常规 phead 的下 12 相反 */
const PHEAD_END = "mt-[12px] flex items-center justify-end gap-[12px]"

/*
 * 设置项一行：标题 | 说明 | 控件。列宽固定（标题列 190px）所以多行之间对得齐，
 * 分隔线用 border-t + first:border-t-0。720px 以下收成两列：说明挪到标题下面一行，
 * 控件跨两行钉在行尾（与 BotSwitchList 的行同一套做法）。
 */
const ROW =
  "grid min-h-[54px] grid-cols-[190px_minmax(0,1fr)_auto] items-center gap-x-[16px] gap-y-[2px] border-t border-border px-[16px] first:border-t-0 max-[720px]:grid-cols-[minmax(0,1fr)_auto] max-[720px]:px-[4px]"
const ROW_TITLE = "text-[13px] max-[720px]:col-start-1 max-[720px]:row-start-1"
/* overflow-wrap:anywhere 是页面级横向滚动的真正解法：容器可收缩 + 长串就地断行 */
const ROW_HINT =
  "min-w-0 text-[12px] text-muted [overflow-wrap:anywhere] max-[720px]:col-start-1 max-[720px]:row-start-2"
const ROW_CTRL =
  "flex justify-end max-[720px]:col-start-2 max-[720px]:row-span-2 max-[720px]:row-start-1"

function Stat({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-surface px-[16px] py-[14px] shadow-[var(--shadow)]">
      <div className="text-[12px] tracking-[0.04em] text-muted">{k}</div>
      <div className="my-[2px] text-[26px] font-bold tabular-nums">{v}</div>
      <div className="text-[12px] text-muted">{sub}</div>
    </div>
  )
}

/* 状态码对应 constants/index.ts 的 STATUS_TEXT：0 未连接 1 已连接 2 连接中 3 断线重连中。
   已连接那档带同色光晕，box-shadow 用变量拼 utility 太长，留在 styles.css 里当 .dot-on */
const DOT: Record<string, string> = {
  0: "bg-danger",
  1: "dot-on",
  2: "bg-warning",
  3: "bg-warning",
  off: "bg-muted",
}

/**
 * @description 面板发给 /connection 的请求体
 * 五个动作共用一个接口、字段随动作变，所以除 action 外都是可选 —— 后端 `locate()` / `bool()` 自己兜缺失值
 */
interface ConnAction {
  action: "add" | "edit" | "del" | "toggle" | "bind"
  key?: number
  enable?: boolean
  id?: string
  on?: boolean
  [k: string]: unknown
}

/**
 * @description 弹层里就地判断「用户正在填的这个地址是不是自动端点」（pathname 是不是空或根）
 * 已保存的连接不走这里，它们直接读后端算好的 `ConnView.automatic`。
 * 注意：刻意只做最粗的形状判断，不复刻 normalizeEndpoint —— 判错的唯一后果是提交按钮的可用性，
 * 真正的拦截仍在后端 requireAccounts
 */
function looksAutomatic(url: string): boolean {
  const rest = url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[?#]/)[0]
  const i = rest.indexOf("/")
  return i < 0 || !rest.slice(i + 1).trim()
}

function Conn({
  c,
  onAct,
  onEdit,
}: {
  c: ConnView
  onAct: (body: ConnAction) => Promise<void>
  onEdit: (conn: ConnView) => void
}) {
  /**
   * @description 绑定折叠区的开合
   * 放在组件内而不是提升到 App：轮询刷新整包替换 state，但 Conn 按 index 作 key，
   * 同位实例复用，开合状态在刷新间存活
   */
  const [open, setOpen] = useState(false)
  /** 正在保存的账号，请求期间整组开关禁用（理由见 toggle） */
  const [saving, setSaving] = useState<string | null>(null)
  const bindBots = c.bind_bots || []
  // 开着的账号 = 有效账号（bind 减 exclude），后端算好回在 accounts 里
  const on = c.accounts || []
  const runtime = c.runtime || []
  /**
   * @description 这条连接现在「不限账号」：兼容连接且一个有效账号都没有
   * 注意：判据是 `accounts` 而不是 `bind` —— bind 非空但被 exclude 吃干净时实际行为就是不限，
   * 看 bind 会显示成「绑定 0/N 个账号」，用户以为白名单在生效。
   * 自动端点不适用：零账号等于这条连接不存在，后端直接拒
   */
  const unlimited = !c.automatic && !on.length

  /**
   * @description 一个开关只表达一个账号的意图，所以发 bind 动作、只报这一个账号
   * 注意：不用 edit + 整份 bind 数组 —— 两个开关几乎同时拨时后一个请求带的是旧数组，
   * 会把前一个的结果整份抹掉（保存期间整组禁用也是为这个）
   */
  const toggle = async (id: string, next: boolean) => {
    /*
     * 兼容连接的两个方向都要确认，两边都会当场改变「谁的消息进核心」：关掉最后一个是白名单
     * 变不限，从不限拨开第一个则让其余机器人当场全部停止转发。
     * 自动端点两个方向都不问：它的最后一个开关在 BotSwitchList 里就是禁用的，也没有「不限账号」这个状态
     */
    if (!c.automatic) {
      // 注意：「不限账号」不等于「谁都转发」—— exclude 是独立的一层，仍然拦着名单里的号，
      // 写死「所有机器人」会在配了排除名单的连接上说过头
      const rest = c.exclude?.length ? "除排除名单里的账号外，其余" : "所有"
      const ask =
        !next && on.length === 1
          ? `移除最后一个绑定后，连接「${c.name}」将变为不限账号，${rest}机器人的消息都会转发。继续？`
          : next && on.length === 0
            ? `连接「${c.name}」现在不限账号。绑上这一个之后只转发它，其余机器人的消息会立刻停止进入这个核心。继续？`
            : ""
      if (ask && !confirm(ask)) return
    }
    setSaving(id)
    try {
      await onAct({ action: "bind", key: c.index, id, on: next })
    } finally {
      // 成功失败都要解锁：失败时整包 state 没动，开关自己回到原位
      setSaving(null)
    }
  }

  return (
    <div className="rounded-[10px] border border-border p-[12px]">
      {/* flex-wrap + 按钮组窄屏占满一行：390px 下三个按钮与状态点挤在一行会溢出 */}
      <div className="flex flex-wrap items-center gap-[12px]">
        <span
          className={`size-[10px] flex-none rounded-[50%] ${DOT[c.enable ? c.status : "off"] ?? "bg-muted"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{c.name}</div>
          {/* 字体栈与 Tailwind 的 font-mono 略有出入，按原样式表逐项写死 */}
          <div className={`truncate text-[12px] text-muted ${MONO}`}>{c.url}</div>
          <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
            <span className={TAG}>{c.status_text}</span>
            {c.retry > 0 && <span className={TAG}>已重连 {c.retry} 次</span>}
            {c.has_token && <span className={TAG}>已配 token</span>}
            {/* 绑定标签升级成折叠开关：缩起时预览前几个已开的头像，点开进管理区 */}
            <button
              className={`${TAG} flex cursor-pointer items-center gap-[5px] hover:border-primary`}
              onClick={() => setOpen(o => !o)}
              aria-expanded={open}
              title="展开绑定账号管理"
            >
              {/* 叠放靠负外边距，描边用 ring（border 会与 Avatar 自己的边框打架） */}
              {bindBots
                .filter(b => on.includes(b.id))
                .slice(0, 3)
                .map((b, i) => (
                  <Avatar
                    key={b.id}
                    p={b}
                    size={18}
                    className={i ? "-ml-[6px] ring-2 ring-surface" : ""}
                  />
                ))}
              {/* 只说开着几个，不给分母：分母是候选数（在线的 + 绑过的），10 个 Bot 在线时
                  「绑定 1/10」看起来像 9 个绑定没成功 */}
              <span>{unlimited ? "不限账号" : `绑定 ${on.length} 个账号`}</span>
              <span className="text-[9px]">{open ? "▲" : "▼"}</span>
            </button>
            {c.exclude?.length > 0 && <span className={TAG}>排除 {c.exclude.join("、")}</span>}
            <span className={TAG}>
              ↑{c.up} ↓{c.down}
            </span>
          </div>
        </div>
        <div className="flex flex-none gap-[6px] max-[720px]:w-full max-[720px]:justify-end">
          <button
            className={BTN}
            onClick={() => onAct({ action: "toggle", key: c.index, enable: !c.enable })}
          >
            {c.enable ? "停用" : "启用"}
          </button>
          <button className={BTN} onClick={() => onEdit(c)}>
            编辑
          </button>
          <button
            className={BTN_DANGER}
            onClick={() => {
              if (confirm(`删除连接「${c.name}」？`)) onAct({ action: "del", key: c.index })
            }}
          >
            删除
          </button>
        </div>
      </div>
      {open && (
        <BotSwitchList
          bots={bindBots}
          checked={on}
          conflicts={c.conflicts || []}
          lockLast={c.automatic}
          saving={saving}
          onToggle={toggle}
          empty="没有可选账号：当前没有机器人在线，这条连接也没绑过账号。可以在「编辑」里手填账号。"
        />
      )}
      {/* 逐条运行时连接：只在展开或多于一条时列 —— 一条时头部那行状态就是它，
          多条时头部是聚合值，必须能看出是哪个账号没连上 */}
      {runtime.length > 0 && (open || runtime.length > 1) && (
        <div className="mt-[10px] flex flex-col gap-[6px] rounded-[10px] border border-border bg-bg p-[10px]">
          {runtime.map(r => (
            <div className="flex flex-wrap items-center gap-[8px]" key={r.name}>
              <span
                className={`size-[8px] flex-none rounded-[50%] ${DOT[c.enable ? r.status : "off"] ?? "bg-muted"}`}
              />
              <span className="text-[12px] font-semibold">{r.name}</span>
              {/* 只到 pathname，地址里的 token 查询串后端已经砍掉了 */}
              <span className={`min-w-0 flex-1 truncate text-[12px] text-muted ${MONO}`}>
                {r.path}
              </span>
              <span className={TAG}>{r.status_text}</span>
              {r.retry > 0 && <span className={TAG}>已重连 {r.retry} 次</span>}
              <span className={TAG}>
                ↑{r.up} ↓{r.down}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 连接编辑弹层。conn 为 null 表示新增 */
function Modal({
  conn,
  bots,
  onClose,
  onSubmit,
}: {
  conn: ConnView | null
  /** 当前在线的机器人，与已填的账号合并成开关列表的候选 */
  bots: BotProfile[]
  onClose: () => void
  onSubmit: (body: ConnAction) => void
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {}
    for (const x of CFIELDS) {
      // token 不回填：GET 只回 has_token，拿不到原值。留空提交表示不改
      if (!conn || x.k === "token") {
        f[x.k] = ""
        continue
      }
      const v = (conn as unknown as Record<string, unknown>)[x.k]
      f[x.k] = x.type === "list" ? (Array.isArray(v) ? v.join(", ") : "") : String(v ?? "")
    }
    if (!conn) {
      f.reconnect_interval = "5"
      f.max_reconnect_attempts = "5"
    }
    return f
  })

  const bind = toList(form.bind || "")
  const exclude = toList(form.exclude || "")
  /*
   * 开关列表的候选与状态都从这份表单算，不存第二份 state。
   * 候选 = 在线机器人 + 已填在 bind 里的账号 + 本连接原先绑过的（编辑时可能已离线）；手填的号
   * 查不到档案，造一个占位的（online false、无头像，Avatar 会回退成首字圆）。
   */
  const known = new Map(bots.map(b => [b.id, b]))
  for (const b of conn?.bind_bots || []) if (!known.has(b.id)) known.set(b.id, b)
  for (const id of bind)
    if (!known.has(id)) known.set(id, { id, name: id, avatar: "", online: false })
  const candidates = [...known.values()]
  const checked = bind.filter(id => !exclude.includes(id))
  const conflicts = bind.filter(id => exclude.includes(id))
  const url = (form.url || "").trim()
  // 注意：地址还没填时不算自动端点 —— looksAutomatic("") 回 true，照它办的话弹层一打开
  // 保存按钮就是灰的、红字说「自动连接至少要绑定一个账号」，指错了字段
  const automatic = !!url && looksAutomatic(url)

  const toggle = (id: string, on: boolean) => {
    // 开一个号要顺手把它从 exclude 里放出来，否则「开着但不转发」，与后端
    // bindConnection 的 freed 分支保持同一行为；关只动 bind，不去替用户写排除名单
    const next = on ? [...bind.filter(x => x !== id), id] : bind.filter(x => x !== id)
    setForm({
      ...form,
      bind: next.join(", "),
      exclude: on ? exclude.filter(x => x !== id).join(", ") : form.exclude,
    })
  }

  // 自动端点必须至少留一个账号：后端 requireAccounts 会拒，这里提前把提交按钮灰掉。
  // 判自动端点用的是本地那个粗略函数，所以只灰按钮、不做别的推断 —— 真正的把关在后端
  const blocked = automatic && checked.length === 0

  const submit = () => {
    if (blocked) return
    const body: ConnAction = { action: conn ? "edit" : "add" }
    if (conn) body.key = conn.index
    for (const x of CFIELDS) {
      const v = String(form[x.k] ?? "").trim()
      if (!v && x.k === "token") continue
      // list 留空要提交空数组（表示清掉白名单），不能跳过
      body[x.k] = x.type === "list" ? toList(v) : x.type === "number" ? Number(v) : v
    }
    onSubmit(body)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(0_0_0/45%)] p-[20px] max-[720px]:p-[8px]"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[90vh] w-[min(560px,100%)] overflow-auto rounded-[14px] bg-surface p-[20px] max-[720px]:p-[14px]">
        <h2 className="mb-[16px] text-[17px] font-semibold">
          {conn ? `编辑：${conn.name}` : "添加连接"}
        </h2>
        <div className={GRID}>
          {CFIELDS.map(x => (
            <label className={FIELD} key={x.k}>
              <span className="text-[12px] text-muted">{x.label}</span>
              <input
                className={INPUT}
                // list 不是合法的 input type，落回 text
                type={x.type === "list" ? "text" : x.type || "text"}
                placeholder={x.ph || ""}
                // 只有下界有意义的字段才带 min：max_reconnect_attempts 的 0 是无限重连
                min={x.min}
                value={form[x.k] ?? ""}
                onChange={e => setForm(f => ({ ...f, [x.k]: e.target.value }))}
              />
              {x.hint && <span className={FHINT}>{x.hint}</span>}
            </label>
          ))}
        </div>
        <div className="mt-[16px]">
          <div className="text-[13px] font-semibold">绑定账号</div>
          <p className={FHINT}>
            {!url
              ? "先填上面的连接地址：只填 host:port 就是自动连接，每个绑定账号在核心侧各是一条独立客户端"
              : automatic
                ? "自动连接：每个开着的账号在核心侧是一条独立客户端（/ws/Yunzai-<账号>），至少留一个"
                : "自定义路径的兼容连接：只有一条 ws，这里的账号是转发过滤器，全关等于不限账号"}
          </p>
          {/* 不即时保存：弹层里的改动跟其余字段一起提交，中途关掉就等于没改。
              也不锁「最后一个」—— 还没落盘，没有要维护的不变量，锁了只会让人关不掉 */}
          <BotSwitchList
            bots={candidates}
            checked={checked}
            conflicts={conflicts}
            onToggle={toggle}
            empty="没有机器人在线。可以在上面的「绑定账号」框里手填账号，离线号也能先绑上。"
          />
        </div>
        {blocked && (
          <p className={`${HINT} text-danger`}>
            自动连接至少要绑定一个账号：核心侧的客户端标识就是 /ws/Yunzai-&lt;账号&gt;，
            一个都不绑等于这条连接不存在。
          </p>
        )}
        <div className={PHEAD_END}>
          <button className={BTN} onClick={onClose}>
            取消
          </button>
          <button
            className={`${BTN_PRIMARY} disabled:cursor-not-allowed disabled:opacity-45`}
            disabled={blocked}
            onClick={submit}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

/** 全局设置提交体。filter 那四项在后端是嵌在 filter 下的，所以单独一层 */
interface SettingsBody {
  filter: Record<string, boolean | number>
  [k: string]: unknown
}

/** 把 config 摊平成表单值。初始化与「外部真的变了吗」的比对都用它 */
function readFields(config: PayloadConfig): Record<string, unknown> {
  const f: Record<string, unknown> = {}
  for (const x of FIELDS) f[x.k] = dig(config, x.k)
  return f
}

/** 表单值的指纹。按 FIELDS 顺序取值，所以与对象的键顺序无关 */
function fieldsKey(f: Record<string, unknown>): string {
  return JSON.stringify(FIELDS.map(x => f[x.k] ?? null))
}

function Settings({
  config,
  onSave,
}: {
  config: PayloadConfig
  onSave: (body: SettingsBody) => void
}) {
  const [form, setForm] = useState<Record<string, unknown>>(() => readFields(config))
  /** 上次同步进表单的那份服务端值的指纹，用来区分「外部真的改了」与「轮询又回了同一份包」 */
  const synced = useRef(fieldsKey(readFields(config)))
  /*
   * 注意：只在服务端值真的**变了**时才覆盖表单 —— 轮询每 10 秒 setState 一个新对象，
   * 按引用判断会让没点保存的开关自己弹回去、输一半的数字被抹掉；这批开关不即时写，
   * App 那个 inflight 挡不住它
   */
  useEffect(() => {
    const f = readFields(config)
    const key = fieldsKey(f)
    if (key === synced.current) return
    synced.current = key
    setForm(f)
  }, [config])

  const submit = () => {
    const body: SettingsBody = { filter: {} }
    for (const x of FIELDS) {
      const v = x.type === "switch" ? !!form[x.k] : Number(form[x.k])
      if (x.k.startsWith("filter.")) body.filter[x.k.slice(7)] = v
      else body[x.k] = v
    }
    onSave(body)
  }

  return (
    <>
      {/* 一列到底的设置行，不用 auto-fit 多列网格：多列在窄屏上会把「标题 / 说明 / 控件」
          三段各自换行，读起来是一团 */}
      <div className="overflow-hidden rounded-[10px] border border-border">
        {FIELDS.map(x => {
          // filter.report_private → set-filter-report_private，点号在 CSS/HTML 里都不该出现在 id 上
          const id = `set-${x.k.replace(/\./g, "-")}`
          // 字节数直接看数字读不出量级，把人类可读的那串并进说明列
          const hint = [x.type === "bytes" ? bytes(Number(form[x.k])) : "", x.hint || ""]
            .filter(Boolean)
            .join(" · ")
          return (
            <div className={ROW} key={x.k}>
              {/* htmlFor 让点标题也能切换开关，顺带把标题当成读屏的可见名字 */}
              <label className={ROW_TITLE} htmlFor={id}>
                {x.label}
              </label>
              <span className={ROW_HINT}>{hint}</span>
              <div className={ROW_CTRL}>
                {x.type === "switch" ? (
                  <Switch
                    id={id}
                    checked={!!form[x.k]}
                    onChange={next => setForm(f => ({ ...f, [x.k]: next }))}
                  />
                ) : (
                  <input
                    className={`${INPUT} w-[110px] text-right tabular-nums`}
                    id={id}
                    type="number"
                    value={String(form[x.k] ?? 0)}
                    onChange={e => setForm(f => ({ ...f, [x.k]: e.target.value }))}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className={PHEAD_END}>
        <button className={BTN_PRIMARY} onClick={submit}>
          保存设置
        </button>
      </div>
    </>
  )
}

function App() {
  const [state, setState] = useState<Payload | null>(null)
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null)
  /**
   * 弹层状态有三档，靠 undefined / null / 对象区分：
   *   undefined  关闭（轮询也靠这个值判断「现在能不能刷」）
   *   null       新增
   *   ConnView   编辑这一条
   */
  const [modal, setModal] = useState<ConnView | null | undefined>(undefined)
  const [logoOk, setLogoOk] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /**
   * @description 在途的写请求数，写在途时不轮询，免得后到的读回包把开关刷回旧位
   * 注意：计数而不是布尔 —— 连着拨两个开关时，先回来的那个不该把还在途的那个也放开
   */
  const inflight = useRef(0)
  /**
   * @description 已落地的写请求计数，用来作废「跨过一次写」的读回包
   * 注意：与 {@link inflight} 两个都要有，窗口不重叠 —— 它管「别发起」，这里管「别采用」：
   * 写请求开始之前发出的轮询会在写完成之后才回来，那份 state 是旧值
   */
  const gen = useRef(0)
  /**
   * @description 弹层是否开着，给轮询回调读
   * 注意：别在回调里用 `setModal(m => …)` 顺手读当前值 —— 那个 updater 被 React 当纯函数对待，
   * 在里面发请求属于副作用
   */
  const modalOpen = useRef(false)
  useEffect(() => {
    modalOpen.current = modal !== undefined
  }, [modal])

  const say = useCallback((text: string, bad?: boolean) => {
    setToast({ text, bad })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  const load = useCallback(async () => {
    const at = gen.current
    try {
      const r = await api("/config")
      // 这期间有写请求落地过，回包已经过期，丢掉等下一轮（失败仍要报：那是真的读不到）
      if (gen.current !== at) return
      setState(r)
    } catch (err) {
      say(errMsg(err), true)
    }
  }, [say])

  /** 写请求。刻意不往外抛：调用方（开关）只关心「结束了」，错误已经弹了 toast */
  const send = useCallback(
    async (path: string, body: unknown) => {
      inflight.current++
      try {
        const r = await api(path, body)
        // 成功用回包整包换 state：那是服务端算完之后的真状态，比本地猜的准
        setState(r)
        setModal(undefined)
        // 有话才弹：Payload.message 是可选的（多数写动作不带），空着弹出来是个没字的框。
        // tsc 抓不到 —— 仓库关了 strictNullChecks，`string | undefined` 传进 `text: string` 不报错
        if (r.message) say(r.message)
      } catch (err) {
        // 失败不动 state，界面停在原样，用户重来一次就是
        say(errMsg(err), true)
      } finally {
        // 失败也要加：那时虽然没换 state，但服务端可能已经改了，旧回包一样不可信
        gen.current++
        inflight.current--
      }
    },
    [say],
  )

  useEffect(() => {
    load()
    // 连接状态会自己变（断线重连），定时刷一下
    const id = setInterval(() => {
      // 弹层开着时不刷，免得输入被覆盖；有写请求在途时也不刷，理由见 inflight
      if (!modalOpen.current && inflight.current === 0) load()
    }, 10000)
    return () => clearInterval(id)
  }, [load])

  if (!state) return <p className={HINT}>加载中…</p>

  const s = state.stats
  // 连接数看 totals（后端按运行时连接算）：一条逻辑连接会按绑定账号展开成多条 ws，
  // 数 connections 里 status === 1 的看不出某条核心上掉了一个账号
  const t = state.totals || { logical: state.connections.length, runtime: 0, connected: 0 }
  // 展开阶段被跳过的连接在卡片上只显示「未启动」，原因只有这份话术说得出
  const errors = state.errors || []
  const warnings = state.warnings || []

  return (
    <>
      {/* flex-wrap：390px 下「标题 + 两个按钮」放不进一行，按钮整组换到下一行靠右 */}
      <header className="mb-[16px] flex flex-wrap items-center justify-between gap-[16px]">
        <div className="flex min-w-0 items-center gap-[12px]">
          {/* 图标经接口取：宿主的静态白名单只放行 page.html/css/js，直连 resources/ 会 403。
              加载失败就不显示，页面其余部分不依赖它。图标是透明底字形，不加底色与描边 */}
          <img
            className="size-[40px] flex-none object-contain"
            src={`${API}/logo`}
            alt=""
            hidden={!logoOk}
            onLoad={() => setLogoOk(true)}
          />
          <div>
            <h1 className="text-[20px] font-bold">早柚核心适配器</h1>
            <p className={HINT}>
              {state.plugin.name} {state.plugin.version}
            </p>
          </div>
        </div>
        <div className="flex flex-none gap-[8px] max-[720px]:w-full max-[720px]:justify-end">
          <button className={BTN} onClick={load}>
            刷新
          </button>
          <button className={BTN} onClick={() => send("/reconnect", {})}>
            全部重连
          </button>
        </div>
      </header>

      {/* 注意：toast 必须浮在弹层之上（fixed + z-[60]，与 Modal 的 z-50 成对，别只改一个）——
          待在文档流里会被弹层的半透明遮罩压住，而保存失败只弹 toast、不关弹层也不动 state，
          界面上就没有任何可见变化。底色用 color-mix 兑到 --surface，透明底会把遮罩的黑透进来 */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed left-1/2 top-[16px] z-[60] w-[min(560px,calc(100%-32px))] -translate-x-1/2 rounded-[10px] border px-[14px] py-[10px] text-[13px] shadow-[0_8px_24px_rgb(0_0_0/18%)] ${
            toast.bad
              ? "border-danger bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface))]"
              : "border-success bg-[color-mix(in_srgb,var(--success)_12%,var(--surface))]"
          }`}
        >
          {toast.text}
        </div>
      )}

      <section className="mb-[16px] grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-[12px]">
        <Stat
          k="连接"
          v={`${t.connected}/${t.runtime}`}
          sub={`已连接 / 运行时（逻辑 ${t.logical} 条）`}
        />
        <Stat
          k="今日上行"
          v={String(s.today.up + s.today.event)}
          sub={`累计 ${s.total.up + s.total.event}`}
        />
        <Stat k="今日下行" v={String(s.today.down)} sub={`累计 ${s.total.down}`} />
        <Stat
          k="适配器"
          v={state.config.enable ? "已启用" : "已禁用"}
          sub={s.persisted ? "计数已落盘" : "计数仅内存"}
        />
      </section>

      <section className={PANEL}>
        <div className="mb-[12px] flex items-center justify-between gap-[12px]">
          <h2 className="text-[15px] font-semibold">连接</h2>
          <button className={BTN_PRIMARY} onClick={() => setModal(null)}>
            添加连接
          </button>
        </div>
        <div className="flex flex-col gap-[8px]">
          {errors.length > 0 && (
            <div className="rounded-[10px] border border-danger bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-[14px] py-[10px] text-[13px]">
              <div className="mb-[4px] font-semibold">有连接没能启动</div>
              {/* 注意：key 用下标而不是话术本身 —— 两条连接同名且坏在同一处时话术逐字相同，
                  撞 key 会让 React 只渲一条；这个列表整包重取、不排序也不局部增删 */}
              {errors.map((e, i) => (
                <p className="whitespace-pre-line text-[12px]" key={i}>
                  {e}
                </p>
              ))}
            </div>
          )}
          {/* 注意：警告与上面那个红框分开渲（标题与配色都不一样）—— 混进去会让一条正在正常
              收发的兼容连接绿着点显示「已连接」，头顶一个红框说它没能启动 */}
          {warnings.length > 0 && (
            <div className="rounded-[10px] border border-warning bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-[14px] py-[10px] text-[13px]">
              <div className="mb-[4px] font-semibold">连接已启动，但有需要注意的地方</div>
              {warnings.map((e, i) => (
                <p className="whitespace-pre-line text-[12px]" key={i}>
                  {e}
                </p>
              ))}
            </div>
          )}
          {state.connections.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-border p-[28px] text-center text-muted">
              还没有连接。点「添加连接」，或直接发 #早柚添加连接 127.0.0.1:8765
            </p>
          ) : (
            state.connections.map(c => (
              <Conn
                key={c.index}
                c={c}
                onAct={b => send("/connection", b)}
                onEdit={x => setModal(x)}
              />
            ))
          )}
        </div>
      </section>

      <section className={PANEL}>
        <h2 className="mb-[12px] text-[15px] font-semibold">全局设置</h2>
        <Settings config={state.config} onSave={b => send("/config", b)} />
        <p className={HINT}>配置文件：{state.plugin.configFile}</p>
      </section>

      {modal !== undefined && (
        <Modal
          conn={modal}
          bots={state.bots || []}
          onClose={() => setModal(undefined)}
          onSubmit={b => send("/connection", b)}
        />
      )}
    </>
  )
}

createRoot(document.getElementById("app")).render(<App />)
