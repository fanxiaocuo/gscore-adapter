/**
 * @description 文本宽度估算，用来在 SSR 阶段决定「字号要不要缩、缩多少」
 * 画布固定 1440px 而版本号是运行时才知道的（`v2.1.0` 到 `v2.1.0-2-gc6522ee-dirty` 差近四倍），写死字号
 * 就会短的留一大片空白、长的直接换行。而浏览器里量不了：组件出的是静态 HTML，页面里没有脚本。
 * 精度只需量级正确：估宽了字号偏小（浪费一点空白），估窄了才会换行，所以宁可高估 —— 见 SAFETY。
 */

/**
 * @description 各类字符相对字号的宽度系数（em）
 * 按 900 字重的无衬线中文字体栈实测量级取值，比常规字重宽约 5%。分档而不是逐字查表：字形表要跟着字体栈变。
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

/** @description 单个字符占多少 em */
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
 * @description 估算一段文字的宽度
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
 * @description 高估余量：留 8% 让估算偏保守
 * 字体栈里各字体宽度不同，上面的分档也只是量级正确。宁可字号小一点，也不要换行 —— 换行是用户看得见的
 * 毛病，小一号不是。
 */
const SAFETY = 1.08

/**
 * @description 求「让文本刚好放进 budget 宽度」的字号
 * @param text     要放的文本
 * @param budget   可用宽度（px）
 * @param max      理想字号，放得下就用它
 * @param min      最小字号，再放不下也不缩了（宁可轻微溢出也要保持可读）
 * @param tracking 字距（em）
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
