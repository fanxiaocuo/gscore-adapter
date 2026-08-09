/**
 * 渲染入口：React SSR -> 自己拼出整页 HTML -> 本体 puppeteer 截图
 *
 * 与 karin-plugin-kkk 的差异
 * ---------------------------
 * 版式思路参考 kkk 的 packages/template。相同的部分比想象的多：kkk 也是运行时
 * SSR，同样不 hydrate、不产出 client bundle。页面是拿去截图的静态图，两边都没有
 * 交互需求。样式管线现在也对齐：都用 Tailwind v4 在构建期扫 JSX 产出一份 CSS。
 *
 * 剩下的差异只有两处：
 *   1. 语义 token 自己定义在 theme.ts，不依赖 @heroui/styles
 *      （kkk 那些 --heroui-* 变量在它仓库里只被读、没有定义）
 *   2. CSS 内联进 <style> 而不是 <link>：kkk 有 HtmlWrapper + ResourcePathManager
 *      负责算相对路径，这边没有那一层，而 puppeteer 用 file:// 打开临时目录下的
 *      HTML，相对路径的基准是那个目录，链不到插件里的 css
 *
 * 整页 HTML 自己拼，不再走 art-template
 * ------------------------------------
 * 对齐 kkk 的 reactServerRender：它的 HtmlWrapper.wrapContent 就是把 DOCTYPE、
 * meta、样式和 body 拼成一个自包含的 HTML 文件写盘，交给截图方打开。这边同理，
 * 见 buildHtml()，原先那份 resources/template/html/shell.html 已删。
 *
 * 好处不在性能（art-template 渲一次 0.19ms，相对一两秒的截图可以忽略），而在于
 * 少一层「模板语法」的中间态：外壳是 TS 里的一个函数，改它有类型检查、有 diff，
 * 不必再遵守「模板内容必须恒定」这条只有读过本体 Renderer 源码才知道的约束。
 *
 * 但 screenshot() 仍然要用
 * ----------------------
 * 本体 screenshot() 里除了套模板，还有浏览器生命周期、超时强制重启、每 N 次渲染
 * 主动重启（防止越跑越慢）、分片截图的 viewport 计算、buffer 归一化——套模板只占
 * 其中很小一块。所以不自己驱动 puppeteer，而是把「已经拼好的整页 HTML」当模板喂
 * 给它：art-template 对不含 {{ }} 的文本是逐字节原样返回（实测过），于是那一步
 * 退化成一次无副作用的拷贝。
 *
 * 代价是要绕开 dealTpl 的模板缓存，见 render() 里 evictTplCache() 那段。
 *
 * 关于最后一步的接法：本体那个模块的 screenshot() 已经用 segment.image 包好了
 * （puppeteer.js:9-12），返回值可直接 e.reply，所以不必自己碰 renderer/loader。
 */
import fs from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"
import { PluginName, YunzaiPath } from "@/dir"
import { makeLog } from "@/utils/compat"
import { buildCss } from "./styles/index.js"
import { pickPalette, DARK, LIGHT, type Palette } from "./theme.js"

/**
 * 自己生成的整页 HTML 放哪
 *
 * 每个页面一个固定文件名（temp/html/gscore-adapter-html/{name}.html），不带时间戳。
 * 理由见 render() 里 evictTplCache 那段：本体按路径缓存模板、并为每个新路径注册一个
 * chokidar watcher，路径每次都变的话两者都会无上限增长。
 */
const HTML_DIR = join(YunzaiPath, "temp", "html", `${PluginName}-html`)

/**
 * 高清倍率：1440px 画布出 2160px 宽的图，缩放到聊天窗口后文字边缘仍清晰。
 *
 * 取 1.5 而不是 2：帮助页本身就有 3900px 高，2 倍出图接近 7800px、5.8MB，
 * 不少 QQ 适配器会直接拒发或压成马赛克。1.5 倍文字依旧锐利，体积小一个量级。
 *
 * 用 CSS zoom 而不是 screenshot 的 deviceScaleFactor —— 本体的渲染后端
 * （renderers/puppeteer/lib/puppeteer.js）从没读过 data.deviceScaleFactor，
 * 传了是静默失效，只会拿到 1 倍图；它也只在分片截图时调 setViewport。
 * 而 zoom 会放大 #container 的实际布局盒，body.screenshot() 截的就是放大后的尺寸。
 *
 * 不用 transform:scale：transform 不改变元素的布局尺寸，boundingBox 仍是 1440，
 * 截出来会把画面裁掉一大半。kkk 用的是 transform:scale(3)（DefaultLayout 里
 * 配 transformOrigin:'top left'），那条路要求截图方按放大后的尺寸显式设 viewport，
 * 它自己的渲染服务能做到；本体的 screenshot() 只按 #container 的 boundingBox 截，
 * 所以这里必须用会改布局盒的 zoom。
 */
const SCALE = 1.5

/** 本体 puppeteer 模块，首次渲染时惰性加载 */
let puppeteer: any

/**
 * 取本体截图器
 *
 * 与 apps/update.ts 同一套做法：由 YunzaiPath 拼绝对路径后动态 import。
 * 不写 ../../../../lib/puppeteer/puppeteer.js —— 那样既依赖编译产物的目录深度，
 * 又会让 tsc 去静态解析一个不在本插件仓库里的文件（CI 单独 checkout 时必然 TS2307）。
 */
async function getPuppeteer() {
  if (puppeteer) return puppeteer
  try {
    const url = pathToFileURL(join(YunzaiPath, "lib/puppeteer/puppeteer.js")).href
    puppeteer = (await import(url)).default
  } catch (err) {
    makeLog("error", ["加载本体 puppeteer 失败", err], "GsCore")
    return null
  }
  return puppeteer
}

/**
 * 拼出一张自包含的整页 HTML
 *
 * 对齐 kkk 的 HtmlWrapper.wrapContent：DOCTYPE、charset、title、内联样式、
 * 一个 #container 包住 body。就这么多——原先的 shell.html 除了 art-template
 * 的占位符语法，实质内容也只有这些。
 *
 * #container 是必需的：本体截图取 #container，取不到才回落 body
 * （renderers/puppeteer/lib/puppeteer.js:189）。回落到 body 会连页面外边距一起截。
 *
 * title 要转义：它来自调用方的字面量（"早柚核心适配器 帮助"），当前没有特殊字符，
 * 但这里是模板的位置，将来若有人把用户输入拼进标题，不转义就是注入。body 不转义
 * ——它是 renderToStaticMarkup 的产物，React 已经把文本节点转义过了。
 *
 * 导出是为了给 test/preview.mjs 用：预览页与真正出的图必须是同一个骨架，
 * 否则「预览里对、出图错」这类问题会没人发现。
 */
export function buildHtml(title: string, css: string, body: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
${css}
</style>
</head>
<body><div id="container">${body}</div></body>
</html>
`
}

/**
 * 清掉本体对我们这份 HTML 的模板缓存
 *
 * 本体 Renderer.dealTpl 会把模板文本按路径缓存在 this.html[tplFile] 里，永不失效
 * （lib/renderer/Renderer.js:44）。我们每次渲染都会重写同一个文件，若不清缓存，
 * 第二次开始读到的还是首次那份——页面数据变了，出的图却纹丝不动，而且不报任何错。
 *
 * 反过来「每次换一个新文件名」也不行：那条路径分支里还会 this.watch(tplFile) 注册
 * 一个 chokidar watcher（第 54 行），路径无限增长时缓存和 watcher 一起泄漏。
 *
 * 所以取「固定路径 + 渲染前删缓存」：watcher 恒定只有页面数那么几个，缓存每次失效。
 * 删的是我们自己写进去的键，不动本体其它插件的条目。
 *
 * 拿不到 puppeteer.html 时静默跳过：本体换实现的话，最坏结果是图不刷新，
 * 不该因此让整个渲染失败。
 */
function evictTplCache(tplFile: string) {
  try {
    const cache = puppeteer?.html
    if (cache && typeof cache === "object") delete cache[tplFile]
  } catch {
    // 同上：缓存清不掉不影响本次出图，不打断流程
  }
}

export interface RenderOptions {
  /** 截图名，用于日志与临时文件名 */
  name: string
  /** 页面标题（<title>，不影响画面） */
  title: string
  /** 组件工厂：拿到调色板后返回 React 元素 */
  view: (palette: Palette) => ReactElement
  /**
   * 超长图分片，交由本体处理
   *
   * 开了它必须走 screenshots() 而不是 screenshot()：本体渲染后端在
   * multiPage 下返回的是 buffer **数组**（renderers/puppeteer/lib/puppeteer.js:276
   * `return data.multiPage ? ret : ret[0]`），而 lib/puppeteer/puppeteer.js 的
   * screenshot() 只会把整个数组塞进一个 segment.image，发出去是坏的。
   * screenshots() 才会逐片包裹（puppeteer.js:13-19）。
   *
   * 另注：multiPage 会被本体强制成 jpeg（第 203 行），imgType 在这条路上无效。
   */
  multiPage?: boolean
}

/**
 * 渲染成图片消息段
 * @returns 可直接 e.reply 的消息段（multiPage 时为数组）；失败返回 false
 */
export async function render(opts: RenderOptions) {
  const pp = await getPuppeteer()
  const shot = opts.multiPage ? pp?.screenshots : pp?.screenshot
  if (!shot) return false

  // 一次渲染只取一次调色板：若 view 与 buildCss 各自调 pickPalette()，
  // 恰好跨过 6:00/18:00 边界的那一次出图会拿到两套颜色——组件内联 style 是
  // 一套字面量，样式表的 :root 变量是另一套。取一次再传下去，两边必然一致。
  const palette = pickPalette()

  let body: string
  try {
    body = renderToStaticMarkup(opts.view(palette))
  } catch (err) {
    makeLog("error", ["组件渲染失败", err], "GsCore")
    return false
  }

  // 整页 HTML 自己拼好写盘，再把它当"模板"喂给本体。
  // art-template 对不含 {{ }} 的文本逐字节原样返回，所以那一步没有副作用；
  // CSS 里的花括号、@media、以及类名里被转义的方括号（.gap-\[18px\]）都不受影响。
  fs.mkdirSync(HTML_DIR, { recursive: true })
  const tplFile = join(HTML_DIR, `${opts.name}.html`)
  fs.writeFileSync(tplFile, buildHtml(opts.title, buildCss(palette, SCALE), body))
  evictTplCache(tplFile)

  const data = {
    tplFile,
    // saveId 决定 temp/html 下的文件名。同名会互相覆盖，按用途区分即可
    saveId: opts.name,
    // jpeg 而非 png：整页是渐变照片式背景（深浅两套都是），png 无损存这种内容
    // 体积极大（帮助页 5.8MB → 600KB 上下），质量 92 下看不出差别，也不需要透明通道
    imgType: "jpeg" as const,
    quality: 92,
    pageGotoParams: { waitUntil: "load" as const },
    multiPage: opts.multiPage,
  }

  // 本体 Renderer.dealTpl 把 temp/html/{name} 的 mkdir 放在了「模板未缓存」分支里
  // （lib/renderer/Renderer.js:44-46），而保存路径是按 name 分目录的。
  //
  // 现在每个页面各有一份 HTML、且渲染前会清缓存，那条分支每次都会走到，本体自己也会
  // 建目录——但仍然自己建一次：那个顺序是本体的实现细节（createDir 恰好排在
  // readFileSync 之前），依赖它等于把我们的正确性押在别人的语句顺序上。
  // mkdir recursive 幂等，多跑一次的代价可以忽略。
  const shotName = `${PluginName}-${opts.name}`
  fs.mkdirSync(join(YunzaiPath, "temp", "html", shotName), { recursive: true })

  const img = await shot.call(pp, shotName, data)
  if (!img) makeLog("error", `渲染 ${opts.name} 失败`, "GsCore")
  return img
}

export { pickPalette, DARK, LIGHT }
export type { Palette }
