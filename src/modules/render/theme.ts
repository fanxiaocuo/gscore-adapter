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
export const CANVAS_WIDTH = 1440

/**
 * 一组颜色角色
 *
 * 两套：LIGHT（白天）与 COOL（夜里），由 pickPalette() 按时段选。
 *
 * COOL 曾经叫 DARK，是真的深色（bg #0a0d14）。换成压花玻璃之后它改成了银灰亮底 ——
 * 理由见 COOL 自己的注释：压花玻璃是亮材质，深底上色斑看不见、白鳞片一叠就是雪花。
 * 名字跟着语义改，免得下一个人按「dark」的预期去读它的取值。
 *
 * 这里有一段反复：曾经的 getPalette(dark) 双主题被删过一次，因为当时的
 * useDark() 硬编码 return true，浅色那套在生产里一次都没跑过——死代码。
 * 现在按时段切换是真需求，两套都有调用方，所以加回来；区别是选择逻辑
 * 变成 pickPalette() 里真会走两条分支的判断，而不是一个永远为真的函数。
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
   * 五团而不是三团：三团各自成形、能看出「三个光球」；五团尺寸位置错开之后互相
   * 咬合，出来才是整片晕染而不是几个球。边缘是靠 radial-gradient 自己在 66~74%
   * 处收干吃掉的，不靠 CSS 模糊 —— 曾经每团还挂着 140~190px 的 blur，实测那五个
   * 滤镜占掉整张图七成耗时而画面几乎不动，已经去掉（数据见 Layout.tsx 的色斑层）。
   *
   * 色相取自 #FFCEE3 → #678EC9 → #262277 那条渐变，外加 #FEDFCB / #FCC2EB 两个
   * 暖调点把冷色调兜住。深浅两套同一手法、不同明度：浅色要压得住黑字所以透明度
   * 低、明度高；深色要在暗底上看得见所以饱和度稍高。
   */
  glow: [string, string, string, string, string]
  /** 分组标题轮换色 */
  rotate: [string, string, string]
  /**
   * 渐变点缀的四档取样
   *
   * 出图是信息密集的界面，大面积渐变会压正文可读性，所以渐变只作点缀：统计卡的
   * 大数字、分组计数。四档取自同一条渐变（粉 → 蓝 → 深蓝紫），按位置轮换，
   * 既有渐变的连续感又保持相邻卡片可区分。
   *
   * 两套各自往自己那侧取样：深色取渐变的亮端（深底要亮才看得见），浅色取暗端。
   * 每一档都验过 ≥3:1（大数字走大字那条线），见下面各自的注释。
   */
  spectrum: [string, string, string, string]
  /**
   * 压花玻璃高光层的强度与混合方式
   *
   * 为什么必须按主题分档
   * -----------------
   * 高光是白色的 feSpecularLighting。浅底上用 screen 混合正好 —— 白鳞片压在浅色
   * 渐变上就是玻璃的反光。深底上同一套是灾难：screen 对深色几乎等于直接叠加纯白，
   * 出来是一屏雪花，正文全被咬花（第一次落地时 help-dark 就是这样，实测不可读）。
   *
   * 深色改用 overlay + 很低的透明度：overlay 在暗部是 2·base·blend，提亮量与底色
   * 成正比，所以深色区域只被轻微擦亮，读起来像烟熏玻璃而不是下雪。
   */
  gloss: { opacity: number; blend: "screen" | "overlay" }
}

/**
 * 夜间那套（历史名 DARK，现已不是深色）
 *
 * 为什么不再是深底
 * ---------------
 * 压花玻璃是**亮材质**：它的质感来自「底下有色块透过来 + 表面反白」。深底上这两件
 * 事都不成立 —— 色斑在近黑上几乎看不见，白鳞片一叠就是雪花（用 screen 实测过，
 * 一屏噪点且正文不可读，只能把 opacity 压到 .06，等于这层白做了）。
 *
 * 所以夜间这套改成**银灰玻璃**：同样是亮底，但基色从白天的 #f4f6fb 压到 #c6d0da
 * （试板 Q 档冷色的中段），整体更冷更沉。白天是「窗外大太阳」，夜里是「阴天的窗」。
 *
 * 代价：不再有夜间护眼的深色出图。这是有意的取舍 —— 出图是发到聊天里的静态图片，
 * 不是长时间盯着的界面；而两套都用玻璃能让版式在一天里保持同一个语言。
 *
 * 基色为什么停在 #c6d0da
 * --------------------
 * 再往下（#bfc9d4）前景那批彩色角色色集体掉出 3.5:1，连深化一档都救不回来：
 * 实测 primary 3.08 / success 2.99 / danger 2.88。#c6d0da 配下面深化过的角色色
 * 全部达标，是「够沉」与「彩色还能用」的交点。
 */
export const COOL: Palette = {
  bg: "#c6d0da",
  // 亮底上的面：半透明白，比白天那套再实一档（银灰底更需要面来托内容）
  surface: "rgba(255,255,255,0.66)",
  border: "rgba(24,36,50,0.12)",
  foreground: "#0f1720",
  /*
   * muted #3d4754
   *
   * 平底上 6.03:1。真实背景（色斑 + 高光合成）的最暗处更吃紧，实测值见
   * test/inkprobe.mjs 的输出 —— 深字的最坏情况在**最暗**那一端。
   */
  muted: "#3d4754",
  inset: "rgba(24,36,50,0.06)",
  /*
   * 角色色整体深化一档
   *
   * 白天那套（primary #2563eb 等）是按 #f4f6fb 配的，搬到 #c6d0da 上普遍掉到
   * 3.1~3.5，压线或不过。这里各深一档，实测（对 #c6d0da）：
   *   primary 4.29 / secondary 4.55 / accent 4.85 / success 4.56 / warning 4.54 / danger 4.14
   * 全部过 3.5，且多数连正文的 4.5 也过 —— 银灰底比纯白底更吃对比度，留余量。
   */
  primary: "#1d4ed8",
  secondary: "#6d28d9",
  accent: "#115e59",
  success: "#166534",
  warning: "#92400e",
  danger: "#b91c1c",
  /*
   * 色斑：与白天同族同色，alpha 略高
   *
   * 银灰底本身比白底暗，斑要更浓才透得出来；同时高光鳞片有更多明暗可调制，
   * 这也是这套玻璃感比白天那套更明显的原因。
   */
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
}

/**
 * 白天那套
 *
 * 两套现在都是亮底（见 COOL 顶部的说明），差的是**基色的沉重程度**：
 * 白天 #f4f6fb 是偏蓝的近白，夜里 #c6d0da 是银灰。白天像大太阳下的窗，
 * 夜里像阴天的窗 —— 同一块玻璃，不同的光。
 *
 * 因为两套都是亮底，角色色的配法也就同源：这一套按 #f4f6fb 配（primary #2563eb
 * 等），COOL 把它们各深化一档以配更沉的银灰底。改一边时记得看另一边是否也要跟。
 */
export const LIGHT: Palette = {
  bg: "#f4f6fb",
  surface: "rgba(255,255,255,0.72)",
  border: "rgba(15,23,42,0.10)",
  foreground: "#101828",
  /*
   * muted 从 #5b6577 压到 #4c5666
   *
   * 同上（见 COOL.muted）的实测方法。浅色背景亮度分布：
   *
   *   p1 L=0.718  p50 L=0.805  p99 L=0.972
   *
   * 深字的最坏情况与深色那套相反 —— 是**最暗**的那一档（色斑最浓处）：
   * #5b6577 在 L=0.718 上只有 4.30:1，差 0.2 掉出 AA。#4c5666 是 5.43:1。
   *
   * 顺带回答「要不要给文字加白色描边」：不要。描边是在对比度不够时把问题糊掉 ——
   * 1px 白边会侵蚀中文那些本来就细的笔画（说明文字 15px 时笔画约 1.5px，白边吃掉
   * 三分之一），小字反而更难认。对比度够了就不需要描边，不够就该改颜色。
   * 原型里那层 --halo 没有进真实组件。
   */
  muted: "#4c5666",
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
  /*
   * 浅色弥散：压花玻璃后面透过来的东西
   *
   * 原来是五团高明度低饱和的粉彩，alpha .40~.62。那套配平铺噪点时成立 —— 噪点只是
   * 修饰，底色越淡越干净。换成压花玻璃之后不成立了：高光鳞片靠调制底色的明暗才
   * 显出起伏，底色几乎没有色差时鳞片只是浮在白纸上的白点，读作「有纹理的纸」
   * 而不是「玻璃后面有东西」。
   *
   * 直接取试板 Q 档（temp/proto/glass-test3.html）的冷色，不重新配
   * ----------------------------------------------------------
   * 那组是三轮比对里选定的一档，已经验过「鳞片有东西可调制」且不与前景撞色：
   *   #5b93de 天蓝 / #2b9ade 亮蓝 / #838bcc 蓝紫 / #7cb238 淡绿
   * 底噪走 #dae0e8 → #bfc9d4 的银灰。整页的强调色是蓝(#2563eb) / 紫(#7c3aed) /
   * 青(#0f766e)，与这组同一个冷色家族，所以不会像绿色那张试板那样出现补色对撞。
   *
   * alpha 比试板低一档（试板是不透明底色，这里是叠在 bg #f4f6fb 上的 glow）
   * ------------------------------------------------------------------
   * .22~.34：再往上会压住正文 —— 文字对比度按 bg 这个平底算，斑越浓，落在斑上
   * 那部分字与算出来的值偏离越大。淡绿那团压到最低（.18），它是唯一的暖偏色，
   * 浓了会在蓝底上显脏。
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
}

/**
 * 按时段选调色板
 *
 * 白天（6:00-17:59）浅色，夜间深色。边界取 6 与 18 而不是日出日落：算真实
 * 日照需要经纬度，而这是个 QQ 机器人的出图插件，拿不到也不该问用户要位置。
 *
 * 用本机时区的小时数（宿主机通常就在使用者所在时区）。hour 参数留出注入口，
 * 测试要覆盖两条分支时不必去改系统时间。
 */
export function pickPalette(hour = new Date().getHours()): Palette {
  return hour >= 6 && hour < 18 ? LIGHT : COOL
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
  glow: ["var(--glow-1)", "var(--glow-2)", "var(--glow-3)", "var(--glow-4)", "var(--glow-5)"],
  rotate: ["var(--rot-1)", "var(--rot-2)", "var(--rot-3)"],
  spectrum: ["var(--spec-1)", "var(--spec-2)", "var(--spec-3)", "var(--spec-4)"],
  /*
   * gloss 不在这里：它不是颜色
   *
   * V 的每一项都是「给 CSS 用的 var() 串」，而 gloss 是 {opacity, blend} ——
   * 一个数值加一个混合模式枚举，只在 Backdrop 里当内联 style 用，走不了 CSS 变量
   * （mix-blend-mode 用变量当值虽然合法，但拆成两个变量比直接传对象更绕）。
   * 所以从约束里 Omit 掉，而不是硬造一个 var() 让类型过关。
   */
} as const satisfies Record<keyof Omit<Palette, "gloss">, string | readonly string[]>

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
export const FONT_STACK =
  '"HarmonyOS Sans SC","MiSans","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",' +
  '"Source Han Sans SC",-apple-system,"Segoe UI",Roboto,sans-serif'

/**
 * 等宽栈：版本号、时间、命令、计数用它保持机器感
 *
 * 尾部必须挂上与 FONT_STACK 同一批中文字体
 * -----------------------------------
 * 原来这个栈到 monospace 就结束了。等宽族全都只覆盖拉丁，中文没有命中项，
 * 于是落到浏览器的 monospace 默认值 —— 用 CDP 的 CSS.getPlatformFontsForNode
 * 查过一条既有中文又有拉丁的示例行（`#早柚添加连接 ws://127.0.0.1:8765/ws`）：
 *
 *   JetBrains Mono×26 | NSimSun×6
 *
 * 拉丁走 JetBrains Mono，中文掉到 NSimSun —— 点阵时代的宋体等宽，笔画又细又硬，
 * 和 JetBrains Mono 的拉丁完全两个年代，同一行里混着看最刺眼。
 * 补上中文回退后同一行变成 PingFang SC×6 | JetBrains Mono×26，中文与正文同族。
 *
 * 代价：中文在这里不再等宽（比例字体），所以 mono 列的中文不会对齐。
 * 但本来就没有「中文列要对齐」的场景 —— mono 用在版本号、时间戳、命令示例上，
 * 需要对齐的全是数字与拉丁，那部分依然走 JetBrains Mono。
 */
export const MONO_STACK =
  '"JetBrains Mono","Cascadia Code","SF Mono",Consolas,"DejaVu Sans Mono",' +
  '"HarmonyOS Sans SC","MiSans","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",monospace'
