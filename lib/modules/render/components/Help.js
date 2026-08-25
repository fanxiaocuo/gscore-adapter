import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Icon } from "./Icons.js";
import { Footer, Header, Page, Stats } from "./Layout.js";
/**
 * @description 把指令标题切成若干不可断开的整块，只允许在空白处折行
 * 标题里有两种断在中间就像坏了的语义单元：指令本身（`#早柚设置私聊上报关闭` —— break-keep 只禁掉 CJK 逐字断点，
 * 管不了 `#` 与后面汉字之间那个「前置标点不能落行尾」给的断点，于是 `#` 独占一行）、以及 `<地址>` 这类占位符
 * （断点来自空格）。所以按空白切片，每片各自 nowrap。
 * 片内可能仍然超栏宽（真出现时溢出比劈开更好定位），但现行清单里最长的一片仍在子卡栏宽内。
 * 返回 string 而非数组的快路径：不含空白的标题就是一整片，不必包 <span>。
 */
function keepAtoms(cmd) {
    if (!/\s/.test(cmd))
        return _jsx("span", { className: "whitespace-nowrap", children: cmd });
    return cmd.split(/(\s+)/g).map((part, i) => /^\s+$/.test(part) ? (part) : (_jsx("span", { className: "whitespace-nowrap", children: part }, i)));
}
/**
 * @description 一条指令。主条目与子条目版式相同（命令在上、说明在下），靠字号区分（32px vs 26px）
 * 上下结构而不是「命令列定宽 380px + 说明列占满剩余」的左右两栏：后者每行右侧固定空掉约 600px，整页高到
 * 3140px；上下结构一行能放两条（外层 2 列网格，每列约 626px），而左右两栏做不到两列（336 + 437 已超列宽）。
 * 子条目尤其需要它：参数表的 key 是拉丁长串（`max_reconnect_attempts（retry）` 28px 下宽 445px），在原来的
 * 300px 命令列里不折行而是直接溢出压在说明上 —— break-keep 为保住中文禁掉了 CJK 断点，而下划线不是合法断点。
 * 也不再用带边框的卡片：跨列那些卡内容只有左边一点，右侧大片空白被边框圈起来。
 */
function Item({ item, color, sub, badge, }) {
    // 子条目：命令在上、说明在下
    if (sub) {
        return (_jsxs("div", { className: "flex items-start gap-[12px]", children: [_jsx("div", { className: "flex-none pt-[7px] [&>svg]:block [&>svg]:size-[19px]", style: { color }, children: _jsx(Icon, { name: item.icon }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "text-[26px] font-black leading-[1.3] tracking-[-.01em] break-keep [overflow-wrap:anywhere]", children: keepAtoms(item.cmd) }), _jsx("div", { className: "mt-[5px] text-[20px] leading-[1.55] break-words break-keep whitespace-pre-line text-muted", children: item.dsc }), item.eg && (_jsx("div", { className: "mt-[8px] inline-block max-w-full rounded-[10px] bg-inset px-[13px] py-[7px] font-mono text-[19px] leading-[1.5] break-words break-keep text-muted", children: item.eg }))] })] }));
    }
    return (_jsxs("div", { className: "flex items-start gap-[22px]", children: [_jsx("div", { className: "flex-none pt-[7px] [&>svg]:block [&>svg]:size-[30px]", style: { color }, children: _jsx(Icon, { name: item.icon }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "text-[32px] font-black leading-[1.25] tracking-[-.01em]", children: keepAtoms(item.cmd) }), _jsx("div", { className: "mt-[7px] text-[23px] leading-[1.6] break-words break-keep whitespace-pre-line text-muted", children: item.dsc }), badge && (_jsx("span", { className: "mt-[8px] inline-block rounded-[9999px] px-[12px] py-[4px] text-[17px] font-extrabold leading-none tracking-[.08em]", style: { color, background: `${color}1f` }, children: "MASTER" })), item.eg && (_jsx("div", { className: "mt-[10px] inline-block max-w-full rounded-[10px] bg-inset px-[15px] py-[7px] font-mono text-[20px] leading-[1.5] break-words break-keep text-muted", children: item.eg }))] })] }));
}
function Group({ group, color, spectrum, }) {
    const total = group.items.length + (group.subGroups?.reduce((n, s) => n + s.items.length, 0) || 0);
    /** 整组都要主人权限时在标题上标一次，替代原先每条卡片各标一个 */
    const allMaster = group.items.length > 0 && group.items.every(i => i.master);
    return (_jsxs("div", { className: "mb-[88px] last:mb-0", children: [_jsxs("div", { className: "mb-[44px] flex items-center gap-[24px]", children: [_jsx("div", { className: "h-[56px] w-[12px] flex-none rounded-[9999px]", style: { background: color } }), _jsx("h2", { className: "flex-none text-[64px] font-black leading-none tracking-[-.03em]", children: group.title }), allMaster && (_jsx("span", { className: "flex-none rounded-[9999px] px-[14px] py-[7px] text-[20px] font-extrabold leading-none tracking-[.08em]", style: { color, background: `${color}1f`, border: `1px solid ${color}3d` }, children: "MASTER" })), _jsxs("div", { className: "ml-auto flex flex-none items-baseline gap-[8px]", children: [_jsx("span", { className: "font-mono text-[34px] font-black leading-none [font-variant-numeric:tabular-nums]", style: {
                                    backgroundImage: `linear-gradient(135deg, ${spectrum[0]}, ${spectrum[1]})`,
                                    WebkitBackgroundClip: "text",
                                    backgroundClip: "text",
                                    color: "transparent",
                                }, children: total }), _jsx("span", { className: "text-[19px] leading-none text-muted", children: "\u9879" })] })] }), group.items.length > 0 && (_jsx("div", { 
                /*
                 * 主条目走多列流式（CSS columns），不是 grid
                 *
                 * grid 有个改不掉的毛病：行高由该行最高的那条决定。「#早柚添加连接」带三行说明加一条示例，同行的
                 * 「#早柚重载」只有一行说明，底下就空出约 130px —— 而条目高度参差是这份数据的常态。
                 * CSS columns 是流式的：条目按高度自动分配到两栏、栏底自然对齐。代价是阅读顺序变成「先读完左栏再读
                 * 右栏」，对并列的指令清单无所谓。
                 * 注意：break-inside:avoid 必须给 —— 不给的话一条会被拆到两栏（命令名在左栏底、说明跑到右栏顶）。
                 */
                className: "[column-count:2] [column-gap:44px] pl-[34px] [&>*]:mb-[30px] [&>*]:[break-inside:avoid]", children: group.items.map((it, i) => (_jsx(Item, { item: it, color: color, badge: !allMaster && it.master }, i))) })), group.subGroups?.map((sub, i) => (_jsxs("div", { className: "mt-[52px]", children: [_jsxs("div", { className: "mb-[28px] flex items-center gap-[14px] text-[28px] font-extrabold leading-[1.3] tracking-[.06em] opacity-[.62]", children: [_jsx("span", { className: "size-[10px] flex-none rounded-[9999px] bg-fg" }), sub.title] }), _jsx("div", { className: "[column-count:2] [column-gap:44px] pl-[30px] [&>*]:mb-[26px] [&>*]:[break-inside:avoid]", children: sub.items.map((it, j) => (_jsx(Item, { item: it, color: color, sub: true }, j))) })] }, i)))] }));
}
export function Help(data) {
    const { rotate, spectrum } = data.palette;
    return (_jsxs(_Fragment, { children: [_jsxs(Page, { word: "COMMANDS", children: [_jsx(Header, { title: "COMMANDS", status: "GSCORE_ADAPTER", led: data.enabled ? "on" : "off", rightKey: "ADAPTER", rightValue: data.enabled ? "ENABLED" : "DISABLED" }), _jsx(Stats, { items: data.summary, palette: data.palette }), data.groups.map((g, i) => (_jsx(Group, { group: g, color: rotate[i % rotate.length], 
                        // 每个分组的计数取渐变上相邻两档，i 轮换 —— 与该组标题色的轮换同步推进
                        spectrum: [spectrum[i % spectrum.length], spectrum[(i + 1) % spectrum.length]] }, i)))] }), _jsx(Footer, { name: data.title, version: data.version, palette: data.palette, lines: [data.time, "MASTER 标记的指令仅主人可用"] })] }));
}
