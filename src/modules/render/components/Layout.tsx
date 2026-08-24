/**
 * @description 画布骨架，对应 kkk 的 DefaultLayout：固定宽画布 + 弥散光 + 絮状调制 + 角落装饰
 * 注意：不做 transform:scale —— 本体 puppeteer 直接截 #container，缩放写进 DOM 会让截图尺寸算错。
 */
import type { ReactNode } from "react"
import type { Palette } from "../theme.js"
import { FRAME_LOGO, PLUGIN_LOGO, imageDataUri } from "../assets.js"
import { frameLabel, releaseType } from "../env.js"
import { textWidth } from "../metrics.js"

/**
 * @description 液态玻璃卡面：面 + 边 + 厚度三件套，全套卡片共用
 *
 * 三件事一起才成立，缺一件就退回「半透明矩形」：
 *   面    竖向渐变 .52 → .24 的白，上亮下暗是玻璃的体积感来源，底下的弥散光透得上来
 *   边    两条方向相反的 1px 内阴影代替描边：左上受光边、右下背光边 —— 描边四周同色，
 *         而玻璃的边随光向一半亮一半暗，圆角处自然过渡（这也是不能用 border 的原因：
 *         四条边只能同一个颜色）
 *   厚度  顶部 28px 白色内发光（玻璃体内的漫射）＋ 一层外投影把卡片托起来
 *
 * 抽成常量而不是在五处各写一遍那串取值：改一处漏四处，而 classes.test.mjs 查的是
 * 「类有没有定义」，查不出「五处材质不一致」——那正是这次要修的东西本身。
 *
 * 注意：底端停在 .24 而不是更透。按 test/glassink.mjs 实测，.17 那档第一张统计卡的最暗
 * 单像素是 4.41，差 0.09 掉出正文 4.5；抬到 .24 后是 4.63，看不出画面差别。
 * 注意：这串取值只在 Layout.tsx 里出现，但 Tailwind 扫的是 components/*.tsx 的正则级候选，
 * 本文件在扫描范围内，所以别把它挪去 theme.ts 那类不被扫的文件 —— 会静默丢掉这几条规则。
 */
export const GLASS =
  "[background:linear-gradient(180deg,rgba(255,255,255,.52),rgba(255,255,255,.33)_44%,rgba(255,255,255,.24))] [box-shadow:inset_1px_1px_0_rgba(255,255,255,.95),inset_-1px_-1px_0_var(--border),inset_0_28px_40px_-32px_rgba(255,255,255,.95),0_16px_36px_-22px_rgba(16,26,40,.20)]"

/**
 * @description 无方向性边的玻璃：给自带描边的卡用（目前只有空态卡）
 * 空态卡的虚线描边是语义标记（「这里本该有东西」），不是材质的边。两者叠在同一像素上会打架：
 * 左上角是「虚线的 border 色」紧贴「受光白线」，读起来是脏边而不是玻璃。所以那里只取面与厚度，
 * 边交给虚线本身。
 */
export const GLASS_SOFT =
  "[background:linear-gradient(180deg,rgba(255,255,255,.52),rgba(255,255,255,.33)_44%,rgba(255,255,255,.24))] [box-shadow:inset_0_28px_40px_-32px_rgba(255,255,255,.95),0_16px_36px_-22px_rgba(16,26,40,.20)]"

/** @description 背景装饰层：弥散光、絮状调制、暗角、气氛大字、角落点缀 */
export function Backdrop({ word, ghostTop }: { word: string; ghostTop?: number }) {
  return (
    <>
      {/*
       * 弥散光：五团大色斑互相咬合
       *
       * 三团各自成形、能数出「三个光球」；提到五团并把半径放大到超出画布（负边距 + 超宽高），团边落在画布外，
       * 看到的只有中段过渡。尺寸/位置/旋转刻意各不相同：等距等大的斑会形成可辨的节奏，反而像图案。
       *
       * 这一层现在是画面的主体。压花高光去掉之后，「不显廉价」不再有纹理兜着，全靠色相跨度 + 下面那层絮状
       * 调制 + 暗角三件事撑 —— 取值与理由见 theme.ts 的 glow。
       *
       * 注意：别给这几团加回 CSS 模糊。本体用 --disable-gpu 起 Chromium，模糊全走 CPU 且滤镜区域要按 3σ 外扩，
       * 五团约 5000 万像素 —— 实测帮助页有模糊 5090ms、无模糊 1530ms，而整页逐像素比对平均只差 1.93/255、
       * p99 差 8，并看分不出来。原因是这层本来就没有高频：radial-gradient 到 66~74% 处已经收干，边是渐变自己
       * 收尾吃掉的，不是模糊吃的。缩盒子再 scale 回去（k=2/3/4/6 全试过）省不了，Chromium 按最终设备尺度光栅化。
       *
       * 注意：rounded-[9999px] 而不是 rounded-full —— 后者是 calc(infinity*1px)，算出来是 3.35544e+07px。
       */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute top-[-420px] left-[-320px] h-[1680px] w-[1560px] rounded-[9999px] [transform:rotate(-18deg)] [background:radial-gradient(ellipse_at_42%_38%,var(--glow-1)_0%,transparent_68%)]" />
        <div className="absolute top-[260px] right-[-380px] h-[1560px] w-[1320px] rounded-[9999px] [transform:rotate(22deg)] [background:radial-gradient(ellipse_at_52%_48%,var(--glow-2)_0%,transparent_66%)]" />
        <div className="absolute bottom-[-460px] left-[80px] h-[1380px] w-[1500px] rounded-[9999px] [transform:rotate(-8deg)] [background:radial-gradient(ellipse_at_48%_56%,var(--glow-3)_0%,transparent_70%)]" />
        <div className="absolute top-[820px] left-[-260px] h-[1140px] w-[1040px] rounded-[9999px] [transform:rotate(34deg)] [background:radial-gradient(ellipse_at_46%_50%,var(--glow-4)_0%,transparent_72%)]" />
        <div className="absolute top-[-160px] right-[-200px] h-[1020px] w-[1180px] rounded-[9999px] [transform:rotate(-26deg)] [background:radial-gradient(ellipse_at_54%_44%,var(--glow-5)_0%,transparent_74%)]" />
      </div>

      {/*
       * 絮状调制：极低频的一层，专治「纯渐变像塑料」
       *
       * 换掉压花鳞片的关键在**频率**，不在有没有噪声。旧的那层是 baseFrequency 0.1（周期约 10px）配
       * feSpecularLighting，1~2px 的锐白点和字的笔画抢像素，读作雪花；而 jpeg 的 DCT 最压不动的正是
       * 中间调 + 高频锐噪，所以它一个人吃掉七八成体积。
       *
       * 这里只留 0.009（周期约 110px）的 fractalNoise，不加镜面光照。出来是大块柔和的明暗起伏，
       * 肉眼不成形、也不与字争，只把纯渐变那种塑料感压掉。低频对 DCT 友好，几乎不涨体积。
       *
       * feColorMatrix 把亮度搬进 alpha 并压到很低（0.16 的斜率 + 负偏置），于是只有噪声的亮处留下
       * 一点提亮，暗处直接透明 —— 这样它永远只提亮、不压暗，不会吃掉正文对比度。
       *
       * 注意：opacity 别往上抬。这层的作用是「让人说不出哪里不平」，一旦看得出颗粒就又回到旧问题了。
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
       * 暗角：把视线收进画面
       *
       * 五团色斑铺满整幅之后四角最容易发飘 —— 尤其近白的那套，边缘几乎与页面外的白融在一起，
       * 画面没有边。一道很轻的径向暗角给它收个口。
       *
       * 注意：用 --fg 而不是写死黑。COOL 的前景是 #0f1720（偏蓝），纯黑压在银灰底上会显脏。
       * 注意：第一版给的是 58% + .055，四角根本没收住 —— 起点太靠外、浓度也太淡。现在 42% 起收、
       * .085 收尾，画面才有边。再往内会压到统计条那一带的正文，inkprobe 会先报出来。
       */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-[.085] [background:radial-gradient(ellipse_at_50%_40%,transparent_42%,var(--fg)_100%)]" />

      {/*
       * 竖排气氛大字
       *
       * top 默认 560px：起点更高的话大字正好压在第四张统计卡背后，字面笔画透过半透明卡片显出来、像脏了。
       * 560px 落在统计条下方的列表区，那里行高一致、底色均匀。透明度压到 .028 —— 列表卡片比统计卡更透。
       * ghostTop 由页面给（关于页多一张 hero 卡、内容整体下移约 260px），所以位置跟着版式走，不写死。
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
       * 两块退到画布边缘 40px 处（原来 48px 时点阵右下角正好压到徽标那颗 LED 上），点阵缩到 3 列让出徽标横带。
       * 几何上：点阵 3×3 = 29px 见方，刻度 3 条 = 20px 高、最长 72px —— 行数相同、高度接近、最长边同量级，
       * 两个角落才配平（曾经是 2 行点阵配 128px 长刻度线，右边分量重出四倍）。
       * 列宽用 repeat(3,1fr) 而不是 grid-cols-3，理由同 Stats：后者的最小值是 0。
       */}
      <div className="absolute top-[40px] left-[40px] z-0 grid [grid-template-columns:repeat(3,1fr)] gap-[7px] opacity-[.16]">
        {Array.from({ length: 9 }, (_, i) => (
          // 老规则是 `.dots i`，样式挂在生成出来的子元素上，迁移后直接写在 <i> 上
          <i key={i} className="size-[5px] rounded-[9999px] bg-fg" />
        ))}
      </div>
      {/* 固定宽度而非随机：随机值会让每次截图产生无意义的像素差异。最长 72px 而不是 128px 的理由见上面的配平 */}
      <div className="absolute top-[40px] right-[40px] z-0 flex flex-col items-end gap-[4px] opacity-[.16]">
        {[72, 52, 32].map(w => (
          <i key={w} className="h-[4px] bg-fg" style={{ width: w }} />
        ))}
      </div>
      {/*
       * 左下角落：一团很淡的辉光，不再是 45° 斜纹
       *
       * 那条斜纹是压花时代的遗物：那时满屏鳞片，一块 5px 周期的规则纹理混在里面看不出来。背景一干净，
       * 它就成了整幅唯一一块「机器画的几何」，而且只在左下角、右边没有对称物，读作画错了地方。
       * 换成同色系的一团辉光：仍然给左下角一点分量（不然那片空得发虚），但它与五团色斑是同一种语言。
       */}
      <div className="pointer-events-none absolute bottom-[-220px] left-[-180px] z-0 h-[720px] w-[860px] rounded-[9999px] opacity-[.5] [background:radial-gradient(ellipse_at_46%_54%,var(--glow-2)_0%,transparent_70%)]" />
    </>
  )
}

/**
 * @description 概览统计条：四张等宽大数字卡
 * 抽成组件而不是让帮助页/状态页/更新日志页各写一遍那串二十来个类 —— 改一处漏两处，而 classes.test.mjs 查的是
 * 「类有没有定义」，查不出「三处不一致」。
 */
export function Stats({
  items,
  palette,
}: {
  items: { key: string; value: string; sub?: string }[]
  palette: Palette
}) {
  // 注意：列宽用 repeat(4,1fr) 而不是 grid-cols-4 —— 后者编出来是 repeat(4,minmax(0,1fr))，最小值被钉在 0、
  // 四列恒等宽；而 1fr 的最小值是 auto，放不下的列可以超出等分。更新日志页的上排小字够长，它那四列实际是
  // 382/162/299/380 而非 306×4，换成 minmax(0,1fr) 会把那页的统计条压回等分
  return (
    <div className="mb-[72px] grid [grid-template-columns:repeat(4,1fr)] gap-[24px]">
      {items.map((s, i) => (
        /*
         * 四张卡等高（grid 默认 stretch），内部三行 flex 竖排；卡面走 {@link GLASS} —— 取值与理由见那里。
         * 52px 的大数字走大字 3.0 那条线，比 GLASS 上的正文宽裕得多。
         */
        <div
          className={`flex flex-col gap-[10px] rounded-[22px] px-[26px] py-[24px] ${GLASS}`}
          key={i}
        >
          {/* 三行字号 16 / 52 / 18：原先是 19 / 60 / 21，19 与 21 几乎同级、层级读不出来，60 又跳得太远 */}
          <div className="font-mono text-[16px] font-extrabold uppercase leading-[1.3] tracking-[.16em] text-muted">
            {s.key}
          </div>
          {/*
           * 大数字走渐变点缀：四张卡各取 spectrum 的一档，同一条渐变上的连续取样。
           * 渐变字必须给 background-clip:text + 透明字色；用内联 style 而不是 utility 是因为颜色来自运行时
           * Palette，编译期拿不到值。tabular-nums 让四张卡的数字宽度一致，不会因 1 比 8 窄而歪。
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
 * 关于页的「环境摘要 / 本版变更」与状态页的分组明细都用它。做成组件之后，从前那种「关于页私有类被状态页借用、
 * 改哪边都会波及对方」在类型上就不成立了。渐变线与圆点的颜色来自运行时轮换色，走内联 style；组件只定形。
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
 *
 * 虚线描边是这张卡的语义标记（「这里本该有东西」），它保留着 —— 但内容卡都迁成玻璃之后，
 * 从前那句理由（「与实线内容卡区分开」）不再成立了：现在的对照是「虚线 vs 无描边」，
 * 区分度反而比从前的「虚线 vs 实线」更大。
 * 卡面走 {@link GLASS_SOFT} 而不是 GLASS：虚线与受光白线叠在同一像素上会读成脏边。
 * whitespace-pre-line 保留说明里的换行（提示文案带 \n 分段）。
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
           * 注意：字号字距与 text-muted 要写在这颗圆点上，尽管它没有文字 —— 老规则是 `.badge span`，两个 span
           * 都命中，圆点也跟着拿到 20px/.22em/700 与 muted。letter-spacing 会在行内盒右侧留出一个字距的空位，
           * 删掉的话徽标整体宽度会变；color 也是计算值，不写就从 #container 继承 fg。
           * 光晕走任意属性而不是 shadow-* 那族：后者是复合属性，即使只给一层也会展开成一长串。
           * 注意这里刻意不把那个写法原样抄进注释 —— 扫描器是正则级别的，会把注释里带方括号的片段也当候选。
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
 * 版式照 kkk 的 DefaultLayout：居中一排，左半是插件、右半是框架，中间一根竖线分隔。
 * 必须是一行，所以在 SSR 阶段估一遍总宽（metrics.ts），超了就靠 CSS 变量 --fs 整体等比缩小 —— 靠 flex-wrap
 * 兜底会把框架半边甩到第二行、并列关系断掉，而只禁止换行会溢出被 overflow:hidden 裁掉，比换行更糟。
 * 版本号旁的 Stable/Preview 取自 env.ts 的 releaseType：预览版用 warning 色，让「这不是发布版本」一眼可见。
 * 不做 kkk 那套像素隐写（要 sharp 的原生二进制，且用户看不见），也不显示构建工具标（本插件是运行时 SSR）。
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
   * 默认值在组件里探测而不是让各页面从 pages.ts 传进来：角标对每个页面都一样，走 props 就得同时改几份 data
   * 接口和几处调用，加新页面还容易漏掉署名。组件只在 Node 里做 SSR，读进程信息与文件系统是安全的。
   * 留着 props 是为了单测能注入固定值。
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
             * 图标：外层 span 定框，内层 img 决定字形实际大小
             *
             * 两张图构图不同：logo.webp 的字形只占画幅 70.7%，frame-logo.webp 是满幅不透明图。同样塞进框、
             * 同样内缩时早柚字形只有 42px、云崽有 60px —— 差三分之一，就是「适配器图标偏小」的来源。所以让
             * img 溢出框 112% 把那圈留白顶出去（字形 ≈ 63px），overflow-hidden 裁掉溢出部分。
             * 不给底色和描边：logo.webp 是透明底，加了淡底 + 边框就成了两个方块罩在字形外，而页脚这行只是
             * 水印，方框比它要标记的内容更抢眼。圆角留着只为裁剪溢出。
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
            /* 满幅图内缩 8px，字形 = 80 - 16 = 64px，与左边的 63px 相当。frame-logo 自带白底、本身就是个
               方块，不需要再补边框框住它 */
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
 * 注意：不收 palette。骨架曾经要读它给压花高光按主题分档，换成弥散渐变之后背景的颜色全部走 cssVars 下发的
 * 自定义属性，骨架本身不再碰任何字面量色值。别为了「以后可能要用」把这个 prop 加回来 —— 一个什么都不做的
 * prop 会让下一个人以为骨架的外观能按调色板变。
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
