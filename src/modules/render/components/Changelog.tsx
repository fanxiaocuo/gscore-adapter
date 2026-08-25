/**
 * @description 更新日志页：沿用 Status 的骨架（统计条 + 逐行卡片），把「连接」换成「提交」
 * 左侧短 hash 当序号，中间标题，右侧提交时间。按 git 提交列而没有版本段落，所以「新提交 / 本地提交」两种语境
 * 共用一套行，靠 heading 与 tip 区分。
 */
import type { Palette } from "../theme.js"
import type { Commit } from "@/modules/update/git.js"
import { Empty, Footer, GLASS, Header, Notice, Page, Stats } from "./Layout.js"

export interface ChangelogData {
  title: string
  version: string
  /** 页面主标题 */
  heading: string
  ghost: string
  /** 顶部状态灯：有更新亮黄，已最新亮绿 */
  led: "on" | "off" | "warn"
  /** 右上角的键值 */
  rightKey: string
  rightValue: string
  summary: { key: string; value: string; sub?: string }[]
  commits: Commit[]
  /** 列表为空时的说明 */
  emptyTitle: string
  emptyTip: string
  palette: Palette
  time: string
  /** 顶部提示条，例如 fetch 失败的原因 */
  notice?: string
}

export function Changelog(data: ChangelogData) {
  const p = data.palette

  return (
    <>
      <Page word={data.ghost}>
        <Header
          title={data.heading}
          status="GSCORE_ADAPTER"
          led={data.led}
          rightKey={data.rightKey}
          rightValue={data.rightValue}
        />

        <Stats items={data.summary} palette={p} />

        {data.notice && <Notice text={data.notice} color={p.warning} />}

        {data.commits.length === 0 ? (
          <Empty title={data.emptyTitle} tip={data.emptyTip} />
        ) : (
          <div className="flex flex-col gap-[18px]">
            {data.commits.map((c, i) => (
              // align-items:center 而不是 flex-start：右侧「标题 + 时间」两行、左边短 hash 只有一行，
              // 顶对齐会让 hash 明显偏上
              <div
                className={`flex items-center gap-[28px] rounded-[24px] px-[32px] py-[26px] ${GLASS}`}
                key={c.hash + i}
              >
                {/* hash 做成独立胶囊：等宽 + 定宽让标题左边缘对齐成一列，淡底把它和标题分层。
                    颜色用主情绪色轮换（纯灰会糊成一片），取值要拼下标所以走内联 */}
                <div
                  className="w-[132px] flex-none rounded-[12px] border border-border bg-inset py-[11px] text-center font-mono text-[25px] font-extrabold leading-none"
                  style={{ color: p.rotate[i % p.rotate.length] }}
                >
                  {c.hash}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
                  {/* break-words + break-keep：提交标题多为中文，前者防长串溢出，后者禁掉 CJK 逐字断点 */}
                  <div className="text-[30px] font-bold leading-[1.45] break-words break-keep">
                    {c.subject}
                  </div>
                  <div className="font-mono text-[21px] text-muted">{c.date}</div>
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
        lines={[data.time, "#早柚更新 拉取最新代码"]}
      />
    </>
  )
}
