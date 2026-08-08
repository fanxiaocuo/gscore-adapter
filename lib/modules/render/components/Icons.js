import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/** 描边图标的公共属性：24×24、圆头圆角、跟随 currentColor */
const STROKE = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
};
/**
 * 各图标的绘制内容
 *
 * 描边路径统一继承 <svg> 上的 STROKE；需要实心的部分（圆点、旋钮、播放三角）
 * 单独写 fill="currentColor" stroke="none" 覆盖。
 */
const PATHS = {
    // 靶心：状态
    status: (_jsxs(_Fragment, { children: [_jsx("circle", { cx: "12", cy: "12", r: "8" }), _jsx("circle", { cx: "12", cy: "12", r: "3", fill: "currentColor", stroke: "none" })] })),
    // 三横：列表
    list: (_jsxs(_Fragment, { children: [_jsx("path", { d: "M4 7h16" }), _jsx("path", { d: "M4 12h16" }), _jsx("path", { d: "M4 17h10" })] })),
    // 顺时针环箭头：重连
    refresh: (_jsxs(_Fragment, { children: [_jsx("path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" }), _jsx("path", { d: "M21 3v5h-5" })] })),
    plus: (_jsxs(_Fragment, { children: [_jsx("path", { d: "M12 5v14" }), _jsx("path", { d: "M5 12h14" })] })),
    minus: _jsx("path", { d: "M5 12h14" }),
    // 实心三角：开启
    play: _jsx("path", { d: "M9 5.5l10 6.5-10 6.5z", fill: "currentColor", stroke: "none" }),
    // 方块：关闭
    stop: _jsx("rect", { x: "7", y: "7", width: "10", height: "10", rx: "2.5" }),
    // 推子：设置
    settings: (_jsxs(_Fragment, { children: [_jsx("path", { d: "M3 8h18" }), _jsx("path", { d: "M3 16h18" }), _jsx("circle", { cx: "15", cy: "8", r: "2.75", fill: "currentColor", stroke: "none" }), _jsx("circle", { cx: "9", cy: "16", r: "2.75", fill: "currentColor", stroke: "none" })] })),
    // 上箭头：更新
    arrowUp: (_jsxs(_Fragment, { children: [_jsx("path", { d: "M12 19V5" }), _jsx("path", { d: "M5 12l7-7 7 7" })] })),
    // 双层上箭头：强制更新
    arrowUpDouble: (_jsxs(_Fragment, { children: [_jsx("path", { d: "M6 12l6-6 6 6" }), _jsx("path", { d: "M6 19l6-6 6 6" })] })),
    // 文档带正文行：更新日志
    changelog: (_jsxs(_Fragment, { children: [_jsx("path", { d: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" }), _jsx("path", { d: "M14 3v5h5" }), _jsx("path", { d: "M9 13h6" }), _jsx("path", { d: "M9 17h4" })] })),
    // 放大镜：检查更新
    search: (_jsxs(_Fragment, { children: [_jsx("circle", { cx: "11", cy: "11", r: "7" }), _jsx("path", { d: "M20 20l-4.6-4.6" })] })),
    // 圆圈里一个 i：版本信息
    // 点画成实心圆而不是短竖线——2px 描边的一个点，圆头线帽下会糊成小方块
    info: (_jsxs(_Fragment, { children: [_jsx("circle", { cx: "12", cy: "12", r: "9" }), _jsx("path", { d: "M12 16.5v-5" }), _jsx("circle", { cx: "12", cy: "8", r: "1.15", fill: "currentColor", stroke: "none" })] })),
    // 实心圆点：参数项
    dot: _jsx("circle", { cx: "12", cy: "12", r: "3.5", fill: "currentColor", stroke: "none" }),
};
/**
 * 渲染一个图标
 *
 * 尺寸交给 CSS（.ico svg），这里只给 viewBox —— 同一套图标在帮助页图标框和
 * 未来别处复用时不必改组件。
 */
export function Icon({ name }) {
    return (_jsx("svg", { viewBox: "0 0 24 24", ...STROKE, "aria-hidden": "true", children: PATHS[name] }));
}
