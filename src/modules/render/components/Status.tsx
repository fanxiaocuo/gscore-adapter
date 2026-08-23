/**
 * @description 连接列表 / 状态页
 * 版式参照 kkk 的推送列表：概览统计条 + 逐行卡片，每行左侧序号、中间主信息、右侧状态灯胶囊。
 */
import { statusRank } from "@/constants"
import type { Palette } from "../theme.js"
import { Empty, Footer, Header, Page, Section, Stats } from "./Layout.js"

/** @description 一条连接的展示数据 */
export interface ConnRow {
  index: number
  name: string
  url: string
  /** 状态文案 */
  state: string
  /** 状态色种类 */
  tone: "on" | "off" | "warn" | "err"
  /** 附加标签 */
  meta: string[]
  /**
   * bind 账号的档案（头像 + 昵称），渲染成头像胶囊；没有绑定时不给。
   * avatar 为空串时回退成首字圆 —— 未知平台的离线账号取不到图。
   * excluded 是「写在 bind 里但又被 exclude 挡掉」的那些：它们有胶囊却没有子行，不标出来就像子行渲染丢了一条。
   */
  bots?: { id: string; name: string; avatar: string; platform?: string; excluded?: boolean }[]
  /**
   * 账号级运行时连接，一条一行
   *
   * 一条逻辑连接在运行时是 N 条 ws，卡片右侧那个胶囊是聚合值、看不出是哪个账号没连上。派生出多条时才给
   * （pages.ts 判），只有一条时那个胶囊就是它。比面板严格是因为画布固定宽高、没有交互：点不开，也没有滚动条。
   */
  runtime?: {
    name: string
    path: string
    /**
     * 插件自己的状态码（见 constants 的 STATUS_TEXT）
     *
     * 已经有 state 文案和 tone 了还要它：折叠时得按 STATUS_ORDER 的名次挑出最该被看见的几条，而 tone 把 2 和 3
     * 并成了同一个 warn、把 0 归进 err，排不出序。
     */
    status: 0 | 1 | 2 | 3
    state: string
    tone: ConnRow["tone"]
    meta: string[]
  }[]
}

/**
 * @description 一块分组明细
 * 连接卡片答「连上了没有」，这些块答「配置成什么样、转了多少」。做成 key/value 两列而不是继续堆大数字卡：
 * 这类信息条目多、每条都短，大数字卡一行只放得下 4 个。
 */
export interface StatusPanel {
  /** 中文小标题 */
  title: string
  /** 标题右侧的等宽英文，与页面其他小标题一套语言 */
  key: string
  items: { k: string; v: string }[]
}

export interface StatusData {
  title: string
  version: string
  /** 适配器是否启用，展示在右上 */
  enabled: boolean
  /** 页面主标题，连接列表与状态页共用本组件 */
  heading: string
  ghost: string
  summary: { key: string; value: string; sub?: string }[]
  /**
   * 连接卡片；不给则整块不渲染
   *
   * 注意：空数组与不给是两回事 —— 空数组是「该有连接但一条都没有」，出空态卡；不给是「这页不谈连接」
   * （配置页、设置结果页），那块整个不出现，否则那两页会顶着一张「暂无连接」的大卡。
   */
  rows?: ConnRow[]
  palette: Palette
  time: string
  /** 无连接时的空态文案 */
  emptyTip?: string
  /** 连接列表下方的分组明细，不给则整块不渲染。#早柚连接列表 只回答「有哪些连接」，用不着这些 */
  panels?: StatusPanel[]
  /**
   * 账号级子行是否折叠到 {@link RUNTIME_LIMIT} 条
   *
   * 只有 #早柚状态 折：它是概览页，子行下面还压着四块分组明细，一条核心绑十几个号时全铺开会把那些明细挤到
   * 第二屏。#早柚连接列表 不折 —— 那条命令存在的意义就是逐条枚举，它下面没有别的块。
   * 注意：与 pages.ts 里 collect(detail) 是同一条分界线，但那个参数问的是另一件事（要不要往 meta 里加收发
   * 计数），不能直接拿它当这个用。
   */
  compactRuntime?: boolean
}

/** @description 状态色：语义色只用于状态，不参与主情绪 */
function toneColor(p: Palette, tone: ConnRow["tone"]) {
  if (tone === "on") return p.success
  if (tone === "warn") return p.warning
  if (tone === "err") return p.danger
  return p.muted
}

/**
 * @description 账号级子行最多列几条（只在 {@link StatusData.compactRuntime} 时生效）
 * 一条核心绑十几个号是可能的（QQBot 多实例），逐条列出会把卡片拉成半页、把分组明细挤到第二屏。3 条足够看出
 * 「是不是有账号掉线」—— 前提是挑的是该看的那 3 条，见 {@link shownRuntime}。
 */
const RUNTIME_LIMIT = 3

/**
 * @description 折叠时真正画出来的那几条子行：按状态名次挑最糟的，按 bind 原顺序画
 * 注意：不能按 bind 顺序取前 N 条 —— 绑了 5 个号、坏的是第 4 个时，前 3 条全是绿的，那个唯一需要人动手的账号
 * 恰好落进「+2 个账号未显示」里，而子行存在的理由正是补上主行说不出的那句「是哪个账号在挣扎」。
 * 注意：挑与画分开 —— 挑按名次，画按原顺序，这样状态抖动时卡片不会重排。sort 里显式带上下标做第二比较键，
 * 不依赖 Array.prototype.sort 的稳定性。
 * 注意：主行那个代表账号（决定右侧胶囊颜色的那条）可能不在列出的子行里 —— 它状态最好、最先被折叠掉。
 * 这是有意的，别「修」回去：主行已经说过它的状态，子行的位置要留给说不出来的那些。
 */
function shownRuntime(list: NonNullable<ConnRow["runtime"]>, compact?: boolean) {
  if (!compact || list.length <= RUNTIME_LIMIT) return { shown: list, hidden: 0 }
  const keep = list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => statusRank(b.r.status) - statusRank(a.r.status) || a.i - b.i)
    .slice(0, RUNTIME_LIMIT)
    .sort((a, b) => a.i - b.i)
  return { shown: keep.map(x => x.r), hidden: list.length - keep.length }
}

export function Status(data: StatusData) {
  const p = data.palette

  return (
    <>
      <Page palette={p} word={data.ghost}>
        <Header
          title={data.heading}
          status="GSCORE_ADAPTER"
          led={data.enabled ? "on" : "off"}
          rightKey="ADAPTER"
          rightValue={data.enabled ? "ENABLED" : "DISABLED"}
        />

        <Stats items={data.summary} palette={p} />

        {data.rows === undefined ? null : data.rows.length === 0 ? (
          <Empty title="暂无连接" tip={data.emptyTip || "用 #早柚添加连接 <地址> 添加"} />
        ) : (
          <div className="flex flex-col gap-[22px]">
            {data.rows.map(row => {
              const c = toneColor(p, row.tone)
              const subs = row.runtime?.length
                ? shownRuntime(row.runtime, data.compactRuntime)
                : null
              return (
                // 刻意不给 items-center：序号、主信息、胶囊三者由各自的 self-center 对齐整行中线
                <div
                  className="flex gap-[26px] rounded-[28px] border border-border bg-surface px-[32px] py-[28px]"
                  key={row.index}
                >
                  {/* self-center 对齐整条连接的垂直中线：卡片行数是变的（带 token / 重连次数时多一行 meta），
                      按「名字那一行」硬算负边距的话，三行内容下方块就贴到卡片最上沿、与右侧胶囊也不在一条线上 */}
                  <div className="w-[60px] flex-none self-center rounded-[14px] border border-border bg-inset py-[16px] text-center font-mono text-[26px] font-extrabold leading-none text-muted">
                    {String(row.index).padStart(2, "0")}
                  </div>
                  {/* min-w-0 让长 url 在下面 break-all 得以生效，否则 flex 子项不肯收缩 */}
                  <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
                    <div className="text-[38px] font-black leading-[1.2]">{row.name}</div>
                    <div className="break-all font-mono text-[23px] leading-[1.45] text-muted">
                      {row.url}
                    </div>
                    {/* bind 胶囊：头像 + 昵称 + 账号。头像可能来自外链（qlogo），截图用 waitUntil:"load"
                        会等它加载完；取不到头像的账号回退成首字圆，不会出现碎图标 */}
                    {row.bots && row.bots.length > 0 && (
                      <div className="mt-[4px] flex flex-wrap items-center gap-[10px]">
                        <span className="font-mono text-[20px] leading-none text-muted">bind</span>
                        {row.bots.map(b => (
                          <span
                            className="flex items-center gap-[9px] rounded-[9999px] border border-border bg-inset py-[4px] pr-[15px] pl-[5px]"
                            key={b.id}
                          >
                            <span className="grid size-[34px] flex-none place-items-center overflow-hidden rounded-[9999px] border border-border bg-surface text-[17px] font-bold text-muted">
                              {b.avatar ? (
                                <img
                                  className="block size-full object-cover"
                                  src={b.avatar}
                                  alt=""
                                />
                              ) : (
                                (b.name || b.id).slice(0, 1)
                              )}
                            </span>
                            {b.name && b.name !== b.id && (
                              <span className="text-[21px] font-bold leading-none">{b.name}</span>
                            )}
                            <span className="font-mono text-[19px] leading-none text-muted">
                              {b.id}
                            </span>
                            {b.platform && (
                              <span className="font-mono text-[17px] leading-none text-muted">
                                {b.platform}
                              </span>
                            )}
                            {/* 注意：被 exclude 挡掉的账号要当场说明 —— 这排胶囊来自原始 bind，而下面的子行是
                                bind - exclude 之后的结果，不标一句的话「bind 三个号却只有两条子行」看起来像
                                子行渲染丢了，而 meta 里那个光秃秃的 `exclude: 1` 说不出是哪个号 */}
                            {b.excluded && (
                              <span className="font-mono text-[17px] leading-none text-muted">
                                已排除
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* 账号级子行：一个绑定账号一条 ws，各自的状态与计数。刻意不再造一套卡片，这是主信息列里
                        的一小组紧凑行，靠一层 bg-inset 与卡片区分。右侧那个大胶囊是聚合值，只有这里能看出是
                        哪个号没连上 */}
                    {subs && (
                      <div className="mt-[6px] flex flex-col gap-[8px] rounded-[18px] bg-inset px-[18px] py-[12px]">
                        {subs.shown.map(r => {
                          const rc = toneColor(p, r.tone)
                          return (
                            // flex-wrap 是溢出兜底：bind 里的账号 id 可能是十八九位的平台雪花号，三段定宽内容
                            // 加起来能顶破这块 bg-inset，而这一行没有任何环节会裁切或折行。给 meta 加 min-w-0
                            // 治不了 —— 它是 flex-none，收缩因子本身就是 0，min-width 压根不参与计算
                            <div className="flex flex-wrap items-center gap-[12px]" key={r.name}>
                              <span
                                className="size-[10px] flex-none rounded-[9999px]"
                                style={{ background: rc }}
                              />
                              <span className="flex-none font-mono text-[21px] font-bold leading-none">
                                {r.name}
                              </span>
                              {/*
                               * 只到 pathname —— 完整地址可能带 token，而这张图会发进群里。truncate 而不是
                               * break-all：路径尾巴就是账号，左边那一列已经写着它。
                               * 注意：这一个 span 例外地不用 leading-none —— truncate 带着 overflow:hidden，
                               * 而 19px 等宽字的 ascent+descent 超过 19px 的行盒，自定义路径里的 `_`、`g`
                               * 会被切掉半截（根路径全是 `/ws/Yunzai-数字`，没有下伸笔画，所以一直没露出来）。
                               */}
                              <span className="min-w-0 flex-1 truncate font-mono text-[19px] leading-[1.2] text-muted">
                                {r.path}
                              </span>
                              {r.meta.length > 0 && (
                                <span className="flex-none font-mono text-[19px] leading-none text-muted">
                                  {r.meta.join(" · ")}
                                </span>
                              )}
                              <span
                                className="flex-none text-[20px] font-bold leading-none"
                                style={{ color: rc }}
                              >
                                {r.state}
                              </span>
                            </div>
                          )
                        })}
                        {subs.hidden > 0 && (
                          <div className="font-mono text-[19px] leading-none text-muted">
                            {/* 「异常的已优先列出」只在真有异常时说：五个号全好的时候这句话读起来像
                                「出了问题，我们把问题挑出来给你看了」 */}
                            +{subs.hidden} 个账号未显示
                            {subs.shown.some(r => r.status !== 1) && "（异常的已优先列出）"}
                          </div>
                        )}
                      </div>
                    )}
                    {row.meta.length > 0 && (
                      <div className="mt-[4px] flex flex-wrap gap-[10px]">
                        {row.meta.map((m, i) => (
                          // not-italic：em 的默认斜体在等宽字下很难看
                          <em
                            key={i}
                            className="rounded-[10px] border border-border bg-inset px-[13px] py-[5px] font-mono text-[20px] not-italic leading-[1.4] text-muted"
                          >
                            {m}
                          </em>
                        ))}
                      </div>
                    )}
                  </div>
                  {/*
                   * 状态胶囊：形由 utility 定，色由语义色内联给。
                   * 1f / 3d 是给 hex 补 alpha（约 12% 底、24% 描边），var() 拼不出来。
                   * self-center 是必须的——父级没有 items-center。
                   */}
                  <div
                    className="flex flex-none items-center gap-[11px] self-center rounded-[9999px] px-[22px] py-[14px] text-[24px] font-extrabold leading-none"
                    style={{ color: c, background: `${c}1f`, border: `1px solid ${c}3d` }}
                  >
                    <span
                      className="size-[12px] flex-none rounded-[9999px]"
                      style={{ background: c, boxShadow: `0 0 10px ${c}` }}
                    />
                    {row.state}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 分组明细：两列铺开，每块内部是 key/value 行；分节标题复用 Layout 的 <Section> */}
        {data.panels && data.panels.length > 0 && (
          // column-gap 给到 64px：两列都是「左标签右取值」的两端对齐结构，列间距小于列内空档时，右列的标签会
          // 读成左列取值的一部分。mt-[72px] 与 Stats 的 mb-[72px] 同值，纵向节奏一致
          <div className="mt-[72px] grid [grid-template-columns:repeat(2,1fr)] gap-[56px_64px]">
            {data.panels.map((panel, pi) => (
              // min-w-0：否则长取值会把这一列撑宽，两列不再等分
              <div className="min-w-0" key={pi}>
                <Section
                  title={panel.title}
                  color={p.rotate[pi % p.rotate.length]}
                  right={panel.key}
                />
                <div className="flex flex-col gap-[14px]">
                  {panel.items.map((it, ii) => (
                    // items-baseline：取值用等宽字、标签用正文字，基线对齐才不会一高一低
                    <div
                      className="flex items-baseline gap-[14px] text-[23px] leading-[1.5]"
                      key={ii}
                    >
                      <span className="flex-none text-muted">{it.k}</span>
                      {/* break-keep 同 Settings 的 facts：中文取值不在字间断开 */}
                      <span className="min-w-0 flex-1 break-words break-keep text-right font-mono font-bold">
                        {it.v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Page>

      <Footer
        name={data.title}
        version={data.version}
        palette={p}
        lines={[data.time, "#早柚帮助 查看全部指令"]}
      />
    </>
  )
}
