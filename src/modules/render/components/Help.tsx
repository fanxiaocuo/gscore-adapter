/**
 * 帮助页
 *
 * 结构照 kkk 的 Help.tsx：分组标题（色条 + 巨型标题）→ 双栏条目网格 → 子分组。
 * 图标差异：kkk 用 iconify/lucide 组件，本插件不引图标库（多一个运行时依赖，
 * 且 SSR 出来的是内联 SVG，体积翻几倍），改用自己手写的一小组内联 SVG，
 * 见 Icons.tsx —— 那里也记了为什么不能用字符当图标。
 */
import type { Palette } from "../theme.js"
import { Icon, type IconName } from "./Icons.js"
import { Footer, Header, Page } from "./Layout.js"

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
  /** 运行模式，展示在右上 */
  mode: string
  /** 连接数概览 */
  summary: { key: string; value: string; sub?: string }[]
  groups: HelpGroup[]
  palette: Palette
  time: string
}

function Item({ item, color }: { item: HelpItem; color: string }) {
  return (
    <div className="hp-item">
      {/* 多一层 .row：卡片被同行更高的邻居拉高时，这一层保持内容自身的高度并贴在
          卡片顶部，图标则在这一层里居中——两件事分开，互不牵连。
          详见 styles/pages/help.ts */}
      <div className="row">
        <div
          className="ico"
          style={{ background: `${color}1f`, color, border: `1px solid ${color}3d` }}
        >
          <Icon name={item.icon} />
        </div>
        <div className="body">
          {/* cmd 与 MASTER 标签是并排的两个块，不是「标签内联在标题文字里」：
              标题会折行（全局设置那组的命令长到两三行），内联标签便跟着最后一行走，
              四张卡片能排出四种样子。做成 flex 兄弟后标签恒在首行右侧。 */}
          <div className="cmd">
            <span className="t">{item.cmd}</span>
            {item.master && (
              <span
                className="hp-tag"
                style={{ color, background: `${color}1f`, border: `1px solid ${color}3d` }}
              >
                MASTER
              </span>
            )}
          </div>
          <div className="dsc">{item.dsc}</div>
          {item.eg && <div className="eg mono">{item.eg}</div>}
        </div>
      </div>
    </div>
  )
}

function Group({ group, color }: { group: HelpGroup; color: string }) {
  const total =
    group.items.length + (group.subGroups?.reduce((n, s) => n + s.items.length, 0) || 0)

  return (
    <div className="hp-group">
      <div className="hp-group-h">
        <div className="bar" style={{ background: color }} />
        <h2>{group.title}</h2>
        <div className="n mono">{String(total).padStart(2, "0")}</div>
      </div>

      {group.items.length > 0 && (
        <div className="hp-items">
          {group.items.map((it, i) => (
            <Item key={i} item={it} color={color} />
          ))}
        </div>
      )}

      {group.subGroups?.map((sub, i) => (
        <div className="hp-sub" key={i}>
          <div className="hp-sub-h">
            <span className="d" />
            {sub.title}
          </div>
          <div className="hp-items">
            {sub.items.map((it, j) => (
              <Item key={j} item={it} color={color} />
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
          led={data.mode === "client" ? "on" : "off"}
          rightKey="RUNNING MODE"
          rightValue={data.mode}
        />

        <div className="stats">
          {data.summary.map((s, i) => (
            <div className="stat" key={i}>
              <div className="k mono">{s.key}</div>
              <div className="v" style={{ color: rotate[i % rotate.length] }}>
                {s.value}
              </div>
              {s.sub && <div className="s">{s.sub}</div>}
            </div>
          ))}
        </div>

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
