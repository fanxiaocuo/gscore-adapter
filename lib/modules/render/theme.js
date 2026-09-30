/**
 * @description 视觉 token：组件用的 Palette 字面量，以及样式表用的 cssVars / V 自定义属性
 * Tailwind 真源只此一处：styles/tailwind.css 的 @theme 把 --color-* 指到 cssVars 下发的 --*，所以 `text-muted` 这类 utility 随调色板走，无需 dark: 变体或根节点主题类。
 * 注意：产物必须内联进 <style> 而非 <link>——puppeteer 用 file:// 打开 HTML，无 dev server 供外部资源。
 */
/** @description 固定画布宽度，与 kkk 一致 */
export const CANVAS_WIDTH = 1440;
/**
 * @description 夜间那套：银灰玻璃亮底 #c6d0da（历史名 DARK，非深色）。白天「窗外大太阳」，夜里「阴天的窗」；不做深色护眼出图是有意取舍——出图是发到聊天的静态图。
 * 注意：基色别再往下压。#bfc9d4 上前景彩色角色色集体掉出 3.5:1（实测 primary 3.08 / success 2.99 / danger 2.88），#c6d0da 是「够沉」与「彩色还能用」的交点。
 */
export const COOL = {
    bg: "#c6d0da",
    // 亮底上的面：半透明白，比白天再实一档（银灰底更需要面来托内容）
    surface: "rgba(255,255,255,0.66)",
    border: "rgba(24,36,50,0.12)",
    foreground: "#0f1720",
    /* muted #3d4754：平底上 6.03:1；真实背景（色斑 + 高光合成）最暗处更吃紧，实测值见 test/inkprobe.mjs */
    muted: "#3d4754",
    inset: "rgba(24,36,50,0.06)",
    /*
     * 角色色整体深化一档（白天那套按 #f4f6fb 配，搬到 #c6d0da 上普遍掉到 3.1~3.5）。实测对 #c6d0da：
     * primary 4.29 / secondary 4.55 / accent 4.85 / success 4.56 / warning 4.54 / danger 4.14——全过 3.5，银灰底比纯白底更吃对比度，留余量。
     */
    primary: "#1d4ed8",
    secondary: "#6d28d9",
    accent: "#115e59",
    success: "#166534",
    warning: "#92400e",
    danger: "#b91c1c",
    /*
     * 色斑：五团弥散光，靠色相跨度而非纹理撑画面。蓝紫推成真紫、一团淡绿换暖玫（冷场留一处暖作落点），银灰作粘合压在最不起眼处。
     * 注意：alpha 整体比压花时代低一档。高光层是 white + screen（只提亮），删掉它等于把背景暗部原样还原，muted 对比度会跟着掉（COOL 原本最坏 4.72:1，余量 0.22），故斑必须同时变淡补偿；改这几个值后必须跑 test/inkprobe.mjs 复核，不能只看截图。
     * 注意：暖玫不能压太低（.13 会被银灰底整个吃掉、色相走不出去）——它是唯一让画面不单调的色，抬到 .20 并单独摆到右下空档。
     */
    glow: [
        "rgba(91,147,222,0.26)",
        "rgba(138,127,208,0.24)",
        "rgba(43,154,222,0.20)",
        "rgba(226,158,126,0.20)",
        "rgba(191,201,212,0.18)",
    ],
    // 与 primary/secondary/accent 同值（contrast.mjs 有一致性断言）
    rotate: ["#1d4ed8", "#6d28d9", "#115e59"],
    // 取渐变暗端，比白天再深一档以配银灰底
    spectrum: ["#1e1b5c", "#2f3a82", "#42599c", "#544a86"],
};
/**
 * @description 白天那套：偏蓝的近白 #f4f6fb（与 COOL 同为亮底，差在基色沉重程度）
 * 注意：角色色按 #f4f6fb 配，COOL 各深化一档以配更沉的银灰底，改一边记得看另一边是否也要跟。
 */
export const LIGHT = {
    bg: "#f4f6fb",
    surface: "rgba(255,255,255,0.72)",
    border: "rgba(15,23,42,0.10)",
    foreground: "#101828",
    /*
     * muted 从 #5b6577 压到 #4c5666：深字最坏在最暗档（色斑最浓处 L=0.718），#5b6577 只有 4.30:1 掉出 AA，#4c5666 是 5.43:1。
     * 注意：别给文字加白色描边救对比度——1px 白边会侵蚀中文本就细的笔画（15px 时笔画约 1.5px，白边吃掉三分之一），小字更难认；对比度不够就该改颜色。
     */
    muted: "#4c5666",
    inset: "rgba(15,23,42,0.05)",
    primary: "#2563eb",
    secondary: "#7c3aed",
    // teal-700 而非 teal-600(#0d9488 仅 3.46:1)：青色在浅底上最弱，又出现在 rotate[2]（标题字号比状态点小）
    accent: "#0f766e",
    // green-700 而非 green-600(#16a34a 仅 3.05:1，余量 0.05)：700 是 4.54:1，与 warning 同档余量
    success: "#15803d",
    // amber-700 而非 amber-600(#d97706 仅 2.95:1，页脚版本号 38px 粗体够不到大字 3:1)：700 是 4.64:1，连正文 4.5 也过
    warning: "#b45309",
    danger: "#dc2626",
    /*
     * 浅色弥散：同一套色相跨度（天蓝 → 紫 → 青 → 暖玫），银灰那团最实、用来把整片场压住不发飘。
     * 注意：alpha 比 COOL 更低——底越白同样 alpha 压下去的对比度损失越大，且此套 muted #4c5666 比 COOL 浅。改完同样要跑 test/inkprobe.mjs。
     */
    glow: [
        "rgba(91,147,222,0.22)",
        "rgba(138,127,208,0.21)",
        "rgba(43,154,222,0.17)",
        "rgba(226,158,126,0.17)",
        "rgba(191,201,212,0.22)",
    ],
    // 与 primary/secondary/accent 同值，改一个就得改这里（见 rotate 的一致性测试）
    rotate: ["#2563eb", "#7c3aed", "#0f766e"],
    // 取渐变暗端（浅底要深才看得见）。#f4f6fb 上实测 12.2 / 7.1 / 4.4 / 5.3 : 1；第三档 4.38 略低于正文 4.5，但只用在 50px 大数字走 3:1
    spectrum: ["#262277", "#3d4a9e", "#5470b5", "#6b5a9e"],
};
/**
 * @description 按时段选调色板：白天（6:00-17:59）用 LIGHT，夜间用 COOL
 * 边界取 6 与 18 而非日出日落（算真实日照要经纬度，不该问用户要位置）。hour 参数留作注入口，测试覆盖两分支不必改系统时间。
 */
export function pickPalette(hour = new Date().getHours()) {
    return hour >= 6 && hour < 18 ? LIGHT : COOL;
}
/**
 * @description 调色板 -> CSS 自定义属性
 * 这层间接让各 styles/ 层退化成静态字符串、主题差异集中在一个变量块（否则换主题要把 149 个块整张重生，而真正变的只有十几个颜色）。
 * 注意：定义在 :root 而非 #container——base 层有条 `html,body{background:...}` 在 #container 之外，变量挂 #container 上它读不到（自定义属性只向后代继承）。
 * 注意：组件内联 style 不走这套（要 `${c}1f` 拼接与按下标取色，都需字面量），故 Palette 本身保留。
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
 * @description 各层引用颜色时用的 var() 串，名字与 Palette 的键一一对应
 * 写成常量而非每处手打 `var(--muted)`：拼错变量名不报错、只静默拿空值（样式失效），而 V.muted 拼错 tsc 立刻报。
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
    glow: ["var(--glow-1)", "var(--glow-2)", "var(--glow-3)", "var(--glow-4)", "var(--glow-5)"],
    rotate: ["var(--rot-1)", "var(--rot-2)", "var(--rot-3)"],
    spectrum: ["var(--spec-1)", "var(--spec-2)", "var(--spec-3)", "var(--spec-4)"],
    // Palette 每一项在这里都有对应 var()：gloss 那个非颜色字段已删，故此约束不再需要 Omit
};
/**
 * @description 字体栈：直接列系统字体，不打包字体文件（resources/ 无 ttf/woff，指不存在的 @font-face 会回落默认衬线，中文标题变难看）。Windows/macOS/Linux 各有命中项。
 * 注意：这两个栈在 styles/tailwind.css 的 @theme 里各有一份拷贝（@theme 值须编译期确定、读不到运行时常量），改了要两边一起改，不一致表现为 font-mono 与 MONO_STACK 字体不同。
 */
export const FONT_STACK = '"HarmonyOS Sans SC","MiSans","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",' +
    '"Source Han Sans SC",-apple-system,"Segoe UI",Roboto,sans-serif';
/**
 * @description 等宽栈：版本号、时间、命令、计数用它保持机器感
 * 注意：尾部必须挂与 FONT_STACK 同一批中文字体——等宽族只覆盖拉丁，中文没命中项会掉到浏览器 monospace 默认（实测 NSimSun）。代价是中文不再等宽，但 mono 只用在版本号/时间戳/命令示例，需对齐的全是数字与拉丁。
 */
export const MONO_STACK = '"JetBrains Mono","Cascadia Code","SF Mono",Consolas,"DejaVu Sans Mono",' +
    '"HarmonyOS Sans SC","MiSans","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",monospace';
