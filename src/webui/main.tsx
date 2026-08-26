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
import { Chips } from "./components/Chips.js"
import { PickerModal } from "./components/PickerModal.js"
import { SaveBar } from "./components/SaveBar.js"
import { Switch } from "./components/Switch.js"
import { Tabs, useTab } from "./components/Tabs.js"
import { useAutoFocus, useDialog } from "./components/useDialog.js"
import {
  ALL_FIELDS,
  DEFERRED,
  FIELD_BY_KEY,
  TAB_IDS,
  TABS,
  type Field,
  type TabId,
} from "./fields.js"
import { errMsg, request } from "./http.js"
import {
  BTN,
  BTN_DANGER,
  BTN_ACCENT,
  BTN_PRIMARY,
  DOT,
  FHINT,
  FOCUS,
  HINT,
  INPUT,
  MONO,
  toList,
} from "./ui.js"
import "./styles.css"

/**
 * @description 构建时间戳，由 vite 的 define 注入（见 vite.config.mts 那段说明）
 * 页脚显示它，用来分辨浏览器手上这一份是不是刚构建的那个包 —— panel.js 的文件名被宿主的
 * 静态白名单钉死、换不了名，所以没有 URL 层的防缓存，只能靠这个戳加一次硬刷新
 */
declare const __BUILD__: string

/** 宿主可能挂在 /qqbot-web 这类前缀下，接口前缀只能从它注入的查询参数取 */
const WEB_BASE = new URLSearchParams(location.search).get("__webBase") || ""
const API = `${WEB_BASE}/api/gscore-adapter`

/** 整包接口。错误处理（含「宿主回 HTML 登录页」那一支）在 http.ts，选择器走同一条 */
const api = (path: string, body?: unknown) => request<Payload>(API, path, body)

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

/**
 * @description 按点号路径取值，供 ALL_FIELDS 里的 `filter.xxx` 用
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
 * 只有本文件用到的 utility 组合。跨组件共用的那批（BTN / INPUT / MONO / TAG / FOCUS…）
 * 已经挪进 ui.ts —— 新组件也要用它们，两处各留一份必然漂移。
 */
const FIELD = "flex flex-col gap-[4px]"
const GRID = "grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[12px]"
/* 卡片：描边是装饰性的（区分卡与页面底），用弱的那个 border 而不是 border-strong */
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

/*
 * chip 那几行的变体：控件占满整行宽度，标题与说明摞在它上面。
 * 不能沿用 ROW —— 那一套把控件塞进 `auto` 那列，chip 输入框只剩一个词的宽，
 * 十几个群号会竖着叠成一长条；名单是这个面板上最需要横向铺开的东西。
 * items-start 而不是 center：chip 区会长高，标题该钉在顶上而不是飘到中间。
 */
const ROW_WIDE =
  "grid min-h-[54px] grid-cols-[minmax(0,1fr)] items-start gap-y-[6px] border-t border-border px-[16px] py-[12px] first:border-t-0 max-[720px]:px-[4px]"
const ROW_CTRL_WIDE = "flex min-w-0 flex-col"

function Stat({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-surface px-[16px] py-[14px] shadow-[var(--shadow)]">
      <div className="text-[12px] tracking-[0.04em] text-muted">{k}</div>
      <div className="my-[2px] text-[26px] font-bold tabular-nums">{v}</div>
      <div className="text-[12px] text-muted">{sub}</div>
    </div>
  )
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
  /** 发一个连接动作。只 await 完成，不读返回值（成败已由 App 弹 toast） */
  onAct: (body: ConnAction) => Promise<unknown>
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
   * @description 逐账号的运行时连接，按账号索引，交给账号行自己画状态
   * 一条自动端点连接的每个绑定账号各派生一条 ws，所以这是一对一的
   */
  const byAccount: Record<string, (typeof runtime)[number]> = {}
  for (const r of runtime) if (r.account) byAccount[r.account] = r
  /**
   * @description 没有对应账号行的运行时连接：兼容连接（自定义路径）只有一条 ws、account 为空
   * 它们没有开关可挂，只能单独列
   */
  const loose = runtime.filter(r => !r.account || !byAccount[r.account])
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

  /** 账号行的 id，给折叠按钮的 aria-controls 指 */
  const panelId = `conn-${c.index}-accounts`

  return (
    <div className="overflow-hidden rounded-[10px] border border-border">
      {/* flex-wrap + 按钮组窄屏占满一行：390px 下三个按钮与状态点挤在一行会溢出 */}
      <div className="flex flex-wrap items-center gap-[12px] p-[12px]">
        <span
          className={`size-[10px] flex-none rounded-[50%] ${DOT[c.enable ? c.status : "off"] ?? "bg-muted"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{c.name}</div>
          {/* 字体栈与 Tailwind 的 font-mono 略有出入，按原样式表逐项写死 */}
          <div className={`truncate text-[12px] text-muted ${MONO}`}>{c.url}</div>
          {/*
           * 只读信息一律**纯文字**，不套胶囊。
           * 原先这些和折叠开关一样都是 TAG 描边胶囊，于是唯一能点的那个混在四五个不能点的
           * 里头，只靠 hover 变色区分（触屏上根本没有 hover）。现在这个面板里
           * 「有描边 = 可点」是一条硬规则，别再给只读信息加描边
           */}
          <div className="mt-[4px] text-[12px] text-muted [overflow-wrap:anywhere]">
            {[
              c.status_text,
              c.retry > 0 ? `已重连 ${c.retry} 次` : "",
              c.has_token ? "已配 token" : "",
              c.exclude?.length > 0 ? `排除 ${c.exclude.join("、")}` : "",
              `↑${c.up} ↓${c.down}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        {/*
         * 主次分明：编辑给主色（最常用），停用次要，删除平时不红、hover 才变。
         * 窄屏整行平分 —— 三个按钮各自至少 44px 高，够手指点
         */}
        <div className="flex flex-none gap-[8px] max-[720px]:w-full max-[720px]:*:flex-1">
          <button
            className={BTN}
            onClick={() => onAct({ action: "toggle", key: c.index, enable: !c.enable })}
          >
            {c.enable ? "停用" : "启用"}
          </button>
          {/* 强调而非实心主色：每张卡都有一个编辑，实心会在整页平铺出四五个蓝块，
              与页面级唯一的主按钮「添加连接」抢注意力（见 ui.ts 的 BTN_ACCENT） */}
          <button className={BTN_ACCENT} onClick={() => onEdit(c)}>
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

      {/*
       * 账号行：**整行都是折叠开关**。
       * 单独占一行而不是挤进上面那排信息里 —— 这样命中区是整张卡的宽度（远超 44px），
       * 而且与右边那三个按钮天然分开，不会出现「按钮套按钮」这种嵌套。
       * 注意：不用 hover 承载可点线索（触屏没有 hover），靠底色 + 整行 + 右侧箭头三重提示
       */}
      <button
        className={`flex w-full min-h-[44px] cursor-pointer items-center gap-[8px] border-t border-border bg-surface2 px-[12px] py-[8px] text-left text-[13px] hover:bg-accent-soft ${FOCUS}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {/* 叠放靠负外边距，描边用 ring（border 会与 Avatar 自己的边框打架） */}
        {bindBots
          .filter(b => on.includes(b.id))
          .slice(0, 3)
          .map((b, i) => (
            <Avatar
              key={b.id}
              p={b}
              size={20}
              className={i ? "-ml-[6px] ring-2 ring-surface2" : ""}
            />
          ))}
        {/* 只说开着几个，不给分母：分母是候选数（在线的 + 绑过的），10 个 Bot 在线时
            「绑定 1/10」看起来像 9 个绑定没成功 */}
        <span className="min-w-0 flex-1">
          {unlimited ? "不限账号" : `绑定 ${on.length} 个账号`}
        </span>
        <span className="flex-none text-muted">{open ? "收起 ▲" : "管理 ▼"}</span>
      </button>

      <div id={panelId} className="px-[12px] pb-[12px]">
        {open && (
          <BotSwitchList
            bots={bindBots}
            checked={on}
            conflicts={c.conflicts || []}
            lockLast={c.automatic}
            saving={saving}
            runtime={byAccount}
            connEnabled={c.enable}
            onToggle={toggle}
            empty="没有可选账号：当前没有机器人在线，这条连接也没绑过账号。可以在「编辑」里手填账号。"
          />
        )}
        {/*
        剩下的运行时连接：**没有对应账号行**的那些才列在这儿（兼容连接的自定义路径，account 为空）。
        逐账号的那些已经画在上面的账号行上了 —— 原先这一块把它们再列一遍，于是同一个号在卡片里
        出现两次（号码与状态都重复），绑两个号就是四行说三件事。
        判据用 open 而不是「多于一条」：这些行没有对应的开关，展开与否是用户唯一的控制
      */}
        {loose.length > 0 && open && (
          <div className="mt-[10px] flex flex-col gap-[6px] rounded-[10px] border border-border bg-bg p-[10px]">
            {loose.map(r => (
              <div className="flex flex-wrap items-center gap-[8px]" key={r.name}>
                <span
                  className={`size-[8px] flex-none rounded-[50%] ${DOT[c.enable ? r.status : "off"] ?? "bg-muted"}`}
                />
                <span className="text-[12px] font-semibold">{r.name}</span>
                {/* 只到 pathname，地址里的 token 查询串后端已经砍掉了 */}
                <span className={`min-w-0 flex-1 truncate text-[12px] text-muted ${MONO}`}>
                  {r.path}
                </span>
                {/* 同上：只读信息不套胶囊 */}
                <span className="text-[12px] text-muted">
                  {[r.status_text, r.retry > 0 ? `已重连 ${r.retry} 次` : "", `↑${r.up} ↓${r.down}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
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

  // Esc 关 + Tab 焦点锁 + 打开时把焦点送进层内，与选择器共用同一套
  const { box, onKeyDown } = useDialog(onClose)
  useAutoFocus(box)

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
    /*
     * 遮罩收键盘事件（层内按键会冒泡上来），点遮罩本身关闭。
     * 注意：Esc 关闭、Tab 焦点锁、role/aria-modal 三样都走 useDialog —— 这个弹层原先一样都没有，
     * 而选择器那个全做了：同一个面板上两个弹层的可达性各说一套，且没有任何编译期信号
     */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(0_0_0/45%)] p-[20px] max-[720px]:p-[8px]"
      onClick={e => e.target === e.currentTarget && onClose()}
      onKeyDown={onKeyDown}
    >
      <div
        ref={box}
        className="max-h-[90vh] w-[min(560px,100%)] overflow-auto rounded-[14px] bg-surface p-[20px] max-[720px]:p-[14px]"
        role="dialog"
        aria-modal="true"
        aria-label={conn ? `编辑连接 ${conn.name}` : "添加连接"}
      >
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

/**
 * @description 全局设置提交体。嵌套层按 yaml 原样分层（client / filter / update_check / file_server）
 * 注意：后端 `saveGlobal()` 只写 body 里出现的键，所以「单字段提交」与「整批提交」是同一条路，
 * 不用两个接口 —— 开关即时写发的就是只带一个键的同一个 body
 */
interface SettingsBody {
  [k: string]: unknown
}

/**
 * @description 把点号路径的一批值塞成嵌套 body（`filter.prefix` → `{filter:{prefix:…}}`）
 * 只建路径上真的用到的那几层：多写一个空的 `file_server: {}` 会让后端按「这一节提交了」处理
 */
function nest(values: Map<string, unknown>): SettingsBody {
  const body: SettingsBody = {}
  for (const [k, v] of values) {
    const parts = k.split(".")
    let cur = body
    for (const p of parts.slice(0, -1)) {
      if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {}
      cur = cur[p] as SettingsBody
    }
    cur[parts.at(-1)!] = v
  }
  return body
}

/**
 * @description 把表单里的值收成能提交的形状
 * 数字栏在编辑期存的是字符串（输入框的原值，允许中途空着与 `4.` 这种半截小数），提交这一刻才转数字
 *
 * 注意：空的数字框交空串而**不是 0**。`Number("")` 是 0 且过 isFinite，直接转数字会架空服务端
 * 那条「空串就这一栏不写」的保护，而 0 在这些字段各有含义：client.heartbeat 的 0 是关掉心跳
 *（还连带 reloadClients 把所有 ws 断线重连）、file_server.port 的 0 是随机端口（连带重起文件服务、
 * 作废在途外链）、三个换算字段的 0 会被 boundsError 拦下来让整批保存失败。
 * 全选删掉想重新输入是最常见的操作，不能让它写出这些后果
 */
function coerce(f: Field, v: unknown): unknown {
  if (f.type === "switch") return !!v
  if (f.type === "number") {
    if (typeof v === "string" && !v.trim()) return ""
    const n = Number(v)
    // 半截小数（`4.`、`1e`）也交空串：那不是用户想存的值，让服务端跳过这一栏
    return Number.isFinite(n) ? n : ""
  }
  if (f.type === "chips") return Array.isArray(v) ? v : []
  return String(v ?? "")
}

/**
 * @description 把 config 摊平成表单值。初始化与轮询逐字段回填都用它
 * 注意：读的是 `x.read ?? x.k` —— 凭据栏写的是 `file_server.imagebed_token`，而整包只回
 * `has_imagebed_token`（布尔）。那一栏的表单值恒为空串（占位符说「留空则不修改」），
 * 布尔只用来决定说明列要不要加一句「已配置」
 */
function readFields(config: PayloadConfig): Record<string, unknown> {
  const f: Record<string, unknown> = {}
  for (const x of ALL_FIELDS) f[x.k] = x.read ? "" : dig(config, x.k)
  return f
}

/** 逐字段比较：服务端的这一栏与表单里的这一栏是不是同一个值（数组按内容比） */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b))
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
  // 数字栏在表单里是字符串（见 coerce），"30" 与 30 不该算改过
  if (typeof a === "number" && typeof b === "string") return String(a) === b
  if (typeof b === "number" && typeof a === "string") return String(b) === a
  return a === b
}

function Settings({
  config,
  tab,
  onSave,
}: {
  config: PayloadConfig
  /** 当前 tab，只渲染它名下的节 */
  tab: TabId
  /** 提交一批字段。开关即时写时只带一个键；返回是否保存成功 */
  onSave: (body: SettingsBody) => Promise<boolean>
}) {
  const [form, setForm] = useState<Record<string, unknown>>(() => readFields(config))
  /**
   * @description 用户动过、还没保存的字段（逐字段脏集合）
   *
   * 注意：不是整表指纹 —— 全量字段之后指纹那招不够：任何一项外部变化都会整表覆盖，把用户
   * 正在填的另一项抹掉。轮询回包只覆盖**不在**这个集合里的字段，保存成功后清空。
   * 存在 state 里而不是 ref：保存条要按它的大小显示「有 N 项未保存」
   */
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  /** 提交在途：保存条的两个按钮一起禁用，免得连点把同一批交两遍 */
  const [saving, setSaving] = useState(false)
  /** 群/好友选择器：null 为关着，否则是正在挑的那个字段 */
  const [picking, setPicking] = useState<Field | null>(null)

  /**
   * @description 脏集合的镜像，只给下面那个回填 effect 读
   * 注意：effect 不能把 `touched` 写进依赖 —— `edit()` 每次首触都新建一个 Set（身份变了），
   * 于是往任何一栏敲第一个字都要把 30 个字段整轮比一遍，纯属白跑。
   * 而它又必须读到**最新**的脏集合（跳过用户正在填的那几栏），所以走 ref。
   * 保存成功后脏集合被清空，那一刻 `config` 也换了新包（回包整包换 state），effect 照样会跑
   */
  const touchedRef = useRef(touched)
  touchedRef.current = touched

  /**
   * 注意：逐字段回填而不是整表 setState —— 轮询每 10 秒回一份新包，整表覆盖会把用户正在填的
   * 另一项一起抹掉（这批延迟字段不即时写，App 那个 inflight 挡不住它）。
   * 脏字段一律跳过：那一栏的真值是用户手里的，服务端的旧值不该盖回去
   */
  useEffect(() => {
    const next = readFields(config)
    const dirty = touchedRef.current
    setForm(prev => {
      let changed = false
      const out = { ...prev }
      for (const x of ALL_FIELDS) {
        if (dirty.has(x.k)) continue
        if (same(next[x.k], prev[x.k])) continue
        out[x.k] = next[x.k]
        changed = true
      }
      // 一个字段都没变时返回原对象，省掉一次无意义的重渲染
      return changed ? out : prev
    })
  }, [config])

  /** 记一笔本地改动。延迟字段进脏集合，攒到保存条一起提交 */
  const edit = (k: string, v: unknown) => {
    setForm(f => ({ ...f, [k]: v }))
    setTouched(t => {
      const next = new Set(t)
      next.add(k)
      /*
       * 往凭据栏里打字 = 取消这一栏待提交的「清除」。
       * 两个信号同时交上去时服务端以新值为准（见 saveGlobal 里那段互斥判断），
       * 但脏集合里留着 `_clear` 会让底栏多算一项，也让「我到底清没清」在界面上说不清
       */
      next.delete(`${k}_clear`)
      return next
    })
  }

  /** 清除凭据：值与标记一起置，行上才看得出「未保存」 */
  const clearSecret = (k: string) => {
    setForm(f => ({ ...f, [k]: "" }))
    setTouched(t => new Set(t).add(`${k}_clear`))
  }

  /**
   * @description 开关即时写：单字段 POST，回包整包换 state
   * 注意：file_server 那一节的开关**不走这里** —— port/host/public_host 是一个意图，enable
   * 先即时写会按旧端口重启一次、用户填完端口再重启一次，而重启会作废在途外链
   */
  const flip = (x: Field, next: boolean) => {
    setForm(f => ({ ...f, [x.k]: next }))
    if (DEFERRED.has(x.k)) {
      setTouched(t => (t.has(x.k) ? t : new Set(t).add(x.k)))
      return
    }
    // 失败就立刻拨回去：服务端一个字没写，让开关停在用户选的位置等 10 秒后被轮询纠正，
    // 中间这段时间界面在撒谎（而这一栏不在脏集合里，没有任何「未保存」标记提示他）
    void onSave(nest(new Map([[x.k, next]]))).then(ok => {
      if (!ok) setForm(f => ({ ...f, [x.k]: !next }))
    })
  }

  /** 提交脏集合里的全部字段 */
  const submit = async () => {
    // 未提交的 chip 草稿先收进来：用户打完字直接点保存，不该静默丢掉（见 Chips 的 onBlur）
    const values = new Map<string, unknown>()
    for (const k of touched) {
      const x = FIELD_BY_KEY[k]
      if (x) {
        values.set(k, coerce(x, form[k]))
        continue
      }
      /*
       * 凭据的 `*_clear` 伪键：字段表里没有它（它不是一栏配置，只是一个动作），
       * 但它必须能提交上去 —— 否则「清除」按钮点了没反应
       */
      if (k.endsWith("_clear")) values.set(k, true)
    }
    if (!values.size) return
    /*
     * 这里刻意**不**预警「文件服务会重启」：那条判据只有服务端拿得准（它比得出 port/host/enable
     * 前后有没有真的变、也只有它知道 port:0 随机到的实际端口），而回包的 notes 已经按三种真实
     * 结果分开写好了话术。前端抄一份的下场是两头不一致（只关掉 enable 时不预警、把端口改回原值
     * 又照样预警），而且这条 toast 必然被回包那条顶掉 —— say 是单槽的
     */
    /*
     * 注意：**只有保存成功才清脏集合**。清早了（乐观清空）会立刻触发上面那个回填 effect
     * —— 它以 touched 为依赖，而此刻 config 还是保存前的旧包，于是每一栏刚填的值都被旧值
     * 盖回去；而保存失败时服务端一个字没写（saveGlobal 在 saveConfig 回调里 throw = 整份不写），
     * 用户跨三个 tab 的编辑就这么没了，界面上连「未保存」标记都不剩。
     * 保存期间保存条上的按钮由 saving 禁用，不会连点交两遍
     */
    setSaving(true)
    try {
      if (await onSave(nest(values))) setTouched(new Set())
    } finally {
      setSaving(false)
    }
  }

  /** 放弃：把脏字段恢复成服务端的值 */
  const reset = () => {
    const server = readFields(config)
    setForm(f => {
      const out = { ...f }
      for (const k of touched) out[k] = server[k]
      return out
    })
    setTouched(new Set())
  }

  // 只渲染当前 tab 名下的节。整棵表一直挂着但只显示一部分的话，隐藏页里的输入框仍在
  // Tab 序里，键盘用户会 Tab 进看不见的控件
  const sections = TABS.find(t => t.id === tab)?.sections || []

  return (
    <>
      {sections.map(sec => (
        <section className={PANEL} key={sec.id}>
          <h2 className="text-[15px] font-semibold">{sec.title}</h2>
          {sec.hint && <p className={HINT}>{sec.hint}</p>}
          {/* 一列到底的设置行，不用 auto-fit 多列网格：多列在窄屏上会把「标题 / 说明 / 控件」
              三段各自换行，读起来是一团 */}
          <div className="mt-[12px] overflow-hidden rounded-[10px] border border-border">
            {sec.fields.map(x => {
              // filter.report_private → set-filter-report_private，点号在 CSS/HTML 里都不该出现在 id 上
              const id = `set-${x.k.replace(/\./g, "-")}`
              // `_clear` 也算这一行脏：清除是个动作、键名带后缀，不算上的话点了没有任何行内反馈
              const dirty = touched.has(x.k) || touched.has(`${x.k}_clear`)
              /*
               * 说明列：hint + 两条动态补充。
               *
               * 大小栏报**保存后会落盘的字节数**，拿来和 config.yaml 里那一行对照，所以不加
               * 千分位、不换单位。
               * 注意：判据是「显示值与服务端那份**真的不同**」，不是「这一栏进过脏集合」。
               * 脏集合只增不减（`edit()` 一敲键就进，改回原样也不移出），拿它当判据会在
               * 「敲一下又删掉」之后报出一个 yaml 里根本不存在的数：yaml 里 5000000 显示成
               * 4.77 MB，而 4.77×1048576 = 5001708 —— 提交上去时服务端的 toStored 认出显示值
               * 没变、原样留住 5000000，于是这句提示指着一个文件里没有的字节数，而它唯一的
               * 用途就是给人对照文件
               */
              const willWrite = x.scale === "MB" && !same(dig(config, x.k), form[x.k])
              const extra: string[] = []
              if (willWrite && Number(form[x.k]) > 0)
                extra.push(`保存后落盘 ${Math.round(Number(form[x.k]) * 1048576)} 字节`)
              // 凭据栏的输入框恒为空（值不回前端），配没配只能靠这句说
              if (x.read && dig(config, x.read)) extra.push("已配置")
              if (dirty) extra.push("未保存")
              const hint = [x.hint, ...extra].filter(Boolean).join(" · ")
              // chip 与名单占整行宽度，挤在 auto 那列里只有一个输入框的宽
              const wide = x.type === "chips"
              return (
                <div className={wide ? ROW_WIDE : ROW} key={x.k}>
                  {/* htmlFor 让点标题也能切换开关，顺带把标题当成读屏的可见名字 */}
                  <label className={ROW_TITLE} htmlFor={id}>
                    {x.label}
                  </label>
                  <span className={ROW_HINT} id={`${id}-hint`}>
                    {hint}
                  </span>
                  <div className={wide ? ROW_CTRL_WIDE : ROW_CTRL}>
                    {x.type === "switch" ? (
                      <Switch
                        id={id}
                        checked={!!form[x.k]}
                        describedBy={`${id}-hint`}
                        onChange={next => flip(x, next)}
                      />
                    ) : x.type === "chips" ? (
                      <div className="flex min-w-0 flex-col gap-[6px]">
                        <Chips
                          id={id}
                          value={(form[x.k] as (string | number)[]) || []}
                          placeholder={x.ph}
                          describedBy={`${id}-hint`}
                          /* 号码类名单等宽显示才对得上号（picker 恰好只标在群号/账号那三栏）；
                             前缀与关键词是自然语言，按正文字体读着顺 */
                          mono={!!x.picker}
                          onChange={v => edit(x.k, v)}
                        />
                        {/* 群 / 好友的名单多一个「从列表里挑」的入口，与 chip 读写同一份数组 */}
                        {x.picker && (
                          <button
                            className={`${BTN} self-start`}
                            onClick={() => setPicking(x)}
                            type="button"
                          >
                            {x.picker === "group" ? "从群列表里挑" : "从好友列表里挑"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-[8px]">
                        <input
                          /* path 走等宽：模块路径要与 yaml 里那一行逐字对得上，比例字体下
                             `l`/`1`、`0`/`O` 分不开。这也是 FieldType 里 path 与 text 唯一的差别，
                             少了这一条那个类型成员就只是 text 的同义词 */
                          className={`${INPUT} ${
                            x.type === "number"
                              ? "w-[110px] text-right tabular-nums"
                              : `w-[min(260px,100%)] ${x.type === "path" ? MONO : ""}`
                          }`}
                          id={id}
                          // path/text 的 input type 都是 text；password 只有 imagebed_token 一个
                          type={
                            x.type === "number"
                              ? "number"
                              : x.type === "password"
                                ? "password"
                                : "text"
                          }
                          min={x.min}
                          max={x.max}
                          placeholder={x.ph}
                          aria-describedby={`${id}-hint`}
                          value={String(form[x.k] ?? "")}
                          onChange={e => edit(x.k, e.target.value)}
                        />
                        {/*
                         * 凭据栏的「清除」：输入框留空是「不修改」（值不回前端，没法用空串表达清除），
                         * 所以清空必须有独立入口，否则配过一次就再也删不掉（只能去改 yaml）。
                         * 发的是服务端认的那个 *_clear 伪键，与连接 token 同一套
                         */}
                        {x.read && dig(config, x.read) && (
                          <button className={BTN} type="button" onClick={() => clearSecret(x.k)}>
                            清除
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
      {picking && (
        <PickerModal
          api={API}
          kind={picking.picker!}
          title={picking.label}
          value={(form[picking.k] as (string | number)[]) || []}
          onChange={v => edit(picking.k, v)}
          onClose={() => setPicking(null)}
        />
      )}
      <SaveBar count={touched.size} onSave={submit} onReset={reset} saving={saving} />
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
  /** 当前 tab，初值与写回都在 useTab 里（localStorage 读写都包了 try/catch，理由见 Tabs.tsx） */
  const { tab, select } = useTab(TAB_IDS)
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
      /*
       * 两个判据都要，缺一个就有窗口：
       *   gen 变了      —— 这期间有写请求**落地过**，回包是写之前的旧状态
       *   inflight 非 0 —— 有写请求**正在途中**。gen 是在 send 的 finally 里才 +1 的，
       *                    所以「写开始前发出、写完成前回来」的这次读，gen 还没变、照样等于 at
       *
       * 漏掉后一条的后果：即时写的开关刻意不进脏集合（那一栏的真值由服务端回包给），
       * 于是这份旧回包会把用户刚拨的开关刷回原位，直到 POST 回包才纠正 —— 而 file_server
       * 那类保存要等 saveConfig + reloadClients + restartFileServer（close 会等现有连接结束），
       * 窗口能到秒级。用户看着开关自己弹回去，多半会再拨一次，第二次 POST 正好把它设回原值。
       * 失败仍要报：那是真的读不到
       */
      if (gen.current !== at || inflight.current) return
      setState(r)
    } catch (err) {
      say(errMsg(err), true)
    }
  }, [say])

  /**
   * @description 写请求。刻意不往外抛（错误已经弹了 toast），但**回报成败**
   * 注意：返回值不能省 —— 设置区要靠它决定「脏集合能不能清」。清早了就会在保存失败时
   * 用旧的 config 把用户填的值刷回去（那个回填 effect 以 touched 为依赖），编辑就丢了
   */
  const send = useCallback(
    async (path: string, body: unknown): Promise<boolean> => {
      inflight.current++
      try {
        const r = await api(path, body)
        // 成功用回包整包换 state：那是服务端算完之后的真状态，比本地猜的准
        setState(r)
        setModal(undefined)
        // 有话才弹：Payload.message 是可选的（多数写动作不带），空着弹出来是个没字的框。
        // tsc 抓不到 —— 仓库关了 strictNullChecks，`string | undefined` 传进 `text: string` 不报错
        if (r.message) say(r.message)
        return true
      } catch (err) {
        // 失败不动 state，界面停在原样，用户重来一次就是
        say(errMsg(err), true)
        return false
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

      {/* tab 条在统计卡**下方**：那四张卡是状态而不是某一页的内容，三个 tab 都要看得见 */}
      <Tabs items={TABS} tab={tab} onSelect={select} />

      {/* 三个 tab 的面板各挂 aria-labelledby 指回自己那个按钮（Tabs 里写的 aria-controls
          就是这几个 id）。不给 tabIndex：里头本来就有可聚焦控件，容器再进 Tab 序等于多按一次 */}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "conn" && (
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
        )}
        {/*
         * 三个 tab 的配置项都由 Settings 渲（它自己按 tab 挑名下的节）。
         * 注意：**不能**包在 `tab === "settings" &&` 里 —— 那样切一次 tab 就把它卸掉，
         * 攒着的脏集合与用户填了一半的值跟着没了，回来还看不出发生过什么
         */}
        <Settings config={state.config} tab={tab} onSave={b => send("/config", b)} />
        {/* 配置文件路径只在设置页说一次：三页都挂等于同一句话重复三遍 */}
        {tab === "settings" && <p className={HINT}>配置文件：{state.plugin.configFile}</p>}
        {/* 构建戳三页都显示：它的用途是「我现在看的是不是新包」，而那个疑问在哪一页都会有 */}
        <p className={HINT}>面板构建于 {__BUILD__}</p>
      </div>

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
