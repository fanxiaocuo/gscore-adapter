/**
 * 帮助页
 *
 * 结构照 kkk 的 Help.tsx：分组标题（色条 + 巨型标题）→ 双栏条目网格 → 子分组。
 *
 * 图标是同一套 lucide 图形，但拿法不同：kkk 用 lucide-react 组件（它在 devDeps 里，
 * 靠 vite build 把 SVG 打进产物）；我们只有 tsc 转译、不打包，import 会原样留在
 * 产物里变成真的运行时依赖，所以改从 lucide-static 在开发期生成字面量 JSX。
 * 详见 Icons.tsx 与 scripts/gen-icons.mjs。
 */
import type { Palette } from "../theme.js"
import { Icon, type IconName } from "./Icons.js"
import { Footer, Header, Page, Stats } from "./Layout.js"

/** 一条指令 */
export interface HelpItem {
  /** 指令本身 */
  cmd: string
  /** 说明，支持 \n 换行 */
  dsc: string
  /** 示例 */
  eg?: string
  /** 图标名，见 Icons.tsx */
  icon: IconName
  /** 仅主人可用 */
  master?: boolean
  /**
   * 占满整行（双栏网格里跨两列）
   *
   * 给说明多行、示例又长的条目用。半栏只有 478px，`#早柚添加连接` 的示例
   * 「127.0.0.1:8765 或 wss://域名:8765 n=主核心 t=abc」在里面要折三行，
   * 同一行右边那张卡却只有一行说明，两张卡高度差出一倍——就是用户说的
   * 「连接管理那的字不协调」。让它独占一行，剩下的条目才是同一量级。
   */
  wide?: boolean
}

/** 一个分组 */
export interface HelpGroup {
  title: string
  items: HelpItem[]
  subGroups?: { title: string; items: HelpItem[] }[]
}

export interface HelpData {
  title: string
  version: string
  /** 适配器是否启用，展示在右上 */
  enabled: boolean
  /** 连接数概览 */
  summary: { key: string; value: string; sub?: string }[]
  groups: HelpGroup[]
  palette: Palette
  time: string
}

/**
 * 一张指令卡
 *
 * sub 为真时整体降一档（子分组用）
 * ------------------------------
 * 迁移前这是 CSS 的 `.hp-sub .hp-item{padding:22px 26px}` 一族后代选择器：卡片自己
 * 不知道处境，由祖先改写尺寸。utility 表达不了「祖先是谁」，所以处境改成显式入参。
 *
 * 这样反而更贴合它本来的意思——子分组的条目与主指令卡是不同的东西：cmd 是
 * name / token 这类短标识，dsc 恒为一行，没有 eg 也没有 MASTER 标签。沿用主卡尺寸
 * 有两个具体毛病：60px 的图标框在只有两行内容的卡里显得卡在最上沿（用户反馈过
 * 「子菜单图标还是在最上面」）；36px 的 cmd 配一行 24px 说明，块头与主卡一样大，
 * 读起来分不出主次。
 */
/**
 * 把指令标题切成若干不可断开的整块
 *
 * 标题里有两种语义单元，断在中间读起来都像坏了：
 *
 * - 指令本身，`#早柚设置私聊上报关闭`。break-keep 只禁掉 CJK 的逐字断点，管不了
 *   `#` 与后面汉字之间——那是「前置标点不能落行尾」的规则给的断点，于是 `#` 独占
 *   一行、指令从第二行才开始（用户反馈的「#独占一行」「全局设置第二行就开始了」）。
 * - `<地址>` / `<名字|序号>` 这类占位符。断点来自「连接」与「<」之间那个空格。
 *
 * 所以按空白切片，每片各自 nowrap，只允许在空白处折行。片内可能仍然超栏宽（真出现
 * 时溢出比劈开更好定位），但现行清单里最长的一片是 `max_reconnect_attempts（retry）`
 * 477px，仍在子卡 502px 的栏宽内。
 *
 * 返回 string 而非数组的快路径：不含空白的标题就是一整片，不必包 <span>。
 */
function keepAtoms(cmd: string) {
  if (!/\s/.test(cmd)) return <span className="whitespace-nowrap">{cmd}</span>
  return cmd.split(/(\s+)/g).map((part, i) =>
    /^\s+$/.test(part) ? (
      part
    ) : (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ),
  )
}

function Item({
  item,
  color,
  sub,
  badge,
}: {
  item: HelpItem
  color: string
  sub?: boolean
  /** 单独标 MASTER。整组都要主人权限时由分组标题统一标，这里就不标了 */
  badge?: boolean
}) {
  return (
    // h-full：网格行内按最高的那张拉齐（默认 stretch）。原来是 [align-items:start]
    // 让每张卡保持内容高度，同一行两张卡的底边就差出几十像素，整页边缘参差 ——
    // 用户反馈的「空白一大部分」有一半来自这些高低差。内容仍贴卡片顶部，
    // 只是卡片外框补齐到行高。
    <div
      className={
        sub
          ? "h-full rounded-[26px] border border-border bg-surface px-[26px] py-[22px]"
          : "h-full rounded-[26px] border border-border bg-surface px-[30px] py-[28px]"
      }
    >
      {/*
       * 多一层 row：卡片高度由同一行里内容最多的那张决定（状态与连接那组，右边
       * 「#早柚连接列表」说明折三行，把左边「#早柚状态」也拉高了 ~60px）。这一层
       * 保持内容自身的高度并贴在卡片顶部，图标则在这一层里居中——两件事分开。
       *
       * items-start 而不是 items-center：后者会让 body 也居中，内容在被邻居撑高的
       * 卡片里上下浮动，同一行两张卡的标题起点就差出大半行。
       */}
      <div className={sub ? "flex items-start gap-[20px]" : "flex items-start gap-[24px]"}>
        {/*
         * 图标框：之前用 ◉ ≡ ⚙ 这类字符，看着总偏下——flex 居中的是行盒，字形墨迹
         * 在行盒里的位置由基线决定，而这些符号在 Latin 字体里缺字、回落到中文字体后
         * 墨迹整体偏下。换成内联 SVG 后几何由 viewBox 定死，居中结果与字体无关。
         *
         * self-center 对齐 row 的中线，也就是「这张卡整行内容行高的一半」。试过对齐
         * 标题首行（margin-top 负值反推），图标便贴在卡片最上沿，与直觉相反。
         */}
        <div
          className={
            sub
              ? "grid size-[48px] flex-none place-items-center self-center rounded-[14px] [&>svg]:block [&>svg]:size-[23px]"
              : "grid size-[60px] flex-none place-items-center self-center rounded-[18px] [&>svg]:block [&>svg]:size-[30px]"
          }
          style={{ background: `${color}1f`, color, border: `1px solid ${color}3d` }}
        >
          <Icon name={item.icon} />
        </div>
        {/* 下面三块的间距统一由这层的 gap 给，不再各自写 margin-top */}
        <div
          className={
            sub
              ? "flex min-w-0 flex-1 flex-col gap-[6px]"
              : "flex min-w-0 flex-1 flex-col gap-[10px] pt-[2px]"
          }
        >
          {/*
           * 标题独占整行，不再与 MASTER 标签并排
           * ----------------------------------
           * 曾经是「cmd + 标签」两个 flex 兄弟。标签 113px 加 12px 间距，把半栏的
           * 478px 压到 354px，而 `#早柚设置私聊上报关闭` 恰好就是 354px —— 十条主
           * 指令里有五条卡在这个阈值上，全折成两三行。
           *
           * 而这个标签在整份清单里恒为真（所有指令都是 permission:"master"，见
           * commands.ts 顶部），逐条重复 23 遍不带信息量，却付掉四分之一栏宽。
           * 改成在分组标题右侧标一次，见 Group。
           */}
          <div
            className={
              sub
                ? "text-[30px] font-black leading-[1.25] tracking-[-.01em]"
                : "text-[36px] font-black leading-[1.2] tracking-[-.01em]"
            }
          >
            {/*
             * break-words 而不是 break-all / anywhere：子分组里的
             * `max_reconnect_attempts（retry）` 是最长的一条，比栏宽长，必须折。
             * 后两者会在放不下的那一位上硬断，把字段名劈成「max_reconnect_att /
             * empts」；break-words 只在整个词放不下时才硬断，括号已提供合法断点，
             * 于是它在括号前换行，字段名保持完整。
             *
             * 全局设置那组曾经是最长的（`#早柚设置 media_max_size=10485760`），
             * 改成中文写法后只剩 13 字符，不再是折行阈值的来源。
             *
             * 再加 break-keep（word-break:keep-all）：CJK 每个字之间都是合法断点，
             * 而 `#早柚添加连接 <地址>` 这种标题一旦在「址」「>」之间断开，就会让一个
             * 孤零零的 > 掉到第二行。keep-all 禁掉 CJK 的逐字断点；拉丁长词仍由
             * break-words 兜底，两者不冲突。
             *
             * 注意 keep-all 只挡逐字断点，挡不住空格——上面那条标题里「连接」与
             * 「<地址>」之间就有一个，首行被右侧 MASTER 标签挤窄后仍会在那里折。
             * 这是对的（总得有个地方折），要保的只是「占位符不被劈开」，所以把
             * <...> 整块用 nowrap 包起来，见下面的 keepAtoms。
             */}
            {keepAtoms(item.cmd)}
          </div>
          {/*
           * 混合分组（组里只有部分指令要主人权限）才走到这里，自成一行而不是挂在标题
           * 右侧——标题宽度是整份清单的折行瓶颈，不能再让它分。
           */}
          {badge && (
            <span
              className="self-start rounded-[9999px] px-[13px] py-[5px] text-[18px] font-extrabold leading-none tracking-[.08em]"
              style={{ color, background: `${color}1f`, border: `1px solid ${color}3d` }}
            >
              MASTER
            </span>
          )}
          {/*
           * 说明文字也要 break-keep：默认 CJK 逐字可断，于是「改完即时生效」被折成
           * 「…生 / 效」、「各自的改法」被折成「…的 / 改法」，末行只剩一两个字。
           * 加了 keep-all 后断点落在标点与空格上，末行不再吊单字。
           * break-words 兜底：`media_max_size=2097152` 这类长串仍会硬断而非溢出。
           */}
          <div
            className={
              sub
                ? "text-[21px] leading-[1.5] break-words break-keep whitespace-pre-line text-muted"
                : "text-[24px] leading-[1.6] break-words break-keep whitespace-pre-line text-muted"
            }
          >
            {item.dsc}
          </div>
          {/*
           * 示例框：break-keep 而不是默认 —— 示例是「#早柚添加连接 127.0.0.1:8765
           * name=主核心」这种空格分段的参数串，CJK 默认可在任意字之间断行，于是
           * name=主核心 被拆成「name=主 / 核心」。break-keep 让连续中日韩文字不再随意
           * 断，只在空格处换行，正好与参数串的语义一致；break-words 兜底防溢出。
           * self-start 让框只包住文字，不被拉成整行宽。
           */}
          {item.eg && (
            <div className="mt-[2px] max-w-full self-start rounded-[12px] border border-border bg-inset px-[16px] py-[8px] font-mono text-[21px] leading-[1.5] break-words break-keep text-muted">
              {item.eg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 算每张卡要不要跨两列
 *
 * wide 的显式跨列；其余按网格流依次放。走到组尾还剩半栏时，把最后一张也拉通 ——
 * 双栏网格里落单的半栏是整页最大的空白来源（三个分组各空着一大块）。
 * wide 卡恰好排在半行位置时同理把前一张补齐，否则网格会在上一行留洞。
 */
function spanMap(items: { wide?: boolean }[]): boolean[] {
  const spans = items.map(it => !!it.wide)
  let col = 0
  spans.forEach((wide, i) => {
    if (wide) {
      if (col === 1) spans[i - 1] = true
      col = 0
    } else col = col === 0 ? 1 : 0
  })
  if (col === 1) spans[items.length - 1] = true
  return spans
}

function Group({
  group,
  color,
  spectrum,
}: {
  group: HelpGroup
  color: string
  /** 渐变点缀的两档，给分组计数的渐变数字用 */
  spectrum: [string, string]
}) {
  const total = group.items.length + (group.subGroups?.reduce((n, s) => n + s.items.length, 0) || 0)
  /** 整组都要主人权限时在标题上标一次，替代原先每条卡片各标一个 */
  const allMaster = group.items.length > 0 && group.items.every(i => i.master)
  const spans = spanMap(group.items)

  return (
    <div className="mb-[88px] last:mb-0">
      {/* 色条与标题都用 leading-none + items-center，色条才会正对标题的视觉中线 */}
      <div className="mb-[44px] flex items-center gap-[24px]">
        <div
          className="h-[56px] w-[12px] flex-none rounded-[9999px]"
          style={{ background: color }}
        />
        <h2 className="flex-none text-[64px] font-black leading-none tracking-[-.03em]">
          {group.title}
        </h2>
        {allMaster && (
          <span
            className="flex-none rounded-[9999px] px-[14px] py-[7px] text-[20px] font-extrabold leading-none tracking-[.08em]"
            style={{ color, background: `${color}1f`, border: `1px solid ${color}3d` }}
          >
            MASTER
          </span>
        )}
        {/*
         * 分组计数
         *
         * 原先是「描边胶囊 + 两位补零的灰数字」，孤零零挂在最右端。三个毛病：
         * 补零让 02 读成「第 2 组」而不是「2 项」；灰色 muted 又弱到不像信息；
         * 一个空框子里只装两个字符，框比内容抢眼。
         *
         * 改成「渐变数字 + 单位」：去掉框与补零，数字承接分组色所在的渐变档，
         * 后面缀一个 muted 的「项」把语义钉死。位置仍靠 ml-auto 推到右端 ——
         * 标题长度不一，右对齐才能让四个分组的计数落在同一条竖线上。
         *
         * items-baseline：数字 34px、单位 19px，基线对齐才不会看着一高一低。
         */}
        <div className="ml-auto flex flex-none items-baseline gap-[8px]">
          <span
            className="font-mono text-[34px] font-black leading-none [font-variant-numeric:tabular-nums]"
            style={{
              backgroundImage: `linear-gradient(135deg, ${spectrum[0]}, ${spectrum[1]})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {total}
          </span>
          <span className="text-[19px] leading-none text-muted">项</span>
        </div>
      </div>

      {group.items.length > 0 && (
        <div className="grid grid-cols-2 gap-x-[48px] gap-y-[32px]">
          {group.items.map((it, i) => (
            // 跨列由 spanMap 统一算：显式 wide 的、以及组尾落单的那张
            <div key={i} className={spans[i] ? "col-span-2" : undefined}>
              <Item item={it} color={color} badge={!allMaster && it.master} />
            </div>
          ))}
        </div>
      )}

      {group.subGroups?.map((sub, i) => {
        const subSpans = spanMap(sub.items)
        return (
          <div className="mt-[56px]" key={i}>
            <div className="mb-[32px] flex items-center gap-[14px] text-[28px] font-extrabold leading-[1.3] tracking-[.06em] opacity-[.62]">
              {/* flex-none 防止圆点被长标题挤成椭圆 */}
              <span className="size-[10px] flex-none rounded-[9999px] bg-fg" />
              {sub.title}
            </div>
            <div className="grid grid-cols-2 gap-x-[48px] gap-y-[32px]">
              {sub.items.map((it, j) => (
                <div key={j} className={subSpans[j] ? "col-span-2" : undefined}>
                  <Item item={it} color={color} sub />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function Help(data: HelpData) {
  const { rotate, spectrum } = data.palette

  return (
    <>
      <Page palette={data.palette} word="COMMANDS">
        <Header
          title="COMMANDS"
          status="GSCORE_ADAPTER"
          led={data.enabled ? "on" : "off"}
          rightKey="ADAPTER"
          rightValue={data.enabled ? "ENABLED" : "DISABLED"}
        />

        <Stats items={data.summary} palette={data.palette} />

        {data.groups.map((g, i) => (
          <Group
            key={i}
            group={g}
            color={rotate[i % rotate.length]}
            // 每个分组的计数取渐变上相邻两档，i 轮换 —— 与该组标题色的轮换同步推进
            spectrum={[
              spectrum[i % spectrum.length],
              spectrum[(i + 1) % spectrum.length],
            ]}
          />
        ))}
      </Page>

      <Footer
        name={data.title}
        version={data.version}
        palette={data.palette}
        lines={[data.time, "MASTER 标记的指令仅主人可用"]}
      />
    </>
  )
}
