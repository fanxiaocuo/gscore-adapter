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
 * type: "list" 的两项在后端是数组（GsCoreClient.accept 按 self_id 比对），
 * 这里用逗号分隔的单行文本收，提交时切成数组 —— 面板上给每个账号一个输入框
 * 收益不大，而多账号本身是少数场景。
 */
const CFIELDS = [
  { k: "name", label: "连接名", ph: "gsuid_core" },
  { k: "url", label: "地址", ph: "127.0.0.1:8765（自动补 /ws/Yunzai）" },
  { k: "token", label: "token", ph: "留空则不修改", type: "password" },
  { k: "bot_id", label: "bot_id", ph: "留空按 bot_id_map 推断", hint: "平台标签，非机器人账号" },
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
    ph: "留空为不限，多个用逗号分隔",
    type: "list",
    hint: "只有这些机器人账号的消息进核心",
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
 */
const BTN_SHAPE = "cursor-pointer rounded-[8px] border px-[14px] py-[6px] text-[13px]"
const BTN = `${BTN_SHAPE} border-border bg-surface text-fg hover:border-primary`
/* 主按钮不跟 hover 描边：原样式表里 .btn.primary 排在 .btn:hover 之后，同权重下后者不生效 */
const BTN_PRIMARY = `${BTN_SHAPE} border-transparent bg-primary text-white`
const BTN_DANGER = `${BTN_SHAPE} border-border bg-surface text-fg hover:border-danger hover:text-danger`
const INPUT = "rounded-[8px] border border-border bg-bg px-[10px] py-[7px] text-[13px] text-fg"
const HINT = "mt-[2px] text-[12px] text-muted"
const FHINT = "text-[11px] text-muted"
const TAG = "rounded-[999px] border border-border px-[8px] py-[1px] text-[11px] text-muted"
const FIELD = "flex flex-col gap-[4px]"
const GRID = "grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[12px]"
const PANEL =
  "mb-[16px] rounded-[12px] border border-border bg-surface p-[16px] shadow-[var(--shadow)]"
/* 面板头的「靠右」变体：margin 上 12 下 0，与常规 phead 的下 12 相反 */
const PHEAD_END = "mt-[12px] flex items-center justify-end gap-[12px]"

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
 * 四个动作共用一个接口，字段随动作变（add 不带 key，toggle 只带 key + enable），
 * 所以除 action 外都是可选 —— 后端 `locate()` / `bool()` 自己兜缺失值
 */
interface ConnAction {
  action: "add" | "edit" | "del" | "toggle"
  key?: number
  enable?: boolean
  [k: string]: unknown
}

/**
 * 机器人头像，加载失败回退成首字圆
 *
 * 头像 URL 可能取自 qlogo 的按号猜测（离线账号），号不存在时图挂掉，
 * 不能让页面上顶着一个碎图标。
 */
function Avatar({ p, size = 26 }: { p: BotProfile; size?: number }) {
  const [err, setErr] = useState(false)
  return (
    <span
      className="inline-flex flex-none items-center justify-center overflow-hidden rounded-[50%] border border-border bg-bg text-[12px] font-bold text-muted"
      style={{ width: size, height: size }}
    >
      {p.avatar && !err ? (
        <img className="size-full object-cover" src={p.avatar} alt="" onError={() => setErr(true)} />
      ) : (
        (p.name || p.id).slice(0, 1)
      )}
    </span>
  )
}

/**
 * 绑定账号管理（连接卡片的折叠区）
 *
 * 已绑定的账号逐行列出（头像 + 昵称 + 账号 + 在线状态），每行一个移除键；
 * 下方是「在线但未绑定」的机器人，点一下即追加进 bind。两种操作都直接走
 * 后端已有的 edit 动作（只带 bind 字段），改完自动重连该连接生效。
 */
function BindManager({
  c,
  bots,
  onAct,
}: {
  c: ConnView
  bots: BotProfile[]
  onAct: (body: ConnAction) => void
}) {
  const bindBots = c.bind_bots || []
  const bound = (c.bind || []).map(String)
  const excluded = (c.exclude || []).map(String)
  const save = (next: string[]) => onAct({ action: "edit", key: c.index, bind: next })
  const candidates = bots.filter(b => !bound.includes(b.id))

  return (
    <div className="mt-[10px] flex flex-col gap-[8px] rounded-[10px] border border-border bg-bg p-[12px]">
      {bindBots.length === 0 ? (
        <p className={FHINT}>
          当前不限账号：所有机器人的消息都会转发到这个核心。绑定任意一个后，只转发绑定的账号。
        </p>
      ) : (
        bindBots.map(b => (
          <div className="flex items-center gap-[10px]" key={b.id}>
            <Avatar p={b} />
            <span className="text-[13px] font-semibold">{b.name !== b.id ? b.name : "未知昵称"}</span>
            <span className="font-[family-name:ui-monospace,SFMono-Regular,Consolas,monospace] text-[12px] text-muted">
              {b.id}
            </span>
            <span className={TAG}>{b.online ? "在线" : "离线"}</span>
            {/* 排除名单优先级高于绑定，两边同时有这个号等于白绑，必须标出来 */}
            {excluded.includes(b.id) && (
              <span className={`${TAG} text-danger`}>已被排除，不会转发</span>
            )}
            <button
              className={`${BTN_DANGER} ml-auto`}
              onClick={() => {
                const next = bound.filter(x => x !== b.id)
                if (
                  next.length ||
                  confirm("移除最后一个绑定后将变为「不限账号」，所有机器人的消息都会转发。继续？")
                )
                  save(next)
              }}
            >
              移除
            </button>
          </div>
        ))
      )}
      {candidates.length > 0 && (
        <>
          <div className={FHINT}>在线机器人（点击绑定到本连接）</div>
          <div className="flex flex-wrap gap-[8px]">
            {candidates.map(b => (
              <button
                className={`${BTN} flex items-center gap-[8px]`}
                key={b.id}
                onClick={() => save([...bound, b.id])}
              >
                <Avatar p={b} size={20} />
                <span>{b.name !== b.id ? b.name : b.id}</span>
                <span className="font-[family-name:ui-monospace,SFMono-Regular,Consolas,monospace] text-[11px] text-muted">
                  {b.id}
                </span>
                <span className="font-bold text-primary">＋</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Conn({
  c,
  bots,
  onAct,
  onEdit,
}: {
  c: ConnView
  bots: BotProfile[]
  onAct: (body: ConnAction) => void
  onEdit: (conn: ConnView) => void
}) {
  /**
   * 绑定折叠区的开合。放在组件内而不是提升到 App：轮询刷新会整包替换 state，
   * 但 Conn 按 index 作 key，同位实例复用，开合状态在刷新间存活。
   */
  const [open, setOpen] = useState(false)
  const bindBots = c.bind_bots || []

  return (
    <div className="rounded-[10px] border border-border p-[12px]">
      <div className="flex items-center gap-[12px]">
        <span
          className={`size-[10px] flex-none rounded-[50%] ${DOT[c.enable ? c.status : "off"] ?? "bg-muted"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{c.name}</div>
          {/* 字体栈与 Tailwind 的 font-mono 略有出入，按原样式表逐项写死 */}
          <div className="truncate font-[family-name:ui-monospace,SFMono-Regular,Consolas,monospace] text-[12px] text-muted">
            {c.url}
          </div>
          <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
            <span className={TAG}>{c.status_text}</span>
            {c.retry > 0 && <span className={TAG}>重连 {c.retry} 次</span>}
            {c.bot_id && <span className={TAG}>bot_id {c.bot_id}</span>}
            {c.has_token && <span className={TAG}>已配 token</span>}
            {/* 绑定标签升级成折叠开关：缩起时预览前几个头像，点开进管理区 */}
            <button
              className={`${TAG} flex cursor-pointer items-center gap-[5px] hover:border-primary`}
              onClick={() => setOpen(o => !o)}
              title="展开绑定账号管理"
            >
              {bindBots.slice(0, 3).map(b => (
                <Avatar key={b.id} p={b} size={16} />
              ))}
              <span>绑定 {c.bind?.length ? `${c.bind.length} 个账号` : "不限"}</span>
              <span className="text-[9px]">{open ? "▲" : "▼"}</span>
            </button>
            {c.exclude?.length > 0 && <span className={TAG}>排除 {c.exclude.join("、")}</span>}
            <span className={TAG}>
              ↑{c.up} ↓{c.down}
            </span>
          </div>
        </div>
        <div className="flex flex-none gap-[6px]">
          <button className={BTN} onClick={() => onAct({ action: "toggle", key: c.index, enable: !c.enable })}>
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
      {open && <BindManager c={c} bots={bots} onAct={onAct} />}
    </div>
  )
}

/** 连接编辑弹层。conn 为 null 表示新增 */
function Modal({
  conn,
  onClose,
  onSubmit,
}: {
  conn: ConnView | null
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

  const submit = () => {
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
      className="fixed inset-0 flex items-center justify-center bg-[rgb(0_0_0/45%)] p-[20px]"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[90vh] w-[min(560px,100%)] overflow-auto rounded-[14px] bg-surface p-[20px]">
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
                onChange={e => setForm({ ...form, [x.k]: e.target.value })}
              />
              {x.hint && <span className={FHINT}>{x.hint}</span>}
            </label>
          ))}
        </div>
        <div className={PHEAD_END}>
          <button className={BTN} onClick={onClose}>
            取消
          </button>
          <button className={BTN_PRIMARY} onClick={submit}>
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

function Settings({
  config,
  onSave,
}: {
  config: PayloadConfig
  onSave: (body: SettingsBody) => void
}) {
  const [form, setForm] = useState<Record<string, unknown>>(() => {
    const f: Record<string, unknown> = {}
    for (const x of FIELDS) f[x.k] = dig(config, x.k)
    return f
  })
  // 外部数据刷新（定时轮询）时同步过来，否则表单会一直停在旧值
  useEffect(() => {
    const f: Record<string, unknown> = {}
    for (const x of FIELDS) f[x.k] = dig(config, x.k)
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
      <div className={GRID}>
        {FIELDS.map(x => (
          <label className={FIELD} key={x.k}>
            <span className="text-[12px] text-muted">{x.label}</span>
            {x.type === "switch" ? (
              <input
                className="size-[18px] accent-primary"
                type="checkbox"
                checked={!!form[x.k]}
                onChange={e => setForm({ ...form, [x.k]: e.target.checked })}
              />
            ) : (
              <input
                className={INPUT}
                type="number"
                value={String(form[x.k] ?? 0)}
                onChange={e => setForm({ ...form, [x.k]: e.target.value })}
              />
            )}
            {/* 字节数直接看数字读不出量级，跟一行人类可读的 */}
            {x.type === "bytes" && <span className={FHINT}>{bytes(Number(form[x.k]))}</span>}
            {x.hint && <span className={FHINT}>{x.hint}</span>}
          </label>
        ))}
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

  const say = useCallback((text: string, bad?: boolean) => {
    setToast({ text, bad })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  const load = useCallback(async () => {
    try {
      setState(await api("/config"))
    } catch (err) {
      say(errMsg(err), true)
    }
  }, [say])

  const send = useCallback(
    async (path: string, body: unknown) => {
      try {
        const r = await api(path, body)
        setState(r)
        setModal(undefined)
        say(r.message)
      } catch (err) {
        say(errMsg(err), true)
      }
    },
    [say],
  )

  useEffect(() => {
    load()
    // 连接状态会自己变（断线重连），定时刷一下
    const id = setInterval(() => {
      // 弹层开着时不刷，免得输入被覆盖
      setModal(m => {
        if (m === undefined) load()
        return m
      })
    }, 10000)
    return () => clearInterval(id)
  }, [load])

  if (!state) return <p className={HINT}>加载中…</p>

  const online = state.connections.filter(c => c.status === 1).length
  const s = state.stats

  return (
    <>
      <header className="mb-[16px] flex items-center justify-between gap-[16px]">
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
        <div className="flex gap-[8px]">
          <button className={BTN} onClick={load}>
            刷新
          </button>
          <button className={BTN} onClick={() => send("/reconnect", {})}>
            全部重连
          </button>
        </div>
      </header>

      {toast && (
        <div
          className={`mb-[12px] rounded-[10px] border px-[14px] py-[10px] text-[13px] ${
            toast.bad
              ? "border-danger bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
              : "border-success bg-[color-mix(in_srgb,var(--success)_12%,transparent)]"
          }`}
        >
          {toast.text}
        </div>
      )}

      <section className="mb-[16px] grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-[12px]">
        <Stat k="连接" v={`${online}/${state.connections.length}`} sub="已连接 / 总数" />
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
          {state.connections.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-border p-[28px] text-center text-muted">
              还没有连接。点「添加连接」，或直接发 #早柚添加连接 127.0.0.1:8765
            </p>
          ) : (
            state.connections.map(c => (
              <Conn
                key={c.index}
                c={c}
                bots={state.bots || []}
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
          onClose={() => setModal(undefined)}
          onSubmit={b => send("/connection", b)}
        />
      )}
    </>
  )
}

createRoot(document.getElementById("app")).render(<App />)
