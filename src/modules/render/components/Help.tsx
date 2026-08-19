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

/**
 * 一条指令：无边框，命令与说明分两栏同行
 *
 * 为什么不再用卡片
 * --------------
 * 原先每条是「带边框的卡片」，双栏网格排布，长的靠 spanMap 跨两列。问题出在跨列那
 * 些卡：内容只有左边一点，右侧大片空白被边框圈起来，成了整页最扎眼的地方（用户圈
 * 出来的六处全是这个）。根子不在边框粗细，而在「用框去撑一个填不满的宽度」。
 *
 * 改成单列 + 命令/说明两栏同行：说明自己就占住右侧，宽度由内容决定而不是由框决定，
 * 空白无处可留。顺带 spanMap 那套跨列补齐的逻辑整个不需要了。
 *
 * 命令列定宽 380px（sub 300px）
 * ---------------------------
 * 定宽而不是 auto：auto 会让每行的说明起点参差，整组读下来像锯齿。380px 是按最长
 * 那条量的 —— `#早柚设置私聊上报关闭` 十个中文加一个半角 #，32px 字号下约 336px，
 * 留一点余量。`#早柚添加连接 <地址>` 更短（约 296px），但它含空格与占位符，仍靠
 * keepAtoms 把 <...> 整块 nowrap，避免那个 > 孤零零掉到第二行。
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
  return (
    <div className={sub ? "flex items-start gap-[18px]" : "flex items-start gap-[22px]"}>
      {/*
       * 图标：去掉外框，只留图形本身
       *
       * 原来是 60px 的圆角框 + 1px 描边 + 底色。取消边框这件事对它同样成立 ——
       * 一个框里装一个 30px 图标，框比图标抢眼。现在直接给图形上色。
       *
       * pt 是为了让图标的光学中心对齐命令名首行的视觉中线：flex 的 items-start
       * 对齐的是盒顶，而图标盒（正方形）比文字行盒（含行距）矮，不补这几像素图标
       * 会顶在标题上沿。数值按字号推：(行高 - 图标高) / 2。
       */}
      <div
        className={
          sub
            ? "flex-none pt-[5px] [&>svg]:block [&>svg]:size-[24px]"
            : "flex-none pt-[7px] [&>svg]:block [&>svg]:size-[30px]"
        }
        style={{ color }}
      >
        <Icon name={item.icon} />
      </div>

      {/* 命令名列 */}
      <div className={sub ? "w-[300px] flex-none" : "w-[380px] flex-none"}>
        <div
          className={
            sub
              ? "text-[28px] font-black leading-[1.25] tracking-[-.01em]"
              : "text-[32px] font-black leading-[1.25] tracking-[-.01em]"
          }
        >
          {/*
           * break-words + break-keep 的取舍在这里仍然成立（原注释摘要）：
           * keep-all 禁掉 CJK 的逐字断点，免得 `#早柚添加连接 <地址>` 在「址」「>」
           * 之间断开、留一个孤零零的 >；拉丁长词（`max_reconnect_attempts（retry）`）
           * 仍由 break-words 兜底硬断，两者不冲突。keepAtoms 再把 <...> 整块 nowrap。
           */}
          {keepAtoms(item.cmd)}
        </div>
        {/*
         * 混合分组（组里只有部分指令要主人权限）才走到这里。放在命令名下方而不是
         * 右侧：命令列是定宽的，标签挤进去会把标题压折。
         */}
        {badge && (
          <span
            className="mt-[8px] inline-block rounded-[9999px] px-[12px] py-[4px] text-[17px] font-extrabold leading-none tracking-[.08em]"
            style={{ color, background: `${color}1f` }}
          >
            MASTER
          </span>
        )}
      </div>

      {/* 说明列：占满剩余宽度，这一栏的存在就是为了让右侧不再空 */}
      <div className={sub ? "min-w-0 flex-1 pt-[2px]" : "min-w-0 flex-1 pt-[3px]"}>
        {/*
         * 说明文字的 break-keep：默认 CJK 逐字可断，于是「改完即时生效」被折成
         * 「…生 / 效」、末行吊单字。keep-all 后断点落在标点与空格上。
         * break-words 兜底：`media_max_size=2097152` 这类长串仍硬断而非溢出。
         */}
        <div
          className={
            sub
              ? "text-[20px] leading-[1.55] break-words break-keep whitespace-pre-line text-muted"
              : "text-[23px] leading-[1.6] break-words break-keep whitespace-pre-line text-muted"
          }
        >
          {item.dsc}
        </div>
        {/*
         * 示例：也去掉了边框，改成极淡底色的一条。break-keep 的理由同上 ——
         * 示例是「#早柚添加连接 127.0.0.1:8765 name=主核心」这种空格分段的参数串，
         * 默认可在任意 CJK 字之间断，会把 name=主核心 拆成「name=主 / 核心」。
         * inline-block（而不是块级）让底色只包住文字，不被拉成整行宽。
         */}
        {item.eg && (
          <div
            className={
              sub
                ? "mt-[8px] inline-block max-w-full rounded-[10px] bg-inset px-[13px] py-[7px] font-mono text-[19px] leading-[1.5] break-words break-keep text-muted"
                : "mt-[10px] inline-block max-w-full rounded-[10px] bg-inset px-[15px] py-[7px] font-mono text-[20px] leading-[1.5] break-words break-keep text-muted"
            }
          >
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

      {/*
       * 条目区：左侧一条贯通竖线把同组圈住，单列纵向排列
       *
       * 双栏网格取消了。原来靠 spanMap 把「显式 wide 的」与「组尾落单的」拉成跨列，
       * 但跨列卡的右半边填不满，边框一圈就是用户圈出来的那六处空白。单列 + 命令/说明
       * 两栏（见 Item）之后，宽度由内容自己占满，没有可留白的地方，spanMap 也随之
       * 删掉。
       *
       * 竖线走 border-left 而不是伪元素：这一层是纯静态的块，没有激活态要动，
       * border 最省事；出图也不存在「激活时文字横跳」那种顾虑（那是文档站的事）。
       * 颜色取分组色压到 28% —— 满色的一条竖线比标题还抢眼。
       */}
      {group.items.length > 0 && (
        <div
          className="flex flex-col gap-[30px] pl-[34px]"
          style={{ borderLeft: `2px solid ${color}47` }}
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
          {/* 子分组的竖线更淡一档，和主分组区分层级 */}
          <div
            className="flex flex-col gap-[24px] pl-[30px]"
            style={{ borderLeft: `2px solid ${color}2e` }}
          >
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
