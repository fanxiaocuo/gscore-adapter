/**
 * 运行环境页（#早柚版本）
 *
 * 版式与取材照 karin-plugin-kkk 的 #kkk版本（module/utils/runtime-report.ts +
 * components/platforms/other/runtime.tsx）：一张「本机诊断快照」——巨大的版本号
 * 当主视觉，下面按两列铺环境摘要（系统 / 框架 / Node / 运行模式 / 内存 / CPU）。
 *
 * 为什么不沿用状态页那套骨架
 * ---------------------------
 * 初版直接套了 Header + 统计条 + 卡片列表，结果和 #早柚状态 长得几乎一样——
 * 同一个巨型英文标题、同一条四格统计、同一批圆角卡片，只有文字不同，用户反馈
 * 「早柚版本我觉得写得像早柚状态」。两条命令答的是两个问题：
 *   #早柚状态 —— 连接好不好，是运行时的、随时会变的；
 *   #早柚版本 —— 跑在什么上面，是环境的、基本不变的。
 * 所以这页换一套骨架：不要巨型英文标题和统计条，改成 kkk 那样「版本号即主视觉」，
 * 正文是本机信息的两列摘要。连接数这类状态信息不再重复展示，留给状态页。
 *
 * 隐私：本机信息只取性能类，不取任何能定位机主的东西，边界见 env.ts 的 sysInfo。
 */
import type { Palette } from "../theme.js"
import type { ReleaseType } from "../env.js"
import type { Release } from "../changelog.js"
import { Backdrop, Footer, Section } from "./Layout.js"
import { fitFontSize } from "../metrics.js"

/** 一条环境信息 */
export interface AboutRow {
  /** 左侧标签，如 运行框架 */
  key: string
  /** 右侧取值 */
  value: string
  /** 取值下方的补充说明 */
  sub?: string
  /** 取值用等宽字（版本号、平台名这类） */
  mono?: boolean
}

export interface AboutData {
  title: string
  version: string
  palette: Palette
  time: string
  /** 插件图标的 data URI，空串则不显示图标只显示文字 */
  logo: string
  /** 一句话介绍 */
  desc: string
  /** 正式版 / 预览版 */
  release: ReleaseType
  /** 两列摘要，按顺序左右交替铺开 */
  rows: AboutRow[]
  /** 内存占用，画一条进度条；不给则不显示 */
  memory?: { percent: number; used: string; total: string }
  /**
   * 标题右侧的速览格，不给则标题独占整宽
   *
   * 补的是标题区右侧那片空白（标题只有四个字，88px 下占不到三分之一宽）。
   * 内容要选「一眼就想知道」的三两项，多了会和下面的环境摘要重复。
   */
  glance?: { key: string; value: string }[]
  /**
   * 本版变更，读 CHANGELOG.md 得来；null 则整块不渲染
   *
   * 与 #早柚更新日志 的分工：那条命令列 git 提交，答「代码更新到哪了」；
   * 这里列发布条目，答「这个版本改了什么」。数据源不同，不重复。
   */
  changes?: Release | null
  /** 底部的开源信息行 */
  links: { key: string; value: string }[]
}

/**
 * 版本号可用宽度
 *
 * 1440 画布 - .page 左右 padding 72×2 = 1296，再减去 hero 图标 200px 与 44px 间距。
 * 几何对应下面 hero 那一块的 size-[200px] 与 gap-[44px]，改那边要同步改这里。
 */
const HERO_BUDGET = 1296 - 200 - 44

export function About(data: AboutData) {
  const p = data.palette
  const stable = data.release === "Stable"
  // 版本号与发布类型同色：非正式版 warning，正式版取轮转色的第一个
  const verColor = stable ? p.rotate[0] : p.warning

  /**
   * 版本号字号：按串长反推，保证一行放得下
   *
   * 130px 是给 `v2.1.0` 这类短串的理想值，但 main 分支上 git describe 会给出
   * `v2.1.0-2-gc6522ee-dirty`（23 字符），130px 下宽约 1790px，远超可用的 1052px，
   * 于是折成两行——右侧那块「小字 / 巨大数字 / 插件名」的层次被破坏，
   * 而且第二行会压到下面的插件名上。
   *
   * 下限 56px：仍比正文的 38px 大一档，主视觉地位保得住。
   * 字距 -.05em 与 CSS 一致，长串下这一项能省下约 4% 宽度，不能漏算。
   */
  const verSize = fitFontSize(data.version, HERO_BUDGET, 130, 56, -0.05)

  return (
    <>
      {/* 大字压在两列摘要区，与帮助/状态页「大字落在列表区」一致 */}
      <Backdrop word="RUNTIME" ghostTop={1000} />

      <div className="relative z-10 p-[72px]">
        {/* 顶部一行小字，取代其他页的巨型 Header——这页的主视觉是版本号 */}
        <div className="mb-[40px] flex items-center justify-between gap-[24px]">
          <div className="flex items-center gap-[14px] text-[24px] font-extrabold leading-none tracking-[.18em] text-muted">
            <span
              className="size-[11px] flex-none rounded-[9999px]"
              style={{ background: p.rotate[0] }}
            />
            <span>运行诊断</span>
            <span className="opacity-50">·</span>
            <span className="font-mono">RUNTIME REPORT</span>
          </div>
          <div
            className="flex-none rounded-[9999px] px-[26px] py-[12px] font-mono text-[22px] font-extrabold leading-none tracking-[.1em]"
            style={{
              color: verColor,
              background: `${verColor}1f`,
              border: `1px solid ${verColor}3d`,
            }}
          >
            {data.release === "Stable" ? "正式版" : data.release === "Dev" ? "开发版" : "预览版"}
          </div>
        </div>

        {/* 标题与右侧速览并排
            ------
            原来标题「运行环境」+ 一行说明单独占满整宽，右侧从 y=150 到 400 是一大片
            空背景——标题只有 4 个字，88px 下宽约 360px，剩下 900px 全空着。
            右边补三格速览：进程健康度（在线连接/内存/运行时长），都是「现在好不好」
            的答案，与标题「运行环境」同一个语义层，放在一起读得通。
            不放版本号之类：那是下面 hero 的主视觉，重复会削弱它。

            items-end 让两栏底边成一条线。速览三格合计约 270px 高，比左边的标题+说明
            （约 200px）高，所以底对齐时它会向上探出约 70px——正好填掉标题上方那条空带，
            而不是在标题下方留出一段。顶对齐则相反：速览悬在上面，标题下方空一截。
            mb 给在这一整块上（而不是说明文字上），整块作为一个单位与 hero 拉开。 */}
        <div className="mb-[64px] flex items-end justify-between gap-[56px]">
          <div className="min-w-0">
            {/* 标题比其他页的 104px 小一档：这页的主视觉是下面的版本号，标题让位。
                字号字重全部显式写出——没引 preflight，h1 不带浏览器默认样式 */}
            <h1 className="mb-[18px] text-[88px] font-black leading-[1.05] tracking-[-.04em]">
              运行环境
            </h1>
            <div className="text-[27px] leading-[1.6] text-muted">{data.desc}</div>
          </div>
          {data.glance && data.glance.length > 0 && (
            /*
             * 速览格：竖排三行，右对齐
             *
             * 右对齐而不是左对齐：它贴着画布右边缘，取值的右边缘成一条线才像「标注」，
             * 左对齐会在右侧又留出一条不齐的锯齿边。
             * items-end 要在外层与每个 .g 上各写一次——小标签与大数值的宽度不同，
             * 只在外层对齐的是整格，格内两行仍会各自左对齐。
             */
            <div className="flex flex-none flex-col items-end gap-[22px]">
              {data.glance.map((g, i) => (
                <div className="flex flex-col items-end gap-[7px] leading-none" key={i}>
                  <span className="font-mono text-[19px] font-extrabold tracking-[.18em] text-muted">
                    {g.key}
                  </span>
                  {/* 44px：比正文 38px 大一档，但远小于 hero 的版本号，层级排在它后面。
                      tabular-nums 让数字等宽，三行的数值不会左右跳 */}
                  <span
                    className="text-[44px] font-black tracking-[-.02em] whitespace-nowrap [font-variant-numeric:tabular-nums]"
                    style={{ color: p.rotate[i % p.rotate.length] }}
                  >
                    {g.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/*
         * 版本号主视觉：kkk 那张图上最抢眼的就是这一块
         *
         * 图标 200px 而不是 168px：右侧三行合计约 220px（小字 22 + 数字 130 + 名字 36
         * 加两道 8px 间距），168 的图标明显比文字块矮一截，两边体量不相当。
         */}
        <div className="mb-[80px] flex items-center gap-[44px]">
          {data.logo && (
            /* size 与 HERO_BUDGET 里减掉的 200 是同一个数，改这里要同步改上面。
               object-contain 防非方形图被拉变形 */
            <img
              className="size-[200px] flex-none rounded-[44px] border border-border bg-inset object-contain"
              src={data.logo}
              alt=""
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
            <div className="font-mono text-[22px] font-extrabold leading-none tracking-[.2em] text-muted">
              插件版本
            </div>
            {/*
             * 字号不写死，由上面的 fitFontSize 按串长算出来走内联 style
             * ------
             * 曾写死 130px，按「20 字符 × 0.6em」估过一遍，但那个估算漏了两件事：
             * 内容宽是 1296px 不是 1872px（1440 画布减 72×2 的 padding），
             * 且 main 分支的 describe 串是 v2.1.0-2-gc6522ee-dirty，实际宽约 1790px。
             * 结果版本号折成两行，还压到了下面的插件名上。
             *
             * whitespace-nowrap 取代原来的 overflow-wrap:break-word —— 版本号是一个
             * 整体标识，从中间断开比缩小更难读（v2.1.0-2- / gc6522ee-dirty 是两个
             * 无意义的片段）。这里的 text-[130px] 只是兜底，恒被内联 fontSize 覆盖。
             */}
            <div
              className="text-[130px] font-black leading-none tracking-[-.05em] whitespace-nowrap [font-variant-numeric:tabular-nums]"
              style={{ color: verColor, fontSize: verSize }}
            >
              {data.version}
            </div>
            <div className="font-mono text-[26px] leading-[1.4] tracking-[.06em] text-muted">
              {data.title}
            </div>
          </div>
        </div>

        {/* 环境摘要：两列。标题带一条渐变横线，照 kkk 的分节样式。
            Section 在 Layout.tsx —— 状态页的分组明细也用它 */}
        <Section title="环境摘要" color={p.rotate[0]} />

        {/*
         * 环境摘要两列
         *
         * 不做成圆角卡片：状态页与帮助页已经用满了「卡片列表」这个语言，这页再用一遍
         * 就是用户说的「像早柚状态」。改成无边框的双列信息块，与卡片页拉开观感。
         * row-gap 给得比 column-gap 小（52 / 64）：两列之间要读得开，同列上下条目
         * 反而该紧一些，否则一格一格散开不成块。
         */}
        <div className="mb-[72px] grid grid-cols-2 gap-x-[64px] gap-y-[52px]">
          {data.rows.map((r, i) => (
            <div className="flex min-w-0 flex-col gap-[10px]" key={i}>
              <div className="text-[23px] font-extrabold leading-[1.2] tracking-[.12em] text-muted">
                {r.key}
              </div>
              {/* break-words：CPU 型号这类长串（Intel(R) Core(TM) i3-10100E CPU @ 3.20GHz）
                  必须能折，否则会顶破列宽 */}
              <div
                className={`text-[38px] font-extrabold leading-[1.25] tracking-[-.01em] break-words${r.mono ? " font-mono" : ""}`}
                style={{ color: p.rotate[i % p.rotate.length] }}
              >
                {r.value}
              </div>
              {r.sub && (
                // break-keep：sub 是中文说明，逐字断点会把词劈开（同 Help 的说明文字）
                <div className="text-[21px] leading-[1.5] break-words break-keep text-muted">
                  {r.sub}
                </div>
              )}
            </div>
          ))}

          {data.memory && (
            <div className="flex min-w-0 flex-col gap-[10px]">
              <div className="text-[23px] font-extrabold leading-[1.2] tracking-[.12em] text-muted">
                内存占用
              </div>
              {/*
               * 百分比大字与「已用 / 总量」小字同基线；flex-wrap 兜底防窄列下溢出。
               *
               * 前面那一串字号字重与上面 r.value 那格是同一套——迁移前它写作
               * `.v.mem`，两个类叠在同一个元素上，尺寸由 `.v` 给、排布由 `.mem` 给。
               * utility 没有「继承另一个类」这回事，只能重复写一遍。不能省：这里的
               * 38px/1.25/-.01em 并非给它自己用（它的两个子元素各有字号），而是子元素
               * 的继承源——leading 与 letter-spacing 都是继承属性，删掉的话 pct 的行高
               * 从 57.5px 变成 normal，整格高 2px，把页面总高也带偏。
               */}
              <div className="flex flex-wrap items-baseline gap-[16px] text-[38px] font-extrabold leading-[1.25] tracking-[-.01em] break-words">
                <span
                  className="text-[46px] font-black tracking-[-.02em] [font-variant-numeric:tabular-nums]"
                  style={{ color: p.rotate[2] }}
                >
                  {data.memory.percent}%
                </span>
                <small className="font-mono text-[22px] font-semibold text-muted">
                  {data.memory.used} / {data.memory.total}
                </small>
              </div>
              {/* 进度条：宽度由百分比给，夹到 0~100 防止异常值撑破容器 */}
              <div className="mt-[6px] h-[10px] overflow-hidden rounded-[9999px] border border-border bg-inset">
                <i
                  className="block h-full rounded-[9999px]"
                  style={{
                    width: `${Math.min(100, Math.max(0, data.memory.percent))}%`,
                    background: `linear-gradient(90deg,${p.rotate[0]},${p.rotate[2]})`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 本版变更：照 kkk 的 #kkk版本，环境摘要之后接一段「这个版本改了什么」。
            分类标题各自轮换一个主情绪色，与摘要区的取色规则一致。 */}
        {data.changes && data.changes.groups.length > 0 && (
          <>
            <Section
              title="本版变更"
              color={p.rotate[1]}
              right={
                <>
                  v{data.changes.version}
                  {/* not-italic：em 的默认斜体在等宽字下与版本号对不齐；日期再降一档透明度 */}
                  {data.changes.date && (
                    <em className="not-italic opacity-75"> · {data.changes.date}</em>
                  )}
                </>
              }
            />

            {/*
             * 数据来自 CHANGELOG.md（changelog.ts 解析），结构是「分类 + 条目」两层。
             * 不做成卡片：这页已经定了「无边框信息块」的语言（见上面摘要区的说明），
             * 变更列表再套一层卡片就又向状态页靠回去了。分类之间靠间距分组，
             * 条目用一颗小圆点当项目符号，颜色跟着分类走，扫读时能一眼分出属于哪一类。
             */}
            <div className="mb-[72px] flex flex-col gap-[40px]">
              {data.changes.groups.map((g, gi) => (
                /* min-w-0 让长条目在 flex 列里能正常收缩，分类之间的间距由父级 gap 给。
                   迁移前这个 .grp 在 CSS 里从没定义过，靠父级 gap 恰好达到效果 */
                <div className="min-w-0" key={gi}>
                  <div
                    className="mb-[18px] text-[27px] font-extrabold leading-[1.3] tracking-[.02em]"
                    style={{ color: p.rotate[gi % p.rotate.length] }}
                  >
                    {g.title}
                  </div>
                  {/* list-none：没引 preflight，ul 仍带浏览器默认的圆点与缩进，得显式关掉 */}
                  <ul className="flex list-none flex-col gap-[14px]">
                    {g.items.map((it, ii) => (
                      /* 圆点用 flex-none + mt 手动对齐首行视觉中线：
                         items-center 在条目折行时会把点带到两行之间，看着像挂错了行 */
                      <li
                        className="flex items-start gap-[16px] text-[25px] leading-[1.5]"
                        key={ii}
                      >
                        <i
                          className="mt-[14px] size-[9px] flex-none rounded-[9999px] opacity-[.85]"
                          style={{ background: p.rotate[gi % p.rotate.length] }}
                        />
                        <span className="min-w-0 flex-1 break-words break-keep">{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}

        {/*
         * 开源信息：两列 × 两行，标签在上、取值在下，四条正好铺满、没有空格。
         *
         * 原来是单列三行「标签 + 取值」左右并排，最长的一条（docs.sayu-bot.com/…）
         * 在 22px 等宽下约 567px，整行也只占 720px，右侧 2/3 空着；这块又正压在页脚
         * 上方，两片空白连起来，整页尾部像塌下去一半。
         *
         * 为什么标签要上移：如果保留「标签在左」，每列 616px 减去标签 150px 与 24px
         * 间距，取值只剩 442px，装不下 567px 的文档地址，会折成「…/Adapte + rList.html」
         * 两行——断点落在单词中间，比留白更难读。标签上移后取值能用满 616px。
         *
         * 为什么是两列而不是三列：三列每列只有 (1296-2×48)/3 = 400px，四条里有三条
         * （两个 github 地址加文档地址）都超过 400px，得靠跨列拼凑，反而拼不满。
         */}
        {/* border-t-border 而不是 border-border：后者给四边都上色，其余三边虽然宽度
            为 0 看不见，但计算值会从 reset 的 currentColor 变掉，逐元素比对时是差异 */}
        <div className="grid grid-cols-2 gap-x-[64px] gap-y-[26px] border-t border-t-border pt-[44px]">
          {data.links.map((l, i) => (
            <div className="flex min-w-0 flex-col gap-[8px] text-[22px]" key={i}>
              <span className="font-mono text-[19px] font-extrabold uppercase leading-none tracking-[.14em] text-muted">
                {l.key}
              </span>
              {/* break-all 而不是 break-words：取值是 URL，没有空格可断，
                  break-words 只在整词放不下时才断，那会让长地址整条溢出列宽 */}
              <span className="min-w-0 font-mono leading-[1.5] break-all text-muted">
                {l.value}
              </span>
            </div>
          ))}
        </div>

        {/* kkk 在正文末尾写了「仅包含经过脱敏的本地运行信息」，本插件同样只取
            性能类信息（见 env.ts sysInfo 的隐私边界），照样声明一句 */}
        <div className="mt-[32px] text-[21px] leading-[1.6] opacity-70 text-muted">
          仅包含经过脱敏的本地运行信息
        </div>
      </div>

      <Footer
        name={data.title}
        version={data.version}
        palette={p}
        lines={[data.time, "#早柚帮助 查看全部指令"]}
      />
    </>
  )
}
