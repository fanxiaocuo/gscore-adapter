/**
 * 更新日志页
 *
 * 版式沿用 Status 的骨架（统计条 + 逐行卡片），把「连接」换成「提交」：
 * 左侧短 hash 当序号，中间标题，右侧提交时间。
 *
 * 与 kkk 的差异：它的 changelog 是 npm 包的 CHANGELOG.md，有 semver 分组；
 * 本插件按 git 提交列，没有版本段落，所以用「新提交 / 本地提交」两种语境
 * 共用一套行，靠 heading 与 tip 区分。
 */
import type { Palette } from "../theme.js"
import type { Commit } from "@/modules/update/git.js"
import { Footer, Header, Page } from "./Layout.js"

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
      <Page palette={p} word={data.ghost}>
        <Header
          title={data.heading}
          status="GSCORE_ADAPTER"
          led={data.led}
          rightKey={data.rightKey}
          rightValue={data.rightValue}
        />

        <div className="stats">
          {data.summary.map((s, i) => (
            <div className="stat" key={i}>
              <div className="k mono">{s.key}</div>
              <div className="v" style={{ color: p.rotate[i % p.rotate.length] }}>
                {s.value}
              </div>
              {s.sub && <div className="s">{s.sub}</div>}
            </div>
          ))}
        </div>

        {data.notice && (
          <div
            className="notice"
            style={{ color: p.warning, background: `${p.warning}14`, borderColor: `${p.warning}3d` }}
          >
            {data.notice}
          </div>
        )}

        {data.commits.length === 0 ? (
          <div className="empty">
            <div className="t">{data.emptyTitle}</div>
            <div className="d">{data.emptyTip}</div>
          </div>
        ) : (
          <div className="cl-logs">
            {data.commits.map((c, i) => (
              <div className="cl-log" key={c.hash + i}>
                {/* hash 用主情绪色轮换：一屏几十行，纯灰会糊成一片 */}
                <div className="sha mono" style={{ color: p.rotate[i % p.rotate.length] }}>
                  {c.hash}
                </div>
                <div className="main">
                  <div className="msg">{c.subject}</div>
                  <div className="at mono">{c.date}</div>
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
