/**
 * 样式表：拼装入口
 *
 * 两个来源拼成一份，由 render/index.ts 的 buildHtml() 内联进 <style>：
 *   1. Tailwind 产物 —— 编译期由 @tailwindcss/cli 扫 lib/ 下的组件生成
 *      （入口 ./tailwind.css，那边注释说明了为什么不引 preflight、
 *      为什么扫编译产物而不是 src/*.tsx）
 *   2. base 层 —— 见 base.ts，只剩 :root 变量、reset 与 #container 三件
 *
 * 为什么产物要读回来内联而不是 <link>
 * ----------------------------------
 * 本体把 HTML 写到 temp/html/{name}/ 再让 puppeteer 用 file:// 打开，相对路径的
 * 基准是那个临时目录而不是插件目录（同 assets.ts 把图片转 data URI 的理由）。
 * kkk 能用 <link> 引外部 CSS，是因为它有 HtmlWrapper + ResourcePathManager 负责
 * 算相对路径，这边没有那一层。
 *
 * 手写的语义类去哪了
 * ------------------
 * 全没了。原先是 base / backdrop / frame / shared / pages/* 五层、四套页面前缀
 * （hp- st- cl- rt-），共约 490 行；现在版式一律写在组件的 className 上，
 * 那几层连同 pages/ 目录一起删掉了，只留 base。
 *
 * 促成迁移的是拆分时期就记着的三条毛病，它们都出自「语义类名 + 后代选择器」
 * 本身，分文件只能缓解：
 *   1. 通用类名跨页撞车。.k / .v / .s / .row / .items / .ver 各有两到四套定义，
 *      靠祖先选择器区分；想改「关于页的标签」得先确认另外三页没在用同一个名字。
 *   2. 跨页复用形成隐式依赖。状态页借了关于页私有的 .rt-sec，改关于页会静默
 *      改掉状态页。
 *   3. 漏定义看不出来。About.tsx 用了 .grp，而 CSS 里从来没有这条规则，
 *      靠父级 gap 恰好达到效果。
 * utility 让前两条在语法上不成立（没有名字可撞、没有东西可借），第三条交给
 * classes.test.mjs 的两条断言：类没定义、或规则没人用，都会报。
 *
 * 真正共用的东西改由组件承担而不是类名：Stats / Section / Empty / Notice /
 * Header / Footer / Backdrop 都在 components/Layout.tsx。这比复制一串 utility
 * 更稳——三处复制走样，classes.test.mjs 查不出来（它只查「有没有定义」）。
 *
 * 剩下的内联 style 不迁：组件里那二十来处几乎都是运行时才算得出的值（状态灯
 * toneColor、分组标题轮换色 p.rotate[i%…]、渐变分隔线、页脚的 --fs 缩放比），
 * 值不在编译期确定，utility 表达不了。
 *
 * 颜色怎么进来
 * ------------
 * base 层把调色板落成 :root 上的自定义属性（theme.ts 的 cssVars），Tailwind 的
 * @theme 再把 --color-* 指过去，于是 utility 侧写 text-muted、CSS 侧写 V.muted，
 * 两边同一个真源。深浅两套主题的产物只差 :root 那一行。
 */
import fs from "node:fs"
import { join } from "node:path"
import { ResPath } from "@/dir"
import { makeLog } from "@/utils/compat"
import type { Palette } from "../theme.js"
import { base } from "./base.js"

/** 编译好的 Tailwind 产物。文件在进程生命周期里不会变，读一次就够（同 assets.ts 的缓存理由） */
let twCache: string | undefined

/**
 * 读 Tailwind 编译产物
 *
 * 产物由 `pnpm build` 的 build:css 步骤生成（扫 lib/ 下的组件），不入库。
 * 只在源码树里跑而没 build 过时会读不到，此时降级成空串并告警——
 * 让页面掉样式也好过整张图渲染失败，行为与 assets.ts 读不到图片时一致。
 *
 * 迁移之后这条降级路径的后果比从前重：版式全在 utility 里，读不到产物不再是
 * 「掉点样式」，而是整页回落成无样式的文档流。告警措辞照旧，因为处置方式没变
 * ——跑一次 pnpm build。
 */
function tailwind(): string {
  if (twCache !== undefined) return twCache

  try {
    twCache = fs.readFileSync(join(ResPath, "template", "css", "tailwind.css"), "utf8")
  } catch {
    twCache = ""
    makeLog("warn", "未找到 Tailwind 产物（resources/template/css/tailwind.css），请先 pnpm build", "GsCore")
  }
  return twCache
}

/**
 * 生成整张画布的 CSS
 *
 * 四个页面共用同一份：按页裁剪要多维护一张「页面 → 需要哪些规则」的映射表，
 * 而整份也就十几 KB，不划算。
 *
 * 顺序在这里不起作用：Tailwind 产物整份包在 @layer theme, utilities 里，base 的
 * reset 显式包在 @layer reset 里（层序由 tailwind.css 第一行声明，reset 在最前），
 * 而 base 剩下的 :root 与 #container 是无层的——无层样式在层叠里永远压过任何
 * @layer，与源码先后无关。产物排在前面只是读起来顺。
 *
 * 只有 base 是函数：调色板与 scale 都只在它那儿用得上（scale 落在 #container 的 zoom）。
 *
 * @param p 调色板，只用于生成 :root 上的变量块
 * @param scale 高清倍率，用 zoom 实现（理由见 render/index.ts 的 SCALE 注释）
 */
export function buildCss(p: Palette, scale = 1): string {
  return [tailwind(), base(p, scale)]
    .map(css => css.trim())
    .filter(Boolean)
    .join("\n\n")
}
