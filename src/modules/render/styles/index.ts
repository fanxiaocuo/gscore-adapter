/**
 * 样式表：拼装入口
 *
 * 手写 CSS 而非 Tailwind：kkk 那边靠构建期扫描类名生成 CSS，本插件是运行时
 * SSR（没有构建产物流程能跑 tailwind CLI），所以按语义类名写一份精简样式，
 * 由 shell.html 内联进 <style>。
 *
 * 为什么分成这些文件
 * ------------------
 * 原先是单个 488 行的 styles.ts，四个页面的规则混在一起，有三个具体后果：
 *   1. 通用类名跨页撞车。.k / .v / .s / .row / .items / .ver 各有两到四套定义，
 *      靠祖先选择器区分；想改「关于页的标签」得先确认另外三页没在用同一个名字。
 *   2. 跨页复用形成隐式依赖。状态页借了关于页私有的 .rt-sec，改关于页会静默
 *      改掉状态页。这类东西现在一律提到 shared.ts，改名去掉页面前缀。
 *   3. 漏定义看不出来。About.tsx 用了 .grp，而 CSS 里从来没有这条规则，
 *      靠父级 gap 恰好达到效果——拆开后一眼就能发现（已在 pages/about.ts 补上）。
 *
 * 分层与命名约定
 * --------------
 *   base      reset、画布、字体          无前缀（全局唯一）
 *   backdrop  光斑/噪点/气氛大字/角落     无前缀（四页共用）
 *   frame     .page/.head/.foot          无前缀（四页共用）
 *   shared    .stats/.sec/.pill/.empty   无前缀，收录标准是「两页以上真的在用」
 *   pages/*   各页专属                   hp- / st- / cl- / rt- 前缀
 *
 * 块级类加页面前缀，块内部的元素名（.k .v .row .ico .body）保持短名——它们
 * 始终被带前缀的祖先限定，不会泄漏。加一个新页面就加一个 pages/ 文件，
 * 挑一个新前缀，不必读其它页的规则。
 */
import type { Palette } from "../theme.js"
import { base } from "./base.js"
import { backdrop } from "./backdrop.js"
import { frame } from "./frame.js"
import { shared } from "./shared.js"
import { help } from "./pages/help.js"
import { status } from "./pages/status.js"
import { changelog } from "./pages/changelog.js"
import { about } from "./pages/about.js"

/**
 * 生成整张画布的 CSS
 *
 * 四个页面共用同一份：外壳 shell.html 是固定的（那边注释说明了为什么不能按页
 * 换模板），一份完整样式表约 24KB、内联进 <style> 的开销可以忽略（相较出图本身
 * 的几百 KB 不值一提），而按页裁剪要多维护一张「页面 → 需要哪些层」的映射表，
 * 不划算。
 *
 * 拼装顺序即层叠顺序，不能随意调：base 先落地全局盒模型与字体，pages 放最后，
 * 让页面专属规则在同等特异度下能覆盖 shared。四个页面之间互不覆盖（前缀已隔开），
 * 彼此顺序无所谓，按命令的出场顺序排以便查阅。
 *
 * 显式列出而不是 LAYERS.map()：base 需要 scale、其余层只认调色板，
 * 签名不一致的函数放进同一个数组再统一调用，类型上过不去。
 *
 * @param p 调色板
 * @param scale 高清倍率，用 zoom 实现（理由见 render/index.ts 的 SCALE 注释）
 */
export function buildCss(p: Palette, scale = 1): string {
  return [
    base(p, scale),
    backdrop(p),
    frame(p),
    shared(p),
    help(p),
    status(p),
    changelog(p),
    about(p),
  ]
    .map(css => css.trim())
    .join("\n\n")
}
