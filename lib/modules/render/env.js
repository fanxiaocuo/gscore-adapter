/**
 * 运行环境探测
 *
 * 供页脚角标与 #早柚版本 共用：跑在哪个框架上、框架什么版本、Node 什么版本。
 *
 * 框架判定沿用 karin-plugin-kkk 的做法（module/utils/Version.js 的 getBotName）：
 * 看 `Bot.uin` 是不是数组。TRSS 支持多账号，把 uin 存成数组；Miao 的
 * `class Yunzai extends Client` 继承 ICQQ，uin 是单个数字。
 *
 * 为什么不看目录名或 package.json 的 name：
 * 目录名完全不可靠——本仓库所在的框架目录就叫 Miao-Yunzai、实际却是 TRSS，
 * 这正是 utils/compat.ts 开头记的那个反例。package.json 的 name 稍好，
 * 但 fork 改名即失效，而 uin 的形状是两个框架的架构差异，改名改不掉。
 *
 * 注意这里只用于**显示**。功能上该走哪条兼容路径，仍由 utils/compat.ts
 * 逐个方法探测决定——那才是不会被 fork 骗到的判据。
 */
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { YunzaiPath } from "../../dir.js";
import { branch } from "./version.js";
/** 跑在哪个框架上 */
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
/** 框架版本，读框架根目录的 package.json；读不到返回空串 */
export function frameVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(join(YunzaiPath, "package.json"), "utf8"));
        return String(pkg.version || "");
    }
    catch {
        return "";
    }
}
/** Node 版本，去掉前缀 v */
export function nodeVersion() {
    return process.versions.node;
}
/** 框架名 + 版本，拼成角标那一行；没版本号时只给名字 */
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
/** 角标上那两个字 */
export function releaseLabel(t = releaseType()) {
    return t === "Stable" ? "正式版" : t === "Dev" ? "开发版" : "预览版";
}
/** 字节数转可读单位，保留一位小数 */
export function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0)
        return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
/** 秒数转 3天4小时 这样的时长 */
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
 * 采集本机运行信息
 *
 * 隐私边界照 kkk 的 collectRuntimeReport：这张图会发到群里，所以只取
 * 「机器性能」类信息，不取任何能定位到这台机器或这个人的东西——
 * 不读 hostname、不读 os.userInfo()（家目录、用户名）、不读网卡地址、
 * 不读环境变量内容、不读启动参数，也不读任何连接的 token。
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
