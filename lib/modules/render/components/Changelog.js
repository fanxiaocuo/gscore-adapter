import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Empty, Footer, Header, Notice, Page, Stats } from "./Layout.js";
export function Changelog(data) {
    const p = data.palette;
    return (_jsxs(_Fragment, { children: [_jsxs(Page, { palette: p, word: data.ghost, children: [_jsx(Header, { title: data.heading, status: "GSCORE_ADAPTER", led: data.led, rightKey: data.rightKey, rightValue: data.rightValue }), _jsx(Stats, { items: data.summary, palette: p }), data.notice && _jsx(Notice, { text: data.notice, color: p.warning }), data.commits.length === 0 ? (_jsx(Empty, { title: data.emptyTitle, tip: data.emptyTip })) : (_jsx("div", { className: "flex flex-col gap-[18px]", children: data.commits.map((c, i) => (
                        // align-items:center 而不是 flex-start：右侧「标题 + 时间」两行、左边短 hash 只有一行，
                        // 顶对齐会让 hash 明显偏上
                        _jsxs("div", { className: "flex items-center gap-[28px] rounded-[24px] border border-border bg-surface px-[32px] py-[26px]", children: [_jsx("div", { className: "w-[132px] flex-none rounded-[12px] border border-border bg-inset py-[11px] text-center font-mono text-[25px] font-extrabold leading-none", style: { color: p.rotate[i % p.rotate.length] }, children: c.hash }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-[8px]", children: [_jsx("div", { className: "text-[30px] font-bold leading-[1.45] break-words break-keep", children: c.subject }), _jsx("div", { className: "font-mono text-[21px] text-muted", children: c.date })] })] }, c.hash + i))) }))] }), _jsx(Footer, { name: data.title, version: data.version, palette: p, lines: [data.time, "#早柚更新 拉取最新代码"] })] }));
}
