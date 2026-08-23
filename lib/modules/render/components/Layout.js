import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { FRAME_LOGO, PLUGIN_LOGO, imageDataUri } from "../assets.js";
import { frameLabel, releaseType } from "../env.js";
import { textWidth } from "../metrics.js";
/** @description 背景装饰层：光斑、压花玻璃、气氛大字、角落点缀 */
export function Backdrop({ word, ghostTop, gloss, }) {
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "pointer-events-none absolute inset-0 z-0 overflow-hidden", children: [_jsx("div", { className: "absolute top-[-420px] left-[-320px] h-[1680px] w-[1560px] rounded-[9999px] [transform:rotate(-18deg)] [background:radial-gradient(ellipse_at_42%_38%,var(--glow-1)_0%,transparent_68%)]" }), _jsx("div", { className: "absolute top-[260px] right-[-380px] h-[1560px] w-[1320px] rounded-[9999px] [transform:rotate(22deg)] [background:radial-gradient(ellipse_at_52%_48%,var(--glow-2)_0%,transparent_66%)]" }), _jsx("div", { className: "absolute bottom-[-460px] left-[80px] h-[1380px] w-[1500px] rounded-[9999px] [transform:rotate(-8deg)] [background:radial-gradient(ellipse_at_48%_56%,var(--glow-3)_0%,transparent_70%)]" }), _jsx("div", { className: "absolute top-[820px] left-[-260px] h-[1140px] w-[1040px] rounded-[9999px] [transform:rotate(34deg)] [background:radial-gradient(ellipse_at_46%_50%,var(--glow-4)_0%,transparent_72%)]" }), _jsx("div", { className: "absolute top-[-160px] right-[-200px] h-[1020px] w-[1180px] rounded-[9999px] [transform:rotate(-26deg)] [background:radial-gradient(ellipse_at_54%_44%,var(--glow-5)_0%,transparent_74%)]" })] }), _jsx("div", { className: "pointer-events-none absolute inset-0 z-0", children: _jsxs("svg", { className: "size-full", xmlns: "http://www.w3.org/2000/svg", children: [_jsxs("defs", { children: [_jsxs("filter", { id: "gm", x: "0%", y: "0%", width: "100%", height: "100%", children: [_jsx("feTurbulence", { type: "fractalNoise", baseFrequency: "0.008", numOctaves: 2, seed: 21, result: "n" }), _jsx("feColorMatrix", { in: "n", values: "0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.9 0.9 0.9 0 -0.25" })] }), _jsxs("filter", { id: "gl", x: "0%", y: "0%", width: "100%", height: "100%", children: [_jsx("feTurbulence", { type: "turbulence", baseFrequency: "0.1", numOctaves: 2, seed: 9, result: "n" }), _jsx("feSpecularLighting", { in: "n", lightingColor: "#fff", surfaceScale: 4.4, specularConstant: 1.5, specularExponent: 15, result: "s", children: _jsx("feDistantLight", { azimuth: 228, elevation: 54 }) }), _jsx("feComposite", { in: "s", in2: "s", operator: "in" })] }), _jsx("mask", { id: "gmask", children: _jsx("rect", { width: "1440", height: "6000", filter: "url(#gm)" }) })] }), _jsx("g", { mask: "url(#gmask)", children: _jsx("rect", { width: "1440", height: "6000", filter: "url(#gl)", style: { mixBlendMode: gloss.blend, opacity: gloss.opacity } }) })] }) }), _jsx("div", { className: "pointer-events-none absolute top-[560px] right-[56px] z-0 text-[200px] font-black leading-none tracking-[-.04em] opacity-[.028] [writing-mode:vertical-rl] [text-orientation:mixed]", style: ghostTop ? { top: ghostTop } : undefined, children: word }), _jsx("div", { className: "absolute top-[40px] left-[40px] z-0 grid [grid-template-columns:repeat(3,1fr)] gap-[7px] opacity-[.16]", children: Array.from({ length: 9 }, (_, i) => (
                // 老规则是 `.dots i`，样式挂在生成出来的子元素上，迁移后直接写在 <i> 上
                _jsx("i", { className: "size-[5px] rounded-[9999px] bg-fg" }, i))) }), _jsx("div", { className: "absolute top-[40px] right-[40px] z-0 flex flex-col items-end gap-[4px] opacity-[.16]", children: [72, 52, 32].map(w => (_jsx("i", { className: "h-[4px] bg-fg", style: { width: w } }, w))) }), _jsx("div", { className: "absolute bottom-0 left-0 z-0 h-[400px] w-[520px] opacity-[.04] [background:repeating-linear-gradient(45deg,var(--fg),var(--fg)_5px,transparent_2px,transparent_10px)]" })] }));
}
/**
 * @description 概览统计条：四张等宽大数字卡
 * 抽成组件而不是让帮助页/状态页/更新日志页各写一遍那串二十来个类 —— 改一处漏两处，而 classes.test.mjs 查的是
 * 「类有没有定义」，查不出「三处不一致」。
 */
export function Stats({ items, palette, }) {
    // 注意：列宽用 repeat(4,1fr) 而不是 grid-cols-4 —— 后者编出来是 repeat(4,minmax(0,1fr))，最小值被钉在 0、
    // 四列恒等宽；而 1fr 的最小值是 auto，放不下的列可以超出等分。更新日志页的上排小字够长，它那四列实际是
    // 382/162/299/380 而非 306×4，换成 minmax(0,1fr) 会把那页的统计条压回等分
    return (_jsx("div", { className: "mb-[72px] grid [grid-template-columns:repeat(4,1fr)] gap-[24px]", children: items.map((s, i) => (
        /*
         * 四张卡等高（grid 默认 stretch），内部三行 flex 竖排；卡面是液态玻璃而不是「实心面 + 深色发丝边」
         *
         * 不透的卡片会把底下那片起伏的材质整块盖住 —— 出图里这四张卡明显比周围干净、平滑，是整页唯一不像
         * 玻璃的东西（帮助页尤其突兀，其余内容全部直接压在背景上）。所以三件事一起改：
         *   卡面  竖向渐变 .52 → .24 的白，上亮下暗是玻璃的体积感来源，底下的鳞片纹理透得上来
         *   边    两条方向相反的 1px 内阴影代替描边：左上受光边、右下背光边 —— 描边四周同色，玻璃的边随光向
         *         一半亮一半暗
         *   厚度  顶部 28px 白色内发光（玻璃体内的漫射）＋ 一层外投影，让卡片浮起来
         *
         * 注意：底端停在 .24 而不是更透。按 test/glassink.mjs 实测，.17 那档第一张卡的最暗单像素是 4.41，
         * 差 0.09 掉出正文 4.5；抬到 .24 后是 4.63，看不出画面差别。52px 的大数字走大字 3.0 那条线，本来宽裕。
         */
        _jsxs("div", { className: "flex flex-col gap-[10px] rounded-[22px] px-[26px] py-[24px] [background:linear-gradient(180deg,rgba(255,255,255,.52),rgba(255,255,255,.33)_44%,rgba(255,255,255,.24))] [box-shadow:inset_1px_1px_0_rgba(255,255,255,.95),inset_-1px_-1px_0_var(--border),inset_0_28px_40px_-32px_rgba(255,255,255,.95),0_16px_36px_-22px_rgba(16,26,40,.20)]", children: [_jsx("div", { className: "font-mono text-[16px] font-extrabold uppercase leading-[1.3] tracking-[.16em] text-muted", children: s.key }), _jsx("div", { className: "text-[52px] font-black leading-[1.05] tracking-[-.02em] [font-variant-numeric:tabular-nums]", style: {
                        backgroundImage: `linear-gradient(135deg, ${palette.spectrum[i % palette.spectrum.length]}, ${palette.spectrum[(i + 1) % palette.spectrum.length]})`,
                        WebkitBackgroundClip: "text",
                        backgroundClip: "text",
                        color: "transparent",
                    }, children: s.value }), s.sub && _jsx("div", { className: "mt-auto text-[18px] leading-[1.4] text-muted", children: s.sub })] }, i))) }));
}
/**
 * @description 分节标题：圆点 + 文字 + 一条向右淡出的渐变线
 * 关于页的「环境摘要 / 本版变更」与状态页的分组明细都用它。做成组件之后，从前那种「关于页私有类被状态页借用、
 * 改哪边都会波及对方」在类型上就不成立了。渐变线与圆点的颜色来自运行时轮换色，走内联 style；组件只定形。
 */
export function Section({ title, color, right, }) {
    return (_jsxs("div", { className: "mb-[36px] flex items-center gap-[16px]", children: [_jsx("span", { className: "size-[11px] flex-none rounded-[9999px]", style: { background: color } }), _jsx("span", { className: "text-[26px] font-extrabold leading-none tracking-[.16em] text-muted", children: title }), right && (
            // 比标题再轻一档
            _jsx("span", { className: "flex-none font-mono text-[22px] font-bold leading-none opacity-80 text-muted", children: right })), _jsx("span", { className: "h-[3px] max-w-[220px] flex-1 rounded-[9999px] opacity-[.55]", style: { background: `linear-gradient(90deg,${color},transparent)` } })] }));
}
/**
 * @description 空态卡：状态页「暂无连接」、更新日志页「已是最新」
 * 虚线描边而不是实线 —— 与两页的实线内容卡区分开，一眼能看出「这里本该有东西」。
 * whitespace-pre-line 保留说明里的换行（提示文案带 \n 分段）。
 */
export function Empty({ title, tip }) {
    return (_jsxs("div", { className: "flex flex-col items-center justify-center gap-[16px] rounded-[32px] border border-dashed border-border bg-surface px-[80px] py-[96px] text-center", children: [_jsx("div", { className: "text-[44px] font-black leading-[1.2]", children: title }), _jsx("div", { className: "text-[26px] leading-[1.7] whitespace-pre-line break-words break-keep text-muted", children: tip })] }));
}
/**
 * @description 提示条：fetch 失败等非致命情况用它说明，不占用空态位置
 * 左侧粗边当色标，颜色由调用方按语义色内联给（border-l-[6px] 只定宽，四边的颜色仍走内联的 borderColor）。
 */
export function Notice({ text, color }) {
    return (_jsx("div", { className: "mb-[44px] rounded-[24px] border border-l-[6px] px-[32px] py-[26px] text-[25px] leading-[1.65] break-words break-keep", style: { color, background: `${color}14`, borderColor: `${color}3d` }, children: text }));
}
/** @description 顶部标题区 */
export function Header({ title, status, led = "on", rightKey, rightValue, }) {
    return (
    // border-b-border 而不是 border-border：老规则只给 border-bottom 上色，其余三边仍是 reset 的 currentColor
    _jsxs("div", { className: "mb-[72px] flex items-end justify-between border-b-4 border-b-border pb-[32px]", children: [_jsxs("div", { className: "flex flex-col gap-[22px]", children: [_jsxs("div", { className: "flex items-center gap-[14px] pl-[4px] opacity-70", children: [_jsx("span", { className: `size-[10px] flex-none rounded-[9999px] text-[20px] font-bold uppercase leading-none tracking-[.22em] text-muted ${led === "off"
                                    ? "bg-muted"
                                    : led === "warn"
                                        ? "bg-warning [box-shadow:0_0_12px_var(--warning)]"
                                        : "bg-success [box-shadow:0_0_12px_var(--success)]"}` }), _jsx("span", { className: "font-mono text-[20px] font-bold uppercase leading-none tracking-[.22em] text-muted", children: status })] }), _jsx("h1", { className: "text-[104px] font-black leading-[.95] tracking-[-.045em]", children: title })] }), _jsxs("div", { className: "flex flex-col gap-[8px] pb-[8px] text-right", children: [_jsx("div", { className: "text-[19px] font-extrabold uppercase leading-none tracking-[.2em] text-muted", children: rightKey }), _jsx("div", { className: "text-[34px] font-extrabold leading-[1.1]", children: rightValue })] })] }));
}
/**
 * @description 页脚水印布局常量，用于反推「整条水印能不能放进一行」
 * 注意：几何与 styles/frame.ts 的 .foot 规则一一对应，改那边的尺寸要同步改这里。
 */
const FOOT = {
    /** 画布内容宽 = 1440 - .foot 的左右 padding 72×2 */
    width: 1296,
    /** 图标边长，两侧各一个 */
    icon: 80,
    /** 图标与文字块的间距（.foot .side 的 gap） */
    iconGap: 20,
    /** 水印内各块之间的间距（.foot .wm 的 gap） */
    blockGap: 32,
    /** 分隔竖线宽度 */
    sep: 3,
    /** 上排小字字号与字距 */
    capSize: 19,
    capTrack: 0.2,
    /** 下排大字字号与字距 */
    nameSize: 38,
    nameTrack: -0.01,
    /** 框架版本小字字号 */
    smallSize: 24,
    /** 最小缩放比。0.62 下大字 23.6px，已经很小但仍比换行好看；触发它需要 40 字符以上的版本串 */
    minScale: 0.62,
};
/**
 * @description 页脚水印：插件图标 + 插件名/版本 ｜ 框架图标 + POWER BY 框架名/版本
 * 版式照 kkk 的 DefaultLayout：居中一排，左半是插件、右半是框架，中间一根竖线分隔。
 * 必须是一行，所以在 SSR 阶段估一遍总宽（metrics.ts），超了就靠 CSS 变量 --fs 整体等比缩小 —— 靠 flex-wrap
 * 兜底会把框架半边甩到第二行、并列关系断掉，而只禁止换行会溢出被 overflow:hidden 裁掉，比换行更糟。
 * 版本号旁的 Stable/Preview 取自 env.ts 的 releaseType：预览版用 warning 色，让「这不是发布版本」一眼可见。
 * 不做 kkk 那套像素隐写（要 sharp 的原生二进制，且用户看不见），也不显示构建工具标（本插件是运行时 SSR）。
 */
export function Footer({ name, version, lines, palette, frame = frameLabel(), frameLogo = imageDataUri(FRAME_LOGO), logo = imageDataUri(PLUGIN_LOGO), }) {
    const p = palette;
    const rt = releaseType();
    // 非正式版用 warning 色，正式版跟随前景色
    const verColor = rt === "Stable" ? p.foreground : p.warning;
    const rtCap = rt === "Stable" ? "✓ STABLE" : rt === "Dev" ? "⚙ DEV" : "⚠ PREVIEW";
    // 框架名与版本分开显示：Miao-Yunzai v3.1.3 -> ["Miao-Yunzai", "3.1.3"]
    const m = /^(.*?)\s+v([\d.].*)$/.exec(frame);
    const frameNm = m ? m[1] : frame;
    const frameVer = m ? m[2] : "";
    // ---- 一行放不下就整体缩小 ----
    // 每块的宽度取「上排小字」与「下排大字」的较大者，三块加上图标与间距即总宽。
    const cap = (t) => textWidth(t, FOOT.capSize, FOOT.capTrack);
    const nm = (t) => textWidth(t, FOOT.nameSize, FOOT.nameTrack);
    const wPlugin = Math.max(cap("PLUGIN"), nm(name));
    const wVer = Math.max(cap(rtCap), nm(version));
    const wFrame = Math.max(cap("POWER BY"), nm(frameNm) + (frameVer ? textWidth(` v${frameVer}`, FOOT.smallSize) : 0));
    // 固定开销：两个图标 + 各自与文字的间距 + 分隔线 + 三道块间距
    const fixed = (FOOT.icon + FOOT.iconGap) * 2 + FOOT.sep + FOOT.blockGap * 3;
    const need = fixed + wPlugin + wVer + wFrame;
    const scale = need <= FOOT.width ? 1 : Math.max(FOOT.minScale, (FOOT.width - fixed) / (need - fixed));
    return (_jsxs("div", { className: "relative z-10 flex flex-col items-center gap-[26px] px-[72px] pt-0 pb-[64px]", children: [_jsxs("div", { className: "flex max-w-full flex-nowrap items-center justify-center gap-[32px] whitespace-nowrap [--fs:1]", style: scale < 1 ? { "--fs": scale } : undefined, children: [_jsxs("div", { className: "flex min-w-0 items-center gap-[20px]", children: [logo && (
                            /*
                             * 图标：外层 span 定框，内层 img 决定字形实际大小
                             *
                             * 两张图构图不同：logo.webp 的字形只占画幅 70.7%，frame-logo.webp 是满幅不透明图。同样塞进框、
                             * 同样内缩时早柚字形只有 42px、云崽有 60px —— 差三分之一，就是「适配器图标偏小」的来源。所以让
                             * img 溢出框 112% 把那圈留白顶出去（字形 ≈ 63px），overflow-hidden 裁掉溢出部分。
                             * 不给底色和描边：logo.webp 是透明底，加了淡底 + 边框就成了两个方块罩在字形外，而页脚这行只是
                             * 水印，方框比它要标记的内容更抢眼。圆角留着只为裁剪溢出。
                             */
                            _jsx("span", { className: "flex size-[80px] flex-none items-center justify-center overflow-hidden rounded-[20px]", children: _jsx("img", { className: "block size-[112%] object-contain", src: logo, alt: "" }) })), _jsxs("div", { className: "flex min-w-0 flex-col gap-[7px]", children: [_jsx("div", { className: "font-mono text-[calc(19px*var(--fs))] font-extrabold uppercase leading-none tracking-[.2em] text-muted", children: "PLUGIN" }), _jsx("div", { className: "text-[calc(38px*var(--fs))] font-black leading-none tracking-[-.01em]", children: name })] })] }), _jsxs("div", { className: "flex min-w-0 flex-col gap-[7px]", children: [_jsx("div", { className: "font-mono text-[calc(19px*var(--fs))] font-extrabold uppercase leading-none tracking-[.2em]", style: { color: verColor }, children: rtCap }), _jsx("div", { className: "text-[calc(38px*var(--fs))] font-black leading-none tracking-[-.01em] [font-variant-numeric:tabular-nums]", style: { color: verColor }, children: version })] }), _jsx("div", { className: "h-[56px] w-[3px] flex-none rounded-[9999px] bg-border" }), _jsxs("div", { className: "flex min-w-0 items-center gap-[20px]", children: [frameLogo && (
                            /* 满幅图内缩 8px，字形 = 80 - 16 = 64px，与左边的 63px 相当。frame-logo 自带白底、本身就是个
                               方块，不需要再补边框框住它 */
                            _jsx("span", { className: "flex size-[80px] flex-none items-center justify-center overflow-hidden rounded-[20px]", children: _jsx("img", { className: "block size-full p-[8px] object-contain", src: frameLogo, alt: "" }) })), _jsxs("div", { className: "flex min-w-0 flex-col gap-[7px]", children: [_jsx("div", { className: "font-mono text-[calc(19px*var(--fs))] font-extrabold uppercase leading-none tracking-[.2em] text-muted", children: "POWER BY" }), _jsxs("div", { className: "text-[calc(38px*var(--fs))] font-black leading-none tracking-[-.01em]", children: [frameNm, frameVer && (_jsxs("small", { className: "font-mono text-[calc(24px*var(--fs))] font-bold tracking-normal text-muted", children: [" ", "v", frameVer] }))] })] })] })] }), lines.length > 0 && (_jsx("div", { className: "flex flex-wrap items-center justify-center gap-[28px] font-mono text-[20px] leading-[1.5] opacity-75 text-muted", children: lines.map((t, i) => (_jsx("span", { children: t }, i))) }))] }));
}
/** @description 一整页 */
export function Page({ 
// 骨架真的要读调色板：压花玻璃的高光强度必须按主题分档（深底上 screen 混合等于叠纯白，出来是一屏雪花）
palette, word, ghostTop, children, }) {
    return (_jsxs(_Fragment, { children: [_jsx(Backdrop, { word: word, ghostTop: ghostTop, gloss: palette.gloss }), _jsx("div", { className: "relative z-10 p-[72px]", children: children })] }));
}
