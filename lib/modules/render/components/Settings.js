import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Icon } from "./Icons.js";
import { Footer, Header, Page } from "./Layout.js";
/** @description 开关胶囊：开用 success、关用 muted */
function Toggle({ on, palette }) {
    const c = on ? palette.success : palette.muted;
    return (_jsxs("div", { className: "flex flex-none items-center gap-[12px] self-center rounded-[9999px] px-[24px] py-[15px] text-[25px] font-extrabold leading-none", style: { color: c, background: `${c}1f`, border: `1px solid ${c}3d` }, children: [_jsx("span", { className: "size-[13px] flex-none rounded-[9999px]", style: { background: c, boxShadow: on ? `0 0 10px ${c}` : undefined } }), on ? "开启" : "关闭"] }));
}
/** 非开关项的取值胶囊：等宽字，描边比开关轻一档（它不表达状态） */
function Value({ text }) {
    return (_jsx("div", { className: "flex-none self-center rounded-[9999px] border border-border bg-inset px-[24px] py-[15px] font-mono text-[25px] font-extrabold leading-none", children: text }));
}
/** @description 一行设置 */
function Row({ row, color, palette }) {
    return (
    // 整宽单列卡片。刻意不给 items-center：三者各自 self-center 对齐整行中线，文字块自身按内容撑高（说明可能折行）
    _jsxs("div", { className: "flex gap-[26px] rounded-[28px] border border-border bg-surface px-[32px] py-[26px]", children: [_jsx("div", { className: "grid size-[62px] flex-none place-items-center self-center rounded-[18px] [&>svg]:block [&>svg]:size-[30px]", style: { background: `${color}1f`, color, border: `1px solid ${color}3d` }, children: _jsx(Icon, { name: row.icon }) }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-[8px] self-center", children: [_jsx("div", { className: "text-[34px] font-black leading-[1.2]", children: row.name }), _jsx("div", { className: "text-[23px] leading-[1.5] break-words break-keep text-muted", children: row.dsc })] }), row.on === undefined ? (_jsx(Value, { text: row.value || "" })) : (_jsx(Toggle, { on: row.on, palette: palette }))] }));
}
/**
 * @description 分组标题：色条 + 中文标题 + 右侧等宽英文
 * 比 Layout 的 <Section> 重一档，因为这页的分组是主结构（一屏只有三四组，每组下面是好几行整宽卡片，标题太轻
 * 会被卡片吃掉）；但也没到 Help.tsx 那种 64px 巨型标题 —— 这页各组之间的关系更紧。
 */
function GroupTitle({ title, right, color }) {
    return (_jsxs("div", { className: "mb-[28px] flex items-center gap-[18px]", children: [_jsx("div", { className: "h-[40px] w-[9px] flex-none rounded-[9999px]", style: { background: color } }), _jsx("h2", { className: "text-[40px] font-black leading-none tracking-[-.02em]", children: title }), _jsx("span", { className: "flex-none font-mono text-[22px] font-extrabold leading-none tracking-[.16em] text-muted", children: right }), _jsx("span", { className: "h-[3px] max-w-[220px] flex-1 rounded-[9999px] opacity-[.55]", style: { background: `linear-gradient(90deg,${color},transparent)` } })] }));
}
/**
 * @description 改动结果条：成功项用 success 色、失败项用 danger 色，各自一行
 * 不做成卡片网格 —— 一次指令通常只改一两项，网格会为了对齐留出大片空白。
 */
function Result({ done, errs, palette }) {
    const rows = [
        ...done.map(t => ({ text: t, color: palette.success, ok: true })),
        ...errs.map(t => ({ text: t, color: palette.danger, ok: false })),
    ];
    if (!rows.length)
        return null;
    return (_jsx("div", { className: "mb-[64px] flex flex-col gap-[16px]", children: rows.map((r, i) => (_jsxs("div", { 
            // break-keep：错误行里嵌着「可设置：适配器 / 仅响应at / …」这类清单，CJK 逐字断点会把「更新检查」
            // 劈成「更新检 / 查」（预览里实际出现过）；keep-all 让断点落在 / 与空格上
            className: "flex items-center gap-[20px] rounded-[24px] border border-l-[6px] px-[30px] py-[24px] text-[27px] leading-[1.5] break-words break-keep", style: { color: r.color, background: `${r.color}14`, borderColor: `${r.color}3d` }, children: [_jsx("span", { className: "grid size-[34px] flex-none place-items-center [&>svg]:block [&>svg]:size-[30px]", children: _jsx(Icon, { name: r.ok ? "check" : "cross" }) }), _jsx("span", { className: "min-w-0 flex-1 font-extrabold", children: r.text })] }, i))) }));
}
export function Settings(data) {
    const p = data.palette;
    return (_jsxs(_Fragment, { children: [_jsxs(Page, { palette: p, word: data.ghost, ghostTop: 420, children: [_jsx(Header, { title: data.heading, status: "GSCORE_ADAPTER", led: data.enabled ? "on" : "off", rightKey: "ADAPTER", rightValue: data.enabled ? "ENABLED" : "DISABLED" }), data.result && _jsx(Result, { ...data.result, palette: p }), _jsx("div", { className: "flex flex-col gap-[68px]", children: data.groups.map((g, gi) => {
                            const color = p.rotate[gi % p.rotate.length];
                            return (_jsxs("div", { children: [_jsx(GroupTitle, { title: g.title, right: g.key, color: color }), _jsx("div", { className: "flex flex-col gap-[18px]", children: g.rows.map((r, ri) => (_jsx(Row, { row: r, color: color, palette: p }, ri))) })] }, gi));
                        }) }), data.facts && data.facts.length > 0 && (_jsx("div", { className: "mt-[84px] grid [grid-template-columns:repeat(2,1fr)] gap-[48px_64px]", children: data.facts.map((f, fi) => (
                        // min-w-0：否则长取值会把这一列撑宽，两列不再等分
                        _jsxs("div", { className: "min-w-0", children: [_jsx(GroupTitle, { title: f.title, right: f.key, color: p.rotate[(data.groups.length + fi) % p.rotate.length] }), _jsx("div", { className: "flex flex-col gap-[14px]", children: f.items.map((it, ii) => (
                                    // items-baseline：取值用等宽字、标签用正文字，基线对齐才不会一高一低
                                    _jsxs("div", { className: "flex items-baseline gap-[14px] text-[23px] leading-[1.5]", children: [_jsx("span", { className: "flex-none text-muted", children: it.k }), _jsx("span", { className: "min-w-0 flex-1 break-words break-keep text-right font-mono font-bold", children: it.v })] }, ii))) })] }, fi))) }))] }), _jsx(Footer, { name: data.title, version: data.version, palette: p, lines: [data.time, data.tip || "#早柚帮助 查看全部指令"] })] }));
}
