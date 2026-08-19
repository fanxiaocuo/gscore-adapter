/**
 * 视觉 token
 *
 * 取值参照 karin-plugin-kkk 的「弥散信息海报」体系：1440px 固定画布、
 * 巨型标题、多层光斑 + 噪点、冷色主情绪。
 *
 * 与它的实现差异：kkk 的语义 token 来自 @heroui/styles（那些 --heroui-* 变量在它
 * 仓库里只被读、没有定义），这里自己定义一套。下面的 Palette 是给组件用的字面量，
 * cssVars / V 是给样式表用的自定义属性，由 styles/ 拼进 <style>。
 *
 * Tailwind 只认这一处真源：render/styles/tailwind.css 的 @theme 把 --color-* 指到下面
 * cssVars 下发的 --* 上（两跳），所以 `text-muted` 这类 utility 会随调色板走，
 * 不需要 dark: 变体，也不需要在根节点挂主题类。
 *
 * 产物必须内联进 <style> 而不是 <link>：puppeteer 用 file:// 打开 HTML，
 * 没有 dev server 能提供外部资源（详见 styles/index.ts）。
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
    // 深色弥散：深蓝紫压住整体，粉与奶油只作暖调提亮点。#262277 提到 #382a78 —— 原色
    // 在 #0a0d14 上几乎与底同色，铺出来看不见弥散。
    glow: [
        "rgba(103,142,201,0.34)",
        "rgba(56,42,120,0.46)",
        "rgba(255,206,227,0.17)",
        "rgba(252,194,235,0.15)",
        "rgba(254,223,203,0.11)",
    ],
    rotate: ["#60a5fa", "#a78bfa", "#2dd4bf"],
    // 取渐变亮端。在卡片实际底色 rgb(19,21,28) 上实测 13.2 / 9.5 / 5.5 / 4.8 : 1。
    // 原渐变最深那档 #262277 只有 1.5:1，深底上几乎看不见，所以第四档收在 #6b7fc4 ——
    // 先取过 #5a6eb8，实测最差端 3.78:1，虽过大字 3:1 但那端正好落在状态数字上，
    // 提亮到 4.8 让它连正文的 4.5 也过，关键数字不吃临界值。
    spectrum: ["#ffcee3", "#c3b4dc", "#678ec9", "#6b7fc4"],
};
/**
 * 浅色一套
 *
 * 不是把 DARK 的值反过来：这套海报的深色靠「暗底 + 亮光斑」建立层次，
 * 浅色下光斑几乎不可见，所以 surface 改成接近白的半透明（在浅底上仍能
 * 与背景分开），border 与 inset 换成低透明度的深色（浅底上要压暗才看得见），
 * 前景/辅助色则整体加深一档以保住对比度。
 *
 * 已知的观感差异（不是 bug，不必去追）
 * ----------------------------------
 * backdrop 层的三处装饰用的是固定 opacity（.028/.04/.16），量过合成后的对比度
 * 两套几乎一样（ghost 1.048:1 vs 1.057:1），所以竖排大字本身没有变淡。真正的
 * 差别在光斑：深色下三层 glow 会在大字背后积出一片亮区，把它衬出来；浅色底
 * 上光斑本就接近白，衬不出东西，于是整页看着比深色"平"。
 *
 * 这是弥散海报体系在浅色下的固有代价，要补得改 backdrop 的整体构成（例如浅色
 * 单独一套 opacity），不是调 Palette 能解决的。当前取舍：可读性指标（见
 * test/contrast.mjs）全部达标，气氛差一点可以接受。
 */
export const LIGHT = {
    bg: "#f4f6fb",
    surface: "rgba(255,255,255,0.72)",
    border: "rgba(15,23,42,0.10)",
    foreground: "#101828",
    muted: "#5b6577",
    inset: "rgba(15,23,42,0.05)",
    primary: "#2563eb",
    secondary: "#7c3aed",
    // teal-700 而不是 teal-600(#0d9488)：后者 3.46:1。青色在浅底上是全套里最弱的
    // 一个——它同时出现在分组标题轮换色的第三位（rotate[2]），标题字号比状态点小。
    accent: "#0f766e",
    // green-700 而不是 green-600(#16a34a)：后者 3.05:1，压着大字 3:1 的线过，
    // 余量只有 0.05——状态点旁边的 "在线" 标签将来若调小一号就会掉下去。
    // 700 是 4.54:1，与 warning 同一档余量。深色的 #4ade80 有 11:1，不动。
    success: "#15803d",
    // amber-700 而不是 amber-600(#d97706)：后者在 #f4f6fb 底上只有 2.95:1，
    // 页脚的 "⚙ DEV" 与版本号（38px 粗体）差一点点够不到 WCAG AA 的大字 3:1。
    // 换成 700 是 4.64:1，连普通字号的 4.5 也过得去。深色那套不受影响——
    // #fbbf24 在 #0a0d14 上有 11:1。
    warning: "#b45309",
    danger: "#dc2626",
    // 浅色弥散：高明度低饱和，靠面积和交融出层次而不是靠浓度。透明度比深色那套高
    // 一档也不会压住黑字 —— 底是 #f4f6fb，这些斑只把它推向各自色相一点点。
    glow: [
        "rgba(199,220,244,0.62)",
        "rgba(214,206,240,0.55)",
        "rgba(252,215,235,0.48)",
        "rgba(254,232,214,0.44)",
        "rgba(207,228,214,0.40)",
    ],
    // 与 primary/secondary/accent 同值，改一个就得改这里——见下方 rotate 的一致性测试
    rotate: ["#2563eb", "#7c3aed", "#0f766e"],
    // 取渐变暗端（浅底要深才看得见）。在 #f4f6fb 上实测 12.2 / 7.1 / 4.4 / 5.3 : 1。
    // 第三档 4.38 略低于正文的 4.5，但它只用在 50px 上下的大数字，走 3:1 那条线。
    spectrum: ["#262277", "#3d4a9e", "#5470b5", "#6b5a9e"],
};
/**
 * 按时段选调色板
 *
 * 白天（6:00-17:59）浅色，夜间深色。边界取 6 与 18 而不是日出日落：算真实
 * 日照需要经纬度，而这是个 QQ 机器人的出图插件，拿不到也不该问用户要位置。
 *
 * 用本机时区的小时数（宿主机通常就在使用者所在时区）。hour 参数留出注入口，
 * 测试要覆盖两条分支时不必去改系统时间。
 */
export function pickPalette(hour = new Date().getHours()) {
    return hour >= 6 && hour < 18 ? LIGHT : DARK;
}
/**
 * 调色板 -> CSS 自定义属性
 *
 * 为什么加这一层间接
 * ------------------
 * 原先每个 styles/ 层都是 `(p: Palette) => string`，颜色被字符串插值烘进选择器里。
 * 后果是「换主题」等于把整张样式表重新生成一遍，而样式表里有 149 个块——真正变的
 * 只有十几个颜色值。改成变量之后，各层退化成不带参数的静态字符串（常量，可以被
 * 引擎缓存），主题差异集中在 #container 上的一个变量块里。
 *
 * 定义在 :root 而不是 #container
 * ------------------------------
 * base 层有一条 `html,body{background:...}` 在 #container 之外，若变量定义在
 * #container 上，那条规则读不到（自定义属性只向后代继承）。:root 是 html，
 * 覆盖得到全部节点。
 *
 * 组件里的内联 style 不走这套：它们要做 `${c}1f` 这类拼接（给颜色补 hex alpha）
 * 和 `p.rotate[i % 3]` 这类按下标取色，都需要拿到字面量，var() 表达不了。
 * 所以 Palette 本身保留，组件继续按值取用。
 */
export const cssVars = (p) => [
    `--bg:${p.bg}`,
    `--surface:${p.surface}`,
    `--border:${p.border}`,
    `--fg:${p.foreground}`,
    `--muted:${p.muted}`,
    `--inset:${p.inset}`,
    `--primary:${p.primary}`,
    `--secondary:${p.secondary}`,
    `--accent:${p.accent}`,
    `--success:${p.success}`,
    `--warning:${p.warning}`,
    `--danger:${p.danger}`,
    `--glow-1:${p.glow[0]}`,
    `--glow-2:${p.glow[1]}`,
    `--glow-3:${p.glow[2]}`,
    `--glow-4:${p.glow[3]}`,
    `--glow-5:${p.glow[4]}`,
    `--rot-1:${p.rotate[0]}`,
    `--rot-2:${p.rotate[1]}`,
    `--rot-3:${p.rotate[2]}`,
    `--spec-1:${p.spectrum[0]}`,
    `--spec-2:${p.spectrum[1]}`,
    `--spec-3:${p.spectrum[2]}`,
    `--spec-4:${p.spectrum[3]}`,
].join(";");
/**
 * 各层引用颜色时用的 var() 串
 *
 * 写成常量而不是每处手打 `var(--muted)`：拼错变量名不会报错，只会静默拿到
 * 空值（该处样式失效），而 V.muted 拼错了 tsc 立刻报。名字与 Palette 的键
 * 一一对应，glow / rotate 保持数组形态，调用处的 [0]/[1]/[2] 不用改。
 */
export const V = {
    bg: "var(--bg)",
    surface: "var(--surface)",
    border: "var(--border)",
    foreground: "var(--fg)",
    muted: "var(--muted)",
    inset: "var(--inset)",
    primary: "var(--primary)",
    secondary: "var(--secondary)",
    accent: "var(--accent)",
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
    glow: [
        "var(--glow-1)",
        "var(--glow-2)",
        "var(--glow-3)",
        "var(--glow-4)",
        "var(--glow-5)",
    ],
    rotate: ["var(--rot-1)", "var(--rot-2)", "var(--rot-3)"],
    spectrum: ["var(--spec-1)", "var(--spec-2)", "var(--spec-3)", "var(--spec-4)"],
};
/**
 * 字体栈
 *
 * 不打包字体文件：仓库 resources/ 下没有任何 ttf/woff（已确认），
 * 硬指一个不存在的 @font-face 会让 Chromium 回落到默认衬线字体，
 * 中文标题会变得很难看。这里直接列系统字体，Windows/macOS/Linux 各有命中项。
 *
 * 这两个栈在 render/styles/tailwind.css 的 @theme 里各有一份拷贝（--font-sans / --font-mono）。
 * 颜色能靠 var() 只留一处真源，字体不行：@theme 的值要在编译期就确定，而这里是运行时
 * 常量，Tailwind 读不到。改了记得两边一起改——不一致的表现是「用 font-mono 的元素
 * 和用 MONO_STACK 的元素字体不一样」，只在少数几个地方看得出来。
 */
export const FONT_STACK = '"HarmonyOS Sans SC","MiSans","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",' +
    '"Source Han Sans SC",-apple-system,"Segoe UI",Roboto,sans-serif';
/** 等宽栈：版本号、时间、命令、计数用它保持机器感 */
export const MONO_STACK = '"JetBrains Mono","Cascadia Code","SF Mono",Consolas,"DejaVu Sans Mono",monospace';
