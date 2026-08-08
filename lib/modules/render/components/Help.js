import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Icon } from "./Icons.js";
import { Footer, Header, Page } from "./Layout.js";
function Item({ item, color }) {
    return (_jsx("div", { className: "item", children: _jsxs("div", { className: "row", children: [_jsx("div", { className: "ico", style: { background: `${color}1f`, color, border: `1px solid ${color}3d` }, children: _jsx(Icon, { name: item.icon }) }), _jsxs("div", { className: "body", children: [_jsxs("div", { className: "cmd", children: [_jsx("span", { className: "t", children: item.cmd }), item.master && (_jsx("span", { className: "tag", style: { color, background: `${color}1f`, border: `1px solid ${color}3d` }, children: "MASTER" }))] }), _jsx("div", { className: "dsc", children: item.dsc }), item.eg && _jsx("div", { className: "eg mono", children: item.eg })] })] }) }));
}
function Group({ group, color }) {
    const total = group.items.length + (group.subGroups?.reduce((n, s) => n + s.items.length, 0) || 0);
    return (_jsxs("div", { className: "group", children: [_jsxs("div", { className: "group-h", children: [_jsx("div", { className: "bar", style: { background: color } }), _jsx("h2", { children: group.title }), _jsx("div", { className: "n mono", children: String(total).padStart(2, "0") })] }), group.items.length > 0 && (_jsx("div", { className: "items", children: group.items.map((it, i) => (_jsx(Item, { item: it, color: color }, i))) })), group.subGroups?.map((sub, i) => (_jsxs("div", { className: "sub", children: [_jsxs("div", { className: "sub-h", children: [_jsx("span", { className: "d" }), sub.title] }), _jsx("div", { className: "items", children: sub.items.map((it, j) => (_jsx(Item, { item: it, color: color }, j))) })] }, i)))] }));
}
export function Help(data) {
    const { rotate } = data.palette;
    return (_jsxs(_Fragment, { children: [_jsxs(Page, { palette: data.palette, word: "COMMANDS", children: [_jsx(Header, { title: "COMMANDS", status: "GSCORE_ADAPTER", led: data.mode === "client" ? "on" : "off", rightKey: "RUNNING MODE", rightValue: data.mode }), _jsx("div", { className: "stats", children: data.summary.map((s, i) => (_jsxs("div", { className: "stat", children: [_jsx("div", { className: "k mono", children: s.key }), _jsx("div", { className: "v", style: { color: rotate[i % rotate.length] }, children: s.value }), s.sub && _jsx("div", { className: "s", children: s.sub })] }, i))) }), data.groups.map((g, i) => (_jsx(Group, { group: g, color: rotate[i % rotate.length] }, i)))] }), _jsx(Footer, { name: data.title, version: data.version, palette: data.palette, lines: [data.time, "MASTER ONLY 标记的指令仅主人可用"] })] }));
}
