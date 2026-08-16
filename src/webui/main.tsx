/**
 * Web 面板前端（React）
 *
 * 这份是**浏览器**代码，与 modules/webadapter/（Node 侧接口）分属两端：
 * 它由 Vite（内置 Rolldown，配置见根目录 vite.config.mts）打包成
 * webadapter/panel.js，样式从下面 import 的 styles.css 抽成 webadapter/page.css，
 * 宿主用 iframe 加载 page.html 时引入。打包而不是直接 import react ——
 * 宿主的静态白名单只放行描述符里列过的文件名（src/style/script 三个），
 * 放不进 node_modules，也没有 import map。
 *
 * 与出图那边共用 react 依赖，不额外引运行时。产物约 15KB（min），
 * 与原先手写 DOM 的 314 行体量相当，但状态流转由 React 管，不必自己
 * 记「哪些节点要重画」。
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
 * 连接弹层的字段表
 *
 * type: "list" 的两项在后端是数组。绑定账号在弹层里另有一组开关（BotSwitchList），
 * 两者读写的是**同一个** form.bind —— 这个输入框是手填入口（离线且从没绑过的账号
 * 不会出现在开关列表里，只能手写），开关是常规入口，不存在两份状态。
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
  { k: "reconnect_interval", label: "重连间隔（秒）", type: "number" },
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
 * 按点号路径取值，供 FIELDS 里的 `filter.xxx` 用
 *
 * 返回 unknown 而不是 any：取出来的值一律要经 `!!` 或 `Number()` 才能用，
 * 标 any 会让 `form[x.k]` 直接进 JSX 而不报错（对象会渲染成崩溃）
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
 * 复用的 utility 组合
 *
 * 按钮、输入框这些在多处重复出现，抽成常量免得各处手抄跑偏。
 * 形状与配色分开：同一属性的两个 utility 写在一起时，谁生效由样式表里的
 * 先后决定而非 className 的顺序，所以变体不叠加基础色，各给各的。
 *
 * 只有本文件用到的留在这儿；组件也要用的（MONO / TAG）在 ui.ts，从那儿引。
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
 * 设置项一行：标题 | 说明 | 控件
 *
 * 系统设置那种观感靠的是列宽固定（标题列 190px），多行之间对得齐；分隔线用
 * border-t + first:border-t-0，不必给每行套一个卡片。720px 以下收成两列：
 * 说明挪到标题下面一行，控件跨两行钉在行尾（与 BotSwitchList 的行同一套做法）。
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
 * 面板发给 /connection 的请求体
 *
 * 五个动作共用一个接口，字段随动作变（add 不带 key，toggle 只带 key + enable，
 * bind 带 key + id + on），所以除 action 外都是可选 —— 后端 `locate()` / `bool()`
 * 自己兜缺失值
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
 * 弹层里判断「用户正在填的这个地址是不是自动端点」
 *
 * 已保存的连接不走这里 —— 它们直接读后端算好的 `ConnView.automatic`
 * （webadapter 的 connView 调 isAutomaticEndpoint）。但新增/编辑弹层里的地址还没
 * 落盘，浏览器隔着 JSON 拿不到后端那个函数，只能就地判一次「pathname 是不是空或根」。
 *
 * 判错的唯一后果是提交按钮的可用性：真正的拦截仍在后端 requireAccounts，
 * 所以这里刻意只做最粗的形状判断，不去复刻 normalizeEndpoint 的其余规则。
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
   * 绑定折叠区的开合。放在组件内而不是提升到 App：轮询刷新会整包替换 state，
   * 但 Conn 按 index 作 key，同位实例复用，开合状态在刷新间存活。
   */
  const [open, setOpen] = useState(false)
  /** 正在保存的账号，请求期间整组开关禁用（理由见 toggle） */
  const [saving, setSaving] = useState<string | null>(null)
  const bindBots = c.bind_bots || []
  // 开着的账号 = 有效账号（bind 减 exclude），后端算好回在 accounts 里
  const on = c.accounts || []
  const runtime = c.runtime || []
  /**
   * 这条连接现在「不限账号」：兼容连接且一个有效账号都没有
   *
   * 判据是 `accounts` 而不是 `bind` —— 后端给兼容连接派生的运行时 bind 就是 accounts
   * （expand.ts:188），而 `accept()` 见到空 bind 就放行一切（GsCoreClient.ts:336-337）。
   * 于是 bind 非空但被 exclude 吃干净时（bind=[A]、exclude=[A]），实际行为是「除被排除
   * 的号以外全部转发」，看 bind 却会显示成「绑定 0/N 个账号」—— 用户以为白名单在生效，
   * 实际所有机器人的消息都在进核心。被排除的号由旁边的「排除 …」标签单独说。
   *
   * 自动端点不适用：它的 bind 决定派生出几条 ws，零账号等于这条连接不存在，
   * 后端 requireAccounts 直接拒，不存在「不限账号」这个状态。
   */
  const unlimited = !c.automatic && !on.length

  /**
   * 一个开关只表达一个账号的意图，所以发 bind 动作、只报这一个账号
   *
   * 不用 edit + 整份 bind 数组：edit 会把这条核心上所有账号的运行时连接全停再全起
   * （webadapter 的 editConnection 走 stopSource/startSource），拨一个开关就把已经连着的
   * 其他账号一起断一次；bind 动作只停这一个账号那条 ws。整份数组回传还有并发覆盖问题
   * —— 两个开关几乎同时拨，后一个请求带的是它自己看到的旧数组，会把前一个的结果抹掉。
   * 保存期间整组禁用也是为这个：连点会造出同样的交叉覆盖。
   */
  const toggle = async (id: string, next: boolean) => {
    /*
     * 兼容连接的两个方向都要确认，因为两边都会当场改变「谁的消息进核心」
     *
     * 关掉最后一个：白名单变不限，其余机器人的消息突然全部开始转发。
     * 从不限拨开第一个：不限变单账号白名单，其余机器人的消息当场全部停止转发 ——
     * 比放宽更有破坏性，所以更不能一声不响。
     * 自动端点两个方向都不问：它的最后一个开关在 BotSwitchList 里就是禁用的，
     * 而它压根没有「不限账号」这个状态（零账号会被后端拒）。
     */
    if (!c.automatic) {
      /*
       * 「不限账号」不等于「谁都转发」：exclude 是独立的一层，仍然拦着名单里的号
       * （GsCoreClient.accept 先判 exclude 再判 bind）。写死「所有机器人」会在配了
       * 排除名单的连接上说过头。
       *
       * 反过来「关掉最后一个有效账号之后 bind 还非空、所以还是白名单」不成立：
       * 非根连接的运行时 bind 取的是**有效**账号（expand 的 `bind: accounts`），
       * bind 里剩下的全是被 exclude 挡掉的号时它就是空的，确实变成不限。
       */
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
                  「绑定 1/10」看起来像 9 个绑定没成功。行数在展开后自己数得清 */}
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
      {/*
       * 逐条运行时连接
       *
       * 只在展开或多于一条时列：一条时头部那行状态就是它，重复显示只是噪音；
       * 多条时头部是聚合值（1 > 2 > 3 > 0），必须能看出是哪个账号没连上。
       */}
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
   * 开关列表的候选与状态都从这份表单算，不存第二份 state
   *
   * 候选 = 在线机器人 + 已填在 bind 里的账号 + 本连接原先绑过的（编辑时可能已离线）。
   * 手填的号在框架里查不到档案，只能造一个占位的：online false、无头像，
   * Avatar 会回退成首字圆。开合状态与已保存连接同一个判据：在 bind 且不在 exclude。
   */
  const known = new Map(bots.map(b => [b.id, b]))
  for (const b of conn?.bind_bots || []) if (!known.has(b.id)) known.set(b.id, b)
  for (const id of bind)
    if (!known.has(id)) known.set(id, { id, name: id, avatar: "", online: false })
  const candidates = [...known.values()]
  const checked = bind.filter(id => !exclude.includes(id))
  const conflicts = bind.filter(id => exclude.includes(id))
  const url = (form.url || "").trim()
  /*
   * 地址还没填时既不是自动端点也不是兼容连接
   *
   * `looksAutomatic("")` 回 true（没有 `/` 就算根路径），若照它办，弹层一打开、用户还
   * 什么都没输入，保存按钮就是灰的、底下红字说「自动连接至少要绑定一个账号」——
   * 指错了字段（后端对空地址报的是「连接地址不能为空」，isAutomaticEndpoint 也回 false）。
   */
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

  /*
   * 自动端点必须至少留一个账号
   *
   * 后端 requireAccounts 会拒，这里提前把提交按钮灰掉。判自动端点用的是本地那个
   * 粗略函数（见 looksAutomatic），所以只灰按钮、不做别的推断 —— 真正的把关在后端
   */
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
  /**
   * 上一次同步进表单的那份服务端值的指纹，用来区分「外部真的改了」与「轮询又回了同一份包」
   *
   * useRef 的初值表达式每次渲染都会算一遍（只在首次被采用），FIELDS 就那么几项，
   * 换成惰性初始化反而要多一次 mount 后的重渲染，不值当。
   */
  const synced = useRef(fieldsKey(readFields(config)))
  /*
   * 只在服务端值真的变了时才覆盖表单
   *
   * 每 10 秒的轮询都会 setState 一个新对象，`config` 引用因此每次都变。原来只按引用
   * 判断，于是拨了全局设置的开关却没点保存时，10 秒内它自己弹回去；输一半的数字也
   * 会被抹掉。这批开关不像绑定开关那样即时写（要点「保存设置」），所以 App 那个
   * `inflight` 挡不住它 —— 拨开关的那一刻根本没有在途的写请求。
   *
   * 内容真变了才覆盖：那时本地未保存的改动确实会被顶掉，但那是「外部数据变了」的
   * 既定行为，也是这个 effect 本来的用途（自己保存成功后回包同样走这条路）。
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
      {/*
       * 一列到底的设置行，不再用 auto-fit 多列网格
       *
       * 多列在窄屏上会把「标题 / 说明 / 控件」三段各自换行，读起来是一团；
       * 单列 + 固定标题列宽才是系统设置那种一眼扫得下来的观感。
       */}
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
   * 在途的写请求数
   *
   * 轮询与写请求会抢同一份 state：拨开关时 10 秒的 /config 可能后到，把开关刷回旧位，
   * 看起来就是「点了又弹回去」。计数而不是布尔 —— 连着拨两个开关时，先回来的那个
   * 不该把还在途的那个也放开。用 ref 不用 state：它只在回调里读，不需要触发重渲染。
   */
  const inflight = useRef(0)
  /**
   * 已落地的写请求计数，用来作废「跨过一次写」的读回包
   *
   * `inflight` 管的是**别发起**（写在途时不轮询），这里管的是**别采用**：轮询在写请求
   * 开始之前就发出去了（那时 inflight 还是 0），却在写完成之后才回来，那份 state 是
   * 写之前的旧值，采用它就是把刚保存的改动刷没了。两个窗口不重叠，所以两者都要有。
   */
  const gen = useRef(0)
  /**
   * 弹层是否开着，给轮询回调读
   *
   * 不在回调里用 `setModal(m => …)` 顺手读当前值：那个 updater 会被 React 当纯函数
   * 对待（严格模式下按约定可重复调用），在里面发请求属于副作用。ref 只是读，安全。
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
        // 有话才弹：Payload.message 是可选的（多数写动作不带），空着弹出来是个
        // 没有字的框。tsc 抓不到 —— 仓库关了 strictNullChecks（见 tsconfig.json 的
        // 说明），`string | undefined` 传进 `text: string` 不报错
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
  /*
   * 连接数看 totals：一条逻辑连接会按绑定账号展开成多条 ws
   *
   * 数 connections 里 status === 1 的只能得到「有几条核心通了」，看不出某条核心上
   * 掉了一个账号。totals 由后端按运行时连接算（logical / runtime / connected）。
   */
  const t = state.totals || { logical: state.connections.length, runtime: 0, connected: 0 }
  // 展开阶段被跳过的连接在卡片上只显示「未启动」，原因只有这份话术说得出
  const errors = state.errors || []
  const warnings = state.warnings || []

  return (
    <>
      {/* flex-wrap：390px 下「标题 + 两个按钮」放不进一行，按钮整组换到下一行靠右 */}
      <header className="mb-[16px] flex flex-wrap items-center justify-between gap-[16px]">
        <div className="flex min-w-0 items-center gap-[12px]">
          {/* 图标经接口取：宿主的静态白名单只放行 page.html/css/js，
              直连 resources/ 会 403。加载失败就不显示，页面其余部分不依赖它 */}
          {/* 图标是透明底的字形，不加底色与描边 —— 那会在标题旁多出一个方块 */}
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

      {/*
       * 浮在弹层之上，而不是待在文档流里
       * ------
       * 原来这是 header 后面一个普通的流内 div，而 Modal 是 `fixed inset-0` 带半透明
       * 遮罩 —— 同一层叠上下文里定位元素画在非定位的流内兄弟之上，于是弹层保存失败时
       * 唯一的反馈被压在遮罩底下；页面往下滚过一屏更是整个在视口外。而失败分支只弹
       * toast、不关弹层也不动 state（见 send 的 catch），界面上于是没有任何可见变化，
       * 用户只会再点几次保存。本分支给弹层新加了两个拒绝点（requireAccounts、面板侧的
       * findRouteConflict），把一个原先几乎碰不到的问题变成了常规路径。
       *
       * 底色用 color-mix 兑到 --surface 而不是 transparent：浮在遮罩上时透明底会把
       * 遮罩的黑透进来，文字读不了。z 值与 Modal 的 z-50 成对，别只改一个。
       */}
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
              {/*
               * key 用下标而不是话术本身：两条连接同名（配置允许）且坏在同一处时
               * 话术逐字相同，撞 key 会让 React 只渲一条。这个列表整包重取、不排序
               * 也不局部增删，下标就是稳定身份
               */}
              {errors.map((e, i) => (
                <p className="whitespace-pre-line text-[12px]" key={i}>
                  {e}
                </p>
              ))}
            </div>
          )}
          {/*
           * 警告与上面那个框分开渲，标题和配色都不一样
           * ------
           * 服务端按 ExpandError.skipped 分流（webui/api.ts 的 warnings）。混在上面
           * 那个红框里的话，一条 `ws://h:8765/ws/Yunzai` 不填账号的兼容连接（老配置
           * 升级后的默认形态）就会绿着点显示「已连接」，头顶一个红框说它没能启动 ——
           * 而它正在正常收发，每次轮询还复现一次。
           */}
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
