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
 * 把 <占位符> 包成不可断开的整块
 *
 * 指令标题里的 <地址> / <编号> 是一个语义单元，劈成两行读起来像坏了。break-keep
 * 管不了这种情况：它只禁掉 CJK 的逐字断点，而这里的断点来自「连接」与「<地址>」
 * 之间那个空格（首行被右侧 MASTER 标签挤窄后就会折在那儿）。
 *
 * 所以按 <...> 切分，占位符那段套一层 whitespace-nowrap，其余文本原样返回。
 * 只在这里做而不是整条 nowrap：整条禁折会让长标题直接溢出卡片。
 *
 * 返回 string 而非数组的快路径：绝大多数指令没有占位符，避免无谓的 <span> 包裹。
 */
function keepAtoms(cmd) {
    if (!cmd.includes("<"))
        return cmd;
    return cmd.split(/(<[^<>]*>)/g).map((part, i) => part.startsWith("<") && part.endsWith(">") ? (_jsx("span", { className: "whitespace-nowrap", children: part }, i)) : (part));
}
function Item({ item, color, sub }) {
    return (_jsx("div", { className: sub
            ? "rounded-[26px] border border-border bg-surface px-[26px] py-[22px]"
            : "rounded-[26px] border border-border bg-surface px-[30px] py-[28px]", children: _jsxs("div", { className: sub ? "flex items-start gap-[20px]" : "flex items-start gap-[24px]", children: [_jsx("div", { className: sub
                        ? "grid size-[48px] flex-none place-items-center self-center rounded-[14px] [&>svg]:block [&>svg]:size-[23px]"
                        : "grid size-[60px] flex-none place-items-center self-center rounded-[18px] [&>svg]:block [&>svg]:size-[30px]", style: { background: `${color}1f`, color, border: `1px solid ${color}3d` }, children: _jsx(Icon, { name: item.icon }) }), _jsxs("div", { className: sub
                        ? "flex min-w-0 flex-1 flex-col gap-[6px]"
                        : "flex min-w-0 flex-1 flex-col gap-[10px] pt-[2px]", children: [_jsxs("div", { className: sub
                                ? "flex items-start gap-[12px] text-[30px] font-black leading-[1.25] tracking-[-.01em]"
                                : "flex items-start gap-[12px] text-[36px] font-black leading-[1.2] tracking-[-.01em]", children: [_jsx("span", { className: "min-w-0 break-words break-keep", children: keepAtoms(item.cmd) }), item.master && (
                                /*
                                 * 曾经用 vertical-align:middle + top:-3px 纠正基线，那是它还内联在文字里时
                                 * 的补丁。现在是 flex 兄弟，改用几何对齐：首行行高 43.2px（36×1.2）中线
                                 * 21.6px；标签自身 18（leading-none）+ 4×2 内边距 + 1×2 边框 = 28px，中线
                                 * 14px。差 7.6px，不取整——zoom 1.5 下是 11.4 个物理像素，取 8 会留 0.6px。
                                 */
                                _jsx("span", { className: "mt-[7.6px] flex-none self-start rounded-[9999px] px-[13px] py-[4px] text-[18px] font-extrabold leading-none tracking-[.08em]", style: { color, background: `${color}1f`, border: `1px solid ${color}3d` }, children: "MASTER" }))] }), _jsx("div", { className: sub
                                ? "text-[21px] leading-[1.5] whitespace-pre-line text-muted"
                                : "text-[24px] leading-[1.6] whitespace-pre-line text-muted", children: item.dsc }), item.eg && (_jsx("div", { className: "mt-[2px] max-w-full self-start rounded-[12px] border border-border bg-inset px-[16px] py-[8px] font-mono text-[21px] leading-[1.5] break-words break-keep text-muted", children: item.eg }))] })] }) }));
}
function Group({ group, color }) {
    const total = group.items.length + (group.subGroups?.reduce((n, s) => n + s.items.length, 0) || 0);
    return (_jsxs("div", { className: "mb-[88px] last:mb-0", children: [_jsxs("div", { className: "mb-[44px] flex items-center gap-[24px]", children: [_jsx("div", { className: "h-[56px] w-[12px] flex-none rounded-[9999px]", style: { background: color } }), _jsx("h2", { className: "text-[64px] font-black leading-none tracking-[-.03em]", children: group.title }), _jsx("div", { className: "ml-auto flex-none rounded-[9999px] border border-border bg-inset px-[18px] py-[9px] font-mono text-[22px] font-extrabold leading-none tracking-[.14em] text-muted", children: String(total).padStart(2, "0") })] }), group.items.length > 0 && (_jsx("div", { className: "grid grid-cols-2 [align-items:start] gap-x-[48px] gap-y-[32px]", children: group.items.map((it, i) => (_jsx(Item, { item: it, color: color }, i))) })), group.subGroups?.map((sub, i) => (_jsxs("div", { className: "mt-[56px]", children: [_jsxs("div", { className: "mb-[32px] flex items-center gap-[14px] text-[28px] font-extrabold leading-[1.3] tracking-[.06em] opacity-[.62]", children: [_jsx("span", { className: "size-[10px] flex-none rounded-[9999px] bg-fg" }), sub.title] }), _jsx("div", { className: "grid grid-cols-2 [align-items:start] gap-x-[48px] gap-y-[32px]", children: sub.items.map((it, j) => (_jsx(Item, { item: it, color: color, sub: true }, j))) })] }, i)))] }));
}
export function Help(data) {
    const { rotate } = data.palette;
    return (_jsxs(_Fragment, { children: [_jsxs(Page, { palette: data.palette, word: "COMMANDS", children: [_jsx(Header, { title: "COMMANDS", status: "GSCORE_ADAPTER", led: data.mode === "client" ? "on" : "off", rightKey: "RUNNING MODE", rightValue: data.mode }), _jsx(Stats, { items: data.summary, palette: data.palette }), data.groups.map((g, i) => (_jsx(Group, { group: g, color: rotate[i % rotate.length] }, i)))] }), _jsx(Footer, { name: data.title, version: data.version, palette: data.palette, lines: [data.time, "MASTER ONLY 标记的指令仅主人可用"] })] }));
}
