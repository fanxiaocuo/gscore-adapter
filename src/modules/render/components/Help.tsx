/**
 * @description 帮助页：分组标题（色条 + 巨型标题）→ 双栏条目网格 → 子分组，结构照 kkk 的 Help.tsx
 * 图标见 Icons.tsx。
 */
import type { Palette } from "../theme.js"
import { Icon, type IconName } from "./Icons.js"
import { Footer, Header, Page, Stats } from "./Layout.js"

/** @description 一条指令 */
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
}

/** @description 一个分组 */
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
 * @description 把指令标题切成若干不可断开的整块，只允许在空白处折行
 * 标题里有两种断在中间就像坏了的语义单元：指令本身（`#早柚设置私聊上报关闭` —— break-keep 只禁掉 CJK 逐字断点，
 * 管不了 `#` 与后面汉字之间那个「前置标点不能落行尾」给的断点，于是 `#` 独占一行）、以及 `<地址>` 这类占位符
 * （断点来自空格）。所以按空白切片，每片各自 nowrap。
 * 片内可能仍然超栏宽（真出现时溢出比劈开更好定位），但现行清单里最长的一片仍在子卡栏宽内。
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

/**
 * @description 一条指令。主条目与子条目版式相同（命令在上、说明在下），靠字号区分（32px vs 26px）
 * 上下结构而不是「命令列定宽 380px + 说明列占满剩余」的左右两栏：后者每行右侧固定空掉约 600px，整页高到
 * 3140px；上下结构一行能放两条（外层 2 列网格，每列约 626px），而左右两栏做不到两列（336 + 437 已超列宽）。
 * 子条目尤其需要它：参数表的 key 是拉丁长串（`max_reconnect_attempts（retry）` 28px 下宽 445px），在原来的
 * 300px 命令列里不折行而是直接溢出压在说明上 —— break-keep 为保住中文禁掉了 CJK 断点，而下划线不是合法断点。
 * 也不再用带边框的卡片：跨列那些卡内容只有左边一点，右侧大片空白被边框圈起来。
 */
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
  // 子条目：命令在上、说明在下
  if (sub) {
    return (
      <div className="flex items-start gap-[12px]">
        {/* 标记点：数据里子条目的 icon 恒为 dot，正好当参考版式里那个前缀符号用 */}
        <div className="flex-none pt-[7px] [&>svg]:block [&>svg]:size-[19px]" style={{ color }}>
          <Icon name={item.icon} />
        </div>
        <div className="min-w-0 flex-1">
          {/* 注意：这里不能只靠 break-words —— 长 key 的下划线不是断点，keep-all 又禁了 CJK 断点。
              加 [overflow-wrap:anywhere] 兜底，它允许在任意位置断，是溢出的最后一道闸 */}
          <div className="text-[26px] font-black leading-[1.3] tracking-[-.01em] break-keep [overflow-wrap:anywhere]">
            {keepAtoms(item.cmd)}
          </div>
          <div className="mt-[5px] text-[20px] leading-[1.55] break-words break-keep whitespace-pre-line text-muted">
            {item.dsc}
          </div>
          {item.eg && (
            <div className="mt-[8px] inline-block max-w-full rounded-[10px] bg-inset px-[13px] py-[7px] font-mono text-[19px] leading-[1.5] break-words break-keep text-muted">
              {item.eg}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-[22px]">
      {/* 图标：去掉外框只留图形本身（一个框里装一个 30px 图标，框比图标抢眼）。
          pt 让图标的光学中心对齐命令名首行的视觉中线 —— items-start 对齐的是盒顶，而正方形图标盒比含行距的
          文字行盒矮，不补这几像素图标会顶在标题上沿。数值按字号推：(行高 - 图标高) / 2 */}
      <div className="flex-none pt-[7px] [&>svg]:block [&>svg]:size-[30px]" style={{ color }}>
        <Icon name={item.icon} />
      </div>

      {/* 命令在上、说明在下 —— 与子条目同一个结构，理由见组件头 */}
      <div className="min-w-0 flex-1">
        <div className="text-[32px] font-black leading-[1.25] tracking-[-.01em]">
          {/* break-keep 禁掉 CJK 逐字断点，免得 `#早柚添加连接 <地址>` 在「址」「>」之间断开、留一个孤零零的
              >；拉丁长词仍由 break-words 兜底，keepAtoms 再把 <...> 整块 nowrap */}
          {keepAtoms(item.cmd)}
        </div>

        {/* 说明文字的 break-keep：默认 CJK 逐字可断，「改完即时生效」会被折成「…生 / 效」、末行吊单字。
            break-words 兜底让 `media_max_size=2097152` 这类长串硬断而非溢出 */}
        <div className="mt-[7px] text-[23px] leading-[1.6] break-words break-keep whitespace-pre-line text-muted">
          {item.dsc}
        </div>

        {/* 混合分组（组里只有部分指令要主人权限）才走到这里。放在说明之后而不是命令名下方：上下结构里命令名
            与说明是连着读的一束，中间插一个胶囊会把它们切断 */}
        {badge && (
          <span
            className="mt-[8px] inline-block rounded-[9999px] px-[12px] py-[4px] text-[17px] font-extrabold leading-none tracking-[.08em]"
            style={{ color, background: `${color}1f` }}
          >
            MASTER
          </span>
        )}

        {/* 示例：极淡底色的一条，break-keep 的理由同上（`name=主核心` 不能被拆成「name=主 / 核心」）。
            inline-block 让底色只包住文字，不被拉成整行宽 */}
        {item.eg && (
          <div className="mt-[10px] inline-block max-w-full rounded-[10px] bg-inset px-[15px] py-[7px] font-mono text-[20px] leading-[1.5] break-words break-keep text-muted">
            {item.eg}
          </div>
        )}
      </div>
    </div>
  )
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
        {/* 分组计数：渐变数字 + muted 的「项」，不加框也不补零（补零会让 02 读成「第 2 组」而不是「2 项」）。
            ml-auto 推到右端，标题长度不一时右对齐才能让各组计数落在同一条竖线上；items-baseline 让 34px 的
            数字与 19px 的单位基线对齐 */}
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

      {/* 条目区：只靠缩进归组，不再画竖线。
          pl 的值不是随手给的 —— 标题那行是「12px 色条 + 24px 间距」，34px 让条目文字正对标题首字，
          缩进本身就说清了从属关系。原先还有一条贯通的分组色竖线，去掉了：一页三四组就是三四条竖线，
          而它标的是缩进已经标过的同一件事，重复的分隔线只会把版面切碎 */}
      {group.items.length > 0 && (
        <div
          /*
           * 主条目走多列流式（CSS columns），不是 grid
           *
           * grid 有个改不掉的毛病：行高由该行最高的那条决定。「#早柚添加连接」带三行说明加一条示例，同行的
           * 「#早柚重载」只有一行说明，底下就空出约 130px —— 而条目高度参差是这份数据的常态。
           * CSS columns 是流式的：条目按高度自动分配到两栏、栏底自然对齐。代价是阅读顺序变成「先读完左栏再读
           * 右栏」，对并列的指令清单无所谓。
           * 注意：break-inside:avoid 必须给 —— 不给的话一条会被拆到两栏（命令名在左栏底、说明跑到右栏顶）。
           */
          className="[column-count:2] [column-gap:44px] pl-[34px] [&>*]:mb-[30px] [&>*]:[break-inside:avoid]"
        >
          {group.items.map((it, i) => (
            <Item key={i} item={it} color={color} badge={!allMaster && it.master} />
          ))}
        </div>
      )}

      {group.subGroups?.map((sub, i) => (
        <div className="mt-[52px]" key={i}>
          <div className="mb-[28px] flex items-center gap-[14px] text-[28px] font-extrabold leading-[1.3] tracking-[.06em] opacity-[.62]">
            {/* flex-none 防止圆点被长标题挤成椭圆 */}
            <span className="size-[10px] flex-none rounded-[9999px] bg-fg" />
            {sub.title}
          </div>
          {/* 子条目同样走多列流式，理由与主条目那段一致；break-inside:avoid 同样不能省。
              竖线一并去掉了 —— 子分组这条比主分组那条更淡（2e vs 47），淡到几乎看不见还占着一列缩进 */}
          <div className="[column-count:2] [column-gap:44px] pl-[30px] [&>*]:mb-[26px] [&>*]:[break-inside:avoid]">
            {sub.items.map((it, j) => (
              <Item key={j} item={it} color={color} sub />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function Help(data: HelpData) {
  const { rotate, spectrum } = data.palette

  return (
    <>
      <Page word="COMMANDS">
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
            spectrum={[spectrum[i % spectrum.length], spectrum[(i + 1) % spectrum.length]]}
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
