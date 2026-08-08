/**
 * 文本宽度估算
 *
 * 为什么需要它
 * ------------
 * 画布是固定的 1440px（theme.ts CANVAS_WIDTH），版本号却是运行时才知道的：
 * release 分支上是 `v2.1.0`，main 上 git describe 会给出
 * `v2.1.0-2-gc6522ee-dirty` —— 23 个字符，是前者的近四倍。写死字号的结果就是
 * 短版本号留一大片空白、长版本号直接换行（实测 130px 下折成两行，页脚同理）。
 *
 * 浏览器里这类问题通常交给 JS 量完再调，但这里量不了：组件是 renderToStaticMarkup
 * 出的静态 HTML，页面里没有脚本，puppeteer 也只截图不执行我们的逻辑。所以宽度
 * 必须在 SSR 阶段估出来，字号写进 style 属性。
 *
 * 精度要求
 * --------
 * 只用来决定"要不要缩、缩多少"，不需要像素级准确：估宽了字号偏小（浪费一点空白），
 * 估窄了才会换行。所以宁可高估——SAFETY 就是这个用途。
 */

/**
 * 各类字符相对字号的宽度系数（em）
 *
 * 按 900 字重的无衬线中文字体栈实测量级取值，比常规字重宽约 5%。
 * 分档而不是逐字查表：字形表要跟着字体栈变，而这里只需要量级正确。
 */
const EM: Record<string, number> = {
  /** 数字与大写字母，等宽数字下就是这个值 */
  wide: 0.6,
  /** 小写字母 */
  lower: 0.55,
  /** 全角：中日韩、全角标点 */
  cjk: 1.0,
  /** 窄字符：. , : ; ! | ' ` i l I j f t r ( ) [ ] - + 空格 */
  narrow: 0.3,
}

/** 单个字符占多少 em */
function charEm(ch: string): number {
  const c = ch.codePointAt(0) || 0

  // CJK 统一表意文字、中日韩标点、全角字符、假名
  if (
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
  )
    return EM.cjk

  // 装饰符号（✓ ⚙ ⚠ · 等）按全角算：多数字体里它们接近方形
  if (c >= 0x2000 && c <= 0x2bff) return EM.cjk

  if (/[.,:;!|'`ilIjftr()[\]\-+ ]/.test(ch)) return EM.narrow
  if (/[a-z]/.test(ch)) return EM.lower
  return EM.wide
}

/**
 * 估算一段文字的宽度
 *
 * @param text     文本
 * @param fontSize 字号（px）
 * @param tracking 字距（em），CSS 的 letter-spacing。负值会让整体变窄
 */
export function textWidth(text: string, fontSize: number, tracking = 0): number {
  let em = 0
  for (const ch of text) em += charEm(ch) + tracking
  return em * fontSize
}

/**
 * 高估余量
 *
 * 字体栈里各字体宽度不同（HarmonyOS Sans SC 比 Microsoft YaHei 略窄），
 * 上面的分档也只是量级正确。留 8% 余量，让估算偏保守——宁可字号小一点，
 * 也不要换行，因为换行是用户看得见的毛病，小一号不是。
 */
const SAFETY = 1.08

/**
 * 求「让文本刚好放进 budget 宽度」的字号
 *
 * @param text     要放的文本
 * @param budget   可用宽度（px）
 * @param max      理想字号，放得下就用它
 * @param min      最小字号，再放不下也不缩了（宁可轻微溢出也要保持可读）
 * @param tracking 字距（em）
 *
 * @returns 取整后的字号
 */
export function fitFontSize(
  text: string,
  budget: number,
  max: number,
  min: number,
  tracking = 0,
): number {
  const need = textWidth(text, max, tracking) * SAFETY
  if (need <= budget) return max
  const scaled = (max * budget) / need
  return Math.max(min, Math.floor(scaled))
}
