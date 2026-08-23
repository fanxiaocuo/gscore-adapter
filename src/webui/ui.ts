/**
 * @description 跨模块共用的 className 常量，让「同一个视觉元素」只有一处定义
 * 只放不止一个模块用到的那几个：main.tsx 里那批（BTN / INPUT / ROW…）只有它自己用，留在原处更好读。
 * 没做成 CSS 类是因为它们只是 utility 的组合（方针见 styles.css 的注释）
 */

/**
 * @description 等宽字栈，与 Tailwind 的 `font-mono` 略有出入，按原样式表逐项写死
 * 账号、路径要与核心后台显示的串对得上，字形宽度不一致时一眼看不出是不是同一个号
 */
export const MONO = "font-[family-name:ui-monospace,SFMono-Regular,Consolas,monospace]"

/** 小标签胶囊：描边 + 圆角 + 弱化文字色 */
export const TAG = "rounded-[999px] border border-border px-[8px] py-[1px] text-[11px] text-muted"
