/**
 * @description 内置文件服务：框架没有 Bot.fileToUrl（Miao-Yunzai）时自己起一个 HTTP 服务把大文件挂出去，让核心能拉取
 *
 * 设计要点：懒启动（只有真需要外链才监听端口）、内存暂存 + 到期自动清（不落盘）、
 * 随机 token 路径（不可枚举）、一次性（核心取走即删，可配）。
 * 注意：不用 express —— Miao 根本没装（lib/tools/web.js 那句 import 是孤儿脚本），
 * 照着它写会在真机上 ERR_MODULE_NOT_FOUND。node:http 零依赖，同样够用。
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import { config } from "../config/index.js";
import { makeLog } from "./compat.js";
const files = new Map();
let server = null;
let starting = null;
function fsConf() {
    return config.file_server || {};
}
/** @description 内置文件服务是否可用（未显式关闭） */
export function fileServerEnabled() {
    return fsConf().enable !== false;
}
/**
 * @description 扩展名 → Content-Type，只覆盖早柚核心实际会走的几类媒体
 * 核心侧（PIL / 浏览器）主要靠它决定怎么解码，给错了会拿不到图；其余给 octet-stream。
 */
const MIME = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    amr: "audio/amr",
    silk: "audio/silk",
    mp4: "video/mp4",
    mov: "video/quicktime",
};
function guessType(name) {
    const ext = String(name || "")
        .split(".")
        .pop()
        ?.toLowerCase();
    return (ext && MIME[ext]) || "application/octet-stream";
}
/**
 * @description 起服务，失败不抛错（调用方会降级到 upload_hook 或跳过该段）
 * 一个端口占不到不该让消息发送整体崩掉。
 */
function start() {
    if (server?.listening)
        return Promise.resolve(server);
    if (starting)
        return starting;
    starting = new Promise(resolve => {
        const srv = http.createServer(handle);
        let settled = false;
        // 注意：error 在启动失败与运行期都会触发，只有前者算「起不来」。
        // 已 listening 之后再报错不能把服务置空，否则后续请求全部走降级。
        srv.on("error", err => {
            if (settled) {
                makeLog("warn", ["内置文件服务运行时错误", err], "GsCore");
                return;
            }
            settled = true;
            makeLog("error", ["内置文件服务启动失败，大文件将无法生成外链", err], "GsCore");
            srv.close();
            server = null;
            starting = null;
            resolve(null);
        });
        // host 默认 0.0.0.0：核心常跑在 Docker / 另一台机器上，只听 127.0.0.1 它连不进来
        const port = Number(fsConf().port) || 0;
        const host = String(fsConf().host || "0.0.0.0");
        srv.listen(port, host, () => {
            settled = true;
            server = srv;
            starting = null;
            // unref：文件服务是附属设施，不该成为「进程不肯退出」的原因
            srv.unref?.();
            const p = srv.address()?.port;
            makeLog("info", `内置文件服务已启动 ${host}:${p}（仅用于大文件外链）`, "GsCore");
            resolve(srv);
        });
    });
    return starting;
}
function handle(req, res) {
    const id = String(req.url || "")
        .split("?")[0]
        .replace(/^\/+/, "");
    const item = files.get(id);
    if (!item || item.expire < Date.now()) {
        res.writeHead(404).end("404");
        return;
    }
    res.writeHead(200, {
        "Content-Type": item.type,
        "Content-Length": String(item.buf.length),
        // 外链是一次性临时地址，别让任何中间层缓存
        "Cache-Control": "no-store",
    });
    // HEAD 只要头部，不写 body
    if (req.method === "HEAD")
        res.end();
    else
        res.end(item.buf);
    // 取走即删：核心已经拿到内容，留着只是扩大重放窗口。核心侧会重试的可把 once 关掉。
    if (fsConf().once !== false)
        drop(id);
}
function drop(id) {
    const item = files.get(id);
    if (!item)
        return;
    clearTimeout(item.timer);
    files.delete(id);
}
/**
 * @description 对外地址的 host：优先配置里的 public_host，没配就用已连上的 ws 的本地地址
 * 那正是能路由到核心的那张网卡；硬写 127.0.0.1 在核心跑 Docker / 另一台机器时指向的是它自己。
 */
function publicHost() {
    const conf = String(fsConf().public_host || "").trim();
    if (conf)
        return conf;
    // ::ffff:192.168.1.5 这种 v4-mapped 地址剥掉前缀
    const v4 = localHint.replace(/^::ffff:/, "");
    if (v4 && v4 !== "::" && v4 !== "0.0.0.0" && !v4.startsWith("127.")) {
        // 裸 IPv6 做 URL host 要加方括号
        return v4.includes(":") ? `[${v4}]` : v4;
    }
    return "127.0.0.1";
}
/**
 * @description ws 连接的本地地址，由客户端在连上时写入，用于推断外链 host
 * 放模块级而不透传参数：「外链该用哪个 host」是传输层的事，消息转换层不该为此改签名。
 * 多条连接时后连上的覆盖前者（通常同网段），真要区分就配 public_host。
 */
let localHint = "";
/** @description 记录 ws 本地地址，用于推断外链 host */
export function setLocalHint(addr) {
    const s = String(addr || "").trim();
    if (s)
        localHint = s;
}
/**
 * @description 把内容挂上去，返回 http 外链
 *
 * @param buf  文件内容
 * @param name 原文件名，用于猜 Content-Type
 * @returns http 链接；服务起不来时返回空串
 */
export async function serveFile(buf, name) {
    const srv = await start();
    if (!srv)
        return "";
    const ttl = Number(config.link_expire) || 300000;
    const id = `${randomBytes(16).toString("hex")}${name ? `/${encodeURIComponent(name)}` : ""}`;
    const timer = setTimeout(() => files.delete(id), ttl);
    // 定时器不该拖着进程不退出
    timer.unref?.();
    files.set(id, {
        buf,
        name,
        type: guessType(name),
        expire: Date.now() + ttl,
        timer,
    });
    const port = srv.address()?.port;
    return `http://${publicHost()}:${port}/${id}`;
}
/** @description 当前暂存文件数，供 #早柚状态 显示 */
export function pendingFiles() {
    return files.size;
}
