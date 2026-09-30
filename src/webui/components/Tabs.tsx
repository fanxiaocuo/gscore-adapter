/**
 * @description 顶部 tab 条（连接 / 设置 / 过滤），真 `role="tablist"` + 左右方向键切换
 * 视觉是分段控件：整条一个凹底槽，选中项以浮起的块 + 阴影表现。
 * 注意：选中态靠形状（浮起块 + 阴影 + 凹槽）而非底色深浅，浅色主题下颜色差别看不出当前页。
 * 注意：不加下划线，iframe 窄屏里会与下方卡片描边贴在一起像卡片顶边裂开。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { FOCUS } from "../ui.js"

/** 选中页记在这个 key 下，刷新与切页回来仍停在原处 */
const STORE_KEY = "gscore-panel-tab"

/**
 * @description 读上次选中的 tab，取不到（含抛错）回第一个
 * 注意：try/catch 包的是访问本身而非解析，iframe 页面宿主域被按第三方存储拦掉时 `localStorage` getter 直接抛 SecurityError。
 */
function readTab<T extends string>(ids: readonly T[]): T {
  try {
    const v = localStorage.getItem(STORE_KEY)
    // 与当前 tab 列表核对：改过 tab 名后旧值仍在存储里
    if (v && (ids as readonly string[]).includes(v)) return v as T
  } catch {
    // 存储不可用不算错误，用户只是每次进来停在第一个 tab
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
 * 状态提在 hook 而非 Tabs 组件内：tab 内容是 App 的兄弟节点，塞进 children 会让整棵设置树随 tab 条重挂。
 */
export function useTab<T extends string>(ids: readonly T[]) {
  // 泛型收窄成调用方的联合字面量（TabId），否则 tab 是 string，传给只收 TabId 的 Settings 要多一次断言
  const [tab, setTab] = useState<T>(() => readTab(ids))
  const select = useCallback((id: T) => {
    setTab(id)
    writeTab(id)
  }, [])
  return { tab, select }
}

/* 泛型跟着 useTab 走：写死 string 会让 onSelect 在调用侧多一次断言（TabId 形参收不下 string） */
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
   * 注意：只换 aria-selected 不搬焦点，焦点仍留在原按钮上，再按方向键是从旧位置算的。
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
    // 环形：末尾再按右键回到第一个（APG tabs 模式行为）
    const next = items[(i + d + items.length) % items.length]
    moved.current = true
    onSelect(next.id)
  }

  return (
    /* 凹槽用页面底色 bg（比卡面深一档）+ 描边，选中块以 surface 浮起。
       注意：凹槽不能用 surface2，它对 surface 只有 1.03:1，浮起看不出来。
       注意：min-w-0 不能省，grid/flex 子项默认 min-width:auto，不给 0 会按内容撑宽父级；overflow-x-auto 让窄屏溢出留在容器内不撑页面。 */
    <div
      role="tablist"
      aria-label="面板分页"
      onKeyDown={onKey}
      className="mb-[16px] flex min-w-0 gap-[4px] overflow-x-auto rounded-[12px] border border-border bg-bg p-[4px]"
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
            /* 未选中按钮不进 Tab 序：APG tabs 模式里整个 tablist 只占一个 Tab 位，组内移动交给方向键 */
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(x.id)}
            /* 44px 高是触控下限，flex-1 让三块等分整条，whitespace-nowrap 防标签折成两行。
               选中态三通道一起给：形状（surface 底 + 描边 + 阴影，从凹槽浮起）、字重、字色 accent；描边用 border-strong（控件边界要过 3:1）。 */
            className={`h-[40px] min-w-[72px] flex-1 cursor-pointer whitespace-nowrap rounded-[8px] px-[14px] text-[14px] ${FOCUS} ${
              on
                ? "border border-border-strong bg-surface font-semibold text-accent shadow-[var(--shadow)]"
                : "border-0 bg-transparent text-muted hover:text-fg"
            }`}
          >
            {x.label}
          </button>
        )
      })}
    </div>
  )
}
