/**
 * @description 画布骨架，对应 kkk 的 DefaultLayout：固定宽画布 + 弥散光 + 絮状调制 + 角落装饰
 * 注意：不做 transform:scale —— 本体 puppeteer 直接截 #container，缩放写进 DOM 会让截图尺寸算错。
 */
import type { ReactNode } from "react"
import type { Palette } from "../theme"
import { FRAME_LOGO, PLUGIN_LOGO, imageDataUri } from "../assets"
import { frameLabel, releaseType } from "../env"
import { textWidth } from "../metrics"

/**
 * @description 液态玻璃卡面：面 + 边 + 厚度三件套，全套卡片共用
 * 面=竖向渐变 .52→.24 的白（体积感 + 透出弥散光）；边=两条反向 1px 内阴影代替 border（border 四边只能同色，玻璃边需一半亮一半暗）；厚度=顶部 28px 内发光 + 外投影。抽成常量共用避免五处漂移（classes.test.mjs 只查类是否定义，查不出材质不一致）。
 * 注意：底端停在 .24 —— 按 test/glassink.mjs 实测 .17 档最暗单像素 4.41 掉出正文 4.5，.24 为 4.63。
 * 注意：Tailwind 扫的是 components/*.tsx 的正则级候选，本文件在扫描内；别把这串取值挪去 theme.ts 等不被扫的文件，否则规则被静默丢掉。
 */
export const GLASS =
  "[background:linear-gradient(180deg,rgba(255,255,255,.52),rgba(255,255,255,.33)_44%,rgba(255,255,255,.24))] [box-shadow:inset_1px_1px_0_rgba(255,255,255,.95),inset_-1px_-1px_0_var(--border),inset_0_28px_40px_-32px_rgba(255,255,255,.95),0_16px_36px_-22px_rgba(16,26,40,.20)]"

/**
 * @description 无方向性边的玻璃：给自带描边的卡用（目前只有空态卡）
 * 只取面与厚度、边交给虚线本身：虚线描边与受光白线叠在同一像素会读成脏边。
 */
export const GLASS_SOFT =
  "[background:linear-gradient(180deg,rgba(255,255,255,.52),rgba(255,255,255,.33)_44%,rgba(255,255,255,.24))] [box-shadow:inset_0_28px_40px_-32px_rgba(255,255,255,.95),0_16px_36px_-22px_rgba(16,26,40,.20)]"

/** @description 背景装饰层：弥散光、絮状调制、暗角、气氛大字、角落点缀 */
export function Backdrop({ word, ghostTop }: { word: string; ghostTop?: number }) {
  return (
    <>
      {/*
       * 弥散光：五团大色斑互相咬合，半径放大到超出画布只留中段过渡；尺寸/位置/旋转刻意各不相同，等距等大会像图案。取值与理由见 theme.ts 的 glow。
       * 注意：别加回 CSS 模糊。--disable-gpu 起的 Chromium 下模糊全走 CPU、滤镜区按 3σ 外扩，五团约 5000 万像素，实测帮助页有模糊 5090ms、无模糊 1530ms，而逐像素比对平均只差 1.93/255、p99 差 8，看不出。这层无高频（radial-gradient 到 66~74% 已收干），缩盒子再 scale 回去（k=2/3/4/6）也省不了，Chromium 按最终设备尺度光栅化。
       * 注意：用 rounded-[9999px] 而非 rounded-full —— 后者是 calc(infinity*1px)，算出来 3.35544e+07px。
       */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute top-[-420px] left-[-320px] h-[1680px] w-[1560px] rounded-[9999px] [transform:rotate(-18deg)] [background:radial-gradient(ellipse_at_42%_38%,var(--glow-1)_0%,transparent_68%)]" />
        <div className="absolute top-[260px] right-[-380px] h-[1560px] w-[1320px] rounded-[9999px] [transform:rotate(22deg)] [background:radial-gradient(ellipse_at_52%_48%,var(--glow-2)_0%,transparent_66%)]" />
        <div className="absolute bottom-[-460px] left-[80px] h-[1380px] w-[1500px] rounded-[9999px] [transform:rotate(-8deg)] [background:radial-gradient(ellipse_at_48%_56%,var(--glow-3)_0%,transparent_70%)]" />
        <div className="absolute top-[820px] left-[-260px] h-[1140px] w-[1040px] rounded-[9999px] [transform:rotate(34deg)] [background:radial-gradient(ellipse_at_46%_50%,var(--glow-4)_0%,transparent_72%)]" />
        <div className="absolute top-[-160px] right-[-200px] h-[1020px] w-[1180px] rounded-[9999px] [transform:rotate(-26deg)] [background:radial-gradient(ellipse_at_54%_44%,var(--glow-5)_0%,transparent_74%)]" />
      </div>

      {/*
       * 絮状调制：极低频一层，专治「纯渐变像塑料」。关键在频率不在噪声：旧层 baseFrequency 0.1（周期约 10px）配 feSpecularLighting，1~2px 锐白点与字笔画抢像素读作雪花，且 jpeg DCT 最压不动中间调 + 高频锐噪，独吃七八成体积。这里只留 0.009（周期约 110px）fractalNoise、不加镜面光照，低频对 DCT 友好几乎不涨体积。feColorMatrix 把亮度搬进 alpha 压低（0.16 斜率 + 负偏置），只提亮不压暗，不吃正文对比度。
       * 注意：opacity 别往上抬，一旦看得出颗粒就回到旧问题。
       */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-[.5] [mix-blend-mode:soft-light]">
        <svg className="size-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="fl" x="0%" y="0%" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.009"
                numOctaves={3}
                seed={17}
                result="n"
              />
              <feColorMatrix in="n" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .16 .16 .16 0 -.04" />
            </filter>
          </defs>
          {/* rect 用绝对高度而不是 100%：页面高度由内容决定，svg 拿不到确定参照 */}
          <rect width="1440" height="6000" filter="url(#fl)" />
        </svg>
      </div>

      {/*
       * 暗角：一道很轻的径向暗角把发飘的四角收个口。
       * 注意：用 --fg 而非写死黑 —— COOL 前景 #0f1720（偏蓝），纯黑压在银灰底上显脏。
       * 注意：42% 起收、.085 收尾（58% + .055 收不住四角）；再往内会压到统计条正文，inkprobe 会先报出来。
       */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-[.085] [background:radial-gradient(ellipse_at_50%_40%,transparent_42%,var(--fg)_100%)]" />

      {/*
       * 竖排气氛大字：top 默认 560px 落在统计条下方列表区（更高会压在第四张统计卡背后透出笔画像脏了）；透明度 .028。ghostTop 由页面给（关于页多一张 hero 卡、内容下移约 260px），位置跟版式走不写死。
       */}
      <div
        className="pointer-events-none absolute top-[560px] right-[56px] z-0 text-[200px] font-black leading-none tracking-[-.04em] opacity-[.028] [writing-mode:vertical-rl] [text-orientation:mixed]"
        style={ghostTop ? { top: ghostTop } : undefined}
      >
        {word}
      </div>

      {/*
       * 角落装饰：左上点阵与右上刻度线一对要对称。两块退到边缘 40px（48px 时点阵右下角压到徽标 LED），点阵缩 3 列让出徽标横带。几何上点阵 3×3=29px 见方、刻度 3 条=20px 高最长 72px，行数/高度/最长边同量级才配平。列宽用 repeat(3,1fr) 而非 grid-cols-3，理由同 Stats：后者最小值是 0。
       */}
      <div className="absolute top-[40px] left-[40px] z-0 grid [grid-template-columns:repeat(3,1fr)] gap-[7px] opacity-[.16]">
        {Array.from({ length: 9 }, (_, i) => (
          // 老规则 `.dots i` 挂在生成的子元素上，迁移后直接写在 <i> 上
          <i key={i} className="size-[5px] rounded-[9999px] bg-fg" />
        ))}
      </div>
      {/* 固定宽度而非随机：随机值会让每次截图产生无意义像素差异。最长 72px 理由见上面配平 */}
      <div className="absolute top-[40px] right-[40px] z-0 flex flex-col items-end gap-[4px] opacity-[.16]">
        {[72, 52, 32].map(w => (
          <i key={w} className="h-[4px] bg-fg" style={{ width: w }} />
        ))}
      </div>
      {/*
       * 左下角落：一团很淡的辉光（不再是 45° 斜纹）。给左下角一点分量、不然发虚，与五团色斑同一种语言。
       */}
      <div className="pointer-events-none absolute bottom-[-220px] left-[-180px] z-0 h-[720px] w-[860px] rounded-[9999px] opacity-[.5] [background:radial-gradient(ellipse_at_46%_54%,var(--glow-2)_0%,transparent_70%)]" />
    </>
  )
}

/**
 * @description 概览统计条：四张等宽大数字卡
 * 抽成组件供帮助页/状态页/更新日志页共用，避免三处漂移（classes.test.mjs 只查类是否定义，查不出不一致）。
 */
export function Stats({
  items,
  palette,
}: {
  items: { key: string; value: string; sub?: string }[]
  palette: Palette
}) {
  // 注意：列宽用 repeat(4,1fr) 而非 grid-cols-4 —— 后者是 repeat(4,minmax(0,1fr))，最小值钉在 0、四列恒等宽；1fr 最小值是 auto，放不下的列可超出等分。更新日志页那四列实际是 382/162/299/380 而非 306×4，换 minmax(0,1fr) 会压回等分
  return (
    <div className="mb-[72px] grid [grid-template-columns:repeat(4,1fr)] gap-[24px]">
      {items.map((s, i) => (
        /* 四张卡等高（grid 默认 stretch），内部三行 flex 竖排；卡面走 {@link GLASS}。 */
        <div
          className={`flex flex-col gap-[10px] rounded-[22px] px-[26px] py-[24px] ${GLASS}`}
          key={i}
        >
          {/* 三行字号 16 / 52 / 18（原 19/60/21：19 与 21 几乎同级层级读不出，60 跳太远） */}
          <div className="font-mono text-[16px] font-extrabold uppercase leading-[1.3] tracking-[.16em] text-muted">
            {s.key}
          </div>
          {/*
           * 大数字渐变点缀：四张卡各取 spectrum 一档。渐变字须 background-clip:text + 透明字色；用内联 style 而非 utility 因颜色来自运行时 Palette、编译期拿不到值。tabular-nums 让数字宽度一致，不因 1 比 8 窄而歪。
           */}
          <div
            className="text-[52px] font-black leading-[1.05] tracking-[-.02em] [font-variant-numeric:tabular-nums]"
            style={{
              backgroundImage: `linear-gradient(135deg, ${
                palette.spectrum[i % palette.spectrum.length]
              }, ${palette.spectrum[(i + 1) % palette.spectrum.length]})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {s.value}
          </div>
          {/* mt-auto 贴底：某张卡没有 sub 时，其余三张的数值也不会错位 */}
          {s.sub && <div className="mt-auto text-[18px] leading-[1.4] text-muted">{s.sub}</div>}
        </div>
      ))}
    </div>
  )
}

/**
 * @description 分节标题：圆点 + 文字 + 一条向右淡出的渐变线
 * 关于页与状态页共用；渐变线与圆点颜色来自运行时轮换色走内联 style，组件只定形。
 */
export function Section({
  title,
  color,
  right,
}: {
  title: string
  color: string
  /** 标题右侧的次级信息，如版本号与日期 */
  right?: ReactNode
}) {
  return (
    <div className="mb-[36px] flex items-center gap-[16px]">
      <span className="size-[11px] flex-none rounded-[9999px]" style={{ background: color }} />
      <span className="text-[26px] font-extrabold leading-none tracking-[.16em] text-muted">
        {title}
      </span>
      {right && (
        // 比标题再轻一档
        <span className="flex-none font-mono text-[22px] font-bold leading-none opacity-80 text-muted">
          {right}
        </span>
      )}
      {/* max-w 让线不至于在窄标题下拉满整宽，opacity 让渐变末端更柔 */}
      <span
        className="h-[3px] max-w-[220px] flex-1 rounded-[9999px] opacity-[.55]"
        style={{ background: `linear-gradient(90deg,${color},transparent)` }}
      />
    </div>
  )
}

/**
 * @description 空态卡：状态页「暂无连接」、更新日志页「已是最新」
 * 虚线描边是语义标记（「这里本该有东西」）保留着。卡面走 {@link GLASS_SOFT} 而非 GLASS：虚线与受光白线叠在同一像素会读成脏边。whitespace-pre-line 保留提示文案的 \n 分段。
 */
export function Empty({ title, tip }: { title: string; tip: string }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-[16px] rounded-[32px] border border-dashed border-border px-[80px] py-[96px] text-center ${GLASS_SOFT}`}
    >
      <div className="text-[44px] font-black leading-[1.2]">{title}</div>
      {/* break-keep：提示里嵌着 #早柚设置适配器开启 这类指令，不能在字间劈开 */}
      <div className="text-[26px] leading-[1.7] whitespace-pre-line break-words break-keep text-muted">
        {tip}
      </div>
    </div>
  )
}

/**
 * @description 提示条：fetch 失败等非致命情况用它说明，不占用空态位置
 * 左侧粗边当色标，颜色由调用方按语义色内联给（border-l-[6px] 只定宽，四边的颜色仍走内联的 borderColor）。
 */
export function Notice({ text, color }: { text: string; color: string }) {
  return (
    <div
      className="mb-[44px] rounded-[24px] border border-l-[6px] px-[32px] py-[26px] text-[25px] leading-[1.65] break-words break-keep"
      style={{ color, background: `${color}14`, borderColor: `${color}3d` }}
    >
      {text}
    </div>
  )
}

/** @description 顶部标题区 */
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
    // border-b-border 而不是 border-border：老规则只给 border-bottom 上色，其余三边仍是 reset 的 currentColor
    <div className="mb-[72px] flex items-end justify-between border-b-4 border-b-border pb-[32px]">
      {/* gap 22px：徽标与 104px 的巨型标题之间原来只隔 10px，上面又压着角落点阵 */}
      <div className="flex flex-col gap-[22px]">
        {/* pl-[4px]：只给很小的内缩，让 LED 离开角落装饰的视觉范围，标题仍与它左对齐 */}
        <div className="flex items-center gap-[14px] pl-[4px] opacity-70">
          {/*
           * 注意：字号字距与 text-muted 要写在这颗无文字圆点上 —— 老规则 `.badge span` 命中两个 span，圆点也拿到 20px/.22em/700 与 muted；letter-spacing 在行内盒右侧留一个字距空位，删掉徽标整宽会变；color 不写就从 #container 继承 fg。光晕走任意属性而非 shadow-*（复合属性即使一层也展开成一长串）。
           * 注意：这里刻意不把那个写法原样抄进注释 —— 扫描器是正则级别的，会把注释里带方括号的片段也当候选。
           */}
          <span
            className={`size-[10px] flex-none rounded-[9999px] text-[20px] font-bold uppercase leading-none tracking-[.22em] text-muted ${
              led === "off"
                ? "bg-muted"
                : led === "warn"
                  ? "bg-warning [box-shadow:0_0_12px_var(--warning)]"
                  : "bg-success [box-shadow:0_0_12px_var(--success)]"
            }`}
          />
          <span className="font-mono text-[20px] font-bold uppercase leading-none tracking-[.22em] text-muted">
            {status}
          </span>
        </div>
        {/* 没引 preflight，h1 仍带浏览器默认字号字重，字号字重必须显式写出 */}
        <h1 className="text-[104px] font-black leading-[.95] tracking-[-.045em]">{title}</h1>
      </div>
      {/* 与左侧巨型标题的基线对齐靠父级的 items-end，这里只保证两行自身紧凑 */}
      <div className="flex flex-col gap-[8px] pb-[8px] text-right">
        <div className="text-[19px] font-extrabold uppercase leading-none tracking-[.2em] text-muted">
          {rightKey}
        </div>
        <div className="text-[34px] font-extrabold leading-[1.1]">{rightValue}</div>
      </div>
    </div>
  )
}

/**
 * @description 页脚水印布局常量，用于反推「整条水印能不能放进一行」
 * 注意：几何与 styles/frame.ts 的 .foot 规则一一对应，改那边的尺寸要同步改这里。
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
  /** 最小缩放比。0.62 下大字 23.6px，已经很小但仍比换行好看；触发它需要 40 字符以上的版本串 */
  minScale: 0.62,
}

/**
 * @description 页脚水印：插件图标 + 插件名/版本 ｜ 框架图标 + POWER BY 框架名/版本
 * 版式照 kkk 的 DefaultLayout，居中一排竖线分隔。必须一行，故 SSR 阶段估总宽（metrics.ts），超了靠 CSS 变量 --fs 整体等比缩小：flex-wrap 会把框架半边甩到第二行断掉并列，禁止换行则溢出被 overflow:hidden 裁掉，都更糟。版本旁 Stable/Preview 取自 env.ts 的 releaseType，预览版用 warning 色。不做 kkk 的像素隐写（要 sharp 原生二进制且用户看不见），也不显示构建工具标（本插件运行时 SSR）。
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
   * 默认值在组件里探测而非各页面传入（角标每页都一样，走 props 要改多份 data 接口且加页易漏署名；组件只在 Node SSR，读进程/文件系统安全）。留着 props 是为单测注入固定值。
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
    <div className="relative z-10 flex flex-col items-center gap-[26px] px-[72px] pt-0 pb-[64px]">
      {/* --fs 由下面所有页脚字号乘上，scale=1 时等价于原来的写死值；nowrap 与等比缩字号的理由见组件头 */}
      <div
        className="flex max-w-full flex-nowrap items-center justify-center gap-[32px] whitespace-nowrap [--fs:1]"
        style={scale < 1 ? ({ "--fs": scale } as React.CSSProperties) : undefined}
      >
        {/* 插件半边：图标 + 两行文字，items-center 让图标对齐文字块中线 */}
        <div className="flex min-w-0 items-center gap-[20px]">
          {logo && (
            /*
             * 图标：外层 span 定框，内层 img 决定字形实际大小。logo.webp 字形只占画幅 70.7%、frame-logo.webp 是满幅图，同样内缩时早柚字形只 42px、云崽 60px（「适配器图标偏小」的来源），故让 img 溢出框 112% 顶出留白（字形 ≈ 63px）、overflow-hidden 裁掉。不给底色描边：logo.webp 透明底，加淡底 + 边框会成两个方块罩在字形外；圆角留着只为裁剪溢出。
             */
            <span className="flex size-[80px] flex-none items-center justify-center overflow-hidden rounded-[20px]">
              <img className="block size-[112%] object-contain" src={logo} alt="" />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-[7px]">
            {/* 上排小字（PLUGIN / POWER BY）：字距拉开，与下排的粗名字分层 */}
            <div className="font-mono text-[calc(19px*var(--fs))] font-extrabold uppercase leading-none tracking-[.2em] text-muted">
              PLUGIN
            </div>
            <div className="text-[calc(38px*var(--fs))] font-black leading-none tracking-[-.01em]">
              {name}
            </div>
          </div>
        </div>

        {/* 版本号块：与两侧的名字同高，靠 leading-none 对齐 */}
        <div className="flex min-w-0 flex-col gap-[7px]">
          <div
            className="font-mono text-[calc(19px*var(--fs))] font-extrabold uppercase leading-none tracking-[.2em]"
            style={{ color: verColor }}
          >
            {rtCap}
          </div>
          <div
            className="text-[calc(38px*var(--fs))] font-black leading-none tracking-[-.01em] [font-variant-numeric:tabular-nums]"
            style={{ color: verColor }}
          >
            {version}
          </div>
        </div>

        {/* 分隔竖线：高度取文字块高度（19 + 7 + 38 = 64），略收到 56 留出呼吸 */}
        <div className="h-[56px] w-[3px] flex-none rounded-[9999px] bg-border" />

        {/* 框架半边 */}
        <div className="flex min-w-0 items-center gap-[20px]">
          {frameLogo && (
            /* 满幅图内缩 8px，字形 = 80 - 16 = 64px，与左边 63px 相当。frame-logo 自带白底本就是方块，不需再补边框 */
            <span className="flex size-[80px] flex-none items-center justify-center overflow-hidden rounded-[20px]">
              <img className="block size-full p-[8px] object-contain" src={frameLogo} alt="" />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-[7px]">
            <div className="font-mono text-[calc(19px*var(--fs))] font-extrabold uppercase leading-none tracking-[.2em] text-muted">
              POWER BY
            </div>
            <div className="text-[calc(38px*var(--fs))] font-black leading-none tracking-[-.01em]">
              {frameNm}
              {/* 框架版本跟在框架名后面，小一档并压低不透明度 */}
              {frameVer && (
                <small className="font-mono text-[calc(24px*var(--fs))] font-bold tracking-normal text-muted">
                  {" "}
                  v{frameVer}
                </small>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 时间戳与提示：几个页面都靠页脚给，所以留一行居中小字，与上面的水印分层 */}
      {lines.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-[28px] font-mono text-[20px] leading-[1.5] opacity-75 text-muted">
          {lines.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * @description 一整页
 * 注意：不收 palette。背景颜色全走 cssVars 下发的自定义属性，骨架不碰任何字面量色值；别为「以后可能要用」把这个 prop 加回来（一个什么都不做的 prop 会让人以为骨架外观能按调色板变）。
 */
export function Page({
  word,
  ghostTop,
  children,
}: {
  word: string
  /** 气氛大字的起点，默认见 styles/backdrop.ts 的 .ghost */
  ghostTop?: number
  children: ReactNode
}) {
  return (
    <>
      <Backdrop word={word} ghostTop={ghostTop} />
      <div className="relative z-10 p-[72px]">{children}</div>
    </>
  )
}
