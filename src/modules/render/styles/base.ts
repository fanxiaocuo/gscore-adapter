/**
 * @description 基础层：reset、画布、字体 —— 迁到 Tailwind 之后唯一剩下的手写 CSS
 * 这三件 utility 都表达不了：:root 上的调色板变量（是 utility 的取值来源，得先落地）、
 * `*,*::before,*::after` 的 reset（通用选择器，没有类可挂）、#container 上的画布尺寸与 zoom
 * （那个节点由 buildHtml() 生成，不经组件）。
 * 注意：别往这儿加东西 —— 任何「某个元素长什么样」的规则都写在组件的 className 上，这里再长下去就会重新
 * 变成从前那份四页混住的单文件（拆分与迁移的理由记在 ./index.ts 顶部）。
 * 注意：下面整段 CSS 是一个模板字符串，CSS 注释里也不能出现美元号紧跟花括号 —— 它会被当成插值求值，
 * 而报错信息里既没有行号也没有那段注释，排查时完全想不到是注释的问题。踩过一次。
 */
import { CANVAS_WIDTH, FONT_STACK, V, cssVars, type Palette } from "../theme.js"

/**
 * @description 把调色板落成 :root 上的自定义属性，其余各层只引用 V.* 里的 var()
 * @param p 调色板
 * @param scale 高清倍率，用 zoom 实现（理由见 render/index.ts 的 SCALE 注释）
 */
export const base = (p: Palette, scale: number): string => `
:root{${cssVars(p)}}
@layer reset{*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}}
/* lucide-react 无条件在 <svg> 上挂 class="lucide lucide-图标名"，传 className
   覆盖不掉（它是合并而非替换）。这两类 class 不参与样式，但 classes.test.mjs 两个
   方向都对账，「HTML 里有、CSS 里无」会被报成漏写样式。这里空规则认领一下，
   比在测试里加白名单好：白名单会把「真的漏写了 lucide 相关样式」也一起放过。

   逐个列出而不是用 [class*="lucide-"]：那条对账只把选择器里以点开头的类名抽出来
   比对，属性选择器它看不见，认领不到具体类名。名单跟着 Icons.tsx 的 ICONS 表走，
   换图标要一起改——漏改会被那条测试当场报出来，不会静默。 */
@layer reset{
  .lucide,
  .lucide-activity,.lucide-list,.lucide-refresh-cw,
  .lucide-circle-plus,.lucide-circle-minus,.lucide-circle-play,.lucide-circle-stop,
  .lucide-settings,.lucide-arrow-up,.lucide-chevrons-up,
  .lucide-scroll-text,.lucide-search,.lucide-info,.lucide-circle-dot,
  .lucide-circle-check,.lucide-circle-x{}
}
html,body{background:${V.bg}}
#container{
  width:${CANVAS_WIDTH}px;min-width:${CANVAS_WIDTH}px;
  position:relative;overflow:hidden;
  background:${V.bg};color:${V.foreground};
  font-family:${FONT_STACK};
  -webkit-font-smoothing:antialiased;
  zoom:${scale};
}
`
