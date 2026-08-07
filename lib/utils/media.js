/**
 * 媒体转换工具
 *
 * 云崽文件字段 <-> 早柚核心媒体串（base64:// 与 link:// 两种形式）
 */
import { config } from "../config/index.js";
import { logStr } from "./logger.js";
/**
 * @types/trss-yunzai 把 fileToUrl 拼成了 fileToUrll（多一个 l），
 * 框架实际方法名见 lib/bot.js:274 —— 以框架源码为准，不迁就上游错拼。
 *
 * 不能用 declare global 补 Yunzai：上游 Yunzai 是模块内的 class 而非 interface，
 * 无法声明合并；且 Bot 的类型是 Yunzai & Utils & Record<string, Client|undefined>，
 * 那个索引签名会把未知属性解析成不可调用的 Client。故在调用点断言。
 */
function fileToUrl(file, opts) {
    return Bot.fileToUrl(file, opts);
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
 * 云崽文件字段 -> 早柚核心媒体串
 * 小文件走 base64://，http 外链或超限文件走 link://
 */
export async function toGscoreMedia(file, name) {
    if (file == null || file === "")
        return "";
    const data = await Bot.Buffer(file, { http: true, size: mediaMaxSize() });
    // Bot.Buffer 三路返回：Buffer / http URL 原样 / 超限落盘的 file:// 路径
    if (Buffer.isBuffer(data))
        return `base64://${data.toString("base64")}`;
    const s = Bot.String(data);
    if (/^https?:\/\//.test(s))
        return `link://${s}`;
    // file:// 路径：转成云崽自身的文件服务外链
    try {
        return `link://${await fileToUrl(s, { name, time: linkExpire() })}`;
    }
    catch (err) {
        Bot.makeLog("error", ["生成外链失败", s, err], "GsCore");
        return "";
    }
}
/**
 * file 段协议规定必须是 `{文件名}|{裸base64}`，没有 URL 形式，
 * 所以只能读全量。加硬上限防止 OOM。
 */
export async function toGscoreFile(file, name) {
    if (file == null || file === "")
        return "";
    const buf = await Bot.Buffer(file);
    if (!Buffer.isBuffer(buf)) {
        Bot.makeLog("warn", ["file 段读取失败，已跳过", logStr(file)], "GsCore");
        return "";
    }
    if (buf.length > fileMaxSize()) {
        Bot.makeLog("warn", `file 段 ${(buf.length / 1048576).toFixed(1)}MB 超过上限 ${(fileMaxSize() / 1048576).toFixed(1)}MB，已跳过`, "GsCore");
        return "";
    }
    return `${name || `${Date.now().toString(36)}.dat`}|${buf.toString("base64")}`;
}
/**
 * 早柚核心媒体串 -> 云崽可用的 file 值
 * 注意：不要照抄 ws-plugin 的 /^(http|base64|link)/ ——
 * 该正则未锚定协议分隔符，恰好以 link 开头的裸 base64 会被误判
 */
export function fromGscoreMedia(data) {
    if (Buffer.isBuffer(data))
        return data;
    let s = Bot.String(data ?? "");
    if (s.startsWith("link://")) {
        s = s.slice(7);
        if (!/^https?:\/\//.test(s))
            s = `http://${s}`;
        return s;
    }
    if (/^(base64:\/\/|https?:\/\/|file:\/\/|data:)/.test(s))
        return s;
    return `base64://${s}`; // 裸 base64
}
