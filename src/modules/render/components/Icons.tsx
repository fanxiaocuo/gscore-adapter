/**
 * 图标集
 *
 * 直接用 lucide-react 组件。它在 dependencies 里，运行时从 node_modules 解析
 * （产物不打包，import 语句原样保留）——所以 release / preview 分支装完要
 * pnpm install，见 README「安装」。SSR 下组件展开即内联 svg，颜色靠
 * currentColor 继承。
 *
 * 为什么不用字符标记
 * -----------------
 * 原先用 ◉ ≡ ↻ ⚙ ☰ 这类字符当图标，看着总是没垂直居中。原因不在 CSS：
 * flex/grid 居中的是「行盒」，字形墨迹在行盒里的位置由字体基线决定。这些几何
 * 符号在 Latin 字体里普遍缺字，Chromium 回落到中文字体后，墨迹在 em 方框中
 * 整体偏下，于是无论怎么居中都偏。字符还有一层不确定性——换台机器、少装一个
 * 字体，字形宽窄和位置就变了，截图不可复现。
 *
 * SVG 没有这些问题：viewBox 定死几何，路径在 24×24 里就是画正的，
 * 容器只要把 <svg> 居中即可，结果与字体无关。
 *
 * 这层薄封装的意义
 * ---------------
 * commands.ts 按 IconName 这种语义名引用（"status" / "changelog"），而不是直接
 * 写 lucide 的组件名。换图标只动下面这张表，二十多处调用点不用碰。
 */
import {
  Activity,
  ArrowUp,
  ChevronsUp,
  CircleCheck,
  CircleDot,
  CircleMinus,
  CirclePlay,
  CirclePlus,
  CircleStop,
  CircleX,
  Info,
  List,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react"

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
  | "check"
  | "cross"

/**
 * 语义名 -> lucide 组件
 *
 * plus/minus/play/stop 用的是 Circle* 变体而不是裸的加减号：帮助页里这四个图标
 * 各自待在一个 48/60px 的圆角色块中央，裸符号（一横一竖）在那么大的底上显得空，
 * 有外轮廓的变体视觉重量才与同排的 Activity / Settings / ScrollText 配得上。
 *
 * check/cross 只给设置结果条用（Settings.tsx 的 <Result>）。曾经那里借的是
 * play/stop —— 播放三角与「这项改成功了」没有语义关系，读者要先把它当装饰忽略掉
 * 才能看文字。同样是 Circle* 一族，与旁边的图标同一套视觉重量。
 */
const ICONS: Record<IconName, LucideIcon> = {
  status: Activity,
  list: List,
  refresh: RefreshCw,
  plus: CirclePlus,
  minus: CircleMinus,
  play: CirclePlay,
  stop: CircleStop,
  settings: Settings,
  arrowUp: ArrowUp,
  arrowUpDouble: ChevronsUp,
  changelog: ScrollText,
  search: Search,
  info: Info,
  dot: CircleDot,
  check: CircleCheck,
  cross: CircleX,
}

/**
 * 一个图标
 *
 * 尺寸交给外层 CSS（Help.tsx 用 [&>svg]:size-[30px] 这类），所以要显式压掉
 * lucide 默认写在 <svg> 上的 width/height —— 传 undefined 即可让 React 不输出
 * 这两个属性（注意光传 size={undefined} 没用，lucide 会回落到默认值 24，
 * 照样渲染出 width="24" height="24"）。viewBox 保留，几何不受影响。
 *
 * lucide 还会无条件挂上 `class="lucide lucide-circle-dot"`，传 className 也覆盖
 * 不掉（它是合并而非替换）。这两个类不参与样式，但 classes.test.mjs 会把「HTML
 * 里有、CSS 里无」的类名报成漏写，所以在 base.ts 的 reset 层给了一条空规则认领
 * 它们 —— 那边有对应注释。
 */
export function Icon({ name }: { name: IconName }) {
  const C = ICONS[name]
  return <C width={undefined} height={undefined} aria-hidden="true" />
}
