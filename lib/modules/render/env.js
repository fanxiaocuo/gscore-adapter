/**
 * @description 运行环境探测：跑在哪个框架上、框架什么版本、Node 什么版本，供页脚角标与 #早柚版本 共用
 * 框架判定沿用 kkk 的做法 —— 看 `Bot.uin` 是不是数组（TRSS 支持多账号存成数组，Miao 继承 ICQQ 是单个数字）。
 * 注意：不看目录名或 package.json 的 name —— 目录名由用户随意取（本机这台就叫 `Yunzai`，跑的是 TRSS），
 * name 则 fork 改名即失效；uin 的形状是架构差异，改名改不掉。
 * 注意：这里只用于显示。功能上该走哪条兼容路径仍由 utils/compat.ts 逐个方法探测决定。
 */
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { YunzaiPath } from "../../dir.js";
import { branch } from "./version.js";
/**
 * @description 跑在哪个框架上
 * 注意：绝不能缓存 —— 判据 Bot.uin 要等框架挂上 Bot 才有，早一步缓存就把 TRSS 永久标成喵崽，而目录名与
 * package.json 都帮不上忙（如文件头所说），肉眼看不出来。
 */
export function frameName() {
    try {
        if (Array.isArray(globalThis.Bot?.uin))
            return "TRSS-Yunzai";
    }
    catch {
        // Bot 未初始化（单测、CI）时按喵崽算
    }
    return "Miao-Yunzai";
}
/** @description 框架 package.json 里的版本号，读一次就够（同 styles/index.ts 的缓存理由） */
let verCache;
/**
 * @description 框架版本，读框架根目录的 package.json；读不到返回空串
 * 缓存省掉重复读盘：每页只渲一个 Footer（它把 frameLabel() 写成默认参数），但状态页与关于页另有一行也要
 * 这个值，所以一次出图最多求值两次。
 */
export function frameVersion() {
    if (verCache !== undefined)
        return verCache;
    try {
        const pkg = JSON.parse(fs.readFileSync(join(YunzaiPath, "package.json"), "utf8"));
        verCache = String(pkg.version || "");
    }
    catch {
        verCache = "";
    }
    return verCache;
}
/** @description Node 版本，去掉前缀 v */
export function nodeVersion() {
    return process.versions.node;
}
/** @description 框架名 + 版本，拼成角标那一行；没版本号时只给名字 */
export function frameLabel() {
    const v = frameVersion();
    return v ? `${frameName()} v${v}` : frameName();
}
const RELEASE_BRANCH = {
    release: "Stable",
    preview: "Preview",
    main: "Dev",
    master: "Dev",
};
export function releaseType(_version) {
    return RELEASE_BRANCH[branch] || "Preview";
}
/** @description 角标上那两个字 */
export function releaseLabel(t = releaseType()) {
    return t === "Stable" ? "正式版" : t === "Dev" ? "开发版" : "预览版";
}
/** @description 字节数转可读单位，保留一位小数 */
export function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0)
        return "0 B";
    const u = ["B", "KiB", "MiB", "GiB", "TiB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
/** @description 秒数转 3天4小时 这样的时长 */
export function formatDuration(sec) {
    const s = Math.max(0, Math.floor(sec));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d)
        return `${d} 天 ${h} 小时`;
    if (h)
        return `${h} 小时 ${m} 分`;
    if (m)
        return `${m} 分 ${s % 60} 秒`;
    return `${s} 秒`;
}
/**
 * @description 采集本机运行信息
 * 注意：隐私边界照 kkk 的 collectRuntimeReport —— 这张图会发到群里，所以只取「机器性能」类信息，不读
 * hostname、os.userInfo()、网卡地址、环境变量内容、启动参数，也不读任何连接的 token。
 * 加字段前先想一遍：这条信息发到群里会不会暴露机主。
 */
export function sysInfo() {
    const cpus = os.cpus() || [];
    const total = os.totalmem();
    const used = Math.max(0, total - os.freemem());
    return {
        os: `${os.type()} ${os.release()}`,
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: cpus[0]?.model?.trim() || "未知处理器",
        cpuCores: cpus.length,
        totalMemory: formatBytes(total),
        usedMemory: formatBytes(used),
        memoryPercent: total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0,
        processRss: formatBytes(process.memoryUsage().rss),
        systemUptime: formatDuration(os.uptime()),
        processUptime: formatDuration(process.uptime()),
    };
}
