import { jsx as _jsx } from "react/jsx-runtime";
/**
 * @description 图标集：把语义名映射到 lucide-react 组件，commands.ts 只按语义名引用
 * lucide 在 dependencies 里，运行时从 node_modules 解析（产物不打包）—— 所以 release / preview 分支装完要
 * pnpm install。SSR 下组件展开即内联 svg，颜色靠 currentColor 继承。换图标只动下面那张表。
 * 注意：别改回字符标记（◉ ≡ ↻ ⚙）—— 那些几何符号在 Latin 字体里普遍缺字，Chromium 回落到中文字体后墨迹在
 * em 方框里整体偏下，怎么居中都偏；而且换台机器、少装一个字体，字形宽窄就变了，截图不可复现。
 */
import { Activity, ArrowUp, ChevronsUp, CircleCheck, CircleDot, CircleMinus, CirclePlay, CirclePlus, CircleStop, CircleX, Info, List, RefreshCw, ScrollText, Search, Settings, } from "lucide-react";
/**
 * @description 语义名 -> lucide 组件
 * plus/minus/play/stop 用 Circle* 变体而不是裸的加减号：帮助页里这四个图标各自待在一个 48/60px 的圆角色块
 * 中央，裸符号在那么大的底上显得空，有外轮廓的变体视觉重量才与同排的 Activity / Settings 配得上。
 * check/cross 只给设置结果条用 —— 那里曾借 play/stop，而播放三角与「这项改成功了」没有语义关系。
 */
const ICONS = {
    status: Activity,
    list: List,
    refresh: RefreshCw,
    plus: CirclePlus,
    minus: CircleMinus,
    play: CirclePlay,
    stop: CircleStop,
    settings: Settings,
    arrowUp: ArrowUp,
    arrowUpDouble: ChevronsUp,
    changelog: ScrollText,
    search: Search,
    info: Info,
    dot: CircleDot,
    check: CircleCheck,
    cross: CircleX,
};
/**
 * @description 一个图标，尺寸交给外层 CSS
 * 注意：要显式传 width/height 为 undefined 来压掉 lucide 默认写在 <svg> 上的那两个属性 —— 光传
 * size={undefined} 没用，lucide 会回落到默认值 24，照样渲染出 width="24" height="24"。viewBox 保留。
 * 注意：lucide 还会无条件挂上 `class="lucide lucide-circle-dot"`，传 className 覆盖不掉（合并而非替换）。
 * 这两个类不参与样式，但 classes.test.mjs 会把「HTML 里有、CSS 里无」报成漏写，所以 base.ts 的 reset 层
 * 给了一条空规则认领它们。
 */
export function Icon({ name }) {
    const C = ICONS[name];
    return _jsx(C, { width: undefined, height: undefined, "aria-hidden": "true" });
}
