/**
 * 连接列表 / 状态页
 *
 * 版式参照 kkk 的推送列表：概览统计条 + 逐行卡片，每行左侧序号、
 * 中间主信息、右侧状态灯胶囊。
 */
import { statusRank } from "@/constants"
import type { Palette } from "../theme.js"
import { Empty, Footer, Header, Page, Section, Stats } from "./Layout.js"

/** 一条连接的展示数据 */
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
   *
   * excluded 是「写在 bind 里但又被 exclude 挡掉」的那些：它们有胶囊却没有子行，
   * 不标出来就像子行渲染丢了一条。
   */
  bots?: { id: string; name: string; avatar: string; platform?: string; excluded?: boolean }[]
  /**
   * 账号级运行时连接，一条一行
   *
   * 一条逻辑连接在运行时是 N 条 ws（一个绑定账号一条），卡片右侧那个胶囊是聚合值，
   * 看不出是哪个账号没连上。派生出多条时才给（pages.ts 判），只有一条时那个胶囊
   * 就是它，重复渲染只是噪音。
   *
   * 与面板（webui/main.tsx:386）的差别要记住：那边是 `runtime.length > 0 &&
   * (open || runtime.length > 1)` —— 单条也能靠点开看到，且**从不折叠**。这张图
   * 严格一些是因为画布是固定宽高、没有交互：点不开，也没有滚动条能往下翻。
   */
  runtime?: {
    name: string
    path: string
    /**
     * 插件自己的状态码（见 constants 的 STATUS_TEXT）
     *
     * 已经有 state 文案和 tone 了还要它：折叠时得按 STATUS_ORDER 的名次挑出最该
     * 被看见的几条，而 tone 把 2 和 3 并成了同一个 warn、把 0 归进 err，排不出序。
     */
    status: 0 | 1 | 2 | 3
    state: string
    tone: ConnRow["tone"]
    meta: string[]
  }[]
}

/**
 * 一块分组明细
 *
 * 连接卡片答「连上了没有」，这些块答「配置成什么样、转了多少」——
 * 后者原来只能去翻 config.yaml 和日志。做成 key/value 两列而不是继续堆
 * .stat 大数字卡：这类信息条目多、每条都短，大数字卡一行只放得下 4 个。
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
   * 空数组与不给是两回事：空数组是「该有连接但一条都没有」，出空态卡；
   * 不给是「这页不谈连接」（配置页、设置结果页），那块整个不出现——
   * 否则那两页会顶着一张「暂无连接」的大卡，而它们本来就不该有连接列表。
   */
  rows?: ConnRow[]
  palette: Palette
  time: string
  /** 无连接时的空态文案 */
  emptyTip?: string
  /**
   * 连接列表下方的分组明细，不给则整块不渲染
   *
   * #早柚连接列表 只回答「有哪些连接」，用不着这些，所以做成可选。
   */
  panels?: StatusPanel[]
  /**
   * 账号级子行是否折叠到 {@link RUNTIME_LIMIT} 条
   *
   * 只有 #早柚状态 折：它是概览页，子行下面还压着四块分组明细，一条核心绑十几个号
   * 时全铺开会把那些明细挤到第二屏。#早柚连接列表 不折 —— 那条命令存在的意义就是
   * 逐条枚举（卡片上的提示也是这么写的），它下面没有别的块，纵向有地方放。
   *
   * 与 pages.ts 里 collect(detail) 是同一条分界线，只是那个参数问的是另一件事
   * （要不要往 meta 里加收发计数），所以不能直接把它当这个用。
   */
  compactRuntime?: boolean
}

/** 状态色：语义色只用于状态，不参与主情绪（见 kkk tokens.md 颜色角色） */
function toneColor(p: Palette, tone: ConnRow["tone"]) {
  if (tone === "on") return p.success
  if (tone === "warn") return p.warning
  if (tone === "err") return p.danger
  return p.muted
}

/**
 * 账号级子行最多列几条（只在 {@link StatusData.compactRuntime} 时生效）
 *
 * 一条核心绑十几个号是可能的（QQBot 多实例），逐条列出会把这张卡片拉成半页、
 * 把下面的分组明细挤到第二屏。3 条足够看出「是不是有账号掉线」——前提是挑的是
 * 该看的那 3 条，见 {@link shownRuntime}；要逐个核对有 Web 面板和 #早柚连接列表，
 * 后者不折叠，全部列出。
 */
const RUNTIME_LIMIT = 3

/**
 * 折叠时真正画出来的那几条子行
 *
 * 不能按 bind 顺序取前 N 条
 * ----------------------
 * 绑了 5 个号、坏的是第 4 个时，前 3 条全是绿的，那个唯一需要人动手的账号恰好落进
 * 「+2 个账号未显示」里；卡片上剩下的线索只有主行那个聚合的「已重连 N 次」，它说
 * 「有账号在挣扎」但不说是哪个 —— 而子行存在的理由正是补上这句。所以先按
 * STATUS_ORDER 的名次（statusRank，越大越糟）挑最糟的那几条。
 *
 * 挑与画分开
 * --------
 * 挑按名次，画按原顺序（也就是 bind 的书写顺序）：显示顺序稳定，状态抖动时卡片
 * 不会重排，条数没超上限时看到的东西与折叠前逐字节一致。sort 里显式带上下标做
 * 第二比较键，不依赖 Array.prototype.sort 的稳定性 —— 同名次内必须保持 bind 顺序。
 *
 * 副作用是主行那个代表账号（pickByStatus 选出的、决定右侧胶囊颜色的那条）可能
 * **不在**列出的子行里：它状态最好，正是最先被折叠掉的。这是有意的，别「修」回去
 * ——主行已经把它的状态说了一遍，子行的位置要留给说不出来的那些。
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
                // 刻意不给 items-center：序号、主信息、胶囊三者的对齐各有讲究，
                // 由子元素各自的 self-center 决定（见下面序号那段注释）
                <div
                  className="flex gap-[26px] rounded-[28px] border border-border bg-surface px-[32px] py-[28px]"
                  key={row.index}
                >
                  {/*
                   * self-center 对齐整条连接的垂直中线。
                   *
                   * 曾经是 self-start + -mt-[7px] 去对齐「名字那一行」，那个 −7px 按
                   * 「名字 + url」两行反推：名字行高 46px 中线 23px，方块高 58px 中线 29px。
                   * 但卡片行数是变的——带 token / 重连次数时多出一行 meta 标签，三行内容下
                   * 方块就贴到卡片最上沿，与右侧胶囊也不在一条线上。居中后三者共用同一条
                   * 中线，行数再变都不会飘。
                   */}
                  <div className="w-[60px] flex-none self-center rounded-[14px] border border-border bg-inset py-[16px] text-center font-mono text-[26px] font-extrabold leading-none text-muted">
                    {String(row.index).padStart(2, "0")}
                  </div>
                  {/* min-w-0 让长 url 在下面 break-all 得以生效，否则 flex 子项不肯收缩 */}
                  <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
                    <div className="text-[38px] font-black leading-[1.2]">{row.name}</div>
                    <div className="break-all font-mono text-[23px] leading-[1.45] text-muted">
                      {row.url}
                    </div>
                    {/*
                     * bind 胶囊：头像 + 昵称 + 账号。头像可能来自外链（qlogo），
                     * 截图用 waitUntil:"load"，初始 DOM 里的图片会等加载完再截；
                     * 取不到头像的账号回退成首字圆，不会出现碎图标。
                     */}
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
                                <img className="block size-full object-cover" src={b.avatar} alt="" />
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
                            {/*
                             * 被 exclude 挡掉的账号要当场说明
                             *
                             * 这排胶囊来自原始 bind，而下面的子行是 bind - exclude 之后的
                             * 结果：不标一句的话，bind 三个号却只有两条子行，第三个看起来
                             * 像「子行渲染丢了」，而 meta 里那个光秃秃的 `exclude: 1`
                             * 说不出是哪个号。措辞与面板的「已被排除，不会转发」同源，
                             * 这里压成两个字是因为它挤在胶囊里。
                             */}
                            {b.excluded && (
                              <span className="font-mono text-[17px] leading-none text-muted">
                                已排除
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    {/*
                     * 账号级子行：一个绑定账号一条 ws，各自的状态与计数
                     *
                     * 刻意不再造一套卡片 —— 这是主信息列里的一小组紧凑行，靠一层
                     * bg-inset 与卡片区分。右侧那个大胶囊是聚合值（任一账号连上就算
                     * 这个核心通了），只有这里能看出是哪个号没连上 —— 折叠时也仍然
                     * 成立，因为挑的是状态最糟的那几条（见 shownRuntime）。
                     */}
                    {subs && (
                      <div className="mt-[6px] flex flex-col gap-[8px] rounded-[18px] bg-inset px-[18px] py-[12px]">
                        {subs.shown.map(r => {
                          const rc = toneColor(p, r.tone)
                          return (
                            // flex-wrap 是溢出兜底：bind 里的账号 id 不保证是短数字（可能是
                            // 十八九位的平台雪花号），名字 + 计数 + 状态三段定宽内容加起来能
                            // 顶破这块 bg-inset，而这一行没有任何环节会裁切或折行，状态文字
                            // 会直接漫出圆角框。给 meta 加 min-w-0 治不了：它是 flex-none，
                            // 收缩因子本身就是 0，min-width 压根不参与计算
                            <div className="flex flex-wrap items-center gap-[12px]" key={r.name}>
                              <span
                                className="size-[10px] flex-none rounded-[9999px]"
                                style={{ background: rc }}
                              />
                              <span className="flex-none font-mono text-[21px] font-bold leading-none">
                                {r.name}
                              </span>
                              {/*
                               * 只到 pathname —— 完整地址可能带 token，而这张图会发进群里。
                               * truncate 而不是 break-all：路径尾巴就是账号，左边那一列已经
                               * 写着它，折成两三行只会让这组 leading-none 的紧凑行变松散
                               * （面板 main.tsx:395 同样是 truncate）
                               */}
                              <span className="min-w-0 flex-1 truncate font-mono text-[19px] leading-none text-muted">
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
                            +{subs.hidden} 个账号未显示（异常的已优先列出）
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

        {/* 分组明细：两列铺开，每块内部是 key/value 行。
            分节标题复用 Layout 的 <Section> —— 原先借的是关于页私有的 .rt-sec，
            做成组件之后「借用」在类型上就不成立了 */}
        {data.panels && data.panels.length > 0 && (
          // column-gap 给到 64px：两列都是「左标签右取值」的两端对齐结构，列间距
          // 小于列内空档时，右列的标签会读成左列取值的一部分。
          // mt-[72px] 与 Stats 的 mb-[72px] 同值，纵向节奏一致。
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
