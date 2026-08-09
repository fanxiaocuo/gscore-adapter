/**
 * 运行环境页（#早柚版本）
 *
 * 版式与取材照 karin-plugin-kkk 的 #kkk版本（module/utils/runtime-report.ts +
 * components/platforms/other/runtime.tsx）：一张「本机诊断快照」——巨大的版本号
 * 当主视觉，下面按两列铺环境摘要（系统 / 框架 / Node / 运行模式 / 内存 / CPU）。
 *
 * 为什么不沿用状态页那套骨架
 * ---------------------------
 * 初版直接套了 Header + 统计条 + 卡片列表，结果和 #早柚状态 长得几乎一样——
 * 同一个巨型英文标题、同一条四格统计、同一批圆角卡片，只有文字不同，用户反馈
 * 「早柚版本我觉得写得像早柚状态」。两条命令答的是两个问题：
 *   #早柚状态 —— 连接好不好，是运行时的、随时会变的；
 *   #早柚版本 —— 跑在什么上面，是环境的、基本不变的。
 * 所以这页换一套骨架：不要巨型英文标题和统计条，改成 kkk 那样「版本号即主视觉」，
 * 正文是本机信息的两列摘要。连接数这类状态信息不再重复展示，留给状态页。
 *
 * 隐私：本机信息只取性能类，不取任何能定位机主的东西，边界见 env.ts 的 sysInfo。
 */
import type { Palette } from "../theme.js"
import type { ReleaseType } from "../env.js"
import type { Release } from "../changelog.js"
import { Backdrop, Footer } from "./Layout.js"
import { fitFontSize } from "../metrics.js"

/** 一条环境信息 */
export interface AboutRow {
  /** 左侧标签，如 运行框架 */
  key: string
  /** 右侧取值 */
  value: string
  /** 取值下方的补充说明 */
  sub?: string
  /** 取值用等宽字（版本号、平台名这类） */
  mono?: boolean
}

export interface AboutData {
  title: string
  version: string
  palette: Palette
  time: string
  /** 插件图标的 data URI，空串则不显示图标只显示文字 */
  logo: string
  /** 一句话介绍 */
  desc: string
  /** 正式版 / 预览版 */
  release: ReleaseType
  /** 两列摘要，按顺序左右交替铺开 */
  rows: AboutRow[]
  /** 内存占用，画一条进度条；不给则不显示 */
  memory?: { percent: number; used: string; total: string }
  /**
   * 标题右侧的速览格，不给则标题独占整宽
   *
   * 补的是标题区右侧那片空白（标题只有四个字，88px 下占不到三分之一宽）。
   * 内容要选「一眼就想知道」的三两项，多了会和下面的环境摘要重复。
   */
  glance?: { key: string; value: string }[]
  /**
   * 本版变更，读 CHANGELOG.md 得来；null 则整块不渲染
   *
   * 与 #早柚更新日志 的分工：那条命令列 git 提交，答「代码更新到哪了」；
   * 这里列发布条目，答「这个版本改了什么」。数据源不同，不重复。
   */
  changes?: Release | null
  /** 底部的开源信息行 */
  links: { key: string; value: string }[]
}

/**
 * 版本号可用宽度
 *
 * 1440 画布 - .page 左右 padding 72×2 = 1296，再减去 hero 图标 200px 与 44px 间距。
 * 几何对应 styles.ts 的 .rt-hero，改那边要同步改这里。
 */
const HERO_BUDGET = 1296 - 200 - 44

export function About(data: AboutData) {
  const p = data.palette
  const stable = data.release === "Stable"
  // 版本号与发布类型同色：非正式版 warning，正式版取轮转色的第一个
  const verColor = stable ? p.rotate[0] : p.warning

  /**
   * 版本号字号：按串长反推，保证一行放得下
   *
   * 130px 是给 `v2.1.0` 这类短串的理想值，但 main 分支上 git describe 会给出
   * `v2.1.0-2-gc6522ee-dirty`（23 字符），130px 下宽约 1790px，远超可用的 1052px，
   * 于是折成两行——右侧那块「小字 / 巨大数字 / 插件名」的层次被破坏，
   * 而且第二行会压到下面的插件名上。
   *
   * 下限 56px：仍比正文的 38px 大一档，主视觉地位保得住。
   * 字距 -.05em 与 CSS 一致，长串下这一项能省下约 4% 宽度，不能漏算。
   */
  const verSize = fitFontSize(data.version, HERO_BUDGET, 130, 56, -0.05)

  return (
    <>
      {/* 大字压在两列摘要区，与帮助/状态页「大字落在列表区」一致 */}
      <Backdrop word="RUNTIME" ghostTop={1000} />

      <div className="page">
        {/* 顶部一行小字，取代其他页的巨型 Header——这页的主视觉是版本号 */}
        <div className="rt-top">
          <div className="rt-eyebrow">
            <span className="dot" style={{ background: p.rotate[0] }} />
            <span>运行诊断</span>
            <span className="sp">·</span>
            <span className="mono">RUNTIME REPORT</span>
          </div>
          <div
            className="rt-badge mono"
            style={{
              color: verColor,
              background: `${verColor}1f`,
              border: `1px solid ${verColor}3d`,
            }}
          >
            {data.release === "Stable" ? "正式版" : data.release === "Dev" ? "开发版" : "预览版"}
          </div>
        </div>

        {/* 标题与右侧速览并排
            ------
            原来标题「运行环境」+ 一行说明单独占满整宽，右侧从 y=150 到 400 是一大片
            空背景——标题只有 4 个字，88px 下宽约 360px，剩下 900px 全空着。
            右边补三格速览：进程健康度（在线连接/内存/运行时长），都是「现在好不好」
            的答案，与标题「运行环境」同一个语义层，放在一起读得通。
            不放版本号之类：那是下面 hero 的主视觉，重复会削弱它。 */}
        <div className="rt-lead">
          <div className="txt">
            <h1 className="rt-title">运行环境</h1>
            <div className="rt-desc">{data.desc}</div>
          </div>
          {data.glance && data.glance.length > 0 && (
            <div className="rt-glance">
              {data.glance.map((g, i) => (
                <div className="g" key={i}>
                  <span className="k mono">{g.key}</span>
                  <span className="v" style={{ color: p.rotate[i % p.rotate.length] }}>
                    {g.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 版本号主视觉：kkk 那张图上最抢眼的就是这一块 */}
        <div className="rt-hero">
          {data.logo && <img className="art" src={data.logo} alt="" />}
          <div className="txt">
            <div className="cap mono">插件版本</div>
            <div className="num" style={{ color: verColor, fontSize: verSize }}>
              {data.version}
            </div>
            <div className="nm mono">{data.title}</div>
          </div>
        </div>

        {/* 环境摘要：两列。标题带一条渐变横线，照 kkk 的分节样式 */}
        <div className="rt-sec">
          <span className="dot" style={{ background: p.rotate[0] }} />
          <span className="t">环境摘要</span>
          <span
            className="line"
            style={{ background: `linear-gradient(90deg,${p.rotate[0]},transparent)` }}
          />
        </div>

        <div className="rt-grid">
          {data.rows.map((r, i) => (
            <div className="rt-cell" key={i}>
              <div className="k">{r.key}</div>
              <div
                className={r.mono ? "v mono" : "v"}
                style={{ color: p.rotate[i % p.rotate.length] }}
              >
                {r.value}
              </div>
              {r.sub && <div className="s">{r.sub}</div>}
            </div>
          ))}

          {data.memory && (
            <div className="rt-cell">
              <div className="k">内存占用</div>
              <div className="v mem">
                <span className="pct" style={{ color: p.rotate[2] }}>
                  {data.memory.percent}%
                </span>
                <small className="mono">
                  {data.memory.used} / {data.memory.total}
                </small>
              </div>
              {/* 进度条：宽度由百分比给，夹到 0~100 防止异常值撑破容器 */}
              <div className="bar">
                <i
                  style={{
                    width: `${Math.min(100, Math.max(0, data.memory.percent))}%`,
                    background: `linear-gradient(90deg,${p.rotate[0]},${p.rotate[2]})`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 本版变更：照 kkk 的 #kkk版本，环境摘要之后接一段「这个版本改了什么」。
            分类标题各自轮换一个主情绪色，与摘要区的取色规则一致。 */}
        {data.changes && data.changes.groups.length > 0 && (
          <>
            <div className="rt-sec">
              <span className="dot" style={{ background: p.rotate[1] }} />
              <span className="t">本版变更</span>
              <span className="ver mono">
                v{data.changes.version}
                {data.changes.date && <em> · {data.changes.date}</em>}
              </span>
              <span
                className="line"
                style={{ background: `linear-gradient(90deg,${p.rotate[1]},transparent)` }}
              />
            </div>

            <div className="rt-chg">
              {data.changes.groups.map((g, gi) => (
                <div className="grp" key={gi}>
                  <div className="gt" style={{ color: p.rotate[gi % p.rotate.length] }}>
                    {g.title}
                  </div>
                  <ul className="items">
                    {g.items.map((it, ii) => (
                      <li key={ii}>
                        <i style={{ background: p.rotate[gi % p.rotate.length] }} />
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 两列网格，标签在上取值在下（几何与理由见 styles.ts 的 .rt-links） */}
        <div className="rt-links">
          {data.links.map((l, i) => (
            <div className="link" key={i}>
              <span className="k mono">{l.key}</span>
              <span className="v mono">{l.value}</span>
            </div>
          ))}
        </div>

        {/* kkk 在正文末尾写了「仅包含经过脱敏的本地运行信息」，本插件同样只取
            性能类信息（见 env.ts sysInfo 的隐私边界），照样声明一句 */}
        <div className="rt-note">仅包含经过脱敏的本地运行信息</div>
      </div>

      <Footer
        name={data.title}
        version={data.version}
        palette={p}
        lines={[data.time, "#早柚帮助 查看全部指令"]}
      />
    </>
  )
}
