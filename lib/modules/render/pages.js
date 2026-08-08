/**
 * 页面装配
 *
 * 把配置与运行时状态整理成组件要的形状，再交给 render()。
 * 单独一层是为了让 apps/*.ts 只写一行调用，也方便未来加新页面。
 */
import { config, getConnections } from "../../config/index.js";
import { clients } from "../../modules/client/index.js";
import { STATUS_TEXT } from "../../constants/index.js";
import { PluginName } from "../../dir.js";
import { forwardMode, missingBotApis } from "../../utils/compat.js";
import { Help } from "./components/Help.js";
import { Status } from "./components/Status.js";
import { Changelog } from "./components/Changelog.js";
import { About } from "./components/About.js";
import { HELP_GROUPS } from "./commands.js";
import { render } from "./index.js";
import { versionLabel } from "./version.js";
import { PLUGIN_LOGO, imageDataUri } from "./assets.js";
import { frameName, frameVersion, nodeVersion, releaseType, sysInfo } from "./env.js";
// 页面上显示的是 git describe 风格的串（v2.1.0-2-gc6522ee / v2.1.0+40f2dd4），
// 不是裸的 package.json 版本号——三个分支的裸版本号是同一个，区分不出来。
const version = versionLabel();
/** 本地时间戳，页脚用 */
function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** 按状态码给出色调 */
function tone(status, enabled) {
    if (!enabled)
        return "off";
    if (status === 1)
        return "on";
    if (status === 2 || status === 3)
        return "warn";
    return "err";
}
/** 汇总连接的运行状态 */
function collect() {
    const list = getConnections();
    const rows = list.map((c, i) => {
        const live = clients.find(x => x.name === c.name);
        const enabled = c.enable !== false;
        const status = live?.status ?? 0;
        const state = !enabled ? "已停用" : live ? STATUS_TEXT[status] || String(status) : "未启动";
        const meta = [];
        if (c.token)
            meta.push("token 已设置");
        if (c.bot_id)
            meta.push(`bot_id: ${c.bot_id}`);
        if (live?.retry)
            meta.push(`已重连 ${live.retry} 次`);
        if (c.bind?.length)
            meta.push(`bind: ${c.bind.length}`);
        if (c.exclude?.length)
            meta.push(`exclude: ${c.exclude.length}`);
        return {
            index: i + 1,
            name: c.name || c.url,
            // 不用 client.url —— 那个 getter 会把 token 拼进查询参数，截图会外泄凭据
            url: String(c.url || ""),
            state,
            tone: tone(status, enabled),
            meta,
        };
    });
    const online = rows.filter(r => r.tone === "on").length;
    const off = rows.filter(r => r.tone === "off").length;
    return { rows, online, off, total: rows.length };
}
/** 渲染帮助图 */
export async function renderHelp() {
    const { total, online } = collect();
    return render({
        name: "help",
        title: "早柚核心适配器 帮助",
        view: palette => Help({
            title: PluginName,
            version,
            mode: config.mode || "off",
            palette,
            time: stamp(),
            summary: [
                { key: "CONNECTIONS", value: String(total), sub: "已配置连接" },
                { key: "ONLINE", value: String(online), sub: "当前在线" },
                {
                    key: "COMMANDS",
                    value: String(HELP_GROUPS.reduce((n, g) => n + g.items.length, 0)),
                    sub: "可用指令",
                },
                { key: "REPLY AT", value: config.filter?.only_reply_at ? "ON" : "OFF", sub: "仅响应 @" },
            ],
            groups: HELP_GROUPS,
        }),
    });
}
/** 渲染连接列表图 */
export async function renderList() {
    const { rows, total, online, off } = collect();
    return render({
        name: "list",
        title: "早柚核心 连接列表",
        view: palette => Status({
            title: PluginName,
            version,
            mode: config.mode || "off",
            heading: "CONNECTIONS",
            ghost: "LINKS",
            palette,
            time: stamp(),
            rows,
            summary: [
                { key: "TOTAL", value: String(total), sub: "连接总数" },
                { key: "ONLINE", value: String(online), sub: "已连接" },
                { key: "DISABLED", value: String(off), sub: "已停用" },
                { key: "HEARTBEAT", value: `${config.client?.heartbeat ?? 0}s`, sub: "ping 间隔" },
            ],
        }),
    });
}
/** 渲染状态图 */
export async function renderStatus() {
    const { rows, total, online, off } = collect();
    return render({
        name: "status",
        title: "早柚核心 适配器状态",
        view: palette => Status({
            title: PluginName,
            version,
            mode: config.mode || "off",
            heading: "STATUS",
            ghost: "STATUS",
            palette,
            time: stamp(),
            rows,
            emptyTip: config.mode === "off"
                ? "当前模式为 off，适配器未启用\n用 #早柚设置 mode=client 开启"
                : "用 #早柚添加连接 <地址> 添加",
            summary: [
                { key: "MODE", value: (config.mode || "off").toUpperCase(), sub: "运行模式" },
                { key: "ONLINE", value: `${online}/${total}`, sub: "在线 / 总数" },
                { key: "DISABLED", value: String(off), sub: "已停用" },
                {
                    key: "NOTIFY",
                    value: config.notify_master ? "ON" : "OFF",
                    sub: "断线通知主人",
                },
            ],
        }),
    });
}
/**
 * 渲染关于页（#早柚版本）
 *
 * 与 #早柚更新日志 的分工：那条命令答「代码更新到哪了」（git 提交列表），
 * 这条答「我是谁、跑在什么环境上」。两者不重叠，所以这里不列任何提交信息。
 */
export async function renderAbout() {
    const { total, online } = collect();
    const fv = frameVersion();
    const sys = sysInfo();
    // 缺失的 Bot 能力：兼容层能垫的都垫了，但 fileToUrl 垫不了，
    // 会真实影响大文件发送。这页顺带把探测结果摆出来，省得用户去翻启动日志。
    const missing = missingBotApis();
    const fwd = forwardMode();
    return render({
        name: "about",
        title: "早柚核心适配器 版本信息",
        view: palette => About({
            title: PluginName,
            version,
            palette,
            time: stamp(),
            logo: imageDataUri(PLUGIN_LOGO),
            desc: "插件、框架与本地宿主的精简诊断快照",
            release: releaseType(),
            // 顺序即版面顺序，两列从左到右、从上到下铺。
            // 连接数这类会变的状态信息不放这页——那是 #早柚状态 答的问题。
            rows: [
                {
                    key: "操作系统",
                    value: sys.os,
                    sub: `${sys.platform} · ${sys.arch}`,
                },
                {
                    key: "运行框架",
                    value: fv ? `${frameName()} v${fv}` : frameName(),
                    sub: "按 Bot.uin 的形状判定：TRSS 存数组，喵崽继承 ICQQ 存单个数字",
                },
                {
                    key: "Node.js 版本",
                    value: `v${nodeVersion()}`,
                    mono: true,
                    sub: `V8 ${process.versions.v8}`,
                },
                {
                    key: "运行模式",
                    value: config.mode || "off",
                    mono: true,
                    sub: config.mode === "off"
                        ? "适配器未启用，用 #早柚设置 mode=client 开启"
                        : "云崽作为 ws 客户端主动连接核心",
                },
                {
                    key: "处理器",
                    value: sys.cpuModel,
                    sub: `${sys.cpuCores} 核心`,
                },
                {
                    key: "运行时长",
                    value: sys.processUptime,
                    sub: `系统已运行 ${sys.systemUptime}`,
                },
                {
                    key: "合并转发",
                    value: fwd === "native" ? "框架原生" : fwd === "target" ? "群/好友接口" : "不可用",
                    sub: "核心下发合并转发时走哪条路径",
                },
                {
                    key: "框架能力",
                    value: missing.length ? `缺少 ${missing.join("、")}` : "齐全",
                    sub: missing.includes("fileToUrl")
                        ? "无文件外链服务，超过 media_max_size 的大文件由插件内置服务代发"
                        : "Bot 上所需的工具方法均可用",
                },
                {
                    key: "已配置连接",
                    value: `${total} 个`,
                    sub: `${online} 个在线 · 详情见 #早柚连接列表`,
                },
            ],
            memory: {
                percent: sys.memoryPercent,
                used: sys.usedMemory,
                total: sys.totalMemory,
            },
            links: [
                { key: "License", value: "GPL-3.0-only" },
                { key: "Core", value: "github.com/Genshin-bots/gsuid_core" },
                { key: "Docs", value: "docs.sayu-bot.com/LinkBots/AdapterList.html" },
            ],
        }),
    });
}
/**
 * 渲染更新日志图
 *
 * 两种语境共用一张版式：
 *   - 有新提交（info.hasUpdate）：列远端比本地多的那些，语气是「可以更新了」
 *   - 已最新：列本地最近的提交，等价于本体 #更新日志 的内容
 * 判定哪种由调用方给的 info 决定，本函数只负责排版。
 *
 * @param info checkUpdate() 的结果
 * @param local 已最新时用来填充列表的本地提交
 */
export async function renderChangelog(info, local = []) {
    const has = info.hasUpdate;
    const commits = has ? info.commits : local;
    return render({
        name: "changelog",
        title: has ? "早柚核心适配器 有新版本" : "早柚核心适配器 更新日志",
        multiPage: true,
        view: palette => Changelog({
            title: PluginName,
            version,
            heading: has ? "UPDATE" : "CHANGELOG",
            ghost: has ? "UPDATE" : "CHANGES",
            led: has ? "warn" : "on",
            rightKey: has ? "BEHIND" : "LOCAL",
            rightValue: has ? `${info.behind} commits` : info.local || "unknown",
            palette,
            time: stamp(),
            commits,
            summary: [
                {
                    key: "STATUS",
                    value: has ? "OUTDATED" : "LATEST",
                    sub: has ? "有新提交" : "已是最新",
                },
                { key: "BEHIND", value: String(info.behind), sub: "落后提交数" },
                { key: "LOCAL", value: info.local || "-", sub: "本地 HEAD" },
                // 只显示引用名（origin/main），不显示仓库地址——地址可能内嵌凭据，
                // 抹除逻辑在 git.remoteUrl()，这里索性不引入这个风险面
                { key: "TRACKING", value: info.ref || "-", sub: "跟踪分支" },
            ],
            emptyTitle: has ? "有新提交" : "暂无提交记录",
            emptyTip: has
                ? `本地落后 ${info.behind} 个提交，但读取日志失败\n用 #早柚更新 直接拉取`
                : "插件目录可能不是 git 仓库，或仓库还没有任何提交",
            notice: info.error || undefined,
        }),
    });
}
