/**
 * 连接列表 / 状态页
 *
 * 版式参照 kkk 的推送列表：概览统计条 + 逐行卡片，每行左侧序号、
 * 中间主信息、右侧状态灯胶囊。
 */
import type { Palette } from "../theme.js"
import { Footer, Header, Page } from "./Layout.js"

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
}

export interface StatusData {
  title: string
  version: string
  mode: string
  /** 页面主标题，连接列表与状态页共用本组件 */
  heading: string
  ghost: string
  summary: { key: string; value: string; sub?: string }[]
  rows: ConnRow[]
  palette: Palette
  time: string
  /** 无连接时的空态文案 */
  emptyTip?: string
}

/** 状态色：语义色只用于状态，不参与主情绪（见 kkk tokens.md 颜色角色） */
function toneColor(p: Palette, tone: ConnRow["tone"]) {
  if (tone === "on") return p.success
  if (tone === "warn") return p.warning
  if (tone === "err") return p.danger
  return p.muted
}

export function Status(data: StatusData) {
  const p = data.palette

  return (
    <>
      <Page palette={p} word={data.ghost}>
        <Header
          title={data.heading}
          status="GSCORE_ADAPTER"
          led={data.mode === "client" ? "on" : "off"}
          rightKey="RUNNING MODE"
          rightValue={data.mode}
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

        {data.rows.length === 0 ? (
          <div className="empty">
            <div className="t">暂无连接</div>
            <div className="d">{data.emptyTip || "用 #早柚添加连接 <地址> 添加"}</div>
          </div>
        ) : (
          <div className="conns">
            {data.rows.map(row => {
              const c = toneColor(p, row.tone)
              return (
                <div className="conn" key={row.index}>
                  <div className="idx mono">{String(row.index).padStart(2, "0")}</div>
                  <div className="main">
                    <div className="nm">{row.name}</div>
                    <div className="url mono">{row.url}</div>
                    {row.meta.length > 0 && (
                      <div className="meta">
                        {row.meta.map((m, i) => (
                          <em key={i} className="mono">
                            {m}
                          </em>
                        ))}
                      </div>
                    )}
                  </div>
                  <div
                    className="pill"
                    style={{ color: c, background: `${c}1f`, border: `1px solid ${c}3d` }}
                  >
                    <span className="led" style={{ background: c, boxShadow: `0 0 10px ${c}` }} />
                    {row.state}
                  </div>
                </div>
              )
            })}
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
