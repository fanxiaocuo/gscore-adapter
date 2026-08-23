/**
 * @description 视觉 token：给组件用的 Palette 字面量，以及给样式表用的 cssVars / V 自定义属性
 * 取值参照 karin-plugin-kkk 的「弥散信息海报」体系：1440px 固定画布、巨型标题、多层光斑、冷色主情绪。
 * Tailwind 只认这一处真源：styles/tailwind.css 的 @theme 把 --color-* 指到 cssVars 下发的 --* 上，
 * 所以 `text-muted` 这类 utility 会随调色板走，不需要 dark: 变体，也不需要在根节点挂主题类。
 * 注意：产物必须内联进 <style> 而不是 <link> —— puppeteer 用 file:// 打开 HTML，没有 dev server 供外部资源。
 */
/** @description 固定画布宽度，与 kkk 一致 */
export const CANVAS_WIDTH = 1440;
/**
 * @description 夜间那套：银灰玻璃亮底（历史名 DARK，现已不是深色）
 * 压花玻璃是亮材质，质感来自「底下有色块透过来 + 表面反白」，深底上这两件事都不成立 —— 色斑几乎看不见、
 * 白鳞片一叠就是雪花。所以夜间改成同样亮底但更冷更沉的 #c6d0da：白天是「窗外大太阳」，夜里是「阴天的窗」。
 * 代价是不再有夜间护眼的深色出图，这是有意的取舍 —— 出图是发到聊天里的静态图片，不是长时间盯着的界面。
 * 注意：基色别再往下压。#bfc9d4 上前景那批彩色角色色集体掉出 3.5:1（实测 primary 3.08 / success 2.99 /
 * danger 2.88），#c6d0da 是「够沉」与「彩色还能用」的交点。
 */
export const COOL = {
    bg: "#c6d0da",
    // 亮底上的面：半透明白，比白天那套再实一档（银灰底更需要面来托内容）
    surface: "rgba(255,255,255,0.66)",
    border: "rgba(24,36,50,0.12)",
    foreground: "#0f1720",
    /* muted #3d4754：平底上 6.03:1。真实背景（色斑 + 高光合成）的最暗处更吃紧，实测值见 test/inkprobe.mjs */
    muted: "#3d4754",
    inset: "rgba(24,36,50,0.06)",
    /*
     * 角色色整体深化一档：白天那套是按 #f4f6fb 配的，搬到 #c6d0da 上普遍掉到 3.1~3.5，压线或不过。
     * 实测（对 #c6d0da）primary 4.29 / secondary 4.55 / accent 4.85 / success 4.56 / warning 4.54 / danger 4.14
     * —— 全部过 3.5 且多数连正文的 4.5 也过，银灰底比纯白底更吃对比度，留余量。
     */
    primary: "#1d4ed8",
    secondary: "#6d28d9",
    accent: "#115e59",
    success: "#166534",
    warning: "#92400e",
    danger: "#b91c1c",
    /* 色斑：与白天同族同色，alpha 略高 —— 银灰底比白底暗，斑要更浓才透得出来 */
    glow: [
        "rgba(91,147,222,0.40)",
        "rgba(131,139,204,0.36)",
        "rgba(43,154,222,0.32)",
        "rgba(124,178,56,0.20)",
        "rgba(191,201,212,0.30)",
    ],
    // 与 primary/secondary/accent 同值（contrast.mjs 有一致性断言）
    rotate: ["#1d4ed8", "#6d28d9", "#115e59"],
    // 取渐变暗端，比白天那套再深一档以配银灰底
    spectrum: ["#1e1b5c", "#2f3a82", "#42599c", "#544a86"],
    // 亮底：与白天同样走 screen。这正是换掉深底换来的东西 —— 高光终于能全强度用
    gloss: { opacity: 0.85, blend: "screen" },
};
/**
 * @description 白天那套：偏蓝的近白 #f4f6fb
 * 两套现在都是亮底（见 COOL 顶部的说明），差的是基色的沉重程度 —— 白天像大太阳下的窗，夜里像阴天的窗。
 * 注意：角色色按 #f4f6fb 配，COOL 把它们各深化一档以配更沉的银灰底，改一边时记得看另一边是否也要跟。
 */
export const LIGHT = {
    bg: "#f4f6fb",
    surface: "rgba(255,255,255,0.72)",
    border: "rgba(15,23,42,0.10)",
    foreground: "#101828",
    /*
     * muted 从 #5b6577 压到 #4c5666
     *
     * 深字的最坏情况是最暗那一档（色斑最浓处，L=0.718）：#5b6577 只有 4.30:1、差 0.2 掉出 AA，
     * #4c5666 是 5.43:1。
     * 注意：别给文字加白色描边来救对比度 —— 1px 白边会侵蚀中文本来就细的笔画（15px 时笔画约 1.5px，
     * 白边吃掉三分之一），小字反而更难认。对比度够了就不需要描边，不够就该改颜色。
     */
    muted: "#4c5666",
    inset: "rgba(15,23,42,0.05)",
    primary: "#2563eb",
    secondary: "#7c3aed",
    // teal-700 而不是 teal-600(#0d9488)：后者 3.46:1。青色在浅底上是全套里最弱的一个，
    // 而它同时出现在分组标题轮换色的第三位（rotate[2]），标题字号比状态点小
    accent: "#0f766e",
    // green-700 而不是 green-600(#16a34a)：后者 3.05:1，压着大字 3:1 的线过，余量只有 0.05。
    // 700 是 4.54:1，与 warning 同一档余量
    success: "#15803d",
    // amber-700 而不是 amber-600(#d97706)：后者只有 2.95:1，页脚的版本号（38px 粗体）差一点点够不到
    // WCAG AA 的大字 3:1。700 是 4.64:1，连普通字号的 4.5 也过得去
    warning: "#b45309",
    danger: "#dc2626",
    /*
     * 浅色弥散：压花玻璃后面透过来的东西
     *
     * 底色几乎没有色差时鳞片只是浮在白纸上的白点，读作「有纹理的纸」而不是「玻璃后面有东西」，所以直接
     * 取试板 Q 档的冷色（#5b93de 天蓝 / #2b9ade 亮蓝 / #838bcc 蓝紫 / #7cb238 淡绿）—— 那组已验过
     * 「鳞片有东西可调制」，且与整页强调色同一个冷色家族，不会出现补色对撞。
     * alpha 取 .22~.34（比试板低一档，这里是叠在 bg 上的）：再往上会压住正文。淡绿那团压到最低 .18，
     * 它是唯一的暖偏色，浓了会在蓝底上显脏。
     */
    glow: [
        "rgba(91,147,222,0.32)",
        "rgba(131,139,204,0.30)",
        "rgba(43,154,222,0.26)",
        "rgba(124,178,56,0.18)",
        "rgba(191,201,212,0.34)",
    ],
    // 与 primary/secondary/accent 同值，改一个就得改这里——见下方 rotate 的一致性测试
    rotate: ["#2563eb", "#7c3aed", "#0f766e"],
    // 取渐变暗端（浅底要深才看得见）。在 #f4f6fb 上实测 12.2 / 7.1 / 4.4 / 5.3 : 1。
    // 第三档 4.38 略低于正文的 4.5，但它只用在 50px 上下的大数字，走 3:1 那条线。
    spectrum: ["#262277", "#3d4a9e", "#5470b5", "#6b5a9e"],
    // 浅底：screen + .85，照试板 Q 档原值。降到 .62 试过，鳞片明显发闷
    gloss: { opacity: 0.85, blend: "screen" },
};
/**
 * @description 按时段选调色板：白天（6:00-17:59）用 LIGHT，夜间用 COOL
 * 边界取 6 与 18 而不是日出日落：算真实日照需要经纬度，而这是个 QQ 机器人的出图插件，不该问用户要位置。
 * hour 参数留出注入口，测试要覆盖两条分支时不必去改系统时间。
 */
export function pickPalette(hour = new Date().getHours()) {
    return hour >= 6 && hour < 18 ? LIGHT : COOL;
}
/**
 * @description 调色板 -> CSS 自定义属性
 * 加这一层间接是为了让各 styles/ 层退化成不带参数的静态字符串、主题差异集中在一个变量块里 —— 原先颜色被
 * 插值烘进选择器，换主题等于把 149 个块整张重新生成一遍，而真正变的只有十几个颜色值。
 * 注意：定义在 :root 而不是 #container —— base 层有一条 `html,body{background:...}` 在 #container 之外，
 * 变量挂在 #container 上那条规则就读不到（自定义属性只向后代继承）。
 * 注意：组件里的内联 style 不走这套，它们要 `${c}1f` 拼接与按下标取色，都需要字面量，所以 Palette 本身保留。
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
 * 写成常量而不是每处手打 `var(--muted)`：拼错变量名不会报错，只会静默拿到空值（该处样式失效），
 * 而 V.muted 拼错了 tsc 立刻报。
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
    /*
     * 注意：gloss 有意不在这里 —— V 的每一项都是「给 CSS 用的 var() 串」，而 gloss 是 {opacity, blend}，
     * 只在 Backdrop 里当内联 style 用。所以从约束里 Omit 掉，而不是硬造一个 var() 让类型过关。
     */
};
/**
 * @description 字体栈：直接列系统字体，不打包字体文件
 * 仓库 resources/ 下没有任何 ttf/woff，硬指一个不存在的 @font-face 会让 Chromium 回落到默认衬线字体，
 * 中文标题会变得很难看。Windows/macOS/Linux 各有命中项。
 * 注意：这两个栈在 styles/tailwind.css 的 @theme 里各有一份拷贝 —— @theme 的值要在编译期确定，读不到
 * 运行时常量，所以改了要两边一起改，不一致的表现是 font-mono 与 MONO_STACK 的元素字体不一样。
 */
export const FONT_STACK = '"HarmonyOS Sans SC","MiSans","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",' +
    '"Source Han Sans SC",-apple-system,"Segoe UI",Roboto,sans-serif';
/**
 * @description 等宽栈：版本号、时间、命令、计数用它保持机器感
 * 注意：尾部必须挂上与 FONT_STACK 同一批中文字体 —— 等宽族只覆盖拉丁，中文没有命中项就会掉到浏览器的
 * monospace 默认值（实测是 NSimSun，点阵时代的宋体等宽），同一行里混着 JetBrains Mono 的拉丁最刺眼。
 * 代价是中文在这里不再等宽，但 mono 只用在版本号、时间戳、命令示例上，需要对齐的全是数字与拉丁。
 */
export const MONO_STACK = '"JetBrains Mono","Cascadia Code","SF Mono",Consolas,"DejaVu Sans Mono",' +
    '"HarmonyOS Sans SC","MiSans","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",monospace';
