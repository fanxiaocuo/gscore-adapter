import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Backdrop, Footer } from "./Layout.js";
import { fitFontSize } from "../metrics.js";
/**
 * 版本号可用宽度
 *
 * 1440 画布 - .page 左右 padding 72×2 = 1296，再减去 hero 图标 200px 与 44px 间距。
 * 几何对应 styles.ts 的 .rt-hero，改那边要同步改这里。
 */
const HERO_BUDGET = 1296 - 200 - 44;
export function About(data) {
    const p = data.palette;
    const stable = data.release === "Stable";
    // 版本号与发布类型同色：非正式版 warning，正式版取轮转色的第一个
    const verColor = stable ? p.rotate[0] : p.warning;
    /**
     * 版本号字号：按串长反推，保证一行放得下
     *
     * 130px 是给 `v2.1.0` 这类短串的理想值，但 main 分支上 git describe 会给出
     * `v2.1.0-2-gc6522ee-dirty`（23 字符），130px 下宽约 1790px，远超可用的 1052px，
     * 于是折成两行——右侧那块「小字 / 巨大数字 / 插件名」的层次被破坏，
     * 而且第二行会压到下面的插件名上。
     *
     * 下限 56px：仍比正文的 38px 大一档，主视觉地位保得住。
     * 字距 -.05em 与 CSS 一致，长串下这一项能省下约 4% 宽度，不能漏算。
     */
    const verSize = fitFontSize(data.version, HERO_BUDGET, 130, 56, -0.05);
    return (_jsxs(_Fragment, { children: [_jsx(Backdrop, { word: "RUNTIME", ghostTop: 1000 }), _jsxs("div", { className: "page", children: [_jsxs("div", { className: "rt-top", children: [_jsxs("div", { className: "rt-eyebrow", children: [_jsx("span", { className: "dot", style: { background: p.rotate[0] } }), _jsx("span", { children: "\u8FD0\u884C\u8BCA\u65AD" }), _jsx("span", { className: "sp", children: "\u00B7" }), _jsx("span", { className: "mono", children: "RUNTIME REPORT" })] }), _jsx("div", { className: "rt-badge mono", style: {
                                    color: verColor,
                                    background: `${verColor}1f`,
                                    border: `1px solid ${verColor}3d`,
                                }, children: data.release === "Stable" ? "正式版" : data.release === "Dev" ? "开发版" : "预览版" })] }), _jsx("h1", { className: "rt-title", children: "\u8FD0\u884C\u73AF\u5883" }), _jsx("div", { className: "rt-desc", children: data.desc }), _jsxs("div", { className: "rt-hero", children: [data.logo && _jsx("img", { className: "art", src: data.logo, alt: "" }), _jsxs("div", { className: "txt", children: [_jsx("div", { className: "cap mono", children: "\u63D2\u4EF6\u7248\u672C" }), _jsx("div", { className: "num", style: { color: verColor, fontSize: verSize }, children: data.version }), _jsx("div", { className: "nm mono", children: data.title })] })] }), _jsxs("div", { className: "rt-sec", children: [_jsx("span", { className: "dot", style: { background: p.rotate[0] } }), _jsx("span", { className: "t", children: "\u73AF\u5883\u6458\u8981" }), _jsx("span", { className: "line", style: { background: `linear-gradient(90deg,${p.rotate[0]},transparent)` } })] }), _jsxs("div", { className: "rt-grid", children: [data.rows.map((r, i) => (_jsxs("div", { className: "rt-cell", children: [_jsx("div", { className: "k", children: r.key }), _jsx("div", { className: r.mono ? "v mono" : "v", style: { color: p.rotate[i % p.rotate.length] }, children: r.value }), r.sub && _jsx("div", { className: "s", children: r.sub })] }, i))), data.memory && (_jsxs("div", { className: "rt-cell", children: [_jsx("div", { className: "k", children: "\u5185\u5B58\u5360\u7528" }), _jsxs("div", { className: "v mem", children: [_jsxs("span", { className: "pct", style: { color: p.rotate[2] }, children: [data.memory.percent, "%"] }), _jsxs("small", { className: "mono", children: [data.memory.used, " / ", data.memory.total] })] }), _jsx("div", { className: "bar", children: _jsx("i", { style: {
                                                width: `${Math.min(100, Math.max(0, data.memory.percent))}%`,
                                                background: `linear-gradient(90deg,${p.rotate[0]},${p.rotate[2]})`,
                                            } }) })] }))] }), data.changes && data.changes.groups.length > 0 && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "rt-sec", children: [_jsx("span", { className: "dot", style: { background: p.rotate[1] } }), _jsx("span", { className: "t", children: "\u672C\u7248\u53D8\u66F4" }), _jsxs("span", { className: "ver mono", children: ["v", data.changes.version, data.changes.date && _jsxs("em", { children: [" \u00B7 ", data.changes.date] })] }), _jsx("span", { className: "line", style: { background: `linear-gradient(90deg,${p.rotate[1]},transparent)` } })] }), _jsx("div", { className: "rt-chg", children: data.changes.groups.map((g, gi) => (_jsxs("div", { className: "grp", children: [_jsx("div", { className: "gt", style: { color: p.rotate[gi % p.rotate.length] }, children: g.title }), _jsx("ul", { className: "items", children: g.items.map((it, ii) => (_jsxs("li", { children: [_jsx("i", { style: { background: p.rotate[gi % p.rotate.length] } }), _jsx("span", { children: it })] }, ii))) })] }, gi))) })] })), _jsx("div", { className: "rt-links", children: data.links.map((l, i) => (_jsxs("div", { className: "link", children: [_jsx("span", { className: "k mono", children: l.key }), _jsx("span", { className: "v mono", children: l.value })] }, i))) }), _jsx("div", { className: "rt-note", children: "\u4EC5\u5305\u542B\u7ECF\u8FC7\u8131\u654F\u7684\u672C\u5730\u8FD0\u884C\u4FE1\u606F" })] }), _jsx(Footer, { name: data.title, version: data.version, palette: p, lines: [data.time, "#早柚帮助 查看全部指令"] })] }));
}
