/**
 * 渲染入口：React SSR -> 整页 HTML -> 本体 puppeteer 截图
 *
 * 与 karin-plugin-kkk 的差异
 * ---------------------------
 * 版式思路参考 kkk 的 packages/template。相同的部分比想象的多：kkk 也是运行时
 * SSR，同样不 hydrate、不产出 client bundle。页面是拿去截图的静态图，两边都没有
 * 交互需求。样式管线现在也对齐：都用 Tailwind v4 在构建期扫 JSX 产出一份 CSS。
 *
 * 整页 HTML 交给 @karinjs/template-react
 * -------------------------------------
 * 外壳（DOCTYPE、meta、内联样式、#container）由该包的 HtmlWrapper.wrapContent
 * 生成，SSR 与写盘由 createRenderer 一并完成，本文件不再自己拼 HTML 字符串。
 * 这就是 kkk 那条 reactServerRender 路径本身——原先是照着它的思路自己实现一遍，
 * 现在直接用上游的实现。
 *
 * 接法上绕开了它的「目录即路由」约定
 * --------------------------------
 * 该包的常规用法是 createTemplateRenderer + ktr sync：模板必须写成
 * template/<板块>/<模板>/index.tsx，由 CLI 扫出 .ktr/ 注册表。本插件的组件在
 * src/modules/render/components/ 下，不迁目录——createRenderer 接受的就是一张
 * 普通的「路由 -> 组件」映射表，不依赖注册表文件，所以直接在 render() 里现构一张。
 * 代价是用不到它的开发面板与 mock 管理，那两样本插件也不需要（预览走 test/preview.mjs）。
 *
 * CSS 要先落盘
 * -----------
 * HtmlWrapper 只接 CSS 文件路径（它要按该文件的目录解析 url() 里的相对资源），
 * 而 buildCss() 返回的是字符串。所以每次渲染把 CSS 写到 HTML_DIR/style-{scale}.css
 * 再把路径传进去，见 cssFileFor()。内联行为不变：wrapContent 会把整份 CSS 读进
 * <style>，与原先自己拼的效果一致（试点逐元素比对过 computed style，零差异）。
 *
 * 但 screenshot() 仍然要用
 * ----------------------
 * 本体 screenshot() 里除了套模板，还有浏览器生命周期、超时强制重启、每 N 次渲染
 * 主动重启（防止越跑越慢）、分片截图的 viewport 计算、buffer 归一化——套模板只占
 * 其中很小一块。所以不自己驱动 puppeteer，而是把「已经拼好的整页 HTML」当模板喂
 * 给它：art-template 对不含 {{ }} 的文本是逐字节原样返回（实测过），于是那一步
 * 退化成一次无副作用的拷贝。
 *
 * 代价是要绕开 dealTpl 的模板缓存，见 render() 里 evictTplCache() 那段——换了
 * 渲染包也消不掉它：createRenderer 默认 htmlFileName:'fixed'，同样是固定路径。
 *
 * 关于最后一步的接法：本体那个模块的 screenshot() 已经用 segment.image 包好了
 * （puppeteer.js:9-12），返回值可直接 e.reply，所以不必自己碰 renderer/loader。
 */
import fs from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createRenderer, HtmlWrapper } from "@karinjs/template-react"
import type { ReactElement } from "react"
import { PluginName, YunzaiPath } from "@/dir"
import type { YunzaiSendable } from "@/types"
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
 * 高清倍率：1440px 画布出 1800px 宽的图，缩放到聊天窗口后文字边缘仍清晰。
 *
 * 为什么是 1.25 而不是更高
 * ----------------------
 * 这个数字直接决定出图耗时——瓶颈是 Chromium 把画布编码成 jpeg，耗时随像素数
 * 超线性增长。实测状态页（本体 screenshot()，同一台机器各取 4 次中位数）：
 *
 *   zoom   尺寸          耗时      体积
 *   1.5    2160x2785    3427ms    588KB
 *   1.25   1800x2322    1451ms    443KB
 *   1.0    1440x1859     536ms    316KB
 *
 * 1.5 → 1.25 只少 17% 的边长，却省掉 58% 的时间。裁图逐像素比对过，文字边缘
 * 没有可见劣化（画布本来就是 1440 的两倍多，聊天窗口里再缩一次）。
 * 1.0 更快，但那是原生尺寸，QQ 客户端放大查看时会糊。
 *
 * 曾经写死 1.5 的理由是「2 倍太大」——那个判断没错，只是没往下试。
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
const SCALE = 1.25

interface ScreenshotData {
  tplFile: string
  saveId: string
  imgType: "jpeg"
  quality: number
  pageGotoParams: { waitUntil: "load" }
  multiPage?: boolean
}

interface PuppeteerHost {
  html?: Record<string, unknown>
  screenshot?: (name: string, data: ScreenshotData) => Promise<YunzaiSendable | false>
  screenshots?: (name: string, data: ScreenshotData) => Promise<YunzaiSendable | false>
}

/** 本体 puppeteer 模块，首次渲染时惰性加载 */
let puppeteer: PuppeteerHost | undefined

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
    puppeteer = (await import(url)).default as PuppeteerHost
  } catch (err) {
    makeLog("error", ["加载本体 puppeteer 失败", err], "GsCore")
    return null
  }
  return puppeteer
}

/**
 * CSS 落盘，返回文件路径
 *
 * HtmlWrapper 只接路径不接字符串（它要按 CSS 文件所在目录解析 url() 里的相对
 * 资源，见 loadInlineCss）。而 buildCss() 出的是字符串，所以写到 HTML_DIR 下。
 *
 * 文件名带 scale：同一进程里出图走 SCALE、预览走 1，两者内容不同，共用一个名字
 * 会互相覆盖。按 scale 分文件后各自稳定，也省掉重复写盘。
 *
 * 内容不变就不重写：CSS 一份 200KB 上下，四个页面连着出图会写四次同样的字节。
 * 比一次读盘 + 比字符串便宜，也少一次无意义的 mtime 变动（resolveTemplateStyle
 * 会按 mtime 挑文件，虽然这里没走那条路，但不留坑）。
 */
function cssFileFor(palette: Palette, scale: number): string {
  const css = buildCss(palette, scale)
  fs.mkdirSync(HTML_DIR, { recursive: true })
  const file = join(HTML_DIR, `style-${String(scale).replace(".", "_")}.css`)
  let same = false
  try {
    same = fs.readFileSync(file, "utf8") === css
  } catch {
    // 首次渲染时文件还不存在，当作不同，照写
  }
  if (!same) fs.writeFileSync(file, css)
  return file
}

/**
 * 拼出一张自包含的整页 HTML
 *
 * 骨架由 @karinjs/template-react 的 HtmlWrapper 生成：DOCTYPE、charset、
 * 内联样式、一个 #container 包住 body。原先这里是自己拼的同一套东西。
 *
 * #container 是必需的：本体截图取 #container，取不到才回落 body
 * （renderers/puppeteer/lib/puppeteer.js:189）。回落到 body 会连页面外边距一起截。
 * wrapContent 无条件输出这个节点，正好符合要求——它自己的注释也说明这是截图边界，
 * 组件不该再声明一个。
 *
 * 不传 ctx.theme：themeVariables() 只在给了 theme 时才往 <html>/<body> 的 style
 * 上写 --background 等变量，而那批变量名与本插件 theme.ts 定义的是同一套。传了
 * 就会以内联样式的优先级盖掉 :root 里那份，深浅两套主题反而失效。调色板照旧由
 * buildCss 下发到 :root，这里只借它的外壳。
 *
 * title 由 headExtra 补：wrapContent 不输出 <title>。它不影响画面，但预览页在
 * 浏览器里开着时标签页全是空白，分不清哪页是哪页。转义是因为将来若有人把用户输入
 * 拼进标题，不转义就是注入；body 不转义——它是 SSR 的产物，React 已经转义过文本节点。
 *
 * 导出是为了给 test/preview.mjs 用：预览页与真正出的图必须是同一个骨架，
 * 否则「预览里对、出图错」这类问题会没人发现。
 */
export function buildHtml(title: string, cssPath: string, body: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const wrapper = new HtmlWrapper({
    cssPath,
    headExtra: `<title>${esc(title)}</title>`,
  })
  return wrapper.wrapContent(body, { scale: 1 })
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
export async function render(opts: RenderOptions): Promise<YunzaiSendable | false> {
  const pp = await getPuppeteer()
  const shot = opts.multiPage ? pp?.screenshots : pp?.screenshot
  if (!shot) return false

  // 一次渲染只取一次调色板：若 view 与 buildCss 各自调 pickPalette()，
  // 恰好跨过 6:00/18:00 边界的那一次出图会拿到两套颜色——组件内联 style 是
  // 一套字面量，样式表的 :root 变量是另一套。取一次再传下去，两边必然一致。
  const palette = pickPalette()

  // SSR + 拼壳 + 写盘一步到位。传的是一张现构的「路由 -> 组件」表而不是 ktr sync
  // 生成的注册表，理由见文件头。组件签名是 ({data, ctx}) => Element，本插件的
  // view 只要调色板，所以在这里闭包掉，不走它的 data 通道。
  //
  // htmlFileName 固定成页面名：默认行为（'fixed'）会把路由里的 / 换成 _，
  // 出来是 gscore_help.html。保持与迁移前一致的 {name}.html，evictTplCache
  // 和 test/ 里按名字找文件的地方都不用改。
  const renderHtml = createRenderer(
    { [opts.name]: { name: opts.title, component: () => opts.view(palette) } },
    {
      cssPath: cssFileFor(palette, SCALE),
      outputDir: HTML_DIR,
      htmlFileName: () => opts.name,
      html: { headExtra: `<title>${opts.title.replace(/</g, "&lt;")}</title>` },
    },
  )

  // 它把异常收进返回值而不是抛出，所以判 success 而不是 try/catch
  const res = await renderHtml(opts.name, {})
  if (!res.success) {
    makeLog("error", ["组件渲染失败", res.error], "GsCore")
    return false
  }
  const tplFile = res.htmlPath
  evictTplCache(tplFile)

  const data = {
    tplFile,
    // saveId 决定 temp/html 下的文件名。同名会互相覆盖，按用途区分即可
    saveId: opts.name,
    // jpeg 而非 png：整页是渐变照片式背景（深浅两套都是），png 无损存这种内容
    // 体积极大（帮助页 5.8MB → 600KB 上下），质量 92 下看不出差别，也不需要透明通道
    imgType: "jpeg" as const,
    // 88 而非 92：实测质量档只影响体积、几乎不影响耗时（各档中位数都在 2s 上下，
    // 时间全花在像素数上，见 SCALE 那段）。92→88 少 20% 体积，照片式背景上看不出
    // 差别。真正的提速来自 SCALE。
    quality: 88,
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
