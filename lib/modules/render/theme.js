/**
 * 视觉 token
 *
 * 取值参照 karin-plugin-kkk 的「弥散信息海报」体系：1440px 固定画布、
 * 巨型标题、多层光斑 + 噪点、冷色主情绪。
 *
 * 与它的实现差异：kkk 用 Tailwind + Vite 在构建期产出 CSS，本仓库没有这套
 * 工具链（根 package.json 无 react/tailwind），所以这里把用到的那部分固化成
 * 内联 CSS 变量，由 styles.ts 拼进 <style>。好处是产物自包含——puppeteer 用
 * file:// 打开 HTML，没有 dev server 能提供外部资源。
 */
/** 固定画布宽度，与 kkk 一致 */
export const CANVAS_WIDTH = 1440;
export const DARK = {
    bg: "#0a0d14",
    surface: "rgba(255,255,255,0.035)",
    border: "rgba(255,255,255,0.10)",
    foreground: "#e8ecf4",
    muted: "#8b95a8",
    inset: "rgba(255,255,255,0.06)",
    primary: "#60a5fa",
    secondary: "#a78bfa",
    accent: "#2dd4bf",
    success: "#4ade80",
    warning: "#fbbf24",
    danger: "#f87171",
    glow: ["rgba(59,130,246,0.40)", "rgba(139,92,246,0.30)", "rgba(6,182,212,0.25)"],
    rotate: ["#60a5fa", "#a78bfa", "#2dd4bf"],
};
export const LIGHT = {
    bg: "#f4f6fb",
    surface: "rgba(255,255,255,0.72)",
    border: "rgba(15,23,42,0.10)",
    foreground: "#101828",
    muted: "#5b6577",
    inset: "rgba(15,23,42,0.05)",
    primary: "#2563eb",
    secondary: "#7c3aed",
    accent: "#0d9488",
    success: "#16a34a",
    warning: "#d97706",
    danger: "#dc2626",
    glow: ["rgba(56,189,248,0.50)", "rgba(167,139,250,0.40)", "rgba(45,212,191,0.30)"],
    rotate: ["#2563eb", "#7c3aed", "#0d9488"],
};
export const getPalette = (dark) => (dark ? DARK : LIGHT);
/**
 * 字体栈
 *
 * 不打包字体文件：仓库 resources/ 下没有任何 ttf/woff（已确认），
 * 硬指一个不存在的 @font-face 会让 Chromium 回落到默认衬线字体，
 * 中文标题会变得很难看。这里直接列系统字体，Windows/macOS/Linux 各有命中项。
 */
export const FONT_STACK = '"HarmonyOS Sans SC","MiSans","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",' +
    '"Source Han Sans SC",-apple-system,"Segoe UI",Roboto,sans-serif';
/** 等宽栈：版本号、时间、命令、计数用它保持机器感 */
export const MONO_STACK = '"JetBrains Mono","Cascadia Code","SF Mono",Consolas,"DejaVu Sans Mono",monospace';
