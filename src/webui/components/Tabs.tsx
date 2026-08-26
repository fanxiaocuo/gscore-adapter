/**
 * @description 顶部 tab 条（连接 / 设置 / 过滤），真 `role="tablist"` + 左右方向键切换
 *
 * 注意：用真 `<button>` 而不是 div —— Tab 聚焦、Enter/Space 激活、禁用态都是浏览器给的，
 * div 上要自己补 tabindex 与 keydown，漏一样键盘用户就走不进来
 * 注意：选中态用 accent-soft 底 + accent-soft-fg 字，**不加下划线** —— 下划线在 iframe 窄屏里
 * 与下方卡片的描边贴在一起，看起来像卡片顶边裂了一条
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { FOCUS } from "../ui.js"

/** 选中页记在这个 key 下，刷新与切页回来仍停在原处 */
const STORE_KEY = "gscore-panel-tab"

/**
 * @description 读上次选中的 tab，取不到（含抛错）回第一个
 * 注意：try/catch 包的是**访问本身**而不只是解析 —— 这是 iframe 里的页面，宿主域被浏览器
 * 按第三方存储拦掉时 `localStorage` 这个 getter 就抛 SecurityError，不是回 null
 */
function readTab<T extends string>(ids: readonly T[]): T {
  try {
    const v = localStorage.getItem(STORE_KEY)
    // 收下来的值要与当前的 tab 列表核对：改过 tab 名之后旧值还在存储里
    if (v && (ids as readonly string[]).includes(v)) return v as T
  } catch {
    // 存储不可用：不是错误场景，用户只是每次进来都停在第一个 tab
  }
  return ids[0]
}

/** 写入同样要 try/catch，理由见 {@link readTab} */
function writeTab(id: string) {
  try {
    localStorage.setItem(STORE_KEY, id)
  } catch {
    // 记不住就记不住，不影响当前这一次切换
  }
}

/**
 * @description 当前选中的 tab id + 切换函数，由调用方决定渲染哪一页
 * 状态提在 hook 里而不是 Tabs 组件内：三个 tab 的内容是 App 的兄弟节点，塞进 Tabs 的
 * children 会让整棵设置树跟着 tab 条一起重挂
 */
export function useTab<T extends string>(ids: readonly T[]) {
  // 泛型收窄成调用方那个联合字面量（TabId），否则 tab 是 string，
  // 传给只收 TabId 的 Settings 时要多一次断言
  const [tab, setTab] = useState<T>(() => readTab(ids))
  const select = useCallback((id: T) => {
    setTab(id)
    writeTab(id)
  }, [])
  return { tab, select }
}

/* 泛型跟着 useTab 走：调用方传的是 TabId 的联合字面量，写死 string 会让 onSelect
   在调用侧要多一次断言（TabId 的形参收不下 string） */
export function Tabs<T extends string>({
  items,
  tab,
  onSelect,
}: {
  /** id 即 aria-controls 指向的面板 id 前缀，顺序即显示顺序 */
  items: readonly { id: T; label: string }[]
  tab: T
  onSelect: (id: T) => void
}) {
  /**
   * @description 各 tab 按钮的 DOM 引用，方向键切换后要把焦点搬过去
   * 注意：光换 aria-selected 不搬焦点的话，键盘用户按了右键、屏幕上选中态变了，
   * 而焦点还留在原来那个按钮上，再按一次右键是从旧位置算的
   */
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  /** 只在「因方向键而切换」之后搬焦点，鼠标点选不抢 */
  const moved = useRef(false)
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    refs.current[tab]?.focus()
  }, [tab])

  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    if (!d) return
    e.preventDefault()
    const i = items.findIndex(x => x.id === tab)
    // 环形：末尾再按右键回到第一个（APG 的 tabs 模式就是这个行为）
    const next = items[(i + d + items.length) % items.length]
    moved.current = true
    onSelect(next.id)
  }

  return (
    /* 窄屏可横向滑动，但**不撑页面**：overflow-x-auto 让溢出留在这个容器里。
       min-w-0 不能省 —— grid/flex 子项默认 min-width:auto，不给 0 时它会按内容撑宽父级 */
    <div
      role="tablist"
      aria-label="面板分页"
      onKeyDown={onKey}
      className="mb-[16px] flex min-w-0 gap-[6px] overflow-x-auto rounded-[12px] border border-border bg-surface p-[6px] shadow-[var(--shadow)]"
    >
      {items.map(x => {
        const on = x.id === tab
        return (
          <button
            key={x.id}
            ref={el => {
              refs.current[x.id] = el
            }}
            role="tab"
            id={`tab-${x.id}`}
            aria-selected={on}
            aria-controls={`panel-${x.id}`}
            /* 未选中的按钮不进 Tab 序：APG 的 tabs 模式里整个 tablist 只占一个 Tab 位，
               组内移动交给方向键 */
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(x.id)}
            /* 44px 高是触控下限；flex-none + whitespace-nowrap 让标签不会被压成两行 */
            className={`h-[44px] flex-none cursor-pointer whitespace-nowrap rounded-[8px] border-0 px-[16px] text-[14px] ${FOCUS} ${
              on ? "bg-accent-soft font-semibold text-accent-soft-fg" : "bg-transparent text-muted"
            }`}
          >
            {x.label}
          </button>
        )
      })}
    </div>
  )
}
