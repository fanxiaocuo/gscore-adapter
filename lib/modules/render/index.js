/**
 * 渲染入口：React SSR -> HTML -> 本体 puppeteer 截图
 *
 * 与 karin-plugin-kkk 的差异
 * ---------------------------
 * kkk 用 React + Tailwind + Vite 在构建期打包出模板包，由它自己的渲染服务
 * （packages/template）加载。本仓库没有这套工具链，也不该为一个适配器插件引入
 * 构建期前端流水线，所以这里：
 *   1. 组件仍用 React 写（可复用 kkk 的版式与 token 思路）
 *   2. 渲染时用 react-dom/server 的 renderToStaticMarkup 直接出静态 HTML —— 页面
 *      没有任何交互，不需要 hydrate，也就不必产出 client bundle
 *   3. 样式手写成一份内联 CSS（styles.ts），保证 file:// 下自包含
 *   4. 最后一步交给本体 lib/puppeteer/puppeteer.js 截图
 *
 * 关于最后一步的接法：本体那个模块的 screenshot() 已经用 segment.image 包好了
 * （puppeteer.js:9-12），返回值可直接 e.reply，所以不必自己碰 renderer/loader。
 */
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { PluginName, ResPath, YunzaiPath } from "../../dir.js";
import { makeLog } from "../../utils/compat.js";
import { buildCss } from "./styles.js";
import { getPalette } from "./theme.js";
/** 固定外壳，见 resources/template/html/shell.html 顶部注释 */
const TPL_FILE = join(ResPath, "template", "html", "shell.html");
/**
 * 高清倍率：1440px 画布出 2160px 宽的图，缩放到聊天窗口后文字边缘仍清晰。
 *
 * 取 1.5 而不是 2：帮助页本身就有 3900px 高，2 倍出图接近 7800px、5.8MB，
 * 不少 QQ 适配器会直接拒发或压成马赛克。1.5 倍文字依旧锐利，体积小一个量级。
 *
 * 用 CSS zoom 而不是 screenshot 的 deviceScaleFactor —— 本体的渲染后端
 * （renderers/puppeteer/lib/puppeteer.js）从没读过 data.deviceScaleFactor，
 * 传了是静默失效，只会拿到 1 倍图；它也只在分片截图时调 setViewport。
 * 而 zoom 会放大 #container 的实际布局盒，body.screenshot() 截的就是放大后的尺寸。
 *
 * 不用 transform:scale：transform 不改变元素的布局尺寸，boundingBox 仍是 1440，
 * 截出来会把画面裁掉一大半。
 */
const SCALE = 1.5;
/** 本体 puppeteer 模块，首次渲染时惰性加载 */
let puppeteer;
/**
 * 取本体截图器
 *
 * 与 apps/update.ts 同一套做法：由 YunzaiPath 拼绝对路径后动态 import。
 * 不写 ../../../../lib/puppeteer/puppeteer.js —— 那样既依赖编译产物的目录深度，
 * 又会让 tsc 去静态解析一个不在本插件仓库里的文件（CI 单独 checkout 时必然 TS2307）。
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
/** 是否用深色主题：跟随本体配置，没有就用深色（海报体系深色更好看） */
function useDark() {
    return true;
}
/**
 * 渲染成图片消息段
 * @returns 可直接 e.reply 的消息段（multiPage 时为数组）；失败返回 false
 */
export async function render(opts) {
    const pp = await getPuppeteer();
    const shot = opts.multiPage ? pp?.screenshots : pp?.screenshot;
    if (!shot)
        return false;
    const palette = getPalette(useDark());
    let body;
    try {
        body = renderToStaticMarkup(opts.view(palette));
    }
    catch (err) {
        makeLog("error", ["组件渲染失败", err], "GsCore");
        return false;
    }
    const data = {
        tplFile: TPL_FILE,
        // saveId 决定 temp/html 下的文件名。同名会互相覆盖，按用途区分即可
        saveId: opts.name,
        title: opts.title,
        css: buildCss(palette, SCALE),
        body,
        // jpeg 而非 png：整页是深色渐变照片式背景，png 无损存这种内容体积极大
        // （帮助页 5.8MB → 600KB 上下），质量 92 下看不出差别，也不需要透明通道
        imgType: "jpeg",
        quality: 92,
        pageGotoParams: { waitUntil: "load" },
        multiPage: opts.multiPage,
    };
    // 本体 Renderer.dealTpl 把 temp/html/{name} 的 mkdir 放在了"模板未缓存"分支里
    // （lib/renderer/Renderer.js:44-46），但保存路径是按 name 分目录的。我们三个页面
    // 共用同一个 shell.html，于是第二个页面开始模板已缓存、目录却没建过，writeFileSync
    // 直接 ENOENT。这里先自己把目录补上，不去改本体。
    const shotName = `${PluginName}-${opts.name}`;
    fs.mkdirSync(join(YunzaiPath, "temp", "html", shotName), { recursive: true });
    const img = await shot.call(pp, shotName, data);
    if (!img)
        makeLog("error", `渲染 ${opts.name} 失败`, "GsCore");
    return img;
}
export { getPalette };
