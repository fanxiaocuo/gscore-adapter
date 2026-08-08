/**
 * 图片资源 -> data URI
 *
 * 为什么不直接写 <img src="file:///.../logo.png">：
 * 本体把渲染用的 HTML 写到 temp/html/{name}/ 下再让 puppeteer 打开
 * （lib/renderer/Renderer.js），相对路径的基准是那个临时目录而不是插件目录，
 * 绝对 file:// 路径又要处理 Windows 盘符与中文路径的转义。内联成 data URI
 * 之后页面完全自包含，和 styles.ts 内联 CSS 是同一个理由。
 *
 * MIME 按魔数嗅探而不是按扩展名：resources/template/image/frame-logo.png 实际是 JPEG
 * （开头 ff d8），扩展名是错的。写死 image/png 的话 Chromium 仍能靠嗅探显示出来，
 * 但 data URI 的声明与内容不一致，属于埋着的坑，这里一次性判对。
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
/** 插件图标（早柚），用于 #早柚版本 的主视觉 */
export const PLUGIN_LOGO = "logo.png";
/** 框架图标，用于页脚角标 */
export const FRAME_LOGO = "frame-logo.png";
