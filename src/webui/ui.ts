/**
 * @description 跨模块共用的 className 常量，让「同一个视觉元素」只有一处定义
 * 只放不止一个模块用到的那几个：只有 main.tsx 自己用的（GRID / PANEL / ROW…）留在原处更好读。
 * 没做成 CSS 类是因为它们只是 utility 的组合（方针见 styles.css 的注释）
 *
 * 注意：形状与配色分开写 —— 同一属性的两个 utility 写在一起时，谁生效由样式表里的先后决定
 * 而不是 className 的顺序，所以颜色变体不叠加基础色（`BTN` 与 `BTN_PRIMARY` 各自写全）
 * 注意：本文件是 .ts，靠 styles.css 的 `@source "./**\/*.{ts,tsx}"` 才被扫到。挪位置或新增
 * 子目录时一起看那条 glob —— 失配不报错，只会让这些 utility 静默变空
 */

/**
 * @description 等宽字栈，与 Tailwind 的 `font-mono` 略有出入，按原样式表逐项写死
 * 账号、路径要与核心后台显示的串对得上，字形宽度不一致时一眼看不出是不是同一个号
 */
export const MONO = "font-[family-name:ui-monospace,SFMono-Regular,Consolas,monospace]"

/** 小标签胶囊：描边 + 圆角 + 弱化文字色。装饰性描边，用弱的那个 border */
export const TAG = "rounded-[999px] border border-border px-[8px] py-[1px] text-[11px] text-muted"

/**
 * @description 键盘聚焦环，所有自己造的可交互元素都要挂
 * 用 outline 而不是 ring：ring 是 box-shadow，与 chip 那圈描边、开关的内描边会互相盖掉
 */
export const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"

/**
 * @description 输入框：控件边界必须用 border-strong（SC 1.4.11 的 3:1），不是装饰性的 border
 * 底色用 surface2 而不是 bg —— 输入框长在卡片（surface）上，两者相等时框就没了
 */
export const INPUT = `rounded-[8px] border border-border-strong bg-surface2 px-[10px] py-[7px] text-[13px] text-fg ${FOCUS}`

/** 按钮的形状部分，配色由下面三个变体各自写全 */
const BTN_SHAPE = `cursor-pointer rounded-[8px] border px-[14px] py-[6px] text-[13px] ${FOCUS}`
/** 次要按钮 */
export const BTN = `${BTN_SHAPE} border-border-strong bg-surface text-fg hover:border-accent hover:text-accent`
/** 主按钮。字色走 accent-fg 而不是 white：深色下那是深墨，写死白字只有 2.37:1 */
export const BTN_PRIMARY = `${BTN_SHAPE} border-transparent bg-accent text-accent-fg hover:opacity-90`
/** 危险动作按钮，平时不红，hover 才变 —— 常驻红色会让「删除」比「保存」更抢眼 */
export const BTN_DANGER = `${BTN_SHAPE} border-border-strong bg-surface text-fg hover:border-danger hover:text-danger`

/** 说明文字：段落级（行下方独占一行） */
export const HINT = "mt-[2px] text-[12px] text-muted"
/** 说明文字：字段级（挂在标签下面，字号再小一档） */
export const FHINT = "text-[11px] text-muted"

/**
 * @description 逗号分隔的文本 → 数组。中英文逗号都收，顺手去空项与首尾空白
 *
 * 面板上有两个「粘一串进来」的入口：连接弹层的绑定/排除账号（`type: "list"` 文本框）与
 * chip 标签输入。两处必须同一套解析 —— 各写一份的话「改了分隔符」只会改到一半，
 * 同样的粘贴内容在两个框里得到不同结果，而且没有任何编译期信号。
 * 注意：只 trim 首尾、不动内容 —— 前缀里的 `#`、关键词里的空格与大小写改一个字就匹配不上
 */
export const toList = (s: string): string[] =>
  s
    .split(/[,，]/)
    .map(v => v.trim())
    .filter(Boolean)
