/**
 * 媒体转换工具
 *
 * 云崽文件字段 <-> 早柚核心媒体串（base64:// 与 link:// 两种形式）
 */
import { join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { config, onConfigReload } from "../config/index.js";
import { YunzaiPath } from "../dir.js";
import { logStr } from "./logger.js";
import { makeLog, toStr, toBuffer, fileToUrl } from "./compat.js";
import { serveFile, fileServerEnabled } from "./fileServer.js";
/**
 * 消息段里的流先读成 Buffer
 *
 * `Bot.Buffer` 不认流：非 Buffer 入参一律 `String(data)`（lib/util.js:274），
 * 流会变成 `[object Object]` 再当文件路径去 stat，产出的是一张坏图而不是报错。
 * 所以在媒体转换的入口就把流读掉，下游只见 `FileLike`。
 *
 * 按能力探测而不是 `instanceof Readable`：跨 realm（不同 node_modules 副本里的
 * stream 模块）时 instanceof 会失手，而「有 pipe 且可迭代」是流的稳定特征。
 */
async function readStream(file) {
    // 返回字面量而不是 file：strictNullChecks 关着，`== null` 不会把
    // null/undefined 从类型里收窄掉，直接 return file 仍是 MediaInput
    if (file == null)
        return null;
    if (typeof file === "string")
        return file;
    if (Buffer.isBuffer(file))
        return file;
    const s = file;
    if (typeof s?.pipe !== "function" && typeof s?.[Symbol.asyncIterator] !== "function") {
        // 既不是 FileLike 也不是流。到这里说明段里塞了个我们读不了的东西，
        // 与其交给 toBuffer 去 String 成 "[object Object]" 当路径 stat（坏图），
        // 不如在这里就判失败 —— 报出来才查得到是哪个适配器给的什么。
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
 * 自定义图床上传钩子
 *
 * 框架没有 Bot.fileToUrl（如 Miao-Yunzai）时的补救路径。没有 HTTP 文件服务
 * 就没有外链可给，但**用户自己有图床**时可以补上这一环。
 *
 * 配置 `upload_hook` 指向一个 js/ts 模块，默认导出一个函数：
 *   export default async (buf, name) => "https://图床/xxx.png"
 * 返回 http(s) 链接即视为成功；返回空/抛错则视为失败，走原降级逻辑。
 *
 * 只在真正需要外链时才加载（超过 media_max_size 且框架没有 fileToUrl），
 * 加载后缓存，避免每张图都读盘。
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
/** 重载配置时清掉缓存，让新的 upload_hook 生效 */
export function resetUploadHook() {
    uploadHook = undefined;
}
onConfigReload(resetUploadHook);
/**
 * 云崽文件字段 -> 早柚核心媒体串
 * 小文件走 base64://，http 外链或超限文件走 link://
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
        return `link://${s}`;
    // file:// 路径：转成云崽自身的文件服务外链
    try {
        return `link://${await fileToUrl(s, { name, time: linkExpire() })}`;
    }
    catch (err) {
        // 框架没有文件服务（Miao）时依次降级：内置文件服务 -> 用户图床
        const url = await viaFallback(s, name);
        if (url)
            return `link://${url}`;
        makeLog("error", ["生成外链失败", s, err], "GsCore");
        return "";
    }
}
/**
 * 没有 Bot.fileToUrl 时的降级链
 *
 * 1. 内置文件服务（默认开，零配置即可用）
 * 2. 用户自己的图床 upload_hook（内置服务被关掉或起不来时）
 *
 * 顺序理由：内置服务不需要用户做任何事，先试它；图床要用户自己搭，
 * 但它给的是公网地址，内网穿透场景下更可靠，所以保留为显式后备。
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
 * 走自定义图床。返回空字符串表示没配或失败。
 * 到这一步说明内置文件服务不可用（被关掉或端口起不来），
 * 提示里要把两条路都说清楚，用户才知道该修哪个。
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
 * file 段协议规定必须是 `{文件名}|{裸base64}`，没有 URL 形式，
 * 所以只能读全量。加硬上限防止 OOM。
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
        makeLog("warn", `file 段 ${(buf.length / 1048576).toFixed(1)}MB 超过上限 ${(fileMaxSize() / 1048576).toFixed(1)}MB，已跳过`, "GsCore");
        return "";
    }
    return `${name || `${Date.now().toString(36)}.dat`}|${buf.toString("base64")}`;
}
/**
 * 早柚核心媒体串 -> 云崽可用的 file 值
 * 注意：不要照抄 ws-plugin 的 /^(http|base64|link)/ ——
 * 该正则未锚定协议分隔符，恰好以 link 开头的裸 base64 会被误判
 *
 * 返回 `string | Buffer` 而不是 `string`：Buffer 入参原样返回是有意的
 * （下游 segment.image/record/video 都收 Buffer，转成 base64 只是白绕一圈），
 * 声明成 string 属于签名与实现不符。协议里 data 恒为字符串，Buffer 那路
 * 只服务于把本函数当工具用的外部调用方。
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
    // data: URI 必须转成 base64://，不能原样放行。
    //
    // 下游没有一处认它：
    //   - icqq 的 Image 构造器（lib/message/image.js:98-115）只认 Buffer /
    //     Readable / base64:// / http(s):// / 其余按本地路径走 fromLocal，
    //     data: 会掉进 fromLocal 当文件名去 stat，必然失败
    //   - 框架的 Bot.Buffer（lib/util.js）同样只认那几种
    //   - Milky 的 fixUri 也不识别，原样透给协议端
    // 而 base64:// 是三者都认的形式，data: 的载荷本身就是 base64，转过去零成本。
    //
    // 只处理 ;base64, 形式：data:text/plain,foo 这种 URL 编码的载荷不是媒体，
    // 转过去只会得到一张坏图，不如照旧原样放行让下游报错更容易查。
    const m = /^data:[^,]*;base64,/.exec(s);
    if (m)
        return `base64://${s.slice(m[0].length)}`;
    if (/^(base64:\/\/|https?:\/\/|file:\/\/|data:)/.test(s))
        return s;
    return `base64://${s}`; // 裸 base64
}
