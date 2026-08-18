/**
 * 跨模块共用的 className 常量
 *
 * 只放**不止一个模块用到**的那几个。main.tsx 里那批（BTN / INPUT / ROW…）只有它自己
 * 用，留在原处更好读；抽组件时把常量一起抄过去，两份字面量就会各自漂移 ——
 * 这个文件是为了让「同一个视觉元素」只有一处定义。
 *
 * 没做成 CSS 类是因为它们只是 utility 的组合，没有 `.sw` 那种「写成任意值 utility
 * 会长到读不出意图」的问题（见 styles.css 的方针注释）。
 */

/**
 * 等宽字栈
 *
 * 与 Tailwind 的 `font-mono` 略有出入，按原样式表逐项写死：账号、路径这些要与
 * 核心后台显示的串对得上，字形宽度不一致时一眼看不出是不是同一个号。
 */
export const MONO = "font-[family-name:ui-monospace,SFMono-Regular,Consolas,monospace]"

/** 小标签胶囊：描边 + 圆角 + 弱化文字色 */
export const TAG = "rounded-[999px] border border-border px-[8px] py-[1px] text-[11px] text-muted"
