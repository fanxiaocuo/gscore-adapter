import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Empty, Footer, Header, Page, Section, Stats } from "./Layout.js";
/** 状态色：语义色只用于状态，不参与主情绪（见 kkk tokens.md 颜色角色） */
function toneColor(p, tone) {
    if (tone === "on")
        return p.success;
    if (tone === "warn")
        return p.warning;
    if (tone === "err")
        return p.danger;
    return p.muted;
}
export function Status(data) {
    const p = data.palette;
    return (_jsxs(_Fragment, { children: [_jsxs(Page, { palette: p, word: data.ghost, children: [_jsx(Header, { title: data.heading, status: "GSCORE_ADAPTER", led: data.enabled ? "on" : "off", rightKey: "ADAPTER", rightValue: data.enabled ? "ENABLED" : "DISABLED" }), _jsx(Stats, { items: data.summary, palette: p }), data.rows === undefined ? null : data.rows.length === 0 ? (_jsx(Empty, { title: "\u6682\u65E0\u8FDE\u63A5", tip: data.emptyTip || "用 #早柚添加连接 <地址> 添加" })) : (_jsx("div", { className: "flex flex-col gap-[22px]", children: data.rows.map(row => {
                            const c = toneColor(p, row.tone);
                            return (
                            // 刻意不给 items-center：序号、主信息、胶囊三者的对齐各有讲究，
                            // 由子元素各自的 self-center 决定（见下面序号那段注释）
                            _jsxs("div", { className: "flex gap-[26px] rounded-[28px] border border-border bg-surface px-[32px] py-[28px]", children: [_jsx("div", { className: "w-[60px] flex-none self-center rounded-[14px] border border-border bg-inset py-[16px] text-center font-mono text-[26px] font-extrabold leading-none text-muted", children: String(row.index).padStart(2, "0") }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-[8px]", children: [_jsx("div", { className: "text-[38px] font-black leading-[1.2]", children: row.name }), _jsx("div", { className: "break-all font-mono text-[23px] leading-[1.45] text-muted", children: row.url }), row.bots && row.bots.length > 0 && (_jsxs("div", { className: "mt-[4px] flex flex-wrap items-center gap-[10px]", children: [_jsx("span", { className: "font-mono text-[20px] leading-none text-muted", children: "bind" }), row.bots.map(b => (_jsxs("span", { className: "flex items-center gap-[9px] rounded-[9999px] border border-border bg-inset py-[4px] pr-[15px] pl-[5px]", children: [_jsx("span", { className: "grid size-[34px] flex-none place-items-center overflow-hidden rounded-[9999px] border border-border bg-surface text-[17px] font-bold text-muted", children: b.avatar ? (_jsx("img", { className: "block size-full object-cover", src: b.avatar, alt: "" })) : ((b.name || b.id).slice(0, 1)) }), b.name && b.name !== b.id && (_jsx("span", { className: "text-[21px] font-bold leading-none", children: b.name })), _jsx("span", { className: "font-mono text-[19px] leading-none text-muted", children: b.id })] }, b.id)))] })), row.meta.length > 0 && (_jsx("div", { className: "mt-[4px] flex flex-wrap gap-[10px]", children: row.meta.map((m, i) => (
                                                // not-italic：em 的默认斜体在等宽字下很难看
                                                _jsx("em", { className: "rounded-[10px] border border-border bg-inset px-[13px] py-[5px] font-mono text-[20px] not-italic leading-[1.4] text-muted", children: m }, i))) }))] }), _jsxs("div", { className: "flex flex-none items-center gap-[11px] self-center rounded-[9999px] px-[22px] py-[14px] text-[24px] font-extrabold leading-none", style: { color: c, background: `${c}1f`, border: `1px solid ${c}3d` }, children: [_jsx("span", { className: "size-[12px] flex-none rounded-[9999px]", style: { background: c, boxShadow: `0 0 10px ${c}` } }), row.state] })] }, row.index));
                        }) })), data.panels && data.panels.length > 0 && (
                    // column-gap 给到 64px：两列都是「左标签右取值」的两端对齐结构，列间距
                    // 小于列内空档时，右列的标签会读成左列取值的一部分。
                    // mt-[72px] 与 Stats 的 mb-[72px] 同值，纵向节奏一致。
                    _jsx("div", { className: "mt-[72px] grid [grid-template-columns:repeat(2,1fr)] gap-[56px_64px]", children: data.panels.map((panel, pi) => (
                        // min-w-0：否则长取值会把这一列撑宽，两列不再等分
                        _jsxs("div", { className: "min-w-0", children: [_jsx(Section, { title: panel.title, color: p.rotate[pi % p.rotate.length], right: panel.key }), _jsx("div", { className: "flex flex-col gap-[14px]", children: panel.items.map((it, ii) => (
                                    // items-baseline：取值用等宽字、标签用正文字，基线对齐才不会一高一低
                                    _jsxs("div", { className: "flex items-baseline gap-[14px] text-[23px] leading-[1.5]", children: [_jsx("span", { className: "flex-none text-muted", children: it.k }), _jsx("span", { className: "min-w-0 flex-1 break-words break-keep text-right font-mono font-bold", children: it.v })] }, ii))) })] }, pi))) }))] }), _jsx(Footer, { name: data.title, version: data.version, palette: p, lines: [data.time, "#早柚帮助 查看全部指令"] })] }));
}
