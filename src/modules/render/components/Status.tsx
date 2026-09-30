/**
 * @description 连接列表 / 状态页
 * 版式：概览统计条 + 逐行卡片，每行左侧序号、中间主信息、右侧状态灯胶囊
 */
import { statusRank } from "@/constants"
import type { Palette } from "../theme.js"
import { Empty, Footer, GLASS, Header, Page, Section, Stats } from "./Layout.js"

/**
 * @description 一个 bind 账号：档案 + 它那条 ws 的运行时状态
 * 合成一层而非「头像胶囊 + runtime 子行」两块并列 —— 两块枚举同一份账号会让同一号码在一张卡出现三次、计数重复三次，读者还得两块对着看
 */
export interface ConnAccount {
  id: string
  name: string
  avatar: string
  platform?: string
  /**
   * 写在 bind 里但被 exclude 挡掉：没有 ws，所以没有 {@link rt}
   * 仍列出来 —— 它确实绑了只是不会连，藏掉就看不出配置矛盾，而 meta 里 `exclude: 1` 说不出是哪个号
   */
  excluded?: boolean
  /** 这个账号那条 ws 的运行时状态。只派生一条时不给（卡片右侧那个胶囊就是它） */
  rt?: {
    /**
     * 插件自己的状态码（见 constants 的 STATUS_TEXT）
     * 已有 state 与 tone 还要它：折叠时要按 STATUS_ORDER 名次挑几条，而 tone 把 2、3 并成 warn、把 0 归进 err，排不出序
     */
    status: 0 | 1 | 2 | 3
    state: string
    tone: ConnRow["tone"]
    meta: string[]
  }
}

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
   * bind 账号，一个一行；没有绑定时不给
   * avatar 为空串时回退成首字圆 —— 未知平台的离线账号取不到图
   */
  accounts?: ConnAccount[]
}

/**
 * @description 一块分组明细
 * 做成 key/value 两列而非大数字卡：这类信息条目多、每条都短，大数字卡一行只放得下 4 个
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
   * 注意：空数组与不给是两回事 —— 空数组是「该有连接但一条都没有」出空态卡；不给是「这页不谈连接」（配置页、设置结果页）整块不出现，否则会顶着一张「暂无连接」大卡
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
   * 只有 #早柚状态 折：它是概览页、子行下压着四块分组明细，全铺开会把明细挤到第二屏。#早柚连接列表 不折 —— 它就是逐条枚举、下面没别的块
   * 注意：与 pages.ts 里 collect(detail) 是同一条分界线，但那个参数问的是另一件事（要不要往 meta 加收发计数），不能拿来当这个用
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
 * @description 账号行最多列几条（只在 {@link StatusData.compactRuntime} 时生效）
 * 一条核心可能绑十几个号（QQBot 多实例），逐条列出会把明细挤到第二屏。3 条足够看出有没有账号掉线 —— 前提是挑的是该看的那 3 条，见 {@link shownAccounts}
 */
const RUNTIME_LIMIT = 3

/**
 * @description 折叠优先级：真故障 > 被 exclude > 正常
 * 被 exclude 的账号没有 ws、没状态码，它是配置矛盾（非故障也非正常），排在正常之上、任何异常之下。×2 是为在 statusRank 整数档间腾出 1：正常 0 < 被排除 1 < warn 2 < err 4 < 未启动 6
 */
function foldRank(a: ConnAccount): number {
  return a.rt ? statusRank(a.rt.status) * 2 : 1
}

/**
 * @description 折叠时真正画出来的那几行：按名次挑最该被看见的，按 bind 原顺序画
 * 注意：不能按 bind 顺序取前 N 条 —— 绑 5 个号、坏的是第 4 个时前 3 条全绿，那个唯一要人动手的账号恰好落进「+N 个账号未显示」
 * 注意：挑与画分开 —— 挑按名次、画按原顺序，状态抖动时卡片不重排。sort 显式带下标做第二比较键，不依赖 sort 稳定性
 * 注意：主行代表账号（决定右侧胶囊颜色的那条）可能不在列出的行里（它状态最好、最先被折叠）。这是有意的别「修」回去：这几行的位置要留给主行说不出来的那些
 */
function shownAccounts(list: ConnAccount[], compact?: boolean) {
  if (!compact || list.length <= RUNTIME_LIMIT) return { shown: list, hidden: 0 }
  const keep = list
    .map((a, i) => ({ a, i }))
    .sort((x, y) => foldRank(y.a) - foldRank(x.a) || x.i - y.i)
    .slice(0, RUNTIME_LIMIT)
    .sort((x, y) => x.i - y.i)
  return { shown: keep.map(x => x.a), hidden: list.length - keep.length }
}

export function Status(data: StatusData) {
  const p = data.palette

  return (
    <>
      <Page word={data.ghost}>
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
              const subs = row.accounts?.length
                ? shownAccounts(row.accounts, data.compactRuntime)
                : null
              return (
                // 刻意不给 items-center：序号与胶囊 self-start 钉在标题行（见下），主信息列自己撑高
                <div
                  className={`flex gap-[26px] rounded-[28px] px-[32px] py-[28px] ${GLASS}`}
                  key={row.index}
                >
                  {/*
                   * 对齐标题行而非卡片中线：卡片高度差很大（带子行的 480px、只有名字加地址的 100px），
                   * self-center 在高卡上会把序号推到第三四行、离标题两百多像素。
                   * 负边距按 (标题行高 - 自身高) / 2 推：标题 38px × 1.2 = 45.6 行盒，本块 16+26+16 = 58 高，所以 -6
                   */}
                  <div className="mt-[-6px] w-[60px] flex-none self-start rounded-[14px] border border-border bg-inset py-[16px] text-center font-mono text-[26px] font-extrabold leading-none text-muted">
                    {String(row.index).padStart(2, "0")}
                  </div>
                  {/* min-w-0 让长 url 在下面 break-all 得以生效，否则 flex 子项不肯收缩 */}
                  <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
                    <div className="text-[38px] font-black leading-[1.2]">{row.name}</div>
                    <div className="break-all font-mono text-[23px] leading-[1.45] text-muted">
                      {row.url}
                    </div>
                    {/*
                     * bind 账号，一个一行：头像 + 昵称 + 账号 + 平台 + 状态点 + 该账号的计数。
                     * 合成一层（账号只出现一次），靠 bg-inset 与卡面区分不另造卡片。
                     * 头像可能来自外链（qlogo），截图用 waitUntil:"load" 会等它加载完；取不到头像回退成首字圆
                     */}
                    {subs && (
                      <div className="mt-[6px] flex flex-col gap-[10px] self-start rounded-[18px] bg-inset px-[18px] py-[14px]">
                        {subs.shown.map(a => {
                          // 没有 rt 的是被 exclude 挡掉的号：没有 ws 也没状态色，点用 muted
                          const rc = a.rt ? toneColor(p, a.rt.tone) : p.muted
                          return (
                            // flex-wrap 是溢出兜底：账号 id 可能是十八九位雪花号，几段定宽内容能顶破 bg-inset 而本行无处裁切折行。给 meta 加 min-w-0 治不了 —— 它是 flex-none、收缩因子为 0，min-width 不参与计算
                            <div className="flex flex-wrap items-center gap-[12px]" key={a.id}>
                              <span
                                className="size-[11px] flex-none rounded-[9999px]"
                                style={{ background: rc }}
                              />
                              <span className="grid size-[36px] flex-none place-items-center overflow-hidden rounded-[9999px] border border-border bg-surface text-[17px] font-bold text-muted">
                                {a.avatar ? (
                                  <img
                                    className="block size-full object-cover"
                                    src={a.avatar}
                                    alt=""
                                  />
                                ) : (
                                  (a.name || a.id).slice(0, 1)
                                )}
                              </span>
                              {a.name && a.name !== a.id && (
                                <span className="flex-none text-[22px] font-bold leading-none">
                                  {a.name}
                                </span>
                              )}
                              <span className="flex-none font-mono text-[21px] leading-none text-muted">
                                {a.id}
                              </span>
                              {a.platform && (
                                <span className="flex-none font-mono text-[18px] leading-none text-muted">
                                  {a.platform}
                                </span>
                              )}
                              {/*
                               * ml-auto 把右侧那组推到行尾，空的时候也照样渲染。
                               * 恒渲染是为右缘对齐：正常账号 meta 空、status 1，右组一字没有；重连的那个有「已重连 N 次」。
                               * 「空就不渲染」会让同块内右缘跨度差 325px。空右组宽度为 0 不撑宽块（块宽由最宽行定，外层 self-start），ml-auto 只在块内分配剩余空间，「块贴合内容」与「右缘对齐」同时成立
                               */}
                              <span className="ml-auto flex flex-none items-center gap-[12px]">
                                {a.excluded && (
                                  <span className="font-mono text-[19px] leading-none text-muted">
                                    已排除
                                  </span>
                                )}
                                {a.rt && a.rt.meta.length > 0 && (
                                  <span className="font-mono text-[19px] leading-none text-muted">
                                    {a.rt.meta.join(" · ")}
                                  </span>
                                )}
                                {/*
                                 * 状态文字只在异常时出，正常行一字不给：左边点已按 tone 上色、右上大胶囊也说过「已连接」，每行再写一遍是第三遍，四行绿字会把唯一那行橙的淹掉。
                                 * 注意：判据用 status 而非 tone —— tone 把 warn/err 之外都归一类，分不出「已连接」和该说出来的「已停用」
                                 */}
                                {a.rt && a.rt.status !== 1 && (
                                  <span
                                    className="text-[20px] font-bold leading-none"
                                    style={{ color: rc }}
                                  >
                                    {a.rt.state}
                                  </span>
                                )}
                              </span>
                            </div>
                          )
                        })}
                        {subs.hidden > 0 && (
                          <div className="font-mono text-[19px] leading-none text-muted">
                            {/* 「异常的已优先列出」只在真有异常时说：全好时这句读起来像「出了问题，已挑出来给你看」 */}
                            +{subs.hidden} 个账号未显示
                            {subs.shown.some(a => a.rt && a.rt.status !== 1) &&
                              "（异常的已优先列出）"}
                          </div>
                        )}
                      </div>
                    )}
                    {row.meta.length > 0 && (
                      <div className="mt-[4px] flex flex-wrap gap-[10px]">
                        {row.meta.map((m, i) => (
                          // not-italic：em 的默认斜体在等宽字下难看
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
                   * 状态胶囊：形由 utility 定、色由语义色内联给。1f / 3d 是给 hex 补 alpha（约 12% 底、24% 描边），var() 拼不出来。
                   * self-start + 负边距对齐标题行（同左侧序号块）：本块 14+24+14 = 52 高，(45.6 - 52) / 2 ≈ -3
                   */}
                  <div
                    className="mt-[-3px] flex flex-none items-center gap-[11px] self-start rounded-[9999px] px-[22px] py-[14px] text-[24px] font-extrabold leading-none"
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

        {/* 分组明细：两列铺开，每块内部 key/value 行；分节标题复用 Layout 的 <Section> */}
        {data.panels && data.panels.length > 0 && (
          // column-gap 给 64px：两列都是「左标签右取值」两端对齐，列间距小于列内空档时右列标签会读成左列取值的一部分。mt-[72px] 与 Stats 的 mb-[72px] 同值
          <div className="mt-[72px] grid [grid-template-columns:repeat(2,1fr)] gap-[56px_64px]">
            {data.panels.map((panel, pi) => (
              // min-w-0：否则长取值会把这列撑宽、两列不再等分
              <div className="min-w-0" key={pi}>
                <Section
                  title={panel.title}
                  color={p.rotate[pi % p.rotate.length]}
                  right={panel.key}
                />
                <div className="flex flex-col gap-[14px]">
                  {panel.items.map((it, ii) => (
                    // items-baseline：取值用等宽字、标签用正文字，基线对齐才不一高一低
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
