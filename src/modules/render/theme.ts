/**
 * @description 视觉 token：给组件用的 Palette 字面量，以及给样式表用的 cssVars / V 自定义属性
 * 取值参照 karin-plugin-kkk 的「弥散信息海报」体系：1440px 固定画布、巨型标题、多层光斑、冷色主情绪。
 * Tailwind 只认这一处真源：styles/tailwind.css 的 @theme 把 --color-* 指到 cssVars 下发的 --* 上，
 * 所以 `text-muted` 这类 utility 会随调色板走，不需要 dark: 变体，也不需要在根节点挂主题类。
 * 注意：产物必须内联进 <style> 而不是 <link> —— puppeteer 用 file:// 打开 HTML，没有 dev server 供外部资源。
 */

/** @description 固定画布宽度，与 kkk 一致 */
export const CANVAS_WIDTH = 1440

/**
 * @description 一组颜色角色。两套：LIGHT（白天）与 COOL（夜里），由 pickPalette() 按时段选
 * COOL 曾经叫 DARK、是真的深色，换成压花玻璃之后改成了银灰亮底，名字跟着语义改，免得下一个人按
 * 「dark」的预期去读它的取值。
 */
export interface Palette {
  bg: string
  surface: string
  border: string
  foreground: string
  muted: string
  /** 卡片内部的凹陷块：示例框、meta 标签。比 surface 再深/浅一档 */
  inset: string
  primary: string
  secondary: string
  accent: string
  success: string
  warning: string
  danger: string
  /**
   * 弥散渐变的色斑
   *
   * 五团而不是三团：三团各自成形、能看出「三个光球」；五团尺寸位置错开之后互相咬合，出来才是整片晕染。
   * 色相取自 #FFCEE3 → #678EC9 → #262277 那条渐变，外加两个暖调点把冷色调兜住。
   * 注意：边缘靠 radial-gradient 自己在 66~74% 处收干，别再挂 CSS 模糊 —— 那五个滤镜占掉整张图七成
   * 耗时而画面几乎不动（数据见 Layout.tsx 的色斑层）。
   */
  glow: [string, string, string, string, string]
  /** 分组标题轮换色 */
  rotate: [string, string, string]
  /**
   * 渐变点缀的四档取样（统计卡的大数字、分组计数）
   *
   * 出图是信息密集的界面，大面积渐变会压正文可读性，所以渐变只作点缀。四档取自同一条渐变
   * （粉 → 蓝 → 深蓝紫）按位置轮换；两套各自往自己那侧取样，每一档都验过 ≥3:1。
   */
  spectrum: [string, string, string, string]
}

/**
 * @description 夜间那套：银灰玻璃亮底（历史名 DARK，现已不是深色）
 * 压花玻璃是亮材质，质感来自「底下有色块透过来 + 表面反白」，深底上这两件事都不成立 —— 色斑几乎看不见、
 * 白鳞片一叠就是雪花。所以夜间改成同样亮底但更冷更沉的 #c6d0da：白天是「窗外大太阳」，夜里是「阴天的窗」。
 * 代价是不再有夜间护眼的深色出图，这是有意的取舍 —— 出图是发到聊天里的静态图片，不是长时间盯着的界面。
 * 注意：基色别再往下压。#bfc9d4 上前景那批彩色角色色集体掉出 3.5:1（实测 primary 3.08 / success 2.99 /
 * danger 2.88），#c6d0da 是「够沉」与「彩色还能用」的交点。
 */
export const COOL: Palette = {
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
  /*
   * 色斑：五团弥散光，靠色相跨度而不是纹理撑住画面
   *
   * 换掉压花高光之后，「不显廉价」这件事全压在这一层身上，所以配色目标从「给鳞片提供可调制的明暗」
   * 变成「让整片场自己走过一段色相」—— 原来五团全是蓝族（天蓝/蓝紫/亮蓝/淡绿/银灰），只在明度上动，
   * 没有高频纹理托着就会读成一块塑料。现在把蓝紫推成真紫、把那团淡绿换成暖玫，冷场里留一处暖，
   * 视线才有落点。银灰仍作粘合，压在最不起眼的位置。
   *
   * 注意：alpha 整体比压花时代低一档。高光层是 white + screen，screen 只提亮 —— 删掉它等于把背景暗部
   * 原样还原，muted 对比度会跟着掉（COOL 原本最坏只有 4.72:1，余量 0.22）。所以斑必须同时变淡来补偿，
   * 改这几个值之后必须跑 test/inkprobe.mjs 复核，不能只看截图。
   * 注意：暖玫不能压太低。第一版给了 .13，在银灰底上被整个吃掉，整幅仍是一片蓝灰、色相根本没走出去 ——
   * 「唯一的暖色浓了会显脏」那条经验是压花时代的（那时它要和鳞片抢像素），现在没有纹理托着，
   * 它反而是唯一能让画面不单调的东西，所以抬到 .20 并单独摆到右下的空档里。
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
  // 取渐变暗端，比白天那套再深一档以配银灰底
  spectrum: ["#1e1b5c", "#2f3a82", "#42599c", "#544a86"],
}

/**
 * @description 白天那套：偏蓝的近白 #f4f6fb
 * 两套现在都是亮底（见 COOL 顶部的说明），差的是基色的沉重程度 —— 白天像大太阳下的窗，夜里像阴天的窗。
 * 注意：角色色按 #f4f6fb 配，COOL 把它们各深化一档以配更沉的银灰底，改一边时记得看另一边是否也要跟。
 */
export const LIGHT: Palette = {
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
   * 浅色弥散：同一套色相跨度，alpha 再低一档
   *
   * 近白底本来就没多少色差可用，所以这里最容易读成「一张白纸上刷了点颜色」。对策与 COOL 相同：
   * 靠色相走位（天蓝 → 紫 → 青 → 暖玫）而不是靠浓度，银灰那团反而是五团里最实的一个，用来把
   * 整片场压住不发飘。
   *
   * 注意：alpha 比 COOL 更低。底越白，同样的 alpha 压下去的对比度损失越大，而这一套的 muted
   * 是 #4c5666，比 COOL 那支浅。改完同样要跑 test/inkprobe.mjs。
   */
  glow: [
    "rgba(91,147,222,0.22)",
    "rgba(138,127,208,0.21)",
    "rgba(43,154,222,0.17)",
    "rgba(226,158,126,0.17)",
    "rgba(191,201,212,0.22)",
  ],
  // 与 primary/secondary/accent 同值，改一个就得改这里——见下方 rotate 的一致性测试
  rotate: ["#2563eb", "#7c3aed", "#0f766e"],
  // 取渐变暗端（浅底要深才看得见）。在 #f4f6fb 上实测 12.2 / 7.1 / 4.4 / 5.3 : 1。
  // 第三档 4.38 略低于正文的 4.5，但它只用在 50px 上下的大数字，走 3:1 那条线。
  spectrum: ["#262277", "#3d4a9e", "#5470b5", "#6b5a9e"],
}

/**
 * @description 按时段选调色板：白天（6:00-17:59）用 LIGHT，夜间用 COOL
 * 边界取 6 与 18 而不是日出日落：算真实日照需要经纬度，而这是个 QQ 机器人的出图插件，不该问用户要位置。
 * hour 参数留出注入口，测试要覆盖两条分支时不必去改系统时间。
 */
export function pickPalette(hour = new Date().getHours()): Palette {
  return hour >= 6 && hour < 18 ? LIGHT : COOL
}

/**
 * @description 调色板 -> CSS 自定义属性
 * 加这一层间接是为了让各 styles/ 层退化成不带参数的静态字符串、主题差异集中在一个变量块里 —— 原先颜色被
 * 插值烘进选择器，换主题等于把 149 个块整张重新生成一遍，而真正变的只有十几个颜色值。
 * 注意：定义在 :root 而不是 #container —— base 层有一条 `html,body{background:...}` 在 #container 之外，
 * 变量挂在 #container 上那条规则就读不到（自定义属性只向后代继承）。
 * 注意：组件里的内联 style 不走这套，它们要 `${c}1f` 拼接与按下标取色，都需要字面量，所以 Palette 本身保留。
 */
export const cssVars = (p: Palette): string =>
  [
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
  ].join(";")

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
  // Palette 的每一项都在这里有对应的 var()：换掉压花高光之后 gloss 那个非颜色字段没了，
  // 于是这条约束不再需要 Omit，少一处「为什么它是例外」要解释
} as const satisfies Record<keyof Palette, string | readonly string[]>

/**
 * @description 字体栈：直接列系统字体，不打包字体文件
 * 仓库 resources/ 下没有任何 ttf/woff，硬指一个不存在的 @font-face 会让 Chromium 回落到默认衬线字体，
 * 中文标题会变得很难看。Windows/macOS/Linux 各有命中项。
 * 注意：这两个栈在 styles/tailwind.css 的 @theme 里各有一份拷贝 —— @theme 的值要在编译期确定，读不到
 * 运行时常量，所以改了要两边一起改，不一致的表现是 font-mono 与 MONO_STACK 的元素字体不一样。
 */
export const FONT_STACK =
  '"HarmonyOS Sans SC","MiSans","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",' +
  '"Source Han Sans SC",-apple-system,"Segoe UI",Roboto,sans-serif'

/**
 * @description 等宽栈：版本号、时间、命令、计数用它保持机器感
 * 注意：尾部必须挂上与 FONT_STACK 同一批中文字体 —— 等宽族只覆盖拉丁，中文没有命中项就会掉到浏览器的
 * monospace 默认值（实测是 NSimSun，点阵时代的宋体等宽），同一行里混着 JetBrains Mono 的拉丁最刺眼。
 * 代价是中文在这里不再等宽，但 mono 只用在版本号、时间戳、命令示例上，需要对齐的全是数字与拉丁。
 */
export const MONO_STACK =
  '"JetBrains Mono","Cascadia Code","SF Mono",Consolas,"DejaVu Sans Mono",' +
  '"HarmonyOS Sans SC","MiSans","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",monospace'
