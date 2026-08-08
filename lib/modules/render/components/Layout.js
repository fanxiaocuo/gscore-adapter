import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { FRAME_LOGO, PLUGIN_LOGO, imageDataUri } from "../assets.js";
import { frameLabel, releaseType } from "../env.js";
/** 背景装饰层：光斑、噪点、气氛大字、角落点缀 */
export function Backdrop({ word, ghostTop }) {
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "bg", children: [_jsx("div", { className: "glow glow-1" }), _jsx("div", { className: "glow glow-2" }), _jsx("div", { className: "glow glow-3" })] }), _jsx("div", { className: "noise", children: _jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", children: [_jsxs("filter", { id: "n", x: "0%", y: "0%", width: "100%", height: "100%", children: [_jsx("feTurbulence", { type: "fractalNoise", baseFrequency: "0.3", numOctaves: 1, stitchTiles: "stitch" }), _jsx("feColorMatrix", { type: "saturate", values: "0" })] }), _jsx("rect", { width: "100%", height: "100%", filter: "url(#n)" })] }) }), _jsx("div", { className: "ghost", style: ghostTop ? { top: ghostTop } : undefined, children: word }), _jsx("div", { className: "dots", children: Array.from({ length: 9 }, (_, i) => (_jsx("i", {}, i))) }), _jsx("div", { className: "ticks", children: [72, 52, 32].map(w => (_jsx("i", { style: { width: w } }, w))) }), _jsx("div", { className: "stripes" })] }));
}
/** 顶部标题区 */
export function Header({ title, status, led = "on", rightKey, rightValue, }) {
    return (_jsxs("div", { className: "head", children: [_jsxs("div", { className: "head-l", children: [_jsxs("div", { className: "badge", children: [_jsx("span", { className: led === "on" ? "led" : `led ${led}` }), _jsx("span", { className: "mono", children: status })] }), _jsx("h1", { className: "title", children: title })] }), _jsxs("div", { className: "head-r", children: [_jsx("div", { className: "k", children: rightKey }), _jsx("div", { className: "v", children: rightValue })] })] }));
}
/**
 * 页脚水印：插件图标 + 插件名/版本 ｜ 框架图标 + POWER BY 框架名/版本
 *
 * 版式照 karin-plugin-kkk 的 DefaultLayout：居中一排，左半是插件、右半是框架，
 * 中间一根竖线分隔，两侧各自「图标 + 上小字 + 下大字」。它那边左边用一个内联
 * SVG 当插件标、右边用 /image/frame-logo.png 当框架标，本插件两边都有位图
 * （logo.png 与 frame-logo.png），所以统一走 <img>。
 *
 * 与 kkk 的差异
 * -------------
 * 1. 不做隐写。kkk 还往像素里埋了一串 Restore ID（@ikenxuan/watermark + sharp），
 *    本插件不引这两个依赖：sharp 带原生二进制，为一行署名装它不划算，而且
 *    隐写信息用户看不见，起不到「这张图是谁生成的」的作用。
 * 2. 不显示构建工具（Vite/Rolldown）标。那是 kkk 构建期打包的产物，本插件是
 *    运行时 SSR，没有对应的东西可署。
 *
 * 版本号旁的 Stable/Preview 取自 env.ts 的 releaseType：预览版用 warning 色，
 * 让「这不是发布版本」在图上一眼可见。
 */
export function Footer({ name, version, lines, palette, frame = frameLabel(), frameLogo = imageDataUri(FRAME_LOGO), logo = imageDataUri(PLUGIN_LOGO), }) {
    const p = palette;
    const rt = releaseType();
    // 非正式版用 warning 色，正式版跟随前景色
    const verColor = rt === "Stable" ? p.foreground : p.warning;
    const rtCap = rt === "Stable" ? "✓ STABLE" : rt === "Dev" ? "⚙ DEV" : "⚠ PREVIEW";
    // 框架名与版本分开显示：Miao-Yunzai v3.1.3 -> ["Miao-Yunzai", "3.1.3"]
    const m = /^(.*?)\s+v([\d.].*)$/.exec(frame);
    const frameNm = m ? m[1] : frame;
    const frameVer = m ? m[2] : "";
    return (_jsxs("div", { className: "foot", children: [_jsxs("div", { className: "wm", children: [_jsxs("div", { className: "side", children: [logo && _jsx("img", { className: "ico", src: logo, alt: "" }), _jsxs("div", { className: "txt", children: [_jsx("div", { className: "cap mono", children: "PLUGIN" }), _jsx("div", { className: "nm", children: name })] })] }), _jsxs("div", { className: "ver", children: [_jsx("div", { className: "cap mono", style: { color: verColor }, children: rtCap }), _jsx("div", { className: "num", style: { color: verColor }, children: version })] }), _jsx("div", { className: "sep" }), _jsxs("div", { className: "side", children: [frameLogo && _jsx("img", { className: "ico", src: frameLogo, alt: "" }), _jsxs("div", { className: "txt", children: [_jsx("div", { className: "cap mono", children: "POWER BY" }), _jsxs("div", { className: "nm", children: [frameNm, frameVer && _jsxs("small", { className: "mono", children: [" v", frameVer] })] })] })] })] }), lines.length > 0 && (_jsx("div", { className: "sub mono", children: lines.map((t, i) => (_jsx("span", { children: t }, i))) }))] }));
}
/** 一整页 */
export function Page({ 
// 下划线前缀：配色目前全靠 CSS 变量与各组件自己取，骨架本身用不到。
// 但四个页面都按 <Page palette={p}> 调用，删掉这个 prop 要改四处调用，
// 而将来给骨架加个按调色板取色的元素又得原样加回来，所以保留形参、
// 用 eslint 约定的 _ 前缀说明「有意不用」。
palette: _palette, word, ghostTop, children, }) {
    return (_jsxs(_Fragment, { children: [_jsx(Backdrop, { word: word, ghostTop: ghostTop }), _jsx("div", { className: "page", children: children })] }));
}
