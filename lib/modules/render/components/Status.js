import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * @description 连接列表 / 状态页
 * 版式参照 kkk 的推送列表：概览统计条 + 逐行卡片，每行左侧序号、中间主信息、右侧状态灯胶囊。
 */
import { statusRank } from "../../../constants/index.js";
import { Empty, Footer, Header, Page, Section, Stats } from "./Layout.js";
/** @description 状态色：语义色只用于状态，不参与主情绪 */
function toneColor(p, tone) {
    if (tone === "on")
        return p.success;
    if (tone === "warn")
        return p.warning;
    if (tone === "err")
        return p.danger;
    return p.muted;
}
/**
 * @description 账号级子行最多列几条（只在 {@link StatusData.compactRuntime} 时生效）
 * 一条核心绑十几个号是可能的（QQBot 多实例），逐条列出会把卡片拉成半页、把分组明细挤到第二屏。3 条足够看出
 * 「是不是有账号掉线」—— 前提是挑的是该看的那 3 条，见 {@link shownRuntime}。
 */
const RUNTIME_LIMIT = 3;
/**
 * @description 折叠时真正画出来的那几条子行：按状态名次挑最糟的，按 bind 原顺序画
 * 注意：不能按 bind 顺序取前 N 条 —— 绑了 5 个号、坏的是第 4 个时，前 3 条全是绿的，那个唯一需要人动手的账号
 * 恰好落进「+2 个账号未显示」里，而子行存在的理由正是补上主行说不出的那句「是哪个账号在挣扎」。
 * 注意：挑与画分开 —— 挑按名次，画按原顺序，这样状态抖动时卡片不会重排。sort 里显式带上下标做第二比较键，
 * 不依赖 Array.prototype.sort 的稳定性。
 * 注意：主行那个代表账号（决定右侧胶囊颜色的那条）可能不在列出的子行里 —— 它状态最好、最先被折叠掉。
 * 这是有意的，别「修」回去：主行已经说过它的状态，子行的位置要留给说不出来的那些。
 */
function shownRuntime(list, compact) {
    if (!compact || list.length <= RUNTIME_LIMIT)
        return { shown: list, hidden: 0 };
    const keep = list
        .map((r, i) => ({ r, i }))
        .sort((a, b) => statusRank(b.r.status) - statusRank(a.r.status) || a.i - b.i)
        .slice(0, RUNTIME_LIMIT)
        .sort((a, b) => a.i - b.i);
    return { shown: keep.map(x => x.r), hidden: list.length - keep.length };
}
export function Status(data) {
    const p = data.palette;
    return (_jsxs(_Fragment, { children: [_jsxs(Page, { palette: p, word: data.ghost, children: [_jsx(Header, { title: data.heading, status: "GSCORE_ADAPTER", led: data.enabled ? "on" : "off", rightKey: "ADAPTER", rightValue: data.enabled ? "ENABLED" : "DISABLED" }), _jsx(Stats, { items: data.summary, palette: p }), data.rows === undefined ? null : data.rows.length === 0 ? (_jsx(Empty, { title: "\u6682\u65E0\u8FDE\u63A5", tip: data.emptyTip || "用 #早柚添加连接 <地址> 添加" })) : (_jsx("div", { className: "flex flex-col gap-[22px]", children: data.rows.map(row => {
                            const c = toneColor(p, row.tone);
                            const subs = row.runtime?.length
                                ? shownRuntime(row.runtime, data.compactRuntime)
                                : null;
                            return (
                            // 刻意不给 items-center：序号、主信息、胶囊三者由各自的 self-center 对齐整行中线
                            _jsxs("div", { className: "flex gap-[26px] rounded-[28px] border border-border bg-surface px-[32px] py-[28px]", children: [_jsx("div", { className: "w-[60px] flex-none self-center rounded-[14px] border border-border bg-inset py-[16px] text-center font-mono text-[26px] font-extrabold leading-none text-muted", children: String(row.index).padStart(2, "0") }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-[8px]", children: [_jsx("div", { className: "text-[38px] font-black leading-[1.2]", children: row.name }), _jsx("div", { className: "break-all font-mono text-[23px] leading-[1.45] text-muted", children: row.url }), row.bots && row.bots.length > 0 && (_jsxs("div", { className: "mt-[4px] flex flex-wrap items-center gap-[10px]", children: [_jsx("span", { className: "font-mono text-[20px] leading-none text-muted", children: "bind" }), row.bots.map(b => (_jsxs("span", { className: "flex items-center gap-[9px] rounded-[9999px] border border-border bg-inset py-[4px] pr-[15px] pl-[5px]", children: [_jsx("span", { className: "grid size-[34px] flex-none place-items-center overflow-hidden rounded-[9999px] border border-border bg-surface text-[17px] font-bold text-muted", children: b.avatar ? (_jsx("img", { className: "block size-full object-cover", src: b.avatar, alt: "" })) : ((b.name || b.id).slice(0, 1)) }), b.name && b.name !== b.id && (_jsx("span", { className: "text-[21px] font-bold leading-none", children: b.name })), _jsx("span", { className: "font-mono text-[19px] leading-none text-muted", children: b.id }), b.platform && (_jsx("span", { className: "font-mono text-[17px] leading-none text-muted", children: b.platform })), b.excluded && (_jsx("span", { className: "font-mono text-[17px] leading-none text-muted", children: "\u5DF2\u6392\u9664" }))] }, b.id)))] })), subs && (_jsxs("div", { className: "mt-[6px] flex flex-col gap-[8px] rounded-[18px] bg-inset px-[18px] py-[12px]", children: [subs.shown.map(r => {
                                                        const rc = toneColor(p, r.tone);
                                                        return (
                                                        // flex-wrap 是溢出兜底：bind 里的账号 id 可能是十八九位的平台雪花号，三段定宽内容
                                                        // 加起来能顶破这块 bg-inset，而这一行没有任何环节会裁切或折行。给 meta 加 min-w-0
                                                        // 治不了 —— 它是 flex-none，收缩因子本身就是 0，min-width 压根不参与计算
                                                        _jsxs("div", { className: "flex flex-wrap items-center gap-[12px]", children: [_jsx("span", { className: "size-[10px] flex-none rounded-[9999px]", style: { background: rc } }), _jsx("span", { className: "flex-none font-mono text-[21px] font-bold leading-none", children: r.name }), _jsx("span", { className: "min-w-0 flex-1 truncate font-mono text-[19px] leading-[1.2] text-muted", children: r.path }), r.meta.length > 0 && (_jsx("span", { className: "flex-none font-mono text-[19px] leading-none text-muted", children: r.meta.join(" · ") })), _jsx("span", { className: "flex-none text-[20px] font-bold leading-none", style: { color: rc }, children: r.state })] }, r.name));
                                                    }), subs.hidden > 0 && (_jsxs("div", { className: "font-mono text-[19px] leading-none text-muted", children: ["+", subs.hidden, " \u4E2A\u8D26\u53F7\u672A\u663E\u793A", subs.shown.some(r => r.status !== 1) && "（异常的已优先列出）"] }))] })), row.meta.length > 0 && (_jsx("div", { className: "mt-[4px] flex flex-wrap gap-[10px]", children: row.meta.map((m, i) => (
                                                // not-italic：em 的默认斜体在等宽字下很难看
                                                _jsx("em", { className: "rounded-[10px] border border-border bg-inset px-[13px] py-[5px] font-mono text-[20px] not-italic leading-[1.4] text-muted", children: m }, i))) }))] }), _jsxs("div", { className: "flex flex-none items-center gap-[11px] self-center rounded-[9999px] px-[22px] py-[14px] text-[24px] font-extrabold leading-none", style: { color: c, background: `${c}1f`, border: `1px solid ${c}3d` }, children: [_jsx("span", { className: "size-[12px] flex-none rounded-[9999px]", style: { background: c, boxShadow: `0 0 10px ${c}` } }), row.state] })] }, row.index));
                        }) })), data.panels && data.panels.length > 0 && (
                    // column-gap 给到 64px：两列都是「左标签右取值」的两端对齐结构，列间距小于列内空档时，右列的标签会
                    // 读成左列取值的一部分。mt-[72px] 与 Stats 的 mb-[72px] 同值，纵向节奏一致
                    _jsx("div", { className: "mt-[72px] grid [grid-template-columns:repeat(2,1fr)] gap-[56px_64px]", children: data.panels.map((panel, pi) => (
                        // min-w-0：否则长取值会把这一列撑宽，两列不再等分
                        _jsxs("div", { className: "min-w-0", children: [_jsx(Section, { title: panel.title, color: p.rotate[pi % p.rotate.length], right: panel.key }), _jsx("div", { className: "flex flex-col gap-[14px]", children: panel.items.map((it, ii) => (
                                    // items-baseline：取值用等宽字、标签用正文字，基线对齐才不会一高一低
                                    _jsxs("div", { className: "flex items-baseline gap-[14px] text-[23px] leading-[1.5]", children: [_jsx("span", { className: "flex-none text-muted", children: it.k }), _jsx("span", { className: "min-w-0 flex-1 break-words break-keep text-right font-mono font-bold", children: it.v })] }, ii))) })] }, pi))) }))] }), _jsx(Footer, { name: data.title, version: data.version, palette: p, lines: [data.time, "#早柚帮助 查看全部指令"] })] }));
}
