/**
 * @description 媒体转换工具：云崽文件字段 <-> 早柚核心媒体串
 * 上行（toGscoreMedia）用裸 http(s) URL 或 base64://；下行（fromGscoreMedia）额外兼容
 * 核心 MessageSegment 使用的 link:// 外链标记。
 */
import { join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { config, onConfigReload } from "../config/index.js";
import { YunzaiPath } from "../dir.js";
import { logStr } from "./logger.js";
import { makeLog, toStr, toBuffer, fileToUrl } from "./compat.js";
import { serveFile, fileServerEnabled } from "./fileServer.js";
/**
 * @description 消息段里的流先读成 Buffer，下游只见 `FileLike`
 * 注意：`Bot.Buffer` 不认流（非 Buffer 一律 `String(data)`，lib/util.js:274），流会变成
 * `[object Object]` 再当路径去 stat，产出坏图而不是报错。
 * 按能力探测（有 pipe 且可迭代）而不是 `instanceof Readable` —— 跨 realm 时 instanceof 会失手。
 */
async function readStream(file) {
    // 注意：返回字面量而不是 file —— strictNullChecks 关着，`== null` 不会把 null/undefined 收窄掉
    if (file == null)
        return null;
    if (typeof file === "string")
        return file;
    if (Buffer.isBuffer(file))
        return file;
    const s = file;
    if (typeof s?.pipe !== "function" && typeof s?.[Symbol.asyncIterator] !== "function") {
        // 读不了的东西在这里就判失败：交给 toBuffer 会 String 成 "[object Object]" 当路径 stat（坏图）
        makeLog("warn", ["媒体段既不是路径/Buffer 也不是流，已跳过", logStr(s)], "GsCore");
        return null;
    }
    try {
        const chunks = [];
        for await (const c of s)
            chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        return Buffer.concat(chunks);
    }
    catch (err) {
        makeLog("warn", ["读取流失败，已跳过该段", err], "GsCore");
        return null;
    }
}
export function mediaMaxSize() {
    return Number(config.media_max_size) || 10485760;
}
export function fileMaxSize() {
    return Number(config.file_max_size) || 52428800;
}
export function linkExpire() {
    return Number(config.link_expire) || 300000;
}
/**
 * @description 自定义图床上传钩子的缓存，框架没有 Bot.fileToUrl（如 Miao-Yunzai）时的补救路径
 *
 * 配置 `upload_hook` 指向一个 js/ts 模块，默认导出 `async (buf, name) => "https://图床/xxx.png"`；
 * 返回 http(s) 链接即成功，返回空/抛错则走原降级逻辑。只在真正需要外链时加载并缓存。
 * 注意：三态有意义 —— undefined = 还没加载过，null = 没配或加载失败（不再重试），函数 = 已加载。
 */
let uploadHook;
async function getUploadHook() {
    if (uploadHook !== undefined)
        return uploadHook;
    const p = String(config.upload_hook || "").trim();
    if (!p)
        return (uploadHook = null);
    try {
        // 相对路径按云崽根目录解析，与配置文件里其它路径的习惯一致
        const abs = isAbsolute(p) ? p : join(YunzaiPath, p);
        const mod = await import(pathToFileURL(abs).href);
        const fn = mod.default || mod.upload;
        if (typeof fn !== "function") {
            makeLog("error", `upload_hook ${p} 没有默认导出函数，已忽略`, "GsCore");
            return (uploadHook = null);
        }
        makeLog("info", `已加载自定义图床 ${p}`, "GsCore");
        return (uploadHook = fn);
    }
    catch (err) {
        makeLog("error", ["加载 upload_hook 失败，已忽略", p, err], "GsCore");
        return (uploadHook = null);
    }
}
/** @description 重载配置时清掉缓存，让新的 upload_hook 生效 */
export function resetUploadHook() {
    uploadHook = undefined;
}
onConfigReload(resetUploadHook);
/**
 * @description 云崽文件字段 -> 早柚核心入站媒体串：小文件走 base64://，HTTP 外链或超限文件走裸 http(s) URL
 * 注意：link:// 只是核心构造**下行** MessageSegment 的标记，不能用于上行事件媒体。
 */
export async function toGscoreMedia(input, name) {
    // 段里可能带流，先读成 Buffer —— 理由见 readStream
    const file = await readStream(input);
    if (file == null || file === "")
        return "";
    const data = await toBuffer(file, { http: true, size: mediaMaxSize() });
    // Bot.Buffer 三路返回：Buffer / http URL 原样 / 超限落盘的 file:// 路径
    if (Buffer.isBuffer(data))
        return `base64://${data.toString("base64")}`;
    const s = toStr(data);
    if (/^https?:\/\//.test(s))
        return s;
    // file:// 路径：转成云崽自身的文件服务外链
    try {
        return await fileToUrl(s, { name, time: linkExpire() });
    }
    catch (err) {
        // 框架没有文件服务（Miao）时依次降级：内置文件服务 -> 用户图床
        const url = await viaFallback(s, name);
        if (url)
            return url;
        makeLog("error", ["生成外链失败", s, err], "GsCore");
        return "";
    }
}
/**
 * @description 没有 Bot.fileToUrl 时的降级链：先内置文件服务（零配置即可用），再用户自己的图床 upload_hook
 * 图床要用户自己搭，但给的是公网地址，内网穿透场景更可靠，所以保留为显式后备。
 */
async function viaFallback(pathOrUrl, name) {
    if (fileServerEnabled()) {
        try {
            const buf = await toBuffer(pathOrUrl);
            if (Buffer.isBuffer(buf)) {
                const url = await serveFile(buf, name);
                if (url)
                    return url;
            }
        }
        catch (err) {
            makeLog("warn", ["内置文件服务挂载失败，尝试图床", err], "GsCore");
        }
    }
    return viaUploadHook(pathOrUrl, name);
}
/**
 * @description 走自定义图床，返回空字符串表示没配或失败
 * 到这一步说明内置文件服务也不可用，所以提示里把两条路都说清楚。
 */
async function viaUploadHook(pathOrUrl, name) {
    const fn = await getUploadHook();
    if (!fn) {
        makeLog("warn", "当前框架没有 Bot.fileToUrl（文件服务），且内置文件服务不可用，大文件无法生成外链。\n" +
            "可开启 file_server（默认开启，检查是否被关闭或端口被占用），" +
            "或设置 upload_hook 指向自己的图床模块，" +
            "或调大 media_max_size 让其走 base64（占内存）。", "GsCore");
        return "";
    }
    try {
        const buf = await toBuffer(pathOrUrl);
        if (!Buffer.isBuffer(buf))
            return "";
        const url = String((await fn(buf, name)) || "");
        if (/^https?:\/\//.test(url))
            return url;
        makeLog("error", ["图床未返回 http 链接，已跳过该段", url], "GsCore");
        return "";
    }
    catch (err) {
        makeLog("error", ["图床上传失败", err], "GsCore");
        return "";
    }
}
/**
 * @description 云崽文件字段 -> 核心 file 段的 `{文件名}|{裸base64}`
 * 协议没有 URL 形式，只能读全量，所以加硬上限防 OOM。
 */
export async function toGscoreFile(input, name) {
    const file = await readStream(input);
    if (file == null || file === "")
        return "";
    const buf = await toBuffer(file);
    if (!Buffer.isBuffer(buf)) {
        makeLog("warn", ["file 段读取失败，已跳过", logStr(file)], "GsCore");
        return "";
    }
    if (buf.length > fileMaxSize()) {
        makeLog("warn", `file 段 ${(buf.length / 1048576).toFixed(1)}MiB 超过上限 ${(fileMaxSize() / 1048576).toFixed(1)}MiB，已跳过`, "GsCore");
        return "";
    }
    return `${name || `${Date.now().toString(36)}.dat`}|${buf.toString("base64")}`;
}
/**
 * @description 早柚核心媒体串 -> 云崽可用的 file 值
 * 注意：不要照抄 ws-plugin 的 /^(http|base64|link)/ —— 未锚定协议分隔符，恰好以 link 开头的裸 base64 会被误判。
 * 注意：返回 `string | Buffer` 是有意的 —— Buffer 入参原样返回（下游 segment.image/record/video 都收
 * Buffer），协议里 data 恒为字符串，Buffer 那路只服务把本函数当工具用的外部调用方。
 */
export function fromGscoreMedia(data) {
    if (Buffer.isBuffer(data))
        return data;
    let s = toStr(data ?? "");
    if (s.startsWith("link://")) {
        s = s.slice(7);
        if (!/^https?:\/\//.test(s))
            s = `http://${s}`;
        return s;
    }
    // 注意：data: URI 必须转成 base64://，下游没有一处认它 —— icqq 的 Image 构造器
    // （lib/message/image.js:98-115）、框架的 Bot.Buffer、Milky 的 fixUri 都不识别，
    // data: 会掉进 fromLocal 当文件名去 stat。base64:// 三者都认，载荷本身就是 base64，转过去零成本。
    // 只处理 ;base64, 形式：data:text/plain,foo 不是媒体，原样放行让下游报错更容易查。
    const m = /^data:[^,]*;base64,/.exec(s);
    if (m)
        return `base64://${s.slice(m[0].length)}`;
    if (/^(base64:\/\/|https?:\/\/|file:\/\/|data:)/.test(s))
        return s;
    return `base64://${s}`; // 裸 base64
}
