/**
 * Apple 风格开关
 *
 * 为什么是原生 checkbox
 * -------------------
 * `<div role="switch">` 得自己接 Space / Enter、自己维护 `aria-checked`、自己处理
 * 禁用态不响应键盘 —— 这些原生 checkbox 全都白给。`role="switch"` 只是把读屏的
 * 播报从「复选框」换成「开关」，选中状态仍由 `checked` 隐式提供，不必再写
 * `aria-checked`（两者不一致时读屏会以 aria 为准，正是多写一份的风险）。
 *
 * 视觉细节（滑块、上色、动画、prefers-reduced-motion）在 styles.css 的 `.sw`：
 * appearance-none + ::after 那一套写成任意值 utility 会长到读不出意图。
 *
 * 外层 span 只为把触控区补到 44px 高：轨道本体 28px 高，手指点不准
 * （设计稿要求最小触控区 44×44，横向 46+4 已经够）。
 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  hint,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** 无可见行标题可关联时必填：读屏靠它说出这个开关控制什么 */
  label?: string
  /** 悬停提示。禁用时用来说明「为什么点不动」—— 灰着不给理由最让人困惑 */
  hint?: string
  /** 有可见行标题时给它，配 `<label htmlFor>` 让点标题也能切换 */
  id?: string
}) {
  return (
    /* title 挂在外层而不是 input 上：禁用的表单控件在部分浏览器里不触发 tooltip */
    <span className="inline-flex h-[44px] flex-none items-center px-[2px]" title={hint}>
      <input
        className="sw cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-45"
        id={id}
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
    </span>
  )
}
