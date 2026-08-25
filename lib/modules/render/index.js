/**
 * @description 渲染入口：React SSR -> 整页 HTML -> 本体 puppeteer 截图
 * 版式思路参考 karin-plugin-kkk 的 packages/template：同样运行时 SSR、不 hydrate、不产出 client bundle，
 * 样式管线也对齐（Tailwind v4 在构建期扫 JSX 产出一份 CSS）。
 * 外壳（DOCTYPE、meta、内联样式、#container）与写盘交给 @karinjs/template-react 的 HtmlWrapper /
 * createRenderer，本文件不再自己拼 HTML 字符串。接法上绕开了它的「目录即路由」约定：createRenderer 接受的
 * 就是一张普通的「路由 -> 组件」映射表，所以组件不迁目录，在 render() 里现构一张。
 * CSS 要先落盘：HtmlWrapper 只接文件路径（它按该文件的目录解析 url() 里的相对资源），见 cssFileFor()。
 * 注意：最后一步仍走本体 screenshot() —— 它还管浏览器生命周期、超时强制重启、分片截图的 viewport 计算，
 * 套模板只占很小一块。所以把「已拼好的整页 HTML」当模板喂给它（art-template 对不含 {{ }} 的文本逐字节
 * 原样返回），代价是要绕开 dealTpl 的模板缓存，见 render() 里的 evictTplCache()。
 */
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRenderer, HtmlWrapper } from "@karinjs/template-react";
import { PluginName, YunzaiPath } from "../../dir.js";
import { makeLog } from "../../utils/compat.js";
import { buildCss } from "./styles/index.js";
import { pickPalette, COOL, LIGHT } from "./theme.js";
/**
 * @description 自己生成的整页 HTML 放哪：每个页面一个固定文件名，不带时间戳
 * 注意：路径不能每次都变 —— 本体按路径缓存模板、并为每个新路径注册一个 chokidar watcher，两者都会无上限
 * 增长。理由详见 render() 里的 evictTplCache 那段。
 */
const HTML_DIR = join(YunzaiPath, "temp", "html", `${PluginName}-html`);
/**
 * @description 高清倍率：1440px 画布出 1800px 宽的图，缩到聊天窗口后文字边缘仍清晰
 * 这个数字直接决定出图耗时（瓶颈是 Chromium 把画布编码成 jpeg，随像素数超线性增长）。实测状态页：
 *   zoom 1.5 → 2160x2785 / 3427ms；1.25 → 1800x2322 / 1451ms；1.0 → 1440x1859 / 536ms
 * 1.5 → 1.25 只少 17% 的边长却省掉 58% 的时间，裁图逐像素比对过、文字边缘无可见劣化；1.0 是原生尺寸，
 * QQ 客户端放大查看时会糊。
 * 注意：必须用 CSS zoom。screenshot 的 deviceScaleFactor 本体从没读过，传了是静默失效只拿到 1 倍图；
 * transform:scale 不改变布局尺寸，boundingBox 仍是 1440，截出来会裁掉一大半 —— 本体只按 #container 的
 * boundingBox 截，所以这里只能用会改布局盒的 zoom。
 */
const SCALE = 1.25;
/** @description 本体 puppeteer 模块，首次渲染时惰性加载 */
let puppeteer;
/**
 * @description 取本体截图器
 * 与 apps/update.ts 同一套做法：由 YunzaiPath 拼绝对路径后动态 import。
 * 注意：别写 ../../../../lib/puppeteer/puppeteer.js —— 那既依赖编译产物的目录深度，又会让 tsc 去静态解析
 * 一个不在本仓库里的文件（CI 单独 checkout 时必然 TS2307）。
 */
async function getPuppeteer() {
    if (puppeteer)
        return puppeteer;
    try {
        const url = pathToFileURL(join(YunzaiPath, "lib/puppeteer/puppeteer.js")).href;
        puppeteer = (await import(url)).default;
    }
    catch (err) {
        makeLog("error", ["加载本体 puppeteer 失败", err], "GsCore");
        return null;
    }
    return puppeteer;
}
/**
 * @description CSS 落盘，返回文件路径
 * HtmlWrapper 只接路径不接字符串（它要按 CSS 文件所在目录解析 url() 里的相对资源），而 buildCss() 出的是字符串。
 * 文件名带 scale：同一进程里出图走 SCALE、预览走 1，两者内容不同，共用一个名字会互相覆盖。
 * 内容不变就不重写：CSS 一份 16KB 上下（实测 16099 字节），连着出几张图会写几次同样的字节。
 */
function cssFileFor(palette, scale) {
    const css = buildCss(palette, scale);
    fs.mkdirSync(HTML_DIR, { recursive: true });
    const file = join(HTML_DIR, `style-${String(scale).replace(".", "_")}.css`);
    let same = false;
    try {
        same = fs.readFileSync(file, "utf8") === css;
    }
    catch {
        // 首次渲染时文件还不存在，当作不同，照写
    }
    if (!same)
        fs.writeFileSync(file, css);
    return file;
}
/**
 * @description 拼出一张自包含的整页 HTML，骨架由 @karinjs/template-react 的 HtmlWrapper 生成
 * #container 是必需的：本体截图取 #container，取不到才回落 body，而回落会连页面外边距一起截。
 * title 由 headExtra 补（wrapContent 不输出 <title>）：它不影响画面，但预览页在浏览器里开着时标签页全是
 * 空白。body 不转义 —— 它是 SSR 的产物，React 已经转义过文本节点。
 * 注意：不传 ctx.theme —— themeVariables() 会往 <html>/<body> 的 style 上写 --background 等变量，而那批
 * 变量名与 theme.ts 定义的是同一套，传了就会以内联样式的优先级盖掉 :root 里那份，深浅两套主题反而失效。
 * 导出是给 test/preview.mjs 用：预览页与真正出的图必须是同一个骨架，否则「预览里对、出图错」不会有人发现。
 */
export function buildHtml(title, cssPath, body) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const wrapper = new HtmlWrapper({
        cssPath,
        headExtra: `<title>${esc(title)}</title>`,
    });
    return wrapper.wrapContent(body, { scale: 1 });
}
/**
 * @description 清掉本体对我们这份 HTML 的模板缓存
 * 注意：本体 Renderer.dealTpl 把模板文本按路径缓存且永不失效，而我们每次渲染都重写同一个文件 —— 不清缓存
 * 第二次开始读到的还是首次那份，页面数据变了图却纹丝不动，且不报任何错。
 * 注意：反过来「每次换一个新文件名」也不行 —— 那条分支还会 this.watch(tplFile) 注册一个 chokidar watcher，
 * 路径无限增长时缓存和 watcher 一起泄漏。所以取「固定路径 + 渲染前删缓存」。
 * 拿不到 puppeteer.html 时静默跳过：最坏结果是图不刷新，不该因此让整个渲染失败。
 */
function evictTplCache(tplFile) {
    try {
        const cache = puppeteer?.html;
        if (cache && typeof cache === "object")
            delete cache[tplFile];
    }
    catch {
        // 同上：缓存清不掉不影响本次出图，不打断流程
    }
}
/**
 * @description 渲染成图片消息段
 * @returns 可直接 e.reply 的消息段（multiPage 时为数组）；失败返回 false
 */
export async function render(opts) {
    const pp = await getPuppeteer();
    const shot = opts.multiPage ? pp?.screenshots : pp?.screenshot;
    if (!shot)
        return false;
    // 注意：一次渲染只取一次调色板 —— 若 view 与 buildCss 各自调 pickPalette()，恰好跨过 6:00/18:00 边界
    // 的那一次出图会拿到两套颜色（组件内联 style 一套字面量，样式表的 :root 变量另一套）
    const palette = pickPalette();
    // SSR + 拼壳 + 写盘一步到位。传的是一张现构的「路由 -> 组件」表而不是 ktr sync 生成的注册表，理由见文件头。
    // 组件签名是 ({data, ctx}) => Element，本插件的 view 只要调色板，所以在这里闭包掉，不走它的 data 通道。
    // htmlFileName 固定成页面名：默认行为（'fixed'）会把路由里的 / 换成 _，出来是 gscore_help.html
    const renderHtml = createRenderer({ [opts.name]: { name: opts.title, component: () => opts.view(palette) } }, {
        cssPath: cssFileFor(palette, SCALE),
        outputDir: HTML_DIR,
        htmlFileName: () => opts.name,
        html: { headExtra: `<title>${opts.title.replace(/</g, "&lt;")}</title>` },
    });
    // 它把异常收进返回值而不是抛出，所以判 success 而不是 try/catch
    const res = await renderHtml(opts.name, {});
    if (!res.success) {
        makeLog("error", ["组件渲染失败", res.error], "GsCore");
        return false;
    }
    const tplFile = res.htmlPath;
    evictTplCache(tplFile);
    const data = {
        tplFile,
        // saveId 决定 temp/html 下的文件名。同名会互相覆盖，按用途区分即可
        saveId: opts.name,
        // jpeg 而非 png：整页是渐变照片式背景（深浅两套都是），png 无损存这种内容
        // 体积极大（帮助页 5.8MB → 600KB 上下），质量 92 下看不出差别，也不需要透明通道
        imgType: "jpeg",
        /*
         * quality 82 而非 88：压花玻璃之后体积翻了几倍，这是唯一不动设计的压缩旋钮
         *
         * 实测（scale 1.25，1800×3565）帮助页 COOL 2409KB，而把高光层整个关掉只有 527KB —— 这层纹理占了
         * 体积的 78%，它是这版设计的主体，不能删。剩下的旋钮里 quality 是唯一不改观感的（JPEG 在高频纹理上
         * 的块效应正好被纹理本身盖住）：q88 2409KB / q82 1877KB / q76 1533KB / q70 1320KB。
         * 停在 82：76 起纹理的细鳞片开始被抹平，那是在削这版设计要的东西。
         *
         * 另一个旋钮记在这里，别再重新试一遍：
         * SCALE 1.25→1.0 能到 1627KB，代价是 QQ 里放大看文字会糊。耗时与 quality 无关（各档都在 680~700ms）。
         */
        quality: 82,
        pageGotoParams: { waitUntil: "load" },
        multiPage: opts.multiPage,
    };
    // 本体 Renderer.dealTpl 把 temp/html/{name} 的 mkdir 放在了「模板未缓存」分支里，而保存路径是按 name
    // 分目录的。现在那条分支每次都会走到、本体自己也会建目录，但仍然自己建一次：那个顺序是本体的实现细节
    // （createDir 恰好排在 readFileSync 之前），依赖它等于把我们的正确性押在别人的语句顺序上。
    const shotName = `${PluginName}-${opts.name}`;
    fs.mkdirSync(join(YunzaiPath, "temp", "html", shotName), { recursive: true });
    const img = await shot.call(pp, shotName, data);
    if (!img)
        makeLog("error", `渲染 ${opts.name} 失败`, "GsCore");
    return img;
}
export { pickPalette, COOL, LIGHT };
