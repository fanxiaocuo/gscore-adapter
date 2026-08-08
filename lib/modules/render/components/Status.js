import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Footer, Header, Page } from "./Layout.js";
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
    return (_jsxs(_Fragment, { children: [_jsxs(Page, { palette: p, word: data.ghost, children: [_jsx(Header, { title: data.heading, status: "GSCORE_ADAPTER", led: data.mode === "client" ? "on" : "off", rightKey: "RUNNING MODE", rightValue: data.mode }), _jsx("div", { className: "stats", children: data.summary.map((s, i) => (_jsxs("div", { className: "stat", children: [_jsx("div", { className: "k mono", children: s.key }), _jsx("div", { className: "v", style: { color: p.rotate[i % p.rotate.length] }, children: s.value }), s.sub && _jsx("div", { className: "s", children: s.sub })] }, i))) }), data.rows.length === 0 ? (_jsxs("div", { className: "empty", children: [_jsx("div", { className: "t", children: "\u6682\u65E0\u8FDE\u63A5" }), _jsx("div", { className: "d", children: data.emptyTip || "用 #早柚添加连接 <地址> 添加" })] })) : (_jsx("div", { className: "conns", children: data.rows.map(row => {
                            const c = toneColor(p, row.tone);
                            return (_jsxs("div", { className: "conn", children: [_jsx("div", { className: "idx mono", children: String(row.index).padStart(2, "0") }), _jsxs("div", { className: "main", children: [_jsx("div", { className: "nm", children: row.name }), _jsx("div", { className: "url mono", children: row.url }), row.meta.length > 0 && (_jsx("div", { className: "meta", children: row.meta.map((m, i) => (_jsx("em", { className: "mono", children: m }, i))) }))] }), _jsxs("div", { className: "pill", style: { color: c, background: `${c}1f`, border: `1px solid ${c}3d` }, children: [_jsx("span", { className: "led", style: { background: c, boxShadow: `0 0 10px ${c}` } }), row.state] })] }, row.index));
                        }) }))] }), _jsx(Footer, { name: data.title, version: data.version, palette: p, lines: [data.time, "#早柚帮助 查看全部指令"] })] }));
}
