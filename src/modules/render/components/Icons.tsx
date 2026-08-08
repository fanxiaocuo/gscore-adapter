/**
 * 图标集
 *
 * 为什么是手写内联 SVG，而不是字符标记或图标库
 * ---------------------------------------------
 * 原先用 ◉ ≡ ↻ ⚙ ☰ 这类字符当图标，看着总是没垂直居中。原因不在 CSS：
 * flex/grid 居中的是「行盒」，字形墨迹在行盒里的位置由字体基线决定。这些几何
 * 符号在 Latin 字体里普遍缺字，Chromium 回落到中文字体后，墨迹在 em 方框中
 * 整体偏下，于是无论怎么居中都偏。字符还有一层不确定性——换台机器、少装一个
 * 字体，字形宽窄和位置就变了，截图不可复现。
 *
 * 内联 SVG 没有这些问题：viewBox 定死几何，路径在 24×24 里就是画正的，
 * 容器只要把 <svg> 居中即可，结果与字体无关。也不引图标库（多一个运行时依赖，
 * 见 Help.tsx 顶部注释），这十几个图标手写路径足够。
 *
 * 约定：统一 24×24 viewBox、stroke 描边、currentColor 取色，由 .ico 定色。
 */
import type { ReactNode } from "react"

/** 图标名，commands.ts 里按名引用 */
export type IconName =
  | "status"
  | "list"
  | "refresh"
  | "plus"
  | "minus"
  | "play"
  | "stop"
  | "settings"
  | "arrowUp"
  | "arrowUpDouble"
  | "changelog"
  | "search"
  | "info"
  | "dot"

/** 描边图标的公共属性：24×24、圆头圆角、跟随 currentColor */
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
}

/**
 * 各图标的绘制内容
 *
 * 描边路径统一继承 <svg> 上的 STROKE；需要实心的部分（圆点、旋钮、播放三角）
 * 单独写 fill="currentColor" stroke="none" 覆盖。
 */
const PATHS: Record<IconName, ReactNode> = {
  // 靶心：状态
  status: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  // 三横：列表
  list: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h10" />
    </>
  ),
  // 顺时针环箭头：重连
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  // 实心三角：开启
  play: <path d="M9 5.5l10 6.5-10 6.5z" fill="currentColor" stroke="none" />,
  // 方块：关闭
  stop: <rect x="7" y="7" width="10" height="10" rx="2.5" />,
  // 推子：设置
  settings: (
    <>
      <path d="M3 8h18" />
      <path d="M3 16h18" />
      <circle cx="15" cy="8" r="2.75" fill="currentColor" stroke="none" />
      <circle cx="9" cy="16" r="2.75" fill="currentColor" stroke="none" />
    </>
  ),
  // 上箭头：更新
  arrowUp: (
    <>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </>
  ),
  // 双层上箭头：强制更新
  arrowUpDouble: (
    <>
      <path d="M6 12l6-6 6 6" />
      <path d="M6 19l6-6 6 6" />
    </>
  ),
  // 文档带正文行：更新日志
  changelog: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </>
  ),
  // 放大镜：检查更新
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.6-4.6" />
    </>
  ),
  // 圆圈里一个 i：版本信息
  // 点画成实心圆而不是短竖线——2px 描边的一个点，圆头线帽下会糊成小方块
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16.5v-5" />
      <circle cx="12" cy="8" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  // 实心圆点：参数项
  dot: <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />,
}

/**
 * 渲染一个图标
 *
 * 尺寸交给 CSS（.ico svg），这里只给 viewBox —— 同一套图标在帮助页图标框和
 * 未来别处复用时不必改组件。
 */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}
