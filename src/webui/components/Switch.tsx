/**
 * @description Apple 风格开关，用原生 checkbox 而不是 `<div role="switch">`
 *
 * 键盘、`aria-checked`、禁用态原生全都白给；`role="switch"` 只把读屏播报从「复选框」换成「开关」，
 * 选中状态仍由 `checked` 隐式提供，不必再写 `aria-checked`（两者不一致时读屏以 aria 为准）。
 * 视觉细节（滑块、上色、动画、prefers-reduced-motion）与 44px 触控区在 styles.css 的 `.sw`：
 * 那一套写成任意值 utility 会长到读不出意图，而触控区靠 `.sw::before`，命中算在宿主元素上
 * 注意：聚焦环走 ui.ts 的 {@link FOCUS} 而不是就地写 —— 换配色时 `--primary` 改成了 `--accent`，
 * 而 Tailwind 对未注册的颜色不报错、直接不生成那个类，就地写死过的 `outline-primary` 曾静默失效
 * 成 currentcolor（这个面板上开关是主控件，聚焦环是键盘用户唯一的落点提示）
 */
import { FOCUS } from "../ui.js"

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  hint,
  describedBy,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** 无可见行标题可关联时必填：读屏靠它说出这个开关控制什么 */
  label?: string
  /** 悬停提示，只是**补充**。禁用理由不能只写在这儿，见 {@link describedBy} */
  hint?: string
  /**
   * @description 关联到一段可见说明的 id（`aria-describedby`）
   * 注意：禁用理由必须走这条路而不是 `title` —— 触屏设备根本不显示 tooltip，而这个面板手机优先；
   * 读屏同理（名字由 aria-label 给，span 上的 title 不进可访问描述）
   */
  describedBy?: string
  /** 有可见行标题时给它，配 `<label htmlFor>` 让点标题也能切换 */
  id?: string
}) {
  return (
    /* title 挂在外层而不是 input 上：禁用的表单控件在部分浏览器里不触发 tooltip */
    <span className="inline-flex h-[44px] flex-none items-center px-[2px]" title={hint}>
      <input
        className={`sw cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`}
        id={id}
        type="checkbox"
        role="switch"
        aria-label={label}
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
    </span>
  )
}
