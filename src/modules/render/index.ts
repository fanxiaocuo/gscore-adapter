/**
 * @description 渲染入口：React SSR -> 整页 HTML -> 本体 puppeteer 截图
 * 版式参考 karin-plugin-kkk 的 packages/template：运行时 SSR、不 hydrate、不产 client bundle，样式管线对齐（Tailwind v4 构建期扫 JSX 产一份 CSS）。
 * 外壳（DOCTYPE、meta、内联样式、#container）与写盘交给 @karinjs/template-react 的 HtmlWrapper / createRenderer，本文件不拼 HTML 字符串。
 * 绕开它的「目录即路由」约定：createRenderer 接受一张普通的「路由 -> 组件」映射表，所以组件不迁目录，在 render() 里现构。
 * CSS 要先落盘：HtmlWrapper 只接文件路径（按该文件的目录解析 url() 相对资源），见 cssFileFor()。
 * 注意：最后一步仍走本体 screenshot() —— 它管浏览器生命周期、超时强制重启、分片截图的 viewport 计算。把已拼好的整页 HTML 当模板喂给它（art-template 对不含 {{ }} 的文本逐字节原样返回），代价是要绕开 dealTpl 的模板缓存，见 evictTplCache()。
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
import { pickPalette, COOL, LIGHT, type Palette } from "./theme.js"

/**
 * @description 自己生成的整页 HTML 放哪：每个页面一个固定文件名，不带时间戳
 * 注意：路径不能每次都变 —— 本体按路径缓存模板、并为每个新路径注册一个 chokidar watcher，两者都会无上限增长（详见 evictTplCache）
 */
const HTML_DIR = join(YunzaiPath, "temp", "html", `${PluginName}-html`)

/**
 * @description 高清倍率：1440px 画布出 1800px 宽的图，缩到聊天窗口后文字边缘仍清晰
 * 这数字直接决定出图耗时（瓶颈是 Chromium 编码 jpeg，随像素数超线性增长）。停 1.25：实测状态页 1.5→1.25 只少 17% 边长却省 58% 时间（zoom 1.5→3427ms、1.25→1451ms、1.0→536ms），文字边缘逐像素比对无劣化；1.0 是原生尺寸，QQ 放大看会糊。
 * 注意：必须用 CSS zoom。screenshot 的 deviceScaleFactor 本体从没读过，传了静默失效只拿 1 倍图；transform:scale 不改布局尺寸、boundingBox 仍是 1440 会裁掉一大半 —— 本体只按 #container 的 boundingBox 截，只能用会改布局盒的 zoom。
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

/** @description 本体 puppeteer 模块，首次渲染时惰性加载 */
let puppeteer: PuppeteerHost | undefined

/**
 * @description 取本体截图器
 * 与 apps/update.ts 同一套做法：由 YunzaiPath 拼绝对路径后动态 import。
 * 注意：别写 ../../../../lib/puppeteer/puppeteer.js —— 既依赖编译产物的目录深度，又会让 tsc 静态解析一个不在本仓库的文件（CI 单独 checkout 时必然 TS2307）
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
 * @description CSS 落盘，返回文件路径
 * HtmlWrapper 只接路径不接字符串（按 CSS 文件所在目录解析 url() 相对资源），而 buildCss() 出的是字符串。
 * 文件名带 scale：同一进程出图走 SCALE、预览走 1，内容不同，共用一名会互相覆盖。
 * 内容不变就不重写：CSS 一份 16KB 上下（实测 16099 字节），连着出几张图会写几次同样的字节。
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
 * @description 拼出一张自包含的整页 HTML，骨架由 @karinjs/template-react 的 HtmlWrapper 生成
 * #container 是必需的：本体截图取 #container，取不到才回落 body，而回落会连页面外边距一起截。
 * title 由 headExtra 补（wrapContent 不输出 <title>）：不影响画面，但预览页在浏览器开着时标签页全空白。body 不转义 —— SSR 产物，React 已转义过文本节点。
 * 注意：不传 ctx.theme —— themeVariables() 会往 <html>/<body> 的 style 写 --background 等变量，变量名与 theme.ts 是同一套，传了会以内联优先级盖掉 :root 那份，深浅两套主题失效。
 * 导出给 test/preview.mjs 用：预览页与真正出的图必须同一骨架，否则「预览对、出图错」没人发现。
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
 * @description 清掉本体对我们这份 HTML 的模板缓存
 * 注意：Renderer.dealTpl 按路径缓存模板文本且永不失效，而我们每次渲染都重写同一文件 —— 不清缓存第二次起读到的还是首次那份，数据变了图纹丝不动且不报错
 * 注意：「每次换新文件名」也不行 —— 那条分支还会 this.watch(tplFile) 注册 chokidar watcher，路径无限增长时缓存和 watcher 一起泄漏；故取「固定路径 + 渲染前删缓存」
 * 拿不到 puppeteer.html 时静默跳过：最坏图不刷新，不该因此让整个渲染失败。
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
   * 注意：开了它必须走 screenshots() 而非 screenshot() —— multiPage 下本体返回 buffer 数组，screenshot() 会把整数组塞进一个 segment.image，发出去是坏的
   * 另注：multiPage 会被本体强制成 jpeg，imgType 在这条路上无效
   */
  multiPage?: boolean
}

/**
 * @description 渲染成图片消息段
 * @returns 可直接 e.reply 的消息段（multiPage 时为数组）；失败返回 false
 */
export async function render(opts: RenderOptions): Promise<YunzaiSendable | false> {
  const pp = await getPuppeteer()
  const shot = opts.multiPage ? pp?.screenshots : pp?.screenshot
  if (!shot) return false

  // 注意：一次渲染只取一次调色板 —— 若 view 与 buildCss 各自调 pickPalette()，恰好跨 6:00/18:00 边界那次会拿到两套颜色（组件内联 style 一套、样式表 :root 变量另一套）
  const palette = pickPalette()

  // SSR + 拼壳 + 写盘一步到位。传现构的「路由 -> 组件」表而非 ktr sync 生成的注册表，理由见文件头。
  // 组件签名是 ({data, ctx}) => Element，本插件的 view 只要调色板，故在此闭包掉，不走 data 通道。
  // htmlFileName 固定成页面名：默认行为（'fixed'）会把路由里的 / 换成 _，出来是 gscore_help.html
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
    // jpeg 而非 png：整页是渐变照片式背景，png 无损存体积极大（帮助页 5.8MB → 600KB 上下），无需透明通道
    imgType: "jpeg" as const,
    /*
     * quality 82 而非 88：压花玻璃后体积翻几倍，这是唯一不动设计的压缩旋钮。
     * 实测（scale 1.25，1800×3565）帮助页 COOL：高光层占体积 78%（2409KB → 关掉只 527KB），是设计主体不能删；quality 是唯一不改观感的（高频纹理的块效应被纹理盖住）：q88 2409KB / q82 1877KB / q76 1533KB / q70 1320KB，停 82 是因 76 起细鳞片被抹平。
     * 别再试一遍：SCALE 1.25→1.0 能到 1627KB，代价是 QQ 放大看文字糊；耗时与 quality 无关（各档 680~700ms）。
     */
    quality: 82,
    pageGotoParams: { waitUntil: "load" as const },
    multiPage: opts.multiPage,
  }

  // 注意：Renderer.dealTpl 把 temp/html/{name} 的 mkdir 放在「模板未缓存」分支里（createDir 排在 readFileSync 之前），依赖那语句顺序等于把正确性押在本体实现细节上，故自己也建一次
  const shotName = `${PluginName}-${opts.name}`
  fs.mkdirSync(join(YunzaiPath, "temp", "html", shotName), { recursive: true })

  const img = await shot.call(pp, shotName, data)
  if (!img) makeLog("error", `渲染 ${opts.name} 失败`, "GsCore")
  return img
}

export { pickPalette, COOL, LIGHT }
export type { Palette }
