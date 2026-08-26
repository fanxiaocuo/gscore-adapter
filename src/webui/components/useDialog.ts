/**
 * @description 弹层的键盘行为：Esc 关闭 + Tab 焦点锁在层内
 *
 * 面板上有两个弹层（连接的新增/编辑、群/好友选择器），这段行为必须一样。抽出来的理由不是
 * 「分层更好看」，而是它们已经不一样过：选择器做了 Esc 与焦点锁，连接弹层三样都没有 ——
 * 同一个面板上两个弹层的可达性各说一套，而这种差异没有任何编译期或运行期信号。
 *
 * 焦点锁为什么必要：没有它，Tab 会走到弹层背后的页面上去，键盘与读屏用户在一个看不见的地方
 * 操作，而遮罩挡着鼠标又点不回来。
 * 注意：只在 Tab 与 Escape 上接管，其余按键（方向键、字母、输入法组字）照常交给里头的控件。
 * 注意：Escape 要 stopPropagation —— 两个弹层可能嵌套（设置页开着选择器时上层还有保存条），
 * 不拦会一路冒泡把外层也关掉
 */
import { useCallback, useEffect, useRef, type RefObject } from "react"

/** 焦点能落进去的东西。`[tabindex="-1"]` 排掉：那是「可编程聚焦但不进 Tab 环」 */
const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'

/**
 * @param onClose Esc 与点遮罩时调用
 * @returns box 挂在弹层根元素上（焦点锁按它找可聚焦元素）；onKeyDown 挂在**遮罩**上，
 *          里头的按键会冒泡上来
 */
export function useDialog(onClose: () => void): {
  box: RefObject<HTMLDivElement | null>
  onKeyDown: (e: React.KeyboardEvent) => void
} {
  const box = useRef<HTMLDivElement>(null)

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== "Tab") return
      /*
       * 每次按键现查而不是挂载时算一遍：弹层里的可聚焦元素是会变的
       * （连接弹层的账号开关随候选增减、选择器的行随搜索过滤），
       * 缓存下来会让环的两端指到已经不存在的节点上
       */
      const all = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])].filter(
        // offsetParent 为 null = 不可见（display:none 或祖先隐藏），那些不该进环
        el => !el.hasAttribute("disabled") && el.offsetParent !== null,
      )
      if (!all.length) return
      const first = all[0]
      const last = all[all.length - 1]
      // 环的两端各接一下，中间交给浏览器
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    },
    [onClose],
  )

  return { box, onKeyDown }
}

/**
 * @description 弹层打开时把焦点送进去
 * 不送的话焦点还停在触发它的那个按钮上（在遮罩背后），键盘用户得先 Tab 一圈才进得来。
 * @param target 想优先聚焦的元素（选择器给搜索框）；不给或取不到就退到弹层里第一个可聚焦元素
 */
export function useAutoFocus(
  box: RefObject<HTMLDivElement | null>,
  target?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (target?.current) {
      target.current.focus()
      return
    }
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    // 只在挂载时跑一次：之后焦点归用户
  }, [box, target])
}
