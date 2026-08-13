import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Backdrop, Footer, Section } from "./Layout.js";
import { fitFontSize } from "../metrics.js";
/**
 * 版本号可用宽度
 *
 * 1440 画布 - .page 左右 padding 72×2 = 1296，再减去 hero 图标 200px 与 44px 间距。
 * 几何对应下面 hero 那一块的 size-[200px] 与 gap-[44px]，改那边要同步改这里。
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
    return (_jsxs(_Fragment, { children: [_jsx(Backdrop, { word: "RUNTIME", ghostTop: 1000 }), _jsxs("div", { className: "relative z-10 p-[72px]", children: [_jsxs("div", { className: "mb-[40px] flex items-center justify-between gap-[24px]", children: [_jsxs("div", { className: "flex items-center gap-[14px] text-[24px] font-extrabold leading-none tracking-[.18em] text-muted", children: [_jsx("span", { className: "size-[11px] flex-none rounded-[9999px]", style: { background: p.rotate[0] } }), _jsx("span", { children: "\u8FD0\u884C\u8BCA\u65AD" }), _jsx("span", { className: "opacity-50", children: "\u00B7" }), _jsx("span", { className: "font-mono", children: "RUNTIME REPORT" })] }), _jsx("div", { className: "flex-none rounded-[9999px] px-[26px] py-[12px] font-mono text-[22px] font-extrabold leading-none tracking-[.1em]", style: {
                                    color: verColor,
                                    background: `${verColor}1f`,
                                    border: `1px solid ${verColor}3d`,
                                }, children: data.release === "Stable" ? "正式版" : data.release === "Dev" ? "开发版" : "预览版" })] }), _jsxs("div", { className: "mb-[64px] flex items-end justify-between gap-[56px]", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h1", { className: "mb-[18px] text-[88px] font-black leading-[1.05] tracking-[-.04em]", children: "\u8FD0\u884C\u73AF\u5883" }), _jsx("div", { className: "text-[27px] leading-[1.6] text-muted", children: data.desc })] }), data.glance && data.glance.length > 0 && (
                            /*
                             * 速览格：竖排三行，右对齐
                             *
                             * 右对齐而不是左对齐：它贴着画布右边缘，取值的右边缘成一条线才像「标注」，
                             * 左对齐会在右侧又留出一条不齐的锯齿边。
                             * items-end 要在外层与每个 .g 上各写一次——小标签与大数值的宽度不同，
                             * 只在外层对齐的是整格，格内两行仍会各自左对齐。
                             */
                            _jsx("div", { className: "flex flex-none flex-col items-end gap-[22px]", children: data.glance.map((g, i) => (_jsxs("div", { className: "flex flex-col items-end gap-[7px] leading-none", children: [_jsx("span", { className: "font-mono text-[19px] font-extrabold tracking-[.18em] text-muted", children: g.key }), _jsx("span", { className: "text-[44px] font-black tracking-[-.02em] whitespace-nowrap [font-variant-numeric:tabular-nums]", style: { color: p.rotate[i % p.rotate.length] }, children: g.value })] }, i))) }))] }), _jsxs("div", { className: "mb-[80px] flex items-center gap-[44px]", children: [data.logo && (
                            /* size 与 HERO_BUDGET 里减掉的 200 是同一个数，改这里要同步改上面。
                               object-contain 防非方形图被拉变形 */
                            _jsx("img", { className: "size-[200px] flex-none rounded-[44px] border border-border bg-inset object-contain", src: data.logo, alt: "" })), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-[8px]", children: [_jsx("div", { className: "font-mono text-[22px] font-extrabold leading-none tracking-[.2em] text-muted", children: "\u63D2\u4EF6\u7248\u672C" }), _jsx("div", { className: "text-[130px] font-black leading-none tracking-[-.05em] whitespace-nowrap [font-variant-numeric:tabular-nums]", style: { color: verColor, fontSize: verSize }, children: data.version }), _jsx("div", { className: "font-mono text-[26px] leading-[1.4] tracking-[.06em] text-muted", children: data.title })] })] }), _jsx(Section, { title: "\u73AF\u5883\u6458\u8981", color: p.rotate[0] }), _jsxs("div", { className: "mb-[72px] grid grid-cols-2 gap-x-[64px] gap-y-[52px]", children: [data.rows.map((r, i) => (_jsxs("div", { className: "flex min-w-0 flex-col gap-[10px]", children: [_jsx("div", { className: "text-[23px] font-extrabold leading-[1.2] tracking-[.12em] text-muted", children: r.key }), _jsx("div", { className: `text-[38px] font-extrabold leading-[1.25] tracking-[-.01em] break-words${r.mono ? " font-mono" : ""}`, style: { color: p.rotate[i % p.rotate.length] }, children: r.value }), r.sub && (
                                    // break-keep：sub 是中文说明，逐字断点会把词劈开（同 Help 的说明文字）
                                    _jsx("div", { className: "text-[21px] leading-[1.5] break-words break-keep text-muted", children: r.sub }))] }, i))), data.memory && (_jsxs("div", { className: "flex min-w-0 flex-col gap-[10px]", children: [_jsx("div", { className: "text-[23px] font-extrabold leading-[1.2] tracking-[.12em] text-muted", children: "\u5185\u5B58\u5360\u7528" }), _jsxs("div", { className: "flex flex-wrap items-baseline gap-[16px] text-[38px] font-extrabold leading-[1.25] tracking-[-.01em] break-words", children: [_jsxs("span", { className: "text-[46px] font-black tracking-[-.02em] [font-variant-numeric:tabular-nums]", style: { color: p.rotate[2] }, children: [data.memory.percent, "%"] }), _jsxs("small", { className: "font-mono text-[22px] font-semibold text-muted", children: [data.memory.used, " / ", data.memory.total] })] }), _jsx("div", { className: "mt-[6px] h-[10px] overflow-hidden rounded-[9999px] border border-border bg-inset", children: _jsx("i", { className: "block h-full rounded-[9999px]", style: {
                                                width: `${Math.min(100, Math.max(0, data.memory.percent))}%`,
                                                background: `linear-gradient(90deg,${p.rotate[0]},${p.rotate[2]})`,
                                            } }) })] }))] }), data.changes && data.changes.groups.length > 0 && (_jsxs(_Fragment, { children: [_jsx(Section, { title: "\u672C\u7248\u53D8\u66F4", color: p.rotate[1], right: _jsxs(_Fragment, { children: ["v", data.changes.version, data.changes.date && (_jsxs("em", { className: "not-italic opacity-75", children: [" \u00B7 ", data.changes.date] }))] }) }), _jsx("div", { className: "mb-[72px] flex flex-col gap-[40px]", children: data.changes.groups.map((g, gi) => (
                                /* min-w-0 让长条目在 flex 列里能正常收缩，分类之间的间距由父级 gap 给。
                                   迁移前这个 .grp 在 CSS 里从没定义过，靠父级 gap 恰好达到效果 */
                                _jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "mb-[18px] text-[27px] font-extrabold leading-[1.3] tracking-[.02em]", style: { color: p.rotate[gi % p.rotate.length] }, children: g.title }), _jsx("ul", { className: "flex list-none flex-col gap-[14px]", children: g.items.map((it, ii) => (
                                            /* 圆点用 flex-none + mt 手动对齐首行视觉中线：
                                               items-center 在条目折行时会把点带到两行之间，看着像挂错了行 */
                                            _jsxs("li", { className: "flex items-start gap-[16px] text-[25px] leading-[1.5]", children: [_jsx("i", { className: "mt-[14px] size-[9px] flex-none rounded-[9999px] opacity-[.85]", style: { background: p.rotate[gi % p.rotate.length] } }), _jsx("span", { className: "min-w-0 flex-1 break-words break-keep", children: it })] }, ii))) })] }, gi))) })] })), _jsx("div", { className: "grid grid-cols-2 gap-x-[64px] gap-y-[26px] border-t border-t-border pt-[44px]", children: data.links.map((l, i) => (_jsxs("div", { className: "flex min-w-0 flex-col gap-[8px] text-[22px]", children: [_jsx("span", { className: "font-mono text-[19px] font-extrabold uppercase leading-none tracking-[.14em] text-muted", children: l.key }), _jsx("span", { className: "min-w-0 font-mono leading-[1.5] break-all text-muted", children: l.value })] }, i))) }), _jsx("div", { className: "mt-[32px] text-[21px] leading-[1.6] opacity-70 text-muted", children: "\u4EC5\u5305\u542B\u7ECF\u8FC7\u8131\u654F\u7684\u672C\u5730\u8FD0\u884C\u4FE1\u606F" })] }), _jsx(Footer, { name: data.title, version: data.version, palette: p, lines: [data.time, "#早柚帮助 查看全部指令"] })] }));
}
