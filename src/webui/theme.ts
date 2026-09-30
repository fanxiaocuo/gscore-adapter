/**
 * @description 跟随宿主的主题色：把 QQBot-Web-Adapter 的 `--accent` 搬到本页面
 *
 * 面板是宿主里的同源 iframe，宿主整套界面靠 documentElement 上的 `--accent`/`--accent-weak` 上色。
 * 注意：读 `parent.document` 而非自己那份，iframe 读不到宿主的主题设置，这是唯一能对齐的信号。
 * 注意：实时轮询而非加载时读一次（宿主支持换肤，换完不该要求刷新面板）。
 * 注意：不用 MutationObserver 盯 style —— 宿主换肤路目前不通（上游有 theme-changed 转发，但 applyTheme
 * 在已发布的 web/app.js 里未定义）；主题色也可能改样式表文本/切 class/整页重载来变，轮询计算值是唯一不依赖
 * 「宿主怎么改」的判据，getComputedStyle 每 2 秒开销可忽略。
 * 注意：一条都取不到时什么都不做，`--accent` 一族回落 styles.css 的赤陶（宿主没装、跨源读不到或变量名变了时的表现）。
 * 注意：宿主主题色不照搬，按对比度调过明度才用 —— 宿主 #4f6ef7 对 surface 仅 4.13、对 bg 3.78，本面板门槛逐格卡（test/contrast.mjs）。
 */
import { useEffect } from "react"

/** 宿主变量名。QQBot-Web-Adapter 的 web/style.css 与 webadapter/sandbox.html 都定义这两个 */
const HOST_ACCENT = "--accent"
const HOST_ACCENT_SOFT = "--accent-weak"

/** 轮询间隔。主题色人手动改，2 秒足够跟手 */
const POLL_MS = 2000

/** 正文门槛。与 test/contrast.mjs 一致，改一处要改两处 */
const TEXT_MIN = 4.5

/**
 * @description 从宿主文档读出主题色，换算成面板自己的覆盖变量
 *
 * 两元素挂同一值：documentElement 是 body 页面规则的来源，body 给弹层/保存条这些 fixed 元素兜底。
 * 注意：只覆盖 `--accent` 一族，中性色（bg/surface/fg/muted/border）不跟 —— 混用会让正文 4.5:1 与控件边界 3:1 全部重算。
 */
function sync(hostDoc: Document): void {
  const hostStyle = hostDoc.defaultView?.getComputedStyle(hostDoc.documentElement)
  if (!hostStyle) return

  const raw = hostStyle.getPropertyValue(HOST_ACCENT).trim()
  if (!raw || !parse(raw)) return

  const soft = hostStyle.getPropertyValue(HOST_ACCENT_SOFT).trim()

  /*
   * 按此刻生效的那套算并写入，深浅一变就整套重算（attach 里的 mq 监听）。
   * 注意：不能只在挂载时算一次。面板深浅由 prefers-color-scheme 定，accent 要压的底在深浅两套里明暗相反
   *（亮底 #4f6ef7 往黑压、深底往白提）；且这些值是内联样式，优先于选择器会盖掉样式表那条深色规则 ——
   * 只算一次的话深色下 accent 字色被钉死在「按亮底挑」那档（test/panel-verify.mjs「深色下 accent-fg 是深色字」抓的就是这条）。
   */
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue
    apply(el, raw, soft)
  }
}

/**
 * @description 按当前生效的那套底把 accent 一族调好，写进这个元素
 *
 * 每次 sync 现算不缓存：算术量常数级，缓存要处理「宿主换主题色」「系统换深浅」两个失效源，不划算。
 * 注意：量不到面板自己的底时一个变量都不写，不搬宿主原色 —— 搬上去是内联样式，会盖掉 styles.css 那条
 * `@media (prefers-color-scheme: dark)`，深色下拿到既没调明度又钉死浅色字色的 accent；且 soft 多半同时失败
 *（softFor 靠同一批 token），成了蓝字配赤陶 hover 底。什么都不写就回落 styles.css 验过的赤陶。
 */
function apply(el: HTMLElement, raw: string, rawSoft: string): void {
  const t = panelTokens()
  // 按当前这套的三张底一起调 —— 深浅两套的底不同，调出来的值也不同
  const surfaces = [t.bg, t.surface, t.surface2].filter(Boolean)
  if (!surfaces.length || !t.fg || !t.muted) return
  const accent = adjustTo(raw, surfaces, TEXT_MIN)

  el.style.setProperty("--accent", accent)

  // 压 accent 底上的字色：按调过的填充色判（按钮底用的是上面那个 accent，不是宿主原色），判错对象会把字色挑反
  el.style.setProperty(
    "--accent-fg",
    ratio("#ffffff", accent) >= ratio("#1a1a18", accent) ? "#ffffff" : "#1a1a18",
  )

  /*
   * 弱化底：宿主那份只在压得住字时才用，否则按当前深浅自己兑一个。
   * 注意：不能无条件照搬宿主那份 —— 宿主纯亮色（web/style.css、sandbox.html、menuPanel.html 里无 prefers-color-scheme），
   * --accent-weak 永远浅到发白；深色偏好下成了「亮底+提亮字」：实测宿主默认色 BTN_ACCENT hover 仅 2.65:1、行 hover 里 --fg 压上去 1.02:1。
   * 判据 --fg 与 --muted 都要过：这张底上不只有正文 —— PickerModal 行 hover 的 11px 号码、账号行「管理 ▼」都是 --muted，只卡 --fg 会漏小字。
   */
  const soft = softFor(rawSoft, accent, t)
  if (soft) {
    el.style.setProperty("--accent-soft", soft)
    // 淡底上的字色可调（不承担「大面积色块要像宿主」），调到够为止
    el.style.setProperty("--accent-soft-fg", adjustTo(accent, [soft], TEXT_MIN))
  }
}

/**
 * @description 弱化底：能用宿主那份就用，不能用就把 accent 往这套底色兑淡
 *
 * 兑淡方向是当前深浅自己的底（亮色兑白、深色兑黑），起点 50% —— 回落调色板就这么配（浅色 #fbeee9 赤陶兑白约 91%、
 * 深色 #3a1e14 兑黑约 77%，故 --fg/--muted 压上去都 5:1 往上）。这里同思路现算，从 50% 起每 2% 试，第一个让 --fg 与 --muted 都过 4.5:1 的就用。
 * 注意：不卡「soft 与 surface 有 3:1」—— hover 底与卡面本就只差一点（回落调色板实测 1.10:1/1.05:1），是轻微提示非控件边界，SC 1.4.11 管不到。
 * 注意：宿主没给 soft 时也走这条自己兑，不交回 styles.css 那份 —— 那份按赤陶配，与跟随来的 accent 不同色相，hover 蹦出橘底像坏了。
 */
function softFor(hostSoft: string, accent: string, t: Record<string, string>): string | null {
  const holds = (s: string) => ratio(t.fg, s) >= TEXT_MIN && ratio(t.muted, s) >= TEXT_MIN
  if (hostSoft && parse(hostSoft) && holds(hostSoft)) return hostSoft

  const c = parse(accent)
  const base = parse(t.bg)
  if (!c || !base || !t.fg || !t.muted) return null

  const to: [number, number, number] = lum(base) > 0.5 ? [255, 255, 255] : [0, 0, 0]
  for (let k = 0.5; k <= 1; k += 0.02) {
    const s = mix(c, to, k)
    if (holds(s)) return s
  }
  // 兑到纯白/纯黑都压不住字：已是这套里最极端的一档，交它出去
  return mix(c, to, 1)
}

/**
 * @description 面板自己的三张底与两档字色
 *
 * 读 documentElement 的计算值，即此刻真正生效的那套；调用方 apply 算的也是此刻这套，两边对得上。
 * 注意：不翻样式表规则。翻规则文本收不到 token —— `Object.entries(rule.style)` 给的是 `["0", "--bg"]` 这样的下标→属性名，
 * 不是属性名→值，`k.startsWith("--")` 一次都不成立（实测 collected 0、styleLength 20），静默失效。
 * 且就算修好也不该留：读规则文本得先判深浅，而那个判断自己会错（matchMedia 抛异常时只能按浅色算），一错就拿浅色那套压真实的深色底；计算值无此判断，永远对。
 */
function panelTokens(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const cs = getComputedStyle(document.documentElement)
    for (const k of ["bg", "surface", "surface2", "fg", "muted"]) {
      const v = cs.getPropertyValue(`--${k}`).trim()
      if (v) out[k] = v
    }
  } catch {
    // 连计算值都拿不到：交调用方跳过调整
  }
  return out
}

/**
 * @description 把颜色按需调整明度，直到它对每一张给定底色都够 min 的对比度
 *
 * 收多张底而非一张：调整会挪动颜色，「最吃对比度的那张底」也跟着换人 —— 按调整前挑的那张收敛完，另一张可能反而不过。
 * 注意：实测宿主 #4f6ef7 深色下按单张底收敛得 #647ff8，对 bg 4.61、对 surface 仅 4.14（卡片字不达标且无信号），故判据是三张底的最小值。
 * 方向先按底明度猜（亮底往黑压、暗底往白提），走不通换另一头。
 * 注意：两个方向都要试 —— 宿主给纯白时浅色下往白提永远到不了，只搜一头会停在 1.13:1（字看不见）。
 * 做法：往黑/白线性插值步长 2% 走到底，两头都到不了就交黑白里较好的那个，不回原色（回原色等于明知不过还照用）。
 * 注意：只在不够时才动。宿主给本来就够的色（浅底深蓝、深底亮蓝）原样返回，别写成「统一压暗一档」。
 */
function adjustTo(color: string, bgs: string[], min: number): string {
  const list = bgs.filter(Boolean)
  if (!list.length) return color
  const worst = (c: string) => Math.min(...list.map(b => ratio(c, b)))
  if (worst(color) >= min) return color

  const c = parse(color)
  if (!c) return color
  const hardest = parse(list.reduce((a, b) => (ratio(color, b) < ratio(color, a) ? b : a)))
  // 底比自己亮就往黑压，否则往白提；只是先试哪头，走不通换另一头
  const first: [number, number, number] =
    hardest && lum(hardest) < lum(c) ? [255, 255, 255] : [0, 0, 0]
  const second: [number, number, number] = first[0] ? [0, 0, 0] : [255, 255, 255]

  for (const to of [first, second]) {
    for (let t = 0.02; t <= 1; t += 0.02) {
      const next = mix(c, to, t)
      if (worst(next) >= min) return next
    }
  }
  return worst("#ffffff") >= worst("#000000") ? "#ffffff" : "#000000"
}

/** 两个颜色线性插值，t 为靠近 to 的比例，保持 #rrggbb */
function mix(from: [number, number, number], to: [number, number, number], t: number): string {
  return `#${from
    .map((v, i) =>
      Math.round(v + (to[i] - v) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

/**
 * @description 挂上跟随逻辑，返回卸载函数（由 useEffect 收）
 *
 * 注意：读 `window.parent.document` 会抛 SecurityError（宿主 CSP 或将来挪到另一个源时），不是错误场景（用户只是看到默认配色），整个读取链都要包住。
 */
function attach(): () => void {
  const hostDoc = (() => {
    try {
      // 单独打开面板页时 parent === window，没有宿主，见下面那条 early return
      if (window.parent === window) return null
      return window.parent?.document ?? null
    } catch {
      return null
    }
  })()
  if (!hostDoc) return () => {}

  /*
   * 没有宿主就什么都不做，这条不能省。单独打开时 parent 是自己，hostDoc 会读到本页面那份 --accent（styles.css 回落值），
   * 照抄一遍是把回落值写成内联样式，优先于样式表 —— 下面那条 `@media (prefers-color-scheme: dark)` 再改不动 --accent-fg，
   * 深色下压在 accent 上仍是「按浅色挑」的白字（test/panel-verify.mjs「深色下 accent-fg 是深色字」抓的就是这条，
   * 曾从 #2b1207 变成 #ffffff）。而浅色白字/深色深墨是作者刻意分开配的两档。
   */
  const tick = () => {
    try {
      sync(hostDoc)
    } catch {
      // 宿主文档被卸载/换源：这轮跳过，下轮重判
    }
  }

  tick()
  const id = setInterval(tick, POLL_MS)

  /*
   * 系统深浅切了要立刻重算，不能等下一轮轮询 —— 那 2 秒里底已翻过去，而压在 accent 上的字色还按旧那套挑（深底配白字最刺眼）。
   * 注意：轮询仍要留着，这个监听只覆盖「系统主题变了」，覆盖不到「宿主换了主题色」。
   */
  const mq = (() => {
    try {
      return window.matchMedia?.("(prefers-color-scheme: dark)") ?? null
    } catch {
      return null
    }
  })()
  mq?.addEventListener?.("change", tick)

  return () => {
    clearInterval(id)
    mq?.removeEventListener?.("change", tick)
  }
}

/**
 * @description 面板挂载期间持续跟随宿主主题色
 * 注意：依赖数组为空 —— 跟随逻辑与 props 无关，effect 里读的都是全局对象；别把 interval 重启挂在 state 上，否则每次重渲染都重置计时器。
 */
export function useHostTheme(): void {
  useEffect(attach, [])
}

/* ---------- 对比度算术（与 test/contrast.mjs 同一套，但那份在测试侧，不能 import） ---------- */

/**
 * @description "#rgb" / "#rrggbb" -> [r,g,b]，认不出的回 null
 *
 * 注意：先过一道 `String()` 而非直接 `.trim()`。传进来的是 getPropertyValue 或 token 表取出的，取不到时是 undefined，
 * 而上游守卫全在调用之后（softFor 先 holds 再判 null、ratio 先 parse 再判），直接 .trim() 抛出去会被 tick 的 catch 吞掉，表现为整套跟随静默失效。
 */
function parse(c: string): [number, number, number] | null {
  const m = String(c ?? "")
    .trim()
    .match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1]
  const n = parseInt(h.length === 3 ? [...h].map(x => x + x).join("") : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG 相对亮度 */
function lum([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/**
 * @description 两个颜色的对比度
 * 两个都认不出时回 21（最大值），让调用方走「白字」那支（本面板原本的配色），比算不出而换成没验过的深墨更保守。
 */
function ratio(a: string, b: string): number {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return 21
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}
