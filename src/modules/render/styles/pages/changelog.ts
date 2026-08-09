/**
 * 更新日志页（#早柚更新日志）
 *
 * 组件 components/Changelog.tsx。结构：概览统计条（shared）→ 提示条（shared）
 * → 逐行提交卡 / 空态（shared）。
 *
 * 类名 cl- 前缀。这页原本只有 .logs/.log 两个块，本身不算乱，但 .log .main
 * 与状态页的 .conn .main 同名同义、.log .msg 又只在这里出现——统一加前缀，
 * 免得下次给某一页加规则时又要先数一遍另外三页有没有在用。
 */
import type { Palette } from "../../theme.js"

export const changelog = (p: Palette): string => `
.cl-logs{display:flex;flex-direction:column;gap:18px}
/* align-items:center 而不是 flex-start：右侧是「标题 + 时间」两行，左边的短
   hash 只有一行，顶对齐会让 hash 明显偏上。居中后两栏的视觉重心在同一水平线。 */
.cl-log{display:flex;align-items:center;gap:28px;padding:26px 32px;border-radius:24px;
  border:1px solid ${p.border};background:${p.surface}}
/* hash 做成独立的胶囊块：等宽 + 定宽让标题左边缘对齐成一列（短 hash 恒 7 位），
   淡底把它和标题分层，一屏几十行时更容易扫读 */
.cl-log .sha{font-size:25px;font-weight:800;flex:none;line-height:1;
  padding:11px 0;width:132px;text-align:center;border-radius:12px;
  background:${p.inset};border:1px solid ${p.border}}
.cl-log .main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
/* break-word 而非 break-all：提交标题多为中文，break-all 会从词中间断开 */
.cl-log .msg{font-size:30px;font-weight:700;line-height:1.45;overflow-wrap:break-word}
.cl-log .at{font-size:21px;color:${p.muted}}
`
