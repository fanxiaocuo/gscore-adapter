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
 * 把 <占位符> 包成不可断开的整块
 *
 * 指令标题里的 <地址> / <编号> 是一个语义单元，劈成两行读起来像坏了。break-keep
 * 管不了这种情况：它只禁掉 CJK 的逐字断点，而这里的断点来自「连接」与「<地址>」
 * 之间那个空格（首行被右侧 MASTER 标签挤窄后就会折在那儿）。
 *
 * 所以按 <...> 切分，占位符那段套一层 whitespace-nowrap，其余文本原样返回。
 * 只在这里做而不是整条 nowrap：整条禁折会让长标题直接溢出卡片。
 *
 * 返回 string 而非数组的快路径：绝大多数指令没有占位符，避免无谓的 <span> 包裹。
 */
function keepAtoms(cmd: string) {
  if (!cmd.includes("<")) return cmd
  return cmd.split(/(<[^<>]*>)/g).map((part, i) =>
    part.startsWith("<") && part.endsWith(">") ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    )
  )
}

function Item({ item, color, sub }: { item: HelpItem; color: string; sub?: boolean }) {
  return (
    <div
      className={
        sub
          ? "rounded-[26px] border border-border bg-surface px-[26px] py-[22px]"
          : "rounded-[26px] border border-border bg-surface px-[30px] py-[28px]"
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
           * cmd 与 MASTER 标签是并排的两个块，不是「标签内联在标题文字里」：标题会折行
           * （`#早柚添加连接 <地址>` 与连接管理那组的 `max_reconnect_attempts（retry）`
           * 都比栏宽长），内联标签就会分别落在「自己单独一行」与「第二行右边」，同一个
           * 组件排出好几种样子。做成 flex 兄弟后标签恒在首行右侧。
           */}
          <div
            className={
              sub
                ? "flex items-start gap-[12px] text-[30px] font-black leading-[1.25] tracking-[-.01em]"
                : "flex items-start gap-[12px] text-[36px] font-black leading-[1.2] tracking-[-.01em]"
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
            <span className="min-w-0 break-words break-keep">{keepAtoms(item.cmd)}</span>
            {item.master && (
              /*
               * 曾经用 vertical-align:middle + top:-3px 纠正基线，那是它还内联在文字里时
               * 的补丁。现在是 flex 兄弟，改用几何对齐：首行行高 43.2px（36×1.2）中线
               * 21.6px；标签自身 18（leading-none）+ 4×2 内边距 + 1×2 边框 = 28px，中线
               * 14px。差 7.6px，不取整——zoom 1.5 下是 11.4 个物理像素，取 8 会留 0.6px。
               */
              <span
                className="mt-[7.6px] flex-none self-start rounded-[9999px] px-[13px] py-[4px] text-[18px] font-extrabold leading-none tracking-[.08em]"
                style={{ color, background: `${color}1f`, border: `1px solid ${color}3d` }}
              >
                MASTER
              </span>
            )}
          </div>
          <div
            className={
              sub
                ? "text-[21px] leading-[1.5] whitespace-pre-line text-muted"
                : "text-[24px] leading-[1.6] whitespace-pre-line text-muted"
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

function Group({ group, color }: { group: HelpGroup; color: string }) {
  const total =
    group.items.length + (group.subGroups?.reduce((n, s) => n + s.items.length, 0) || 0)

  return (
    <div className="mb-[88px] last:mb-0">
      {/* 色条与标题都用 leading-none + items-center，色条才会正对标题的视觉中线 */}
      <div className="mb-[44px] flex items-center gap-[24px]">
        <div className="h-[56px] w-[12px] flex-none rounded-[9999px]" style={{ background: color }} />
        <h2 className="text-[64px] font-black leading-none tracking-[-.03em]">{group.title}</h2>
        {/* 计数做成描边胶囊，和标题拉开层级；leading-none 让数字在胶囊里居中 */}
        <div className="ml-auto flex-none rounded-[9999px] border border-border bg-inset px-[18px] py-[9px] font-mono text-[22px] font-extrabold leading-none tracking-[.14em] text-muted">
          {String(total).padStart(2, "0")}
        </div>
      </div>

      {group.items.length > 0 && (
        <div className="grid grid-cols-2 [align-items:start] gap-x-[48px] gap-y-[32px]">
          {group.items.map((it, i) => (
            <Item key={i} item={it} color={color} />
          ))}
        </div>
      )}

      {group.subGroups?.map((sub, i) => (
        <div className="mt-[56px]" key={i}>
          <div className="mb-[32px] flex items-center gap-[14px] text-[28px] font-extrabold leading-[1.3] tracking-[.06em] opacity-[.62]">
            {/* flex-none 防止圆点被长标题挤成椭圆 */}
            <span className="size-[10px] flex-none rounded-[9999px] bg-fg" />
            {sub.title}
          </div>
          <div className="grid grid-cols-2 [align-items:start] gap-x-[48px] gap-y-[32px]">
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
  const { rotate } = data.palette

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
          <Group key={i} group={g} color={rotate[i % rotate.length]} />
        ))}
      </Page>

      <Footer
        name={data.title}
        version={data.version}
        palette={data.palette}
        lines={[data.time, "MASTER ONLY 标记的指令仅主人可用"]}
      />
    </>
  )
}
