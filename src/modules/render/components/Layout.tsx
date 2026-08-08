/**
 * 画布骨架
 *
 * 对应 kkk 的 DefaultLayout：固定宽画布 + 弥散光 + 噪点 + 角落装饰。
 * 差异：不做 transform:scale——本体 puppeteer 直接截 #container（puppeteer.js:189），
 * 高清由 deviceScaleFactor 交给浏览器，缩放写进 DOM 会让截图尺寸算错。
 */
import type { ReactNode } from "react"
import type { Palette } from "../theme.js"
import { FRAME_LOGO, PLUGIN_LOGO, imageDataUri } from "../assets.js"
import { frameLabel, releaseType } from "../env.js"
import { textWidth } from "../metrics.js"

/** 背景装饰层：光斑、噪点、气氛大字、角落点缀 */
export function Backdrop({ word, ghostTop }: { word: string; ghostTop?: number }) {
  return (
    <>
      <div className="bg">
        <div className="glow glow-1" />
        <div className="glow glow-2" />
        <div className="glow glow-3" />
      </div>

      {/* 噪点：SVG feTurbulence，思路取自 kkk tokens.md
          baseFrequency 用 0.3 而不是 kkk 的 0.8：kkk 输出 png，颗粒多细都不涨体积；
          我们出 jpeg，接近逐像素的高频颗粒正好是 DCT 最压不动的东西——0.8 配
          discrete「0 1」的硬二值化，帮助页光噪点就要吃掉 1.4MB。0.3 的颗粒更粗、
          肉眼几乎看不出差别，但给了编码器可压的低频结构。
          同理去掉 feComponentTransfer 的二值量化，保留灰度渐变颗粒。 */}
      <div className="noise">
        <svg xmlns="http://www.w3.org/2000/svg">
          <filter id="n" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.3" numOctaves={1} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#n)" />
        </svg>
      </div>

      {/* ghostTop 由页面给：默认 560px 是按「标题区 + 概览统计条」量出来的，
          落在统计条下方的列表区。关于页多了一张 hero 卡，内容整体下移约 260px，
          用默认值大字就正好压在统计卡与前两行 kv 上（styles.ts 里记的就是这个毛病）。
          所以位置跟着版式走，不写死。 */}
      <div className="ghost" style={ghostTop ? { top: ghostTop } : undefined}>
        {word}
      </div>

      {/* 9 个点，3 列 × 3 行：与右上角的 3 条刻度线行数相同，两块高度也几乎相等
          （点阵 3×5 + 2×7 = 29px，刻度 3×4 + 2×4 = 20px，见 styles.ts 的对称说明）。
          之前是 3 列 × 2 行，只有两行、高 17px，与右边三条线一眼就不对称。
          整块止于 y≈69，徽标那行从 y=72 起——仍在徽标上方，不会挤到状态灯。 */}
      <div className="dots">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      {/* 固定宽度而非随机：随机值会让每次截图产生无意义的像素差异。
          最长 72px 而不是 128px：左边点阵只有 29px 宽，右边拖一条 128px 的长线，
          两个角落的分量差了四倍，就是「不对称」的来源。收到 72px 后两块的
          视觉体量接近，仍保持右侧「由长到短」的方向感。 */}
      <div className="ticks">
        {[72, 52, 32].map(w => (
          <i key={w} style={{ width: w }} />
        ))}
      </div>
      <div className="stripes" />
    </>
  )
}

/** 顶部标题区 */
export function Header({
  title,
  status,
  led = "on",
  rightKey,
  rightValue,
}: {
  title: string
  status: string
  led?: "on" | "off" | "warn"
  rightKey: string
  rightValue: string
}) {
  return (
    <div className="head">
      <div className="head-l">
        <div className="badge">
          <span className={led === "on" ? "led" : `led ${led}`} />
          <span className="mono">{status}</span>
        </div>
        <h1 className="title">{title}</h1>
      </div>
      <div className="head-r">
        <div className="k">{rightKey}</div>
        <div className="v">{rightValue}</div>
      </div>
    </div>
  )
}

/**
 * 页脚水印布局常量
 *
 * 用于反推「整条水印能不能放进一行」，几何与 styles.ts 的 .foot 规则一一对应，
 * 改那边的尺寸要同步改这里。
 */
const FOOT = {
  /** 画布内容宽 = 1440 - .foot 的左右 padding 72×2 */
  width: 1296,
  /** 图标边长，两侧各一个 */
  icon: 80,
  /** 图标与文字块的间距（.foot .side 的 gap） */
  iconGap: 20,
  /** 水印内各块之间的间距（.foot .wm 的 gap） */
  blockGap: 32,
  /** 分隔竖线宽度 */
  sep: 3,
  /** 上排小字字号与字距 */
  capSize: 19,
  capTrack: 0.2,
  /** 下排大字字号与字距 */
  nameSize: 38,
  nameTrack: -0.01,
  /** 框架版本小字字号 */
  smallSize: 24,
  /**
   * 最小缩放比
   *
   * 0.62 下大字是 23.6px、小字 11.8px —— 已经很小，但仍比换行好看。
   * 触发它需要极长的版本串（40 字符以上），正常的 git describe 到不了。
   */
  minScale: 0.62,
}

/**
 * 页脚水印：插件图标 + 插件名/版本 ｜ 框架图标 + POWER BY 框架名/版本
 *
 * 版式照 karin-plugin-kkk 的 DefaultLayout：居中一排，左半是插件、右半是框架，
 * 中间一根竖线分隔，两侧各自「图标 + 上小字 + 下大字」。它那边左边用一个内联
 * SVG 当插件标、右边用 /image/frame-logo.png 当框架标，本插件两边都有位图
 * （logo.png 与 frame-logo.png），所以统一走 <img>。
 *
 * 为什么要自己算字号
 * ------------------
 * 这一排必须是一行。原来靠 flex-wrap 兜底，结果 main 分支上版本号是
 * `v2.1.0-2-gc6522ee-dirty`（23 字符），整条水印宽度超出画布，框架半边被挤到
 * 第二行，「插件 ｜ 框架」的并列关系断掉了。
 *
 * 改成 nowrap 之后不能只是禁止换行——那样会溢出被 #container 的 overflow:hidden
 * 裁掉，比换行更糟。所以在 SSR 阶段估一遍总宽（metrics.ts），超了就整体等比缩小，
 * 由 CSS 变量 --fs 统一作用到所有字号，各块的比例关系不变。
 *
 * 与 kkk 的差异
 * -------------
 * 1. 不做隐写。kkk 还往像素里埋了一串 Restore ID（@ikenxuan/watermark + sharp），
 *    本插件不引这两个依赖：sharp 带原生二进制，为一行署名装它不划算，而且
 *    隐写信息用户看不见，起不到「这张图是谁生成的」的作用。
 * 2. 不显示构建工具（Vite/Rolldown）标。那是 kkk 构建期打包的产物，本插件是
 *    运行时 SSR，没有对应的东西可署。
 *
 * 版本号旁的 Stable/Preview 取自 env.ts 的 releaseType：预览版用 warning 色，
 * 让「这不是发布版本」在图上一眼可见。
 */
export function Footer({
  name,
  version,
  lines,
  palette,
  frame = frameLabel(),
  frameLogo = imageDataUri(FRAME_LOGO),
  logo = imageDataUri(PLUGIN_LOGO),
}: {
  name: string
  version: string
  lines: string[]
  palette: Palette
  /**
   * 框架名 + 版本，如 Miao-Yunzai v3.1.3
   *
   * 默认值直接在组件里探测，而不是让各页面从 pages.ts 传进来：
   * 角标对每个页面都一样，走 props 就得同时改几份 data 接口和几处调用，
   * 加一个新页面还容易漏掉署名。组件只在 Node 里做 SSR（没有 hydrate），
   * 读进程信息和文件系统是安全的。留着 props 是为了单测能注入固定值。
   */
  frame?: string
  /** 框架图标的 data URI，空串则只显示文字 */
  frameLogo?: string
  /** 插件图标的 data URI，空串则只显示文字 */
  logo?: string
}) {
  const p = palette
  const rt = releaseType()
  // 非正式版用 warning 色，正式版跟随前景色
  const verColor = rt === "Stable" ? p.foreground : p.warning
  const rtCap = rt === "Stable" ? "✓ STABLE" : rt === "Dev" ? "⚙ DEV" : "⚠ PREVIEW"
  // 框架名与版本分开显示：Miao-Yunzai v3.1.3 -> ["Miao-Yunzai", "3.1.3"]
  const m = /^(.*?)\s+v([\d.].*)$/.exec(frame)
  const frameNm = m ? m[1] : frame
  const frameVer = m ? m[2] : ""

  // ---- 一行放不下就整体缩小 ----
  // 每块的宽度取「上排小字」与「下排大字」的较大者，三块加上图标与间距即总宽。
  const cap = (t: string) => textWidth(t, FOOT.capSize, FOOT.capTrack)
  const nm = (t: string) => textWidth(t, FOOT.nameSize, FOOT.nameTrack)

  const wPlugin = Math.max(cap("PLUGIN"), nm(name))
  const wVer = Math.max(cap(rtCap), nm(version))
  const wFrame = Math.max(
    cap("POWER BY"),
    nm(frameNm) + (frameVer ? textWidth(` v${frameVer}`, FOOT.smallSize) : 0),
  )

  // 固定开销：两个图标 + 各自与文字的间距 + 分隔线 + 三道块间距
  const fixed = (FOOT.icon + FOOT.iconGap) * 2 + FOOT.sep + FOOT.blockGap * 3
  const need = fixed + wPlugin + wVer + wFrame
  const scale =
    need <= FOOT.width ? 1 : Math.max(FOOT.minScale, (FOOT.width - fixed) / (need - fixed))

  return (
    <div className="foot">
      {/* --fs 由 styles.ts 里所有页脚字号乘上，scale=1 时等价于原来的写死值 */}
      <div className="wm" style={scale < 1 ? ({ "--fs": scale } as React.CSSProperties) : undefined}>
        {/* 插件半边。ico-plugin 见 styles.ts：logo.png 自带留白，要放大补偿 */}
        <div className="side">
          {logo && (
            <span className="ico ico-plugin">
              <img src={logo} alt="" />
            </span>
          )}
          <div className="txt">
            <div className="cap mono">PLUGIN</div>
            <div className="nm">{name}</div>
          </div>
        </div>

        {/* 版本号 + 发布类型 */}
        <div className="ver">
          <div className="cap mono" style={{ color: verColor }}>
            {rtCap}
          </div>
          <div className="num" style={{ color: verColor }}>
            {version}
          </div>
        </div>

        <div className="sep" />

        {/* 框架半边 */}
        <div className="side">
          {frameLogo && (
            <span className="ico ico-frame">
              <img src={frameLogo} alt="" />
            </span>
          )}
          <div className="txt">
            <div className="cap mono">POWER BY</div>
            <div className="nm">
              {frameNm}
              {frameVer && <small className="mono"> v{frameVer}</small>}
            </div>
          </div>
        </div>
      </div>

      {/* 时间戳与提示：kkk 把这类信息放在正文末尾，本插件几个页面都靠页脚给，
          所以留一行居中小字，与上面的水印分层 */}
      {lines.length > 0 && (
        <div className="sub mono">
          {lines.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}


/** 一整页 */
export function Page({
  // 下划线前缀：配色目前全靠 CSS 变量与各组件自己取，骨架本身用不到。
  // 但四个页面都按 <Page palette={p}> 调用，删掉这个 prop 要改四处调用，
  // 而将来给骨架加个按调色板取色的元素又得原样加回来，所以保留形参、
  // 用 eslint 约定的 _ 前缀说明「有意不用」。
  palette: _palette,
  word,
  ghostTop,
  children,
}: {
  palette: Palette
  word: string
  /** 气氛大字的起点，默认见 styles.ts 的 .ghost */
  ghostTop?: number
  children: ReactNode
}) {
  return (
    <>
      <Backdrop word={word} ghostTop={ghostTop} />
      <div className="page">{children}</div>
    </>
  )
}
