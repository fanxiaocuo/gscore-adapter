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
import { fileServerEnabled, pendingFiles } from "../../utils/fileServer.js";
import { forName, snapshot } from "../../modules/stats.js";
import { Help } from "./components/Help.js";
import { Status } from "./components/Status.js";
import { Changelog } from "./components/Changelog.js";
import { About } from "./components/About.js";
import { HELP_GROUPS } from "./commands.js";
import { render } from "./index.js";
import { versionLabel, version as bareVersion } from "./version.js";
import { PLUGIN_LOGO, imageDataUri } from "./assets.js";
import { formatBytes, formatDuration, frameName, frameVersion, nodeVersion, releaseType, sysInfo, } from "./env.js";
import { currentRelease } from "./changelog.js";
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
/**
 * 汇总连接的运行状态
 *
 * @param detail 是否往 meta 里加运行时明细（收发计数、心跳年龄）。
 *   只有 #早柚状态 要；#早柚连接列表 与 #早柚帮助 问的是「配了哪些连接」，
 *   加进去反而把配置信息挤没了。
 */
function collect(detail = false) {
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
        if (detail) {
            // 用连接名取计数：clients 会被 #早柚重载 整个重建，计数按名字存在模块级
            const n = forName(c.name || String(c.url || ""));
            meta.push(`↑${n.up + n.event} ↓${n.down}`);
            // 心跳年龄：lastPong 只在收到 pong 时刷新，而 pong 只因我们发 ping 而来。
            // 关掉 heartbeat 时它永远停在连接建立那一刻，显示出来会被误读成「卡了很久」，
            // 所以只在真的在 ping 时才给这一项。
            if (live?.status === 1 && live.lastPong && Number(config.client?.heartbeat) > 0)
                meta.push(`心跳 ${Math.round((Date.now() - live.lastPong) / 1000)}s 前`);
        }
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
/** 条目数摘要：空数组说「全部」而不是「0」，避免读成「一个都不转」 */
function countOf(list, all = "全部") {
    const n = list?.length || 0;
    return n ? `${n} 项` : all;
}
/** 开关类配置统一显示 */
const onOff = (v) => (v ? "开" : "关");
/**
 * 状态页的分组明细
 *
 * 为什么状态页要有这些
 * ------------------
 * 原来这页只有 4 个统计卡 + 连接卡片，信息量比 #早柚版本 还少，而它本该是
 * 排障的第一站。这里补的三块对应三类最常见的「连着但不对」：
 *   中转情况 —— 连接绿了但一条消息都没过去（计数为 0 一眼可见）
 *   消息过滤 —— 过滤规则把消息挡了（只在群里不响应时最容易忘掉 only_reply_at）
 *   媒体与运行 —— 图片发不出、大文件失败（media/file 上限、文件服务是否在跑）
 *
 * 隐私边界与 env.ts sysInfo 一致：这张图会发到群里。所以过滤规则只报**条数**，
 * 不报具体的群号、用户号、前缀内容；token 只在连接卡片上标「已设置」，不出现值。
 */
function statusPanels() {
    const s = snapshot();
    const f = config.filter || {};
    const sys = sysInfo();
    const hb = Number(config.client?.heartbeat) || 0;
    const to = Number(config.client?.heartbeat_timeout) || 0;
    return [
        {
            title: "中转情况",
            key: "RELAY",
            items: [
                { k: "上行消息", v: `${s.today.up} 今日 / ${s.total.up} 累计` },
                { k: "上行事件", v: `${s.today.event} 今日 / ${s.total.event} 累计` },
                { k: "下行消息", v: `${s.today.down} 今日 / ${s.total.down} 累计` },
                { k: "统计自", v: formatDuration((Date.now() - s.since) / 1000) + "前" },
            ],
        },
        {
            title: "消息过滤",
            key: "FILTER",
            items: [
                { k: "仅响应 @", v: onOff(f.only_reply_at) },
                { k: "触发前缀", v: countOf(f.prefix, "无") },
                { k: "屏蔽前缀 / 关键词", v: `${f.block_prefix?.length || 0} / ${f.block_include?.length || 0}` },
                { k: "群白名单 / 黑名单", v: `${countOf(f.white_group)} / ${f.black_group?.length || 0} 项` },
                { k: "用户黑名单", v: countOf(f.black_user, "无") },
            ],
        },
        {
            title: "媒体与运行",
            key: "RUNTIME",
            items: [
                { k: "媒体内联上限", v: formatBytes(Number(config.media_max_size) || 0) },
                { k: "文件大小上限", v: formatBytes(Number(config.file_max_size) || 0) },
                {
                    k: "内置文件服务",
                    v: fileServerEnabled() ? `开 · 暂存 ${pendingFiles()} 个` : "关",
                },
                { k: "心跳 / 超时", v: hb ? `${hb}s / ${to ? `${to}s` : "关"}` : "关" },
                { k: "运行时长", v: `${sys.processUptime} · 占用 ${sys.processRss}` },
            ],
        },
    ];
}
/** 渲染状态图 */
export async function renderStatus() {
    const { rows, total, online } = collect(true);
    const s = snapshot();
    return render({
        name: "status",
        title: "早柚核心 适配器状态",
        // 不开 multiPage：加了三块明细后整页 CSS 高约 2030px、出图 3050px，本体的
        // 分片阈值是 4000px（renderers/puppeteer/lib/puppeteer.js:161），
        // 到不了阈值时 num 算出来仍是 1，开了只是白走一遍数组包裹的路径。
        // 帮助页 CSS 高 3900px 都还是单图，这页远没到该分片的量级。
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
            // 四格换成「模式 / 在线 / 上行 / 下行」：已停用的连接在卡片上自带
            // 「已停用」胶囊，不必再占一格，而收发量是这页最该先看到的数字。
            summary: [
                { key: "MODE", value: (config.mode || "off").toUpperCase(), sub: "运行模式" },
                { key: "ONLINE", value: `${online}/${total}`, sub: "在线 / 总数" },
                { key: "UPLINK", value: String(s.today.up + s.today.event), sub: "今日上报核心" },
                { key: "DOWNLINK", value: String(s.today.down), sub: "今日核心下发" },
            ],
            panels: statusPanels(),
        }),
    });
}
/**
 * 本版变更最多显示几条
 *
 * 这页走单图（没开 multiPage），所以不会被分片，但也就没人替它兜底：不设限的话
 * 一个大版本二十几条能把图拉到近 6000px，而 index.ts 的 SCALE 注释里记着，
 * 过高的图不少 QQ 适配器会拒发或压成马赛克。12 条时出图 4135px，仍在能发的量级，
 * 也覆盖了目前所有已发布版本的实际条目数（最多的 2.0.0 是 11 条）。
 */
const CHANGE_LIMIT = 12;
/** 按 CHANGE_LIMIT 裁剪变更条目，超出的在末尾留一句说明 */
function trimChanges(r) {
    if (!r)
        return null;
    let left = CHANGE_LIMIT;
    const groups = [];
    let dropped = 0;
    for (const g of r.groups) {
        if (left <= 0) {
            dropped += g.items.length;
            continue;
        }
        const items = g.items.slice(0, left);
        dropped += g.items.length - items.length;
        left -= items.length;
        groups.push({ ...g, items });
    }
    // 省略的条目数明说，免得用户以为这版就改了这么多。
    // 挂在最后一个分类下而不是新起一节：它是个注脚，不是一类变更。
    if (dropped > 0 && groups.length)
        groups[groups.length - 1].items.push(`…另有 ${dropped} 条，详见 CHANGELOG.md`);
    return { ...r, groups };
}
/**
 * 渲染关于页（#早柚版本）
 *
 * 与 #早柚更新日志 的分工：那条命令答「代码更新到哪了」（git 提交列表，按提交），
 * 这条答「我是谁、跑在什么环境上、这版改了什么」（CHANGELOG.md，按发布）。
 * 两者数据源不同，所以这里不列任何 git 提交信息。
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
            // 传裸版本号（2.1.0）而不是 describe 串：CHANGELOG 的小节标题是纯 semver，
            // 拿 v2.1.0-2-gc6522ee-dirty 去比永远对不上
            changes: trimChanges(currentRelease(bareVersion)),
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
