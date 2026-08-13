import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Icon } from "./Icons.js";
import { Footer, Header, Page, Stats } from "./Layout.js";
/**
 * 一张指令卡
 *
 * sub 为真时整体降一档（子分组用）
 * ------------------------------
 * 迁移前这是 CSS 的 `.hp-sub .hp-item{padding:22px 26px}` 一族后代选择器：卡片自己
 * 不知道处境，由祖先改写尺寸。utility 表达不了「祖先是谁」，所以处境改成显式入参。
 *
 * 这样反而更贴合它本来的意思——子分组的条目与主指令卡是不同的东西：cmd 是
 * name / token 这类短标识，dsc 恒为一行，没有 eg 也没有 MASTER 标签。沿用主卡尺寸
 * 有两个具体毛病：60px 的图标框在只有两行内容的卡里显得卡在最上沿（用户反馈过
 * 「子菜单图标还是在最上面」）；36px 的 cmd 配一行 24px 说明，块头与主卡一样大，
 * 读起来分不出主次。
 */
/**
 * 把指令标题切成若干不可断开的整块
 *
 * 标题里有两种语义单元，断在中间读起来都像坏了：
 *
 * - 指令本身，`#早柚设置私聊上报关闭`。break-keep 只禁掉 CJK 的逐字断点，管不了
 *   `#` 与后面汉字之间——那是「前置标点不能落行尾」的规则给的断点，于是 `#` 独占
 *   一行、指令从第二行才开始（用户反馈的「#独占一行」「全局设置第二行就开始了」）。
 * - `<地址>` / `<名字|序号>` 这类占位符。断点来自「连接」与「<」之间那个空格。
 *
 * 所以按空白切片，每片各自 nowrap，只允许在空白处折行。片内可能仍然超栏宽（真出现
 * 时溢出比劈开更好定位），但现行清单里最长的一片是 `max_reconnect_attempts（retry）`
 * 477px，仍在子卡 502px 的栏宽内。
 *
 * 返回 string 而非数组的快路径：不含空白的标题就是一整片，不必包 <span>。
 */
function keepAtoms(cmd) {
    if (!/\s/.test(cmd))
        return _jsx("span", { className: "whitespace-nowrap", children: cmd });
    return cmd.split(/(\s+)/g).map((part, i) => /^\s+$/.test(part) ? (part) : (_jsx("span", { className: "whitespace-nowrap", children: part }, i)));
}
function Item({ item, color, sub, badge, }) {
    return (
    // h-full：网格行内按最高的那张拉齐（默认 stretch）。原来是 [align-items:start]
    // 让每张卡保持内容高度，同一行两张卡的底边就差出几十像素，整页边缘参差 ——
    // 用户反馈的「空白一大部分」有一半来自这些高低差。内容仍贴卡片顶部，
    // 只是卡片外框补齐到行高。
    _jsx("div", { className: sub
            ? "h-full rounded-[26px] border border-border bg-surface px-[26px] py-[22px]"
            : "h-full rounded-[26px] border border-border bg-surface px-[30px] py-[28px]", children: _jsxs("div", { className: sub ? "flex items-start gap-[20px]" : "flex items-start gap-[24px]", children: [_jsx("div", { className: sub
                        ? "grid size-[48px] flex-none place-items-center self-center rounded-[14px] [&>svg]:block [&>svg]:size-[23px]"
                        : "grid size-[60px] flex-none place-items-center self-center rounded-[18px] [&>svg]:block [&>svg]:size-[30px]", style: { background: `${color}1f`, color, border: `1px solid ${color}3d` }, children: _jsx(Icon, { name: item.icon }) }), _jsxs("div", { className: sub
                        ? "flex min-w-0 flex-1 flex-col gap-[6px]"
                        : "flex min-w-0 flex-1 flex-col gap-[10px] pt-[2px]", children: [_jsx("div", { className: sub
                                ? "text-[30px] font-black leading-[1.25] tracking-[-.01em]"
                                : "text-[36px] font-black leading-[1.2] tracking-[-.01em]", children: keepAtoms(item.cmd) }), badge && (_jsx("span", { className: "self-start rounded-[9999px] px-[13px] py-[5px] text-[18px] font-extrabold leading-none tracking-[.08em]", style: { color, background: `${color}1f`, border: `1px solid ${color}3d` }, children: "MASTER" })), _jsx("div", { className: sub
                                ? "text-[21px] leading-[1.5] break-words break-keep whitespace-pre-line text-muted"
                                : "text-[24px] leading-[1.6] break-words break-keep whitespace-pre-line text-muted", children: item.dsc }), item.eg && (_jsx("div", { className: "mt-[2px] max-w-full self-start rounded-[12px] border border-border bg-inset px-[16px] py-[8px] font-mono text-[21px] leading-[1.5] break-words break-keep text-muted", children: item.eg }))] })] }) }));
}
/**
 * 算每张卡要不要跨两列
 *
 * wide 的显式跨列；其余按网格流依次放。走到组尾还剩半栏时，把最后一张也拉通 ——
 * 双栏网格里落单的半栏是整页最大的空白来源（三个分组各空着一大块）。
 * wide 卡恰好排在半行位置时同理把前一张补齐，否则网格会在上一行留洞。
 */
function spanMap(items) {
    const spans = items.map(it => !!it.wide);
    let col = 0;
    spans.forEach((wide, i) => {
        if (wide) {
            if (col === 1)
                spans[i - 1] = true;
            col = 0;
        }
        else
            col = col === 0 ? 1 : 0;
    });
    if (col === 1)
        spans[items.length - 1] = true;
    return spans;
}
function Group({ group, color }) {
    const total = group.items.length + (group.subGroups?.reduce((n, s) => n + s.items.length, 0) || 0);
    /** 整组都要主人权限时在标题上标一次，替代原先每条卡片各标一个 */
    const allMaster = group.items.length > 0 && group.items.every(i => i.master);
    const spans = spanMap(group.items);
    return (_jsxs("div", { className: "mb-[88px] last:mb-0", children: [_jsxs("div", { className: "mb-[44px] flex items-center gap-[24px]", children: [_jsx("div", { className: "h-[56px] w-[12px] flex-none rounded-[9999px]", style: { background: color } }), _jsx("h2", { className: "flex-none text-[64px] font-black leading-none tracking-[-.03em]", children: group.title }), allMaster && (_jsx("span", { className: "flex-none rounded-[9999px] px-[14px] py-[7px] text-[20px] font-extrabold leading-none tracking-[.08em]", style: { color, background: `${color}1f`, border: `1px solid ${color}3d` }, children: "MASTER" })), _jsx("div", { className: "ml-auto flex-none rounded-[9999px] border border-border bg-inset px-[18px] py-[9px] font-mono text-[22px] font-extrabold leading-none tracking-[.14em] text-muted", children: String(total).padStart(2, "0") })] }), group.items.length > 0 && (_jsx("div", { className: "grid grid-cols-2 gap-x-[48px] gap-y-[32px]", children: group.items.map((it, i) => (
                // 跨列由 spanMap 统一算：显式 wide 的、以及组尾落单的那张
                _jsx("div", { className: spans[i] ? "col-span-2" : undefined, children: _jsx(Item, { item: it, color: color, badge: !allMaster && it.master }) }, i))) })), group.subGroups?.map((sub, i) => {
                const subSpans = spanMap(sub.items);
                return (_jsxs("div", { className: "mt-[56px]", children: [_jsxs("div", { className: "mb-[32px] flex items-center gap-[14px] text-[28px] font-extrabold leading-[1.3] tracking-[.06em] opacity-[.62]", children: [_jsx("span", { className: "size-[10px] flex-none rounded-[9999px] bg-fg" }), sub.title] }), _jsx("div", { className: "grid grid-cols-2 gap-x-[48px] gap-y-[32px]", children: sub.items.map((it, j) => (_jsx("div", { className: subSpans[j] ? "col-span-2" : undefined, children: _jsx(Item, { item: it, color: color, sub: true }) }, j))) })] }, i));
            })] }));
}
export function Help(data) {
    const { rotate } = data.palette;
    return (_jsxs(_Fragment, { children: [_jsxs(Page, { palette: data.palette, word: "COMMANDS", children: [_jsx(Header, { title: "COMMANDS", status: "GSCORE_ADAPTER", led: data.enabled ? "on" : "off", rightKey: "ADAPTER", rightValue: data.enabled ? "ENABLED" : "DISABLED" }), _jsx(Stats, { items: data.summary, palette: data.palette }), data.groups.map((g, i) => (_jsx(Group, { group: g, color: rotate[i % rotate.length] }, i)))] }), _jsx(Footer, { name: data.title, version: data.version, palette: data.palette, lines: [data.time, "MASTER 标记的指令仅主人可用"] })] }));
}
