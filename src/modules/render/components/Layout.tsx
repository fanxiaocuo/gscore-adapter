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

/** 背景装饰层：光斑、压花玻璃、气氛大字、角落点缀 */
export function Backdrop({
  word,
  ghostTop,
  gloss,
}: {
  word: string
  ghostTop?: number
  /** 压花高光的强度与混合方式，深浅两套不同 —— 见 theme.ts 的 Palette.gloss */
  gloss: Palette["gloss"]
}) {
  return (
    <>
      {/*
       * 弥散渐变：五团大色斑互相咬合
       *
       * 原来是三团，各自成形、能数出「三个光球」。弥散渐变要的是整片晕染，做法是
       * 多团大半径 radial-gradient 叠加 + 强 blur，让边缘互相吃掉。这里把团数提到
       * 五、半径普遍放大到超出画布（负边距 + 超宽高），并把 blur 拉到 140~190px ——
       * 团边落在画布外，看到的就只有中段的过渡，不会露出球形轮廓。
       *
       * 尺寸/位置/旋转刻意各不相同：等距等大的斑会形成可辨的节奏，反而像图案。
       * 颜色走 var(--glow-n)（base 层下发），深浅两套各自配色见 theme.ts。
       *
       * rounded-[9999px] 而不是 rounded-full：后者是 calc(infinity*1px)，
       * 浏览器算出来是 3.35544e+07px，与老规则的计算值不同。
       */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute top-[-420px] left-[-320px] h-[1680px] w-[1560px] rounded-[9999px] blur-[168px] [transform:rotate(-18deg)] [background:radial-gradient(ellipse_at_42%_38%,var(--glow-1)_0%,transparent_68%)]" />
        <div className="absolute top-[260px] right-[-380px] h-[1560px] w-[1320px] rounded-[9999px] blur-[184px] [transform:rotate(22deg)] [background:radial-gradient(ellipse_at_52%_48%,var(--glow-2)_0%,transparent_66%)]" />
        <div className="absolute bottom-[-460px] left-[80px] h-[1380px] w-[1500px] rounded-[9999px] blur-[176px] [transform:rotate(-8deg)] [background:radial-gradient(ellipse_at_48%_56%,var(--glow-3)_0%,transparent_70%)]" />
        <div className="absolute top-[820px] left-[-260px] h-[1140px] w-[1040px] rounded-[9999px] blur-[152px] [transform:rotate(34deg)] [background:radial-gradient(ellipse_at_46%_50%,var(--glow-4)_0%,transparent_72%)]" />
        <div className="absolute top-[-160px] right-[-200px] h-[1020px] w-[1180px] rounded-[9999px] blur-[144px] [transform:rotate(-26deg)] [background:radial-gradient(ellipse_at_54%_44%,var(--glow-5)_0%,transparent_74%)]" />
      </div>

      {/* 噪点：SVG feTurbulence，思路取自 kkk tokens.md
          baseFrequency 用 0.3 而不是 kkk 的 0.8：kkk 输出 png，颗粒多细都不涨体积；
          我们出 jpeg，接近逐像素的高频颗粒正好是 DCT 最压不动的东西——0.8 配
          discrete「0 1」的硬二值化，帮助页光噪点就要吃掉 1.4MB。0.3 的颗粒更粗、
          肉眼几乎看不出差别，但给了编码器可压的低频结构。
          同理去掉 feComponentTransfer 的二值量化，保留灰度渐变颗粒。

          opacity 从 .04 提到 .07：弥散渐变铺开后大片区域是纯粹的平滑过渡，颗粒感
          正是让它不显廉价的那一层。只动透明度不动 baseFrequency —— 频率是体积的
          主因，透明度只改对比度。三档都实测过（temp/shots 下的 jpeg，quality 88）：

            .04  help-dark 415KB  help-light 363KB   原值
            .07  help-dark 495KB  help-light 396KB   +19% / +9%
            .10  help-dark 561KB  help-light 435KB   +35% / +20%

          停在 .07：.10 的颗粒在 1440px 宽度下肉眼已经和 .07 分不出，却多付 66KB。
          三档都远低于 baseFrequency 0.8 那次的 1.4MB —— 再次印证频率才是体积主因。 */}
      {/*
       * 压花玻璃：折射 + 镜面高光，取代原来那层平铺噪点
       *
       * 原来这里只有一层 opacity .07 的灰度 feTurbulence 颗粒。颗粒能去掉「大片
       * 纯渐变显廉价」，但它是平的 —— 画面仍然读作「一张有噪点的渐变图」。
       * 参考图（浴室压花玻璃）的质感来自两件事，缺一不可：
       *
       *   折射  底下的色斑被玻璃的起伏推歪 —— 「看不清后面」就是这么来的
       *   高光  表面朝光的坡面反白 —— 那些短促的白色鳞片
       *
       * 尺度是关键，试了三轮才对（temp/proto/glass-test{,2,3}.html 留着比对）：
       * baseFrequency 0.3 时周期只有 3px，渲出来是砂纸不是压花；参考图的起伏
       * 周期在 10~30px，对应折射 0.02、高光 0.1。
       *
       * 高光还要再乘一张大尺度噪声当 mask（bf 0.008，周期约 125px）：参考图的
       * 鳞片有疏有密，均匀铺满就成了磨砂玻璃，那是另一种材质。
       *
       * 关于体积：这两层比原来的颗粒层贵（低频结构少、DCT 更难压），但换来的是
       * 材质而不是修饰，值这个代价。实测见下面渲染后的 jpeg 尺寸。
       *
       * mask 必须和它的使用者在同一个 <svg> 里
       * ---------------------------------
       * filter 的 region 相对被应用元素算，所以 #refract 放在 0×0 的 svg 里跨引用
       * 没问题。mask 不一样：mask 内容里的 100% 相对它所在的 svg 视口，放进 0×0
       * 的 svg 就等于 0，整个高光层会被遮光遮掉（第一次落地时踩过，DOM 与 filter
       * 全都在，屏幕上什么都没有）。所以 mask 与高光滤镜都留在这个 svg 内。
       * 同理 rect 用绝对高度而不是 100%：页面高度由内容决定，svg 拿不到确定参照。
       */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <svg className="size-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="gm" x="0%" y="0%" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.008"
                numOctaves={2}
                seed={21}
                result="n"
              />
              {/* 把噪声的亮度搬进 alpha：亮处高光留、暗处高光被吃掉 */}
              <feColorMatrix in="n" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.9 0.9 0.9 0 -0.25" />
            </filter>
            <filter id="gl" x="0%" y="0%" width="100%" height="100%">
              {/* type=turbulence 而不是 fractalNoise：前者的短促笔画更像压花的鳞片 */}
              <feTurbulence
                type="turbulence"
                baseFrequency="0.1"
                numOctaves={2}
                seed={9}
                result="n"
              />
              <feSpecularLighting
                in="n"
                lightingColor="#fff"
                surfaceScale={4.4}
                specularConstant={1.5}
                specularExponent={15}
                result="s"
              >
                <feDistantLight azimuth={228} elevation={54} />
              </feSpecularLighting>
              {/*
               * 只留高光自己的 alpha，否则滤镜区域会带一层黑底。
               *
               * 这里刻意不接 feGaussianBlur
               * -----------------------
               * 出图是 jpeg，这层锐利噪声确实贵（help-dark 从 495KB 涨到约 900KB）。
               * 试过三档省体积的改法，全部否掉：
               *
               *   bf 0.1→0.05 + blur 0.85   646KB  鳞片被拉成脑珊瑚那样的虫状纹
               *   bf 0.1→0.07 + blur 0.55   900KB  介于两者之间，仍偏糊
               *   1 octave                  ——    细节层没了，只剩一层大波浪
               *
               * 结论：blur 与降频率省下的体积，直接换掉了这层要的东西。压花玻璃的
               * 鳞片必须是锐的，糊了就成磨砂玻璃 —— 那是另一种材质。参数照
               * temp/proto/glass-test3.html 的 Q 档（实测选定的那组）原样落地。
               */}
              <feComposite in="s" in2="s" operator="in" />
            </filter>
            <mask id="gmask">
              <rect width="1440" height="6000" filter="url(#gm)" />
            </mask>
          </defs>
          <g mask="url(#gmask)">
            <rect
              width="1440"
              height="6000"
              filter="url(#gl)"
              style={{ mixBlendMode: gloss.blend, opacity: gloss.opacity }}
            />
          </g>
        </svg>
      </div>

      {/*
       * 竖排气氛大字
       *
       * top 默认 560px：概览统计条占 309~500px，起点更高的话大字正好压在第四张卡
       * （TRACKING / origin/main）背后，字面笔画透过半透明卡片显出来，像脏了。
       * 560px 起落在统计条下方的列表区，那里行高一致、底色均匀。
       * 透明度压到 .028——列表卡片比统计卡更透，同样的 .035 在这里更显眼。
       *
       * ghostTop 由页面给：关于页多了一张 hero 卡，内容整体下移约 260px，
       * 用默认值大字就正好压在统计卡与前两行 kv 上。所以位置跟着版式走，不写死。
       * top-[560px] 只是兜底，给了 ghostTop 就被内联 top 覆盖。
       */}
      <div
        className="pointer-events-none absolute top-[560px] right-[56px] z-0 text-[200px] font-black leading-none tracking-[-.04em] opacity-[.028] [writing-mode:vertical-rl] [text-orientation:mixed]"
        style={ghostTop ? { top: ghostTop } : undefined}
      >
        {word}
      </div>

      {/*
       * 角落装饰：左上点阵与右上刻度线是一对，要对称
       *
       * left/top 与 .page 的 72px padding 拉开：原来放在 48px，点阵右下角正好压到
       * 徽标那颗 LED 上（点阵止于 y=68，徽标起于 y=72，只差 4px），看着像挤在一起。
       * 现在整体退到画布边缘 40px 处、并把点阵缩到 3 列，让出徽标所在的横带。
       *
       * 两块的几何对齐：点阵 3 列 × 3 行 = 3×5 + 2×7 = 29px 见方；
       * 刻度 3 条 = 3×4 + 2×4 = 20px 高，最长 72px。行数相同、高度接近、
       * 最长边同量级，两个角落才配平。曾经是点阵 2 行（17px 高）配 128px 的长刻度线，
       * 右边分量重出四倍。
       *
       * 列宽仍用 repeat(3,1fr) 而不是 grid-cols-3，理由同 Stats：后者的最小值是 0。
       */}
      <div className="absolute top-[40px] left-[40px] z-0 grid [grid-template-columns:repeat(3,1fr)] gap-[7px] opacity-[.16]">
        {Array.from({ length: 9 }, (_, i) => (
          // 老规则是 `.dots i`，样式挂在生成出来的子元素上，迁移后直接写在 <i> 上
          <i key={i} className="size-[5px] rounded-[9999px] bg-fg" />
        ))}
      </div>
      {/* 固定宽度而非随机：随机值会让每次截图产生无意义的像素差异。
          最长 72px 而不是 128px：左边点阵只有 29px 宽，右边拖一条 128px 的长线，
          两个角落的分量差了四倍，就是「不对称」的来源。收到 72px 后两块的
          视觉体量接近，仍保持右侧「由长到短」的方向感。 */}
      <div className="absolute top-[40px] right-[40px] z-0 flex flex-col items-end gap-[4px] opacity-[.16]">
        {[72, 52, 32].map(w => (
          <i key={w} className="h-[4px] bg-fg" style={{ width: w }} />
        ))}
      </div>
      {/* 左下斜纹：45° 重复渐变，5px 实线接 5px 透明（transparent 的两个位置故意是
          2px 与 10px，不是等分——渐变在 5→2 之间反向，产生一道柔边） */}
      <div className="absolute bottom-0 left-0 z-0 h-[400px] w-[520px] opacity-[.04] [background:repeating-linear-gradient(45deg,var(--fg),var(--fg)_5px,transparent_2px,transparent_10px)]" />
    </>
  )
}

/**
 * 概览统计条：四张等宽大数字卡
 *
 * 帮助页、状态页、更新日志页三处的写法一字不差（含取色规则 rotate[i % len]），
 * 迁移前是 shared.ts 的 .stats/.stat。utility 化之后如果三页各写一遍，那串
 * 二十来个类就要重复三份——改一处漏两处，而 classes.test.mjs 查的是「类有没有
 * 定义」，查不出「三处不一致」。所以这里换成组件：类名只有一份，页面传数据。
 *
 * .k/.v/.s 这种块内元素名也随之消失，不必再靠祖先限定防跨页撞车。
 */
export function Stats({
  items,
  palette,
}: {
  items: { key: string; value: string; sub?: string }[]
  palette: Palette
}) {
  // 列宽用 repeat(4,1fr) 而不是 grid-cols-4：后者编出来是 repeat(4,minmax(0,1fr))，
  // 最小值被钉在 0，四列恒等宽；而 1fr 的最小值是 auto，放不下的列可以超出等分。
  // 四页里只有更新日志页的上排小字够长（NEW COMMITS / LOCAL AHEAD 这类），它那四列
  // 实际是 382/162/299/380 而非 306×4，卡片高度也因此是 220px 而非 191px。换成
  // minmax(0,1fr) 会把那页的统计条压回等分——那是版式改动，不是等价迁移。
  return (
    <div className="mb-[72px] grid [grid-template-columns:repeat(4,1fr)] gap-[24px]">
      {items.map((s, i) => (
        /*
         * 四张卡等高（grid 默认 stretch），内部三行 flex 竖排
         *
         * 卡面从「实心面 + 深色发丝边」换成液态玻璃
         * ------------------------------------
         * 原来是 bg-surface（白 .66~.72）配 border-border 那道 1px 深色发丝边。
         * 问题不在边框粗细，在于这两样合起来把卡片读成了「贴在玻璃上的白塑料板」：
         * 压花玻璃的高光层在 z-0、正文在 z-10，卡片一旦不透，它底下那片起伏的材质
         * 就被整块盖住 —— 出图里这四张卡明显比周围干净、平滑，是整页唯一不像玻璃
         * 的东西。帮助页尤其突兀：其余内容根本没有卡，全部直接压在背景上。
         *
         * 所以三件事一起改：
         *
         *   卡面   竖向渐变 .52 → .24 的白。上亮下暗是玻璃的体积感来源（光从上来），
         *          平均透明度从 .66 降到约 .36，底下的鳞片纹理透得上来。
         *   边     去掉那道深色描边，改成两条方向相反的 1px 内阴影：左上是
         *          rgba(255,255,255,.95) 的受光边，右下是 var(--border) 的背光边。
         *          这就是「玻璃边缘」与「描边」的区别 —— 描边四周同色，玻璃的边
         *          随光向一半亮一半暗，圆角处自然过渡。颜色右下沿用调色板的
         *          border，深浅两套各自跟随。
         *   厚度   顶部一层 28px 的白色内发光（负 spread 收进去）＋ 一层外投影，
         *          前者是光在玻璃体内的漫射，后者让卡片浮起来，替代描边给的定位感。
         *
         * 底端为什么停在 .24 而不是更透
         * -------------------------
         * 卡面变透明会把文字底色往页面背景推。按 test/glassink.mjs 实测（口径同
         * inkprobe：隐掉卡内文字、截真实合成结果、逐像素统计四张卡各自的亮度分布）：
         *
         *          底端 .17                底端 .24
         *   COOL   muted 最暗 4.41  p1 5.57   muted 最暗 4.63  p1 5.82
         *   LIGHT  muted 最暗 4.63  p1 5.71   muted 最暗 4.73  p1 5.83
         *
         * .17 那档第一张卡的**最暗单像素**是 4.41，差 0.09 掉出正文 4.5 —— 虽然按
         * p1（inkprobe 用的分位，避开噪点里那些一两像素的黑斑）有 5.57 的余量，
         * 而且帮助页其余文字本来就直接压在背景上、比任何卡面都糟，但抬 7 个点就能
         * 让最坏单像素也过线，看不出画面差别，没理由不抬。
         *
         * 52px 的大数字走大字 3.0 那条线，四张卡在 p1 上是 4.18~6.33（COOL）与
         * 3.83~6.17（LIGHT），本来就宽裕。
         *
         * 去掉那道描边之后盒子少了 2px（168 → 166px 高）。没有东西依赖这个数，
         * 也没必要塞一圈透明描边硬撑回去 —— 受光边直接落在卡的最外圈，
         * 玻璃本来就该这样。
         */
        <div
          className="flex flex-col gap-[10px] rounded-[22px] px-[26px] py-[24px] [background:linear-gradient(180deg,rgba(255,255,255,.52),rgba(255,255,255,.33)_44%,rgba(255,255,255,.24))] [box-shadow:inset_1px_1px_0_rgba(255,255,255,.95),inset_-1px_-1px_0_var(--border),inset_0_28px_40px_-32px_rgba(255,255,255,.95),0_16px_36px_-22px_rgba(16,26,40,.20)]"
          key={i}
        >
          {/*
           * 三行的字号原先是 19 / 60 / 21：19 与 21 几乎同级、层级读不出来，60 又
           * 跳得太远，于是一位数的卡片右侧空出一大片。收成 16 / 52 / 18 —— 相邻两
           * 级的比值都在 1.1 与 2.9 之间，主次分明，卡片也从 191px 高收到约 168px。
           */}
          <div className="font-mono text-[16px] font-extrabold uppercase leading-[1.3] tracking-[.16em] text-muted">
            {s.key}
          </div>
          {/*
           * 大数字走渐变点缀：四张卡各取 spectrum 的一档，同一条渐变上的连续取样，
           * 比原先三色 rotate 轮换更整体，也是「渐变只用在点缀」的落点之一。
           *
           * 渐变字必须给 background-clip:text + 透明字色。这里用内联 style 而不是
           * utility：颜色来自运行时 Palette，编译期拿不到值。
           *
           * tabular-nums：等宽数字让四张卡的数字宽度一致，不会因 1 比 8 窄而歪。
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
 * 分节标题：圆点 + 文字 + 一条向右淡出的渐变线
 *
 * 关于页的「环境摘要 / 本版变更」与状态页的分组明细都用它。原是 shared.ts 的 .sec
 * （更早叫 .rt-sec，是关于页私有类被状态页借用——改哪边都会波及对方，见 index.ts
 * 顶部记的那三条拆分理由）。做成组件后「借用」这件事在类型上就不成立了。
 *
 * 渐变线与圆点的颜色都来自运行时轮换色，走内联 style；组件只定形。
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
 * 空态卡：状态页「暂无连接」、更新日志页「已是最新」
 *
 * 虚线描边而不是实线——与两页的实线内容卡区分开，一眼能看出「这里本该有东西」。
 * whitespace-pre-line 保留说明里的换行（提示文案带 \n 分段）。
 */
export function Empty({ title, tip }: { title: string; tip: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-[16px] rounded-[32px] border border-dashed border-border bg-surface px-[80px] py-[96px] text-center">
      <div className="text-[44px] font-black leading-[1.2]">{title}</div>
      {/* break-keep：提示里嵌着 #早柚设置适配器开启 这类指令，不能在字间劈开 */}
      <div className="text-[26px] leading-[1.7] whitespace-pre-line break-words break-keep text-muted">
        {tip}
      </div>
    </div>
  )
}

/**
 * 提示条：fetch 失败等非致命情况用它说明，不占用空态位置
 *
 * 左侧粗边当色标，颜色由调用方按语义色内联给（border-l-[6px] 只定宽，
 * 四边的颜色仍走内联的 borderColor）。
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
    // border-b-border 而不是 border-border：老规则只给 border-bottom 上色，
    // 其余三边的颜色仍是 reset 的 currentColor（宽度 0 看不见，但逐元素比对算差异）
    <div className="mb-[72px] flex items-end justify-between border-b-4 border-b-border pb-[32px]">
      {/* gap 22px：徽标与 104px 的巨型标题之间原来只隔 10px，上面又压着角落点阵，
          整条徽标被夹在两者中间。标题字号大，间距也得按比例给 */}
      <div className="flex flex-col gap-[22px]">
        {/* pl-[4px]：徽标是个独立胶囊，左移会与巨型标题的左边缘脱开，所以只给很小的
            内缩——让 LED 离开角落装饰的视觉范围，标题仍与它左对齐 */}
        <div className="flex items-center gap-[14px] pl-[4px] opacity-70">
          {/*
           * 字号字距要写在这颗圆点上，尽管它没有文字
           * ------
           * 老规则是 `.badge span`，两个 span 都命中，圆点也就跟着拿到 20px/.22em/700。
           * 它自身不显示文字，看不出区别，但 letter-spacing 会在行内盒右侧留出
           * 一个字距的空位——删掉的话徽标整体宽度会变，逐元素比对上是差异。
           */}
          {/* text-muted 同理：老规则给两个 span 都上了 muted 前景色，圆点虽然不显示文字，
              但 color 是计算值，不写就会从 #container 继承 fg。
              光晕走任意属性而不是 shadow-* 那族：后者是与 ring/inset 合成的复合属性，
              即使只给一层也会展开成 `rgba(0,0,0,0) 0 0 0 0, …` 那一长串。
              注意这里刻意不把那个写法原样抄进注释——扫描器是正则级别的，会把注释里
              带方括号的片段也当候选，抄一次就多一条以省略号为值的死规则。 */}
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
 * 页脚水印布局常量
 *
 * 用于反推「整条水印能不能放进一行」，几何与 styles/frame.ts 的 .foot 规则一一对应，
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
 * （logo.webp 与 frame-logo.webp），所以统一走 <img>。
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
    <div className="relative z-10 flex flex-col items-center gap-[26px] px-[72px] pt-0 pb-[64px]">
      {/*
       * --fs 由下面所有页脚字号乘上，scale=1 时等价于原来的写死值。
       * nowrap + white-space:nowrap 一起给：main 分支的版本号是
       * v2.1.0-2-gc6522ee-dirty，整排宽度超过内容宽 1296px，框架半边会被甩到第二行，
       * 「插件 × 框架」的并列关系就断了。禁止换行后靠 --fs 等比缩字号保证放得下。
       */}
      <div
        className="flex max-w-full flex-nowrap items-center justify-center gap-[32px] whitespace-nowrap [--fs:1]"
        style={scale < 1 ? ({ "--fs": scale } as React.CSSProperties) : undefined}
      >
        {/* 插件半边：图标 + 两行文字，items-center 让图标对齐文字块中线 */}
        <div className="flex min-w-0 items-center gap-[20px]">
          {logo && (
            /*
             * 图标：外层 span 定框，内层 img 决定字形实际大小
             * ------
             * 两张图构图不同：logo.webp 的字形只占画幅 70.7%（实测 alpha
             * 包围盒 724/1024，缩到 512 后比例不变），frame-logo.webp 是满幅不透明图
             * （母版扩展名写的是 .png，内容其实是 JPEG）。
             * 同样塞进框、同样内缩时，
             * 早柚字形只有 42px、云崽有 60px——差三分之一，就是「适配器图标偏小」
             * 的来源。所以这里让 img 溢出框 112% 把那圈留白顶出去（字形 =
             * 80 × 1.12 × 0.707 ≈ 63px），overflow-hidden 裁掉溢出部分。
             *
             * 不给底色和描边：logo.webp 是透明底（WebP 保留了 alpha），加了淡底 +
             * 边框就变成两个方块
             * 罩在字形外，页脚这行本来只是水印，方框比它要标记的内容更抢眼。
             * 圆角留着只为裁剪溢出，透明背景下看不出来。
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
            /* 满幅图内缩 8px，字形 = 80 - 16 = 64px，与左边的 63px 相当。
               frame-logo 是满幅不透明图自带白底，本身就是个方块，不需要再补边框框住它 */
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

      {/* 时间戳与提示：kkk 把这类信息放在正文末尾，本插件几个页面都靠页脚给，
          所以留一行居中小字，与上面的水印分层 */}
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

/** 一整页 */
export function Page({
  // 曾经是 _palette（有意不用）。压花玻璃的高光强度必须按主题分档 —— 深底上
  // screen 混合等于叠纯白，出来是一屏雪花 —— 所以骨架现在真的要读调色板了。
  palette,
  word,
  ghostTop,
  children,
}: {
  palette: Palette
  word: string
  /** 气氛大字的起点，默认见 styles/backdrop.ts 的 .ghost */
  ghostTop?: number
  children: ReactNode
}) {
  return (
    <>
      <Backdrop word={word} ghostTop={ghostTop} gloss={palette.gloss} />
      <div className="relative z-10 p-[72px]">{children}</div>
    </>
  )
}
