/**
 * @description 设置页：逐行开关列表，一行一项，左侧图标与中文名，右侧开关胶囊或取值
 * 名字下面那行灰字既解释这项是什么、也直接给出改它的指令。与手机上的设置菜单同形 —— 用户看这页时手里正拿着手机。
 * 不复用 Status：那套「四张大数字卡 + 两列 key/value」答的是「现在是多少」，而两列明细里开关项与数值项长得
 * 完全一样，扫一眼看不出哪些开着，「改法」还得单独占一行挤在每块末尾。
 * 与 Help.tsx 的分工：那页列「有哪些指令」，这页列「每项现在是什么值」；这里的卡片是单列整宽的，因为开关必须
 * 在同一条竖线上对齐才扫得快。
 */
import type { Palette } from "../theme.js"
import { Icon, type IconName } from "./Icons.js"
import { Footer, GLASS, Header, Page } from "./Layout.js"

/** @description 一项设置 */
export interface SettingRow {
  /** 中文项目名 */
  name: string
  /** 一行说明，兼作改法提示 —— 指令就跟在它所改的那一项下面，而不是每块末尾单独一行 */
  dsc: string
  icon: IconName
  /**
   * 开关状态：true/false 出胶囊，undefined 表示这项不是开关（出 value）
   *
   * 不用 `on?: boolean` 加 `value?: string` 的联合类型：两个可选字段的组合在 TS 上表达不出「恰好给一个」，
   * 而运行时这里只需要「有没有 on」这一个判断。
   */
  on?: boolean
  /** 非开关项的取值，如 `2.00 MiB` */
  value?: string
}

/** @description 一组设置 */
export interface SettingGroup {
  /** 中文小标题 */
  title: string
  /** 标题右侧的等宽英文，与页面其他小标题一套语言 */
  key: string
  rows: SettingRow[]
}

/**
 * @description 只读信息块：指令改不了但仍该看得见的项（调参与运行时事实）
 * 做成 key/value 两列而不是继续排成开关行 —— 开关行的右侧位置是留给「可以改的东西」的，把不可改的项也排进去
 * 会让人去找它的开关。
 */
export interface SettingFacts {
  title: string
  key: string
  items: { k: string; v: string }[]
}

export interface SettingsData {
  title: string
  version: string
  enabled: boolean
  /** 页面主标题，设置菜单页与改动结果页共用本组件 */
  heading: string
  ghost: string
  palette: Palette
  time: string
  groups: SettingGroup[]
  /** 只读信息，不给则整块不渲染 */
  facts?: SettingFacts[]
  /**
   * 顶部结果条：改动成功与失败的清单，不给则不渲染
   *
   * 排在设置列表之上：改完那次的回复要先回答「刚才那条指令生效了吗」，再顺带展示当前全貌。
   */
  result?: { done: string[]; errs: string[] }
  /** 页脚第二行提示 */
  tip?: string
}

/** @description 开关胶囊：开用 success、关用 muted */
function Toggle({ on, palette }: { on: boolean; palette: Palette }) {
  const c = on ? palette.success : palette.muted
  return (
    <div
      className="flex flex-none items-center gap-[12px] self-center rounded-[9999px] px-[24px] py-[15px] text-[25px] font-extrabold leading-none"
      style={{ color: c, background: `${c}1f`, border: `1px solid ${c}3d` }}
    >
      {/* 胶囊里那颗点兼当「滑块」：真做一个 iOS 式的轨道+滑块要 60px 宽，而这一列还要放「关闭」两个字，
          并排会把右侧撑到三分之一页宽。一颗发光的点 + 文字已经足够区分状态 */}
      <span
        className="size-[13px] flex-none rounded-[9999px]"
        style={{ background: c, boxShadow: on ? `0 0 10px ${c}` : undefined }}
      />
      {on ? "开启" : "关闭"}
    </div>
  )
}

/** 非开关项的取值胶囊：等宽字，描边比开关轻一档（它不表达状态） */
function Value({ text }: { text: string }) {
  return (
    <div className="flex-none self-center rounded-[9999px] border border-border bg-inset px-[24px] py-[15px] font-mono text-[25px] font-extrabold leading-none">
      {text}
    </div>
  )
}

/** @description 一行设置 */
function Row({ row, color, palette }: { row: SettingRow; color: string; palette: Palette }) {
  return (
    // 整宽单列卡片。刻意不给 items-center：三者各自 self-center 对齐整行中线，文字块自身按内容撑高（说明可能折行）
    <div className={`flex gap-[26px] rounded-[28px] px-[32px] py-[26px] ${GLASS}`}>
      <div
        className="grid size-[62px] flex-none place-items-center self-center rounded-[18px] [&>svg]:block [&>svg]:size-[30px]"
        style={{ background: `${color}1f`, color, border: `1px solid ${color}3d` }}
      >
        <Icon name={row.icon} />
      </div>
      {/* min-w-0 让长说明得以收缩换行，否则 flex 子项不肯让步 */}
      <div className="flex min-w-0 flex-1 flex-col gap-[8px] self-center">
        <div className="text-[34px] font-black leading-[1.2]">{row.name}</div>
        {/* break-keep：说明里嵌着 #早柚设置私聊上报关闭 这类指令，CJK 逐字断点会把它劈成两半 */}
        <div className="text-[23px] leading-[1.5] break-words break-keep text-muted">{row.dsc}</div>
      </div>
      {row.on === undefined ? (
        <Value text={row.value || ""} />
      ) : (
        <Toggle on={row.on} palette={palette} />
      )}
    </div>
  )
}

/**
 * @description 分组标题：色条 + 中文标题 + 右侧等宽英文
 * 比 Layout 的 <Section> 重一档，因为这页的分组是主结构（一屏只有三四组，每组下面是好几行整宽卡片，标题太轻
 * 会被卡片吃掉）；但也没到 Help.tsx 那种 64px 巨型标题 —— 这页各组之间的关系更紧。
 */
function GroupTitle({ title, right, color }: { title: string; right: string; color: string }) {
  return (
    <div className="mb-[28px] flex items-center gap-[18px]">
      <div className="h-[40px] w-[9px] flex-none rounded-[9999px]" style={{ background: color }} />
      <h2 className="text-[40px] font-black leading-none tracking-[-.02em]">{title}</h2>
      <span className="flex-none font-mono text-[22px] font-extrabold leading-none tracking-[.16em] text-muted">
        {right}
      </span>
      <span
        className="h-[3px] max-w-[220px] flex-1 rounded-[9999px] opacity-[.55]"
        style={{ background: `linear-gradient(90deg,${color},transparent)` }}
      />
    </div>
  )
}

/**
 * @description 改动结果条：成功项用 success 色、失败项用 danger 色，各自一行
 * 不做成卡片网格 —— 一次指令通常只改一两项，网格会为了对齐留出大片空白。
 */
function Result({ done, errs, palette }: { done: string[]; errs: string[]; palette: Palette }) {
  const rows: { text: string; color: string; ok: boolean }[] = [
    ...done.map(t => ({ text: t, color: palette.success, ok: true })),
    ...errs.map(t => ({ text: t, color: palette.danger, ok: false })),
  ]
  if (!rows.length) return null

  return (
    <div className="mb-[64px] flex flex-col gap-[16px]">
      {rows.map((r, i) => (
        <div
          // break-keep：错误行里嵌着「可设置：适配器 / 仅响应at / …」这类清单，CJK 逐字断点会把「更新检查」
          // 劈成「更新检 / 查」（预览里实际出现过）；keep-all 让断点落在 / 与空格上
          className="flex items-center gap-[20px] rounded-[24px] border border-l-[6px] px-[30px] py-[24px] text-[27px] leading-[1.5] break-words break-keep"
          key={i}
          style={{ color: r.color, background: `${r.color}14`, borderColor: `${r.color}3d` }}
        >
          {/* 成功/失败的记号用图标而不是 ✓ ✗ 字符，理由同 Icons.tsx 的文件头 */}
          <span className="grid size-[34px] flex-none place-items-center [&>svg]:block [&>svg]:size-[30px]">
            <Icon name={r.ok ? "check" : "cross"} />
          </span>
          <span className="min-w-0 flex-1 font-extrabold">{r.text}</span>
        </div>
      ))}
    </div>
  )
}

export function Settings(data: SettingsData) {
  const p = data.palette

  return (
    <>
      <Page palette={p} word={data.ghost} ghostTop={420}>
        <Header
          title={data.heading}
          status="GSCORE_ADAPTER"
          led={data.enabled ? "on" : "off"}
          rightKey="ADAPTER"
          rightValue={data.enabled ? "ENABLED" : "DISABLED"}
        />

        {data.result && <Result {...data.result} palette={p} />}

        {/* 组间距比组内行距大得多（68 vs 18），分组关系才立得住 */}
        <div className="flex flex-col gap-[68px]">
          {data.groups.map((g, gi) => {
            const color = p.rotate[gi % p.rotate.length]
            return (
              <div key={gi}>
                <GroupTitle title={g.title} right={g.key} color={color} />
                <div className="flex flex-col gap-[18px]">
                  {g.rows.map((r, ri) => (
                    <Row key={ri} row={r} color={color} palette={p} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* 只读信息：两列铺开，与开关列表之间留出比组间距更大的空档 —— 它答的是另一个问题 */}
        {data.facts && data.facts.length > 0 && (
          <div className="mt-[84px] grid [grid-template-columns:repeat(2,1fr)] gap-[48px_64px]">
            {data.facts.map((f, fi) => (
              // min-w-0：否则长取值会把这一列撑宽，两列不再等分
              <div className="min-w-0" key={fi}>
                <GroupTitle
                  title={f.title}
                  right={f.key}
                  color={p.rotate[(data.groups.length + fi) % p.rotate.length]}
                />
                <div className="flex flex-col gap-[14px]">
                  {f.items.map((it, ii) => (
                    // items-baseline：取值用等宽字、标签用正文字，基线对齐才不会一高一低
                    <div
                      className="flex items-baseline gap-[14px] text-[23px] leading-[1.5]"
                      key={ii}
                    >
                      <span className="flex-none text-muted">{it.k}</span>
                      {/* break-keep：取值可能是「间隔 5s 起 · 最多 5 次」这类中文串；break-words 兜底防溢出 */}
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
        lines={[data.time, data.tip || "#早柚帮助 查看全部指令"]}
      />
    </>
  )
}
