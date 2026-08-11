/**
 * 图片资源 -> data URI
 *
 * 为什么不直接写 <img src="file:///.../logo.png">：
 * 本体把渲染用的 HTML 写到 temp/html/{name}/ 下再让 puppeteer 打开
 * （lib/renderer/Renderer.js），相对路径的基准是那个临时目录而不是插件目录，
 * 绝对 file:// 路径又要处理 Windows 盘符与中文路径的转义。内联成 data URI
 * 之后页面完全自包含，和 styles/ 内联 CSS 是同一个理由。
 *
 * MIME 按魔数嗅探而不是按扩展名：母版 resources/template/image/frame-logo.png
 * 实际是 JPEG（开头 ff d8），扩展名是错的。写死 image/png 的话 Chromium 仍能靠
 * 嗅探显示出来，但 data URI 的声明与内容不一致，属于埋着的坑，这里一次性判对。
 * 页面现在引用的是转好的 .webp，但这条判断照旧留着——母版还在，将来换图时
 * 同样的坑还会有。
 */
import fs from "node:fs";
import { join } from "node:path";
import { ResPath } from "../../dir.js";
import { makeLog } from "../../utils/compat.js";
/** 按魔数判 MIME，认不出返回空串 */
function sniff(buf) {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
        return "image/jpeg";
    if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47)
        return "image/png";
    if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF")
        return "image/webp";
    if (buf.length >= 6 && buf.subarray(0, 3).toString("latin1") === "GIF")
        return "image/gif";
    return "";
}
/** 已读过的资源。图片在进程生命周期里不会变，读一次就够 */
const cache = new Map();
/**
 * 读 resources/template/image/<name> 并转成 data URI
 * @returns data URI；文件不存在或格式认不出返回空串（调用方据此不渲染 <img>）
 */
export function imageDataUri(name) {
    const hit = cache.get(name);
    if (hit !== undefined)
        return hit;
    let uri = "";
    try {
        const buf = fs.readFileSync(join(ResPath, "template", "image", name));
        const mime = sniff(buf);
        if (mime)
            uri = `data:${mime};base64,${buf.toString("base64")}`;
        else
            makeLog("warn", `资源 ${name} 不是可识别的图片格式，已跳过`, "GsCore");
    }
    catch {
        // 资源缺失不该让整张图渲染失败，静默降级成不显示
    }
    cache.set(name, uri);
    return uri;
}
/**
 * 插件图标（早柚），用于 #早柚版本 的主视觉与页脚角标
 *
 * 512×512 的 WebP，40KB。原先是 1024² 的 PNG，769KB——base64 之后 1.03MB，
 * 而**每个页面**都内联一份（页脚在 Layout 里，四页都有）。整页 HTML 于是有
 * 1.07MB，其中 96% 是这张图，puppeteer 每次出图都要解一遍 base64、解码 1024²
 * 位图，再缩到实际显示的一两百像素。
 *
 * 512 够用且有余量：页面上最大的用法是关于页的主视觉 200px，zoom 1.5 后
 * 300 实际像素（页脚那处是 80×1.12，134px）。
 *
 * 换 WebP 而不是只缩尺寸：这张图是带柔边渐变的插画而非纯字形（实测 6 万种
 * RGBA、41 万半透明像素），PNG 存它很不划算——同样 512px 的 PNG 要 191KB，
 * WebP q90 只要 40KB，看不出差别。Chromium 原生支持，sniff() 也已经认 WebP。
 *
 * 转换是一次性的，产物入库，运行时不依赖任何图片库（宿主的 sharp/jimp 都只是
 * 间接依赖，不保证在）。要再生成的话：
 *   sharp(logo.png).resize(512,512).webp({quality:90})
 * 原始 1024² PNG 留在库里作为母版，页面不再引用它。
 */
export const PLUGIN_LOGO = "logo.webp";
/**
 * 框架图标，用于页脚角标
 *
 * 同上转成 256×256 WebP（11KB，原 398² JPEG 19KB）。页脚只画 80px，256 是
 * 两倍余量。这张源图不透明，转出来也没有 alpha，与原先一致。
 *
 * 注意源文件 frame-logo.png 的扩展名是错的，内容其实是 JPEG（开头 ff d8）
 * ——sniff() 按魔数判 MIME 就是为了这个，母版留着不动。
 */
export const FRAME_LOGO = "frame-logo.webp";
