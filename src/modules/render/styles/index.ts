/**
 * @description 样式表拼装入口：Tailwind 产物 + base 层，由 render/index.ts 的 buildHtml() 内联进 <style>
 * 手写的语义类已全部删除（原先 base / backdrop / frame / shared / pages/* 五层约 490 行），版式一律写在
 * 组件的 className 上；真正共用的东西由组件承担而不是类名（Stats / Section / Empty / Notice / Header /
 * Footer / Backdrop 都在 components/Layout.tsx）。
 * 颜色的真源只有一处：base 层把调色板落成 :root 上的自定义属性，Tailwind 的 @theme 再把 --color-* 指过去，
 * 于是 utility 侧写 text-muted、CSS 侧写 V.muted。
 * 注意：产物必须读回来内联而不是 <link> —— 本体把 HTML 写到 temp/html/{name}/ 再用 file:// 打开，相对路径
 * 的基准是那个临时目录（同 assets.ts 转 data URI 的理由），而这边没有 kkk 的 ResourcePathManager 那一层。
 * 注意：别回到「语义类名 + 后代选择器」—— 通用类名跨页撞车、跨页复用形成隐式依赖、漏定义看不出来这三条都
 * 出自那套写法本身，分文件只能缓解；utility 让前两条在语法上不成立，第三条交给 classes.test.mjs 的两条断言。
 * 剩下的内联 style 不迁：那二十来处几乎都是运行时才算得出的值，utility 表达不了。
 */
import fs from "node:fs"
import { join } from "node:path"
import { ResPath } from "@/dir"
import { makeLog } from "@/utils/compat"
import type { Palette } from "../theme.js"
import { base } from "./base.js"

/** @description 编译好的 Tailwind 产物。文件在进程生命周期里不会变，读一次就够（同 assets.ts 的缓存理由） */
let twCache: string | undefined

/**
 * @description 读 Tailwind 编译产物
 * 产物由 `pnpm build` 的 build:css 步骤生成（扫 lib/ 下的组件），不入库。只在源码树里跑而没 build 过时读
 * 不到，此时降级成空串并告警 —— 让页面掉样式也好过整张图渲染失败，行为与 assets.ts 读不到图片时一致。
 * 注意：迁移之后这条降级路径的后果很重 —— 版式全在 utility 里，读不到产物就是整页回落成无样式的文档流。
 */
function tailwind(): string {
  if (twCache !== undefined) return twCache

  try {
    twCache = fs.readFileSync(join(ResPath, "template", "css", "tailwind.css"), "utf8")
  } catch {
    twCache = ""
    makeLog(
      "warn",
      "未找到 Tailwind 产物（resources/template/css/tailwind.css），请先 pnpm build",
      "GsCore",
    )
  }
  return twCache
}

/**
 * @description 生成整张画布的 CSS，四个页面共用同一份
 * 按页裁剪要多维护一张「页面 → 需要哪些规则」的映射表，而整份也就十几 KB，不划算。
 * 顺序在这里不起作用：Tailwind 产物整份包在 @layer 里，base 剩下的 :root 与 #container 是无层的，而无层
 * 样式在层叠里永远压过任何 @layer。只有 base 是函数：调色板与 scale 都只在它那儿用得上。
 * @param p 调色板，只用于生成 :root 上的变量块
 * @param scale 高清倍率，用 zoom 实现（理由见 render/index.ts 的 SCALE 注释）
 */
export function buildCss(p: Palette, scale = 1): string {
  return [tailwind(), base(p, scale)]
    .map(css => css.trim())
    .filter(Boolean)
    .join("\n\n")
}
