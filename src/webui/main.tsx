/**
 * Web 面板前端（React）
 *
 * 这份是**浏览器**代码，与 modules/webadapter/（Node 侧接口）分属两端：
 * 它由 esbuild 打包成 webadapter/panel.js，宿主用 iframe 加载 page.html 时引入。
 * 打包而不是直接 import react —— 宿主的静态白名单只放行描述符里列过的文件名
 * （src/style/script 三个），放不进 node_modules，也没有 import map。
 *
 * 与出图那边共用 react 依赖，不额外引运行时。产物约 15KB（min），
 * 与原先手写 DOM 的 314 行体量相当，但状态流转由 React 管，不必自己
 * 记「哪些节点要重画」。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

/** 宿主可能挂在 /qqbot-web 这类前缀下，接口前缀只能从它注入的查询参数取 */
const WEB_BASE = new URLSearchParams(location.search).get("__webBase") || ""
const API = `${WEB_BASE}/api/gscore-adapter`

async function api(path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data
  try {
    data = await res.json()
  } catch {
    // 鉴权失败时宿主回的是 HTML 登录页，不是 JSON
    throw new Error(
      res.status === 401 || res.status === 403 ? "未登录或无权限" : `HTTP ${res.status}`,
    )
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

/** catch 到的是 unknown，统一取一句能显示的话 */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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

/** 全局设置的字段表，渲染与收集共用 */
const FIELDS = [
  { k: "enable", label: "启用适配器", type: "switch", hint: "关掉则完全不连核心，需重启云崽" },
  { k: "heartbeat", label: "心跳间隔（秒）", type: "number", hint: "0 关闭；改后自动重连" },
  { k: "heartbeat_timeout", label: "心跳超时（秒）", type: "number", hint: "0 关闭" },
  { k: "media_max_size", label: "媒体内联上限", type: "bytes", hint: "超过改用外链" },
  { k: "notify_master", label: "断线通知主人", type: "switch" },
  { k: "filter.report_private", label: "上报私聊", type: "switch" },
  { k: "filter.report_group", label: "上报群聊", type: "switch" },
  { k: "filter.report_meta", label: "上报进群/退群/戳一戳", type: "switch" },
  { k: "filter.only_reply_at", label: "仅被 @ 或带前缀才上报", type: "switch" },
]

/** 连接弹层的字段表 */
const CFIELDS = [
  { k: "name", label: "连接名", ph: "gsuid_core" },
  { k: "url", label: "地址", ph: "127.0.0.1:8765（自动补 /ws/Yunzai）" },
  { k: "token", label: "token", ph: "留空则不修改", type: "password" },
  { k: "bot_id", label: "bot_id", ph: "留空按 bot_id_map 推断" },
  { k: "reconnect_interval", label: "重连间隔（秒）", type: "number" },
  { k: "max_reconnect_attempts", label: "最大重连次数", type: "number", hint: "0 为无限" },
]

const dig = (o, path) => path.split(".").reduce((a, k) => a?.[k], o)

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

function Stat({ k, v, sub }) {
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

function Conn({ c, onAct, onEdit }) {
  return (
    <div className="flex items-center gap-[12px] rounded-[10px] border border-border p-[12px]">
      <span
        className={`size-[10px] flex-none rounded-[50%] ${DOT[c.enable ? c.status : "off"] ?? "bg-muted"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{c.name}</div>
        {/* 字体栈与 Tailwind 的 font-mono 略有出入，按原样式表逐项写死 */}
        <div className="truncate font-[family-name:ui-monospace,SFMono-Regular,Consolas,monospace] text-[12px] text-muted">
          {c.url}
        </div>
        <div className="mt-[6px] flex flex-wrap gap-[6px]">
          <span className={TAG}>{c.status_text}</span>
          {c.retry > 0 && <span className={TAG}>重连 {c.retry} 次</span>}
          {c.bot_id && <span className={TAG}>bot_id {c.bot_id}</span>}
          {c.has_token && <span className={TAG}>已配 token</span>}
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
  )
}

/** 连接编辑弹层。conn 为 null 表示新增 */
function Modal({ conn, onClose, onSubmit }) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {}
    for (const x of CFIELDS) {
      // token 不回填：GET 只回 has_token，拿不到原值。留空提交表示不改
      f[x.k] = conn && x.k !== "token" ? String(conn[x.k] ?? "") : ""
    }
    if (!conn) {
      f.reconnect_interval = "5"
      f.max_reconnect_attempts = "0"
    }
    return f
  })

  const submit = () => {
    const body: Record<string, unknown> = { action: conn ? "edit" : "add" }
    if (conn) body.key = conn.index
    for (const x of CFIELDS) {
      const v = String(form[x.k] ?? "").trim()
      if (!v && x.k === "token") continue
      body[x.k] = x.type === "number" ? Number(v) : v
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
                type={x.type || "text"}
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

function Settings({ config, onSave }) {
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
    const body: Record<string, any> = { filter: {} }
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
  const [state, setState] = useState(null)
  const [toast, setToast] = useState(null)
  const [modal, setModal] = useState(undefined) // undefined 关闭，null 新增，对象编辑
  const [logoOk, setLogoOk] = useState(false)
  const timer = useRef(null)

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
    async (path, body) => {
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
