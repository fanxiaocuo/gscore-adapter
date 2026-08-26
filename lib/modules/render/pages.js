/**
 * @description 页面装配：把配置与运行时状态整理成组件要的形状，再交给 render()
 * 单独一层是为了让 apps/*.ts 只写一行调用，也方便未来加新页面。
 */
import { config, getWsConnections, enabled, profileWithPlatform } from "../../config/index.js";
import { clients } from "../../modules/client/index.js";
import { expandConnections, effectiveAccounts } from "../../modules/client/expand.js";
import { DEFAULT_MAX_RECONNECT, STATUS_TEXT, pickByStatus } from "../../constants/index.js";
import { PluginName } from "../../dir.js";
import { forwardMode, missingBotApis } from "../../utils/compat.js";
import { fileServerEnabled, pendingFiles } from "../../utils/fileServer.js";
import { readIds } from "../../utils/ids.js";
import { inlineToken, redactUrl } from "../../utils/url.js";
import { forName, snapshot } from "../../modules/stats/index.js";
import { passiveCount } from "../../modules/passive/index.js";
import { Help } from "./components/Help.js";
import { Status } from "./components/Status.js";
import { Settings } from "./components/Settings.js";
import { Changelog } from "./components/Changelog.js";
import { About } from "./components/About.js";
import { HELP_GROUPS } from "./commands.js";
import { render } from "./index.js";
import { versionLabel, version as bareVersion } from "./version.js";
import { PLUGIN_LOGO, imageDataUri } from "./assets.js";
import { formatBytes, formatDuration, frameLabel, nodeVersion, releaseType, sysInfo, } from "./env.js";
import { currentRelease } from "./changelog.js";
// 显示 git describe 风格的串而不是裸的 package.json 版本号 —— 三个分支的裸版本号是同一个，区分不出来
const version = versionLabel();
/** @description 本地时间戳，页脚用 */
function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/**
 * @description 卡片上显示的地址：脱敏后再画进图里
 * 注意：状态图会被发到群里，凭据落进截图是永久留痕。空地址仍回空串 —— redactUrl 对空输入回的是「(空)」，
 * 那是给错误话术用的措辞，卡片这一行留空即可。
 */
function shownUrl(url) {
    return url ? redactUrl(url) : "";
}
/**
 * @description 按状态码给出色调
 * enabled 默认真：只有卡片主行有「整条连接被停用」这个状态，账号级子行没有 —— 停用的连接根本不展开运行时
 * 连接，一条子行都不会出现。
 */
function tone(status, enabled = true) {
    if (!enabled)
        return "off";
    if (status === 1)
        return "on";
    if (status === 2 || status === 3)
        return "warn";
    return "err";
}
/**
 * @description 收发量求和（累计，不是今日）
 * 注意：计数按运行时名字存（stats 的 count() 收的就是 client.name），所以一条逻辑连接要把它派生出的每条运行时
 * 连接逐个取出来再加 —— 拿逻辑名去问的话账号级连接一条都对不上，图上永远是 ↑0 ↓0。
 * 注意：这里回的是累计值（还跨重启），与状态图「中转情况」里的累计那一半同源，别把它读成今天的量。
 * 查的是名字而不问客户端还在不在：clients 会被 #早柚重载 整个重建，而计数按名字存在模块级，活得比客户端长。
 */
function sumCounters(names) {
    let up = 0;
    let down = 0;
    for (const name of names) {
        const n = forName(name);
        // 上行把消息与事件合并成一个数：这一行只回答「有没有东西发上去」
        up += n.up + n.event;
        down += n.down;
    }
    return { up, down };
}
/**
 * @description 一个 bind 账号那条 ws 的运行时状态
 * 不接「逻辑连接是否启用」：只由 expandConnections 的产物生成，而它对 `enable === false` 的行直接
 * return，所以走到这里的一定是启用的（曾经带过这个参数并写了「已停用」分支，那个分支永远走不到）。
 * @param detail 与 {@link collect} 同义：只有 #早柚状态 才把收发计数摆进来
 */
function runtimeRow(rt, detail) {
    // 注意：认人按 runtimeKey，取数按 runtimeName —— 与 Web 面板同一套口径。名字会随改名与下标位移变而收敛器
    // 把客户端原地留着，按名字找会在改名那一瞬把一条连着的连接印成「未启动」；而计数的分桶键就是运行时名字，
    // 换成 runtimeKey 取不到桶、恒为 ↑0 ↓0
    const live = clients.find(x => x.runtimeKey === rt.runtimeKey);
    const status = live?.status ?? 0;
    const meta = [];
    // 措辞与主行的聚合值同一套：两处指的是同一个数，一处写「重连 N 次」一处写「已重连 N 次」会让人以为是两种计量
    if (live?.retry)
        meta.push(`已重连 ${live.retry} 次`);
    // 心跳不进这里 —— 各账号的值在实践中一模一样（同一个 ping 周期），逐行印一遍等于把同一句话说 N 遍。
    // 卡片层给一个「最差」的（见 collect），那个值才有诊断意义
    if (detail) {
        const n = sumCounters([rt.runtimeName]);
        meta.push(`↑${n.up} ↓${n.down}`);
    }
    return {
        // 组件折叠子行时要按状态挑，光给文案和色调排不出名次
        status,
        // 没有「已停用」这一档：只由启用的连接派生（见函数头），那条分支永远走不到
        state: live ? STATUS_TEXT[status] : "未启动",
        tone: tone(status),
        /*
         * 不给路径
         *
         * 自动派生的路径恒为 `/ws/Yunzai-<账号>`，而账号就印在同一行的左边 —— 信息量是零，却占掉一整列。
         * 那自定义路径呢？走不到这里：自定义路径的连接恒只派生一条 ws（expand.ts 的 automatic:false 那支），
         * 而本函数只在派生出多条时才被调用，所以进到这里的 rt.automatic 永远是 true。曾经写过一个
         * `rt.automatic ? undefined : pathname` 的三元，那个 else 分支永远走不到。
         * 信息也没丢：自定义路径的连接，路径本来就印在卡片 URL 那一行（shownUrl 保留 pathname）。
         */
        meta,
    };
}
/**
 * @description 汇总连接的运行状态
 * 必须先展开一遍：配置里一条「核心地址 + 绑定账号」在运行时是 N 条 ws，逻辑连接自己既不是任何客户端的身份
 * （客户端按派生地址的 runtimeKey 认）也不是任何计数的键（按 `${连接名} [${账号}]` 分桶）。不展开就只有
 * 逻辑那一层的 name 和 url 可用，两边都对不上 —— 每条自动连接都显示「未启动」、收发计数恒为 0。
 * @param detail 是否往 meta 里加运行时明细（收发计数、心跳年龄）。只有 #早柚状态 要；#早柚连接列表 与
 *   #早柚帮助 问的是「配了哪些连接」，加进去反而把配置信息挤没了
 */
function collect(detail = false) {
    const list = getWsConnections();
    // 展开只做一次：expandConnections 是全局裁决（路由冲突先到先得），逐条各展开既拿不到全局上下文，也会把同一批
    // 错误重复算 n 遍。它是纯函数，渲染路径调它没有副作用 —— 也正因如此这里刻意不把 errors 打进日志：
    // 收敛那条路径（lifecycle 的 logErrors）已经报过一次，出图再报只是重复噪音。要看原因去 Web 面板
    const { runtime } = expandConnections(list);
    // 停用的连接转过的量：拿它本该有的运行时名字去问
    // ------
    // 计数按运行时名字存（`早柚核心 [111]`），而停用的行根本不展开，于是没有任何键可查 —— 逻辑名从来不是任何
    // 客户端的名字，问它必然是 ↑0 ↓0，等于对一条刚被停用的连接说「它什么都没干过」。所以再展开一份「假设全部
    // 启用」的副本，把停用行本该派生出的名字捞回来。
    // 注意：必须整份列表一起展开 —— sourceIndex 与未命名连接的 `连接 #N` 标签都按下标算，单独展开一行会把序号
    // 错开、名字对不上。循环外只跑一次，别搬进 map 里逐行展开
    const wouldBe = new Map();
    if (detail && list.some(c => c.enable === false))
        for (const r of expandConnections(list.map(c => ({ ...c, enable: true }))).runtime) {
            const at = wouldBe.get(r.sourceIndex);
            if (at)
                at.push(r.runtimeName);
            else
                wouldBe.set(r.sourceIndex, [r.runtimeName]);
        }
    const rows = list.map((c, i) => {
        // 按来源序号收本条派生出的运行时连接。这一层只做「本条派生出的是哪几个」：runtime 全都出自
        // expandConnections，里头的 sourceIndex 无条件就是 forEach 的下标，筛不掉任何「来路不明」的东西。
        // 真正把野客户端挡在外面的是下一行 —— 按 runtimeKey 去 clients 里认人
        const views = runtime.filter(r => r.sourceIndex === i);
        // 反过来从 clients 里筛而不是逐条 find：展开出来的连接与活着的客户端未必一一对应（#早柚重载 会整个重建
        // clients，某个账号也可能被单独停掉），从 clients 出发得到的就是「此刻真的在跑的那些」，顺序也是启动顺序。
        // 注意：比的是 runtimeKey 不是名字 —— 改名与下标位移都只改显示名而收敛器把客户端原地留着，按名字比会在
        // 那一瞬认不出人，主行状态塌成「未启动」、子行也全没了
        const live = clients.filter(x => views.some(r => r.runtimeKey === x.runtimeKey));
        const enabled = c.enable !== false;
        // 状态是聚合值：任一账号连上就算这个核心通了。规则与 Web 面板共用一份（constants 的 pickByStatus），
        // 否则会出现「面板说通了、状态图说没连上」
        const lead = pickByStatus(live);
        const status = lead?.status ?? 0;
        // 注意：present 看的是有没有活客户端而不是状态码 —— 零客户端时状态码也是 0，只看码会把「没起来」印成「未连接」
        const state = !enabled ? "已停用" : live.length ? STATUS_TEXT[status] : "未启动";
        // 各账号里最差的那个重连次数。与 state 同时看会显得矛盾（「已连接 + 已重连 5 次」），但这一行的用途正是
        // 「这条核心有账号在挣扎」；逐账号的准确值在下面的子行里
        const retry = live.reduce((n, x) => Math.max(n, x.retry), 0);
        const meta = [];
        // 内联在地址里的凭据也算配过（那种配置的 c.token 是空的）：只看 c.token 的话，排查时这张图会对一条其实
        // 配了凭据的连接说「没设 token」，把人引向错误方向
        if (c.token || inlineToken(c.url) !== null)
            meta.push("token 已设置");
        /*
         * bind 账号与它那条 ws 合成一层：一个账号一行
         *
         * 从前是两块平行的东西 —— 一排 bind 头像胶囊，底下再一块 runtime 子行，两者枚举的是同一份账号。
         * 后果是同一个账号号码在一张卡里出现三次（胶囊、子行行首、子行路径尾巴），心跳与收发计数各出现三次
         * （两条子行 + 卡片聚合），而读者还得在两块之间对着看才知道「这个胶囊对应哪条 ws」。合成一层之后
         * 账号只出现一次，每行自带自己的状态与计数。
         * 注意：铺的是 readIds 归一化之后的 bind，不是 c.bind —— 后者 `[111, 111, 222]` 会出三行却只有两条
         * ws，重复项还会让两行撞上同一个 React key。
         * 注意：被 exclude 挡掉的号仍然出一行、只是没有 rt（它确实绑了，只是不会连）。藏掉反而看不出配置写
         * 矛盾了，而 meta 里那个光秃秃的 `exclude: 1` 说不出是哪个号。
         */
        const excluded = new Set(effectiveAccounts(c).conflicts);
        const bound = readIds(c.bind);
        // 只派生一条时不给 rt：卡片右侧那个胶囊就是它的状态，逐行再印一遍只是噪音。比面板严格是因为画布固定、
        // 没有交互 —— 既点不开，也没有滚动条能往下翻
        const perAccount = views.length > 1;
        const byAccount = new Map(views.map(r => [r.account, r]));
        const accounts = bound.length
            ? bound.map(id => {
                const base = profileWithPlatform(id);
                if (excluded.has(id))
                    return { ...base, excluded: true };
                const rt = perAccount ? byAccount.get(id) : undefined;
                return rt ? { ...base, rt: runtimeRow(rt, detail) } : base;
            })
            : undefined;
        /*
         * exclude 只在账号行说不出来的时候才由 meta 说
         *
         * 从前无条件给一个 `exclude: N` 胶囊，理由是「胶囊排看不出是哪个号被挡了」。合成一层之后被挡的那个号
         * 自己那一行就写着「已排除」，这个胶囊成了同一件事的第二遍。
         * 但 exclude 里写的号可能与 bind 不相交（写了却挡不到任何东西）—— 那种情况账号行里一个「已排除」都不会
         * 出现，胶囊是唯一的线索，所以那时仍然给。
         */
        if (c.exclude?.length && !accounts?.some(a => a.excluded))
            meta.push(`exclude: ${c.exclude.length}`);
        // 逐账号那几行各自带着准确的重连次数，卡片这一层就不再说；没有逐账号行时才由卡片给「有账号在挣扎」
        if (retry && !accounts?.some(a => a.rt))
            meta.push(`已重连 ${retry} 次`);
        // 一条都没有时补一句「怎么办」：默认配置那种连接 meta 是空数组，卡片只剩名字和地址两行，右边一大片空，
        // 而这种卡片恰好最需要一句提示。有内容时不加 —— 那句话对已经连上的连接没有意义，只会挤占位置
        if (meta.length === 0 && !accounts) {
            if (!enabled)
                meta.push(`用 #早柚启用连接 ${c.name || i + 1} 恢复`);
            else if (!live.length)
                meta.push("尚未建立连接，可用 #早柚重载 重试");
            else
                meta.push("未配置 token / bind / exclude，按默认规则中转");
        }
        if (detail) {
            // 一条运行时连接都没有时用「本该有」的那些名字（见上面的 wouldBe）：停用的行取不到活着的运行时名字，
            // 但它转过的量确实记在那些名字下。两者互斥地取，不会重复累加。
            // 有逐账号行时不出这个聚合值 —— 它只是那几行的和，逐行都印着分量，卡片再印一次总数是第四遍重复
            if (!accounts?.some(a => a.rt)) {
                const n = sumCounters(views.length ? views.map(r => r.runtimeName) : wouldBe.get(i) || []);
                meta.push(`↑${n.up} ↓${n.down}`);
            }
            // 心跳年龄只在真的在 ping 时才给：lastPong 只因我们发 ping 而刷新，关掉 heartbeat 时它永远停在连接建立
            // 那一刻，显示出来会被误读成「卡了很久」。
            // 取所有账号里最老的那条（最大年龄），不是代表账号：心跳本来只对单条 ws 说得通，而这一行要答的是
            // 「这条核心有没有哪个号的心跳停了」，最老的那个才是该报警的。各账号的值在实践中几乎一致，所以
            // 逐账号行里不再逐一印（见 runtimeRow），只在卡片这层给一个最差值
            const pongs = (perAccount ? views : [lead])
                .map(v => clients.find(x => x.runtimeKey === v?.runtimeKey))
                .filter(x => x?.status === 1 && x.lastPong)
                .map(x => x.lastPong);
            if (pongs.length && Number(config.client?.heartbeat) > 0)
                meta.push(`心跳 ${Math.round((Date.now() - Math.min(...pongs)) / 1000)}s 前`);
        }
        return {
            index: i + 1,
            name: c.name || shownUrl(c.url),
            // 注意：不用 client.url（那个 getter 会把 token 拼进查询参数，截图会外泄凭据），配置里的 c.url 也不能
            // 原样用 —— normalizeEndpoint 不动查询串，`ws://host:port/ws/Custom?token=xxx` 的凭据就在 c.url 里
            url: shownUrl(c.url),
            state,
            tone: tone(status, enabled),
            meta,
            accounts,
        };
    });
    // online / off / total 三个数同一个基数：逻辑连接（配置里的条目），不是账号。一条核心绑 5 个号、其中 3 个
    // 连上，这里算 1 —— tone 是 pickByStatus 聚合出来的「这条核心通不通」。
    // 注意：别改成「连上的账号数」—— 分子换成账号、分母还是连接的话，`online/total` 会出现 3/1 这种读不通的
    // 比值。面板那边要的是账号级基数，它自己给全 totals 三个数，不从这里拿
    const online = rows.filter(r => r.tone === "on").length;
    const off = rows.filter(r => r.tone === "off").length;
    return { rows, online, off, total: rows.length };
}
/** @description 渲染帮助图 */
export async function renderHelp() {
    const { total, online } = collect();
    return render({
        name: "help",
        title: "早柚核心适配器 帮助",
        view: palette => Help({
            title: PluginName,
            version,
            enabled: enabled(),
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
/** @description 渲染连接列表图 */
export async function renderList() {
    const { rows, total, online, off } = collect();
    return render({
        name: "list",
        // 这一页不折叠子行（纵向有地方放），于是没有任何高度上限：3 条连接各绑 12 个号就多出上千像素。过高的图
        // 不少 QQ 适配器会拒发或压成马赛克，所以交给 multiPage 切页 —— 与 renderChangelog 同一个理由
        multiPage: true,
        title: "早柚核心 连接列表",
        view: palette => Status({
            title: PluginName,
            version,
            enabled: enabled(),
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
/** @description 条目数摘要：空数组说「全部」而不是「0」，避免读成「一个都不转」 */
function countOf(list, all = "全部") {
    const n = list?.length || 0;
    return n ? `${n} 项` : all;
}
/** @description 开关类配置统一显示 */
const onOff = (v) => (v ? "开" : "关");
/**
 * @description 状态页的分组明细：中转情况、消息过滤、媒体与文件、运行环境
 * 前三块对应三类最常见的「连着但不对」：连接绿了但一条消息都没过去（计数为 0 一眼可见）、过滤规则把消息挡了、
 * 图片发不出或大文件失败。第四块答「它跑在什么上面」—— 排障时「转发慢/发不出」经常是内存吃满或 Node 太旧。
 * 与 #早柚版本 的重复是有意的：那页是「插件的身份证」，这页是随手一敲的运行快照，不该为去重逼用户再发一条命令。
 * 注意：隐私边界与 env.ts sysInfo 一致 —— 这张图会发到群里，所以过滤规则只报条数，不报群号、用户号、前缀内容；
 * token 只标「已设置」，不出现值。
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
                // 三个方向开关放最前：它们是最粗的一刀，也是「核心收不到某类消息」时第一个该看的地方。
                // 合成一行以免把这块挤到五行以上
                {
                    k: "上报 私聊/群/事件",
                    v: `${onOff(f.report_private !== false)} / ${onOff(f.report_group !== false)} / ${onOff(f.report_meta !== false)}`,
                },
                { k: "仅响应 @", v: onOff(f.only_reply_at) },
                { k: "触发前缀", v: countOf(f.prefix, "无") },
                {
                    k: "屏蔽前缀 / 关键词",
                    v: `${f.block_prefix?.length || 0} / ${f.block_include?.length || 0}`,
                },
                {
                    k: "群白名单 / 黑名单",
                    v: `${countOf(f.white_group)} / ${f.black_group?.length || 0} 项`,
                },
                { k: "用户黑名单", v: countOf(f.black_user, "无") },
            ],
        },
        {
            // 「运行时长 / 内存占用」在下面的运行环境块：那两项讲的是宿主进程，和媒体上限、文件服务不是一类
            title: "媒体与文件",
            key: "MEDIA",
            items: [
                { k: "媒体内联上限", v: formatBytes(Number(config.media_max_size) || 0) },
                { k: "文件大小上限", v: formatBytes(Number(config.file_max_size) || 0) },
                {
                    k: "内置文件服务",
                    v: fileServerEnabled() ? `开 · 暂存 ${pendingFiles()} 个` : "关",
                },
                { k: "心跳 / 超时", v: hb ? `${hb}s / ${to ? `${to}s` : "关"}` : "关" },
                { k: "合并转发", v: fwdLabel() },
                // QQBot 被动回复：记着多少个会话能让回复挂到用户那条消息上。只在真的有记录时显示 ——
                // 没装 QQBot 的用户看到这一行会莫名其妙
                ...(passiveCount() > 0 ? [{ k: "被动回复窗口", v: `${passiveCount()} 个会话可用` }] : []),
            ],
        },
        {
            title: "运行环境",
            key: "RUNTIME",
            items: [
                { k: "运行框架", v: frameLabel() },
                { k: "Node.js", v: `v${nodeVersion()}` },
                { k: "操作系统", v: `${sys.platform} · ${sys.arch}` },
                // 只给核心数不给型号：型号串有 40 多字符，在 kv 的窄栏里会折成两三行、把行距节奏打乱。
                // 排障要看的也是「几核」—— 单核跑满和 16 核闲着是两回事。型号在 #早柚版本 上有
                { k: "处理器", v: `${sys.cpuCores} 核心` },
                // 百分比放前面：一眼要看的是「满不满」，具体数字是佐证
                { k: "内存占用", v: `${sys.memoryPercent}% · ${sys.usedMemory}/${sys.totalMemory}` },
                { k: "本进程", v: `${sys.processUptime} · ${sys.processRss}` },
            ],
        },
    ];
}
/**
 * @description 设置菜单的分组：前三组只放「指令能改的项」，一行一项，说明那行直接给出改它的指令
 * 分组依据是「指令能不能改它」而不是「配置文件里挨着谁」—— 原来每块末尾挂一行「改法」，读起来像第七个配置项，
 * 而块里既有指令能改的开关也有只能在配置文件里改的调参，两者长得完全一样。改不了但仍该看见的项挪进
 * settingFacts() 的只读块。
 * 注意：隐私边界与 statusPanels 一致 —— 这张图会发到群里，所以名单只报条数，不出现群号、用户号、前缀内容与 token。
 */
function settingGroups() {
    const f = config.filter || {};
    const u = config.update_check || {};
    return [
        {
            title: "总开关",
            key: "CORE",
            rows: [
                {
                    name: "适配器",
                    dsc: "关掉则完全不连核心 · #早柚设置适配器开启 / 关闭",
                    icon: "settings",
                    on: enabled(),
                },
                {
                    name: "断线通知",
                    dsc: "连接断开与重连成功时私聊通知主人 · #早柚设置断线通知开启",
                    icon: "refresh",
                    on: !!config.notify_master,
                },
            ],
        },
        {
            title: "消息上报",
            key: "REPORT",
            rows: [
                // 三个方向各占一行，不再合成 `开 / 开 / 关` 一格：那种写法要数到第几个斜杠才知道是哪个方向关着，
                // 而这页最常问的就是「为什么核心收不到消息」
                {
                    name: "私聊上报",
                    dsc: "把私聊消息转给核心 · #早柚设置私聊上报关闭",
                    icon: "list",
                    on: f.report_private !== false,
                },
                {
                    name: "群聊上报",
                    dsc: "含频道消息 · #早柚设置群聊上报关闭",
                    icon: "list",
                    on: f.report_group !== false,
                },
                {
                    name: "事件上报",
                    dsc: "入群、退群、戳一戳 · #早柚设置事件上报关闭",
                    icon: "status",
                    on: f.report_meta !== false,
                },
                {
                    name: "仅响应 @",
                    dsc: "群里只在被 @ 或带前缀时才上报 · #早柚设置仅响应at开启",
                    icon: "search",
                    on: !!f.only_reply_at,
                },
            ],
        },
        {
            title: "媒体与更新",
            key: "MEDIA",
            rows: [
                {
                    name: "最大媒体大小",
                    dsc: "超过这个体积改用外链 · #早柚设置最大媒体大小 2（单位 MB）",
                    icon: "plus",
                    value: formatBytes(Number(config.media_max_size) || 0),
                },
                {
                    name: "更新检查",
                    dsc: "定时查新提交并推送更新日志 · #早柚设置更新检查开启",
                    icon: "arrowUp",
                    on: !!u.enable,
                },
            ],
        },
    ];
}
/**
 * @description 只读信息：指令改不了（要么是调参、要么是运行时事实）但排障时正要看的那些
 * 与上面的开关列表分开，是为了让「右侧有胶囊」这件事只代表「这项可以改」。
 */
function settingFacts() {
    const f = config.filter || {};
    const u = config.update_check || {};
    const srv = config.file_server || {};
    const conns = getWsConnections();
    const hb = Number(config.client?.heartbeat) || 0;
    const to = Number(config.client?.heartbeat_timeout) || 0;
    return [
        {
            title: "连接与过滤",
            key: "LINKS",
            items: [
                {
                    k: "连接数",
                    v: `${conns.length} 条 · ${conns.filter(c => c.enable !== false).length} 条启用`,
                },
                { k: "心跳 / 超时", v: hb ? `${hb}s / ${to ? `${to}s` : "关"}` : "关" },
                // 默认重连次数不再是无限，这页要说清楚——否则「连接自己停了」会被当成 bug
                { k: "重连", v: reconnectLabel(conns) },
                { k: "触发前缀", v: countOf(f.prefix, "无") },
                {
                    k: "屏蔽前缀 / 关键词",
                    v: `${f.block_prefix?.length || 0} / ${f.block_include?.length || 0} 项`,
                },
                {
                    k: "群白名单 / 黑名单",
                    v: `${countOf(f.white_group)} / ${f.black_group?.length || 0} 项`,
                },
            ],
        },
        {
            title: "文件与日志",
            key: "FILES",
            items: [
                { k: "文件大小上限", v: formatBytes(Number(config.file_max_size) || 0) },
                { k: "外链有效期", v: formatDuration(Number(config.link_expire) / 1000 || 0) },
                {
                    k: "内置文件服务",
                    v: srv.enable === false ? "关" : `开 · 端口 ${srv.port || "自动"}`,
                },
                { k: "自定义图床", v: config.upload_hook ? "已配置" : "未配置" },
                {
                    k: "检查间隔 / 首检",
                    v: `${Math.max(Number(u.interval) || 180, 30)} 分 / ${Number(u.delay) || 5} 分`,
                },
                { k: "日志截断 base64", v: onOff(config.log_truncate !== false) },
            ],
        },
    ];
}
/**
 * @description 重连策略摘要，只回答「会不会停」：全都无限、全都有上限、还是混着
 * 各连接可以各配一个次数，值不一致时不必逐条列出 —— 那是 #早柚连接列表 的事。
 */
function reconnectLabel(conns) {
    const base = Number(conns[0]?.reconnect_interval) || 5;
    if (!conns.length)
        return `间隔 ${base}s 起 · 默认最多 ${DEFAULT_MAX_RECONNECT} 次`;
    const caps = conns.map(c => Number(c.max_reconnect_attempts ?? DEFAULT_MAX_RECONNECT));
    const unlimited = caps.filter(n => !(n > 0)).length;
    if (unlimited === caps.length)
        return `间隔 ${base}s 起 · 无限重连`;
    const max = Math.max(...caps.filter(n => n > 0));
    return unlimited
        ? `间隔 ${base}s 起 · 最多 ${max} 次（${unlimited} 条无限）`
        : `间隔 ${base}s 起 · 最多 ${max} 次`;
}
/** @description 合并转发走哪条路径，#早柚设置 与 #早柚版本 共用一套判定与话术 */
function fwdLabel() {
    const fwd = forwardMode();
    return fwd === "native" ? "框架原生" : fwd === "target" ? "群/好友接口" : "不可用";
}
/**
 * @description 渲染当前配置图（不带参数的 #早柚设置）
 * 与 #早柚状态 的分工：那页答「现在跑得怎么样」，这页答「现在配成什么样」（每一项的取值与各自的改法），
 * 所以这里不放任何运行时数字 —— 重复只会让两页都变长而信息没增加。
 * 注意：隐私边界与 statusPanels 一致 —— token 只说「已设置」、过滤名单只报条数、连接地址不带查询参数。
 */
export async function renderConfig() {
    return render({
        name: "config",
        title: "早柚核心 当前配置",
        view: palette => Settings({
            title: PluginName,
            version,
            enabled: enabled(),
            heading: "SETTINGS",
            ghost: "CONFIG",
            palette,
            time: stamp(),
            groups: settingGroups(),
            facts: settingFacts(),
        }),
    });
}
/**
 * @description 渲染设置结果图（#早柚设置 带参数）
 * 与菜单页同一个组件，多一条顶部结果条：改完那次要先回答「刚才那条生效了吗」，再顺带把当前全貌摆出来。
 * 结果整行原样显示，admin.ts 那边的文案怎么写就怎么出。done 收成功的、errs 收失败的（与 admin.ts set() 一致）。
 */
export async function renderSettings(done, errs) {
    return render({
        name: "settings",
        title: "早柚核心 设置已保存",
        view: palette => Settings({
            title: PluginName,
            version,
            enabled: enabled(),
            heading: "SETTINGS",
            ghost: "SETTINGS",
            palette,
            time: stamp(),
            result: { done, errs },
            groups: settingGroups(),
            facts: settingFacts(),
            tip: errs.length ? "#早柚帮助 查看正确写法" : "#早柚设置 再看一次当前配置",
        }),
    });
}
/** @description 渲染状态图 */
export async function renderStatus() {
    const { rows, total, online } = collect(true);
    const s = snapshot();
    return render({
        name: "status",
        title: "早柚核心 适配器状态",
        // 不开 multiPage：整页出图 3050px，本体的分片阈值是 4000px，到不了阈值时开了只是白走一遍数组包裹的路径
        view: palette => Status({
            title: PluginName,
            version,
            enabled: enabled(),
            heading: "STATUS",
            ghost: "STATUS",
            palette,
            time: stamp(),
            rows,
            // 概览页把账号级子行折叠到前几条：下面还压着四块分组明细，一条核心绑十几个号时全铺开会把它们挤到
            // 第二屏。要逐个核对走 #早柚连接列表 —— 那页不折叠
            compactRuntime: true,
            emptyTip: enabled()
                ? "用 #早柚添加连接 <地址> 添加"
                : "适配器已禁用\n用 #早柚设置适配器开启 启用",
            // 四格是「开关 / 在线 / 上行 / 下行」：已停用的连接在卡片上自带「已停用」胶囊，不必再占一格，
            // 而收发量是这页最该先看到的数字
            summary: [
                { key: "ADAPTER", value: enabled() ? "ON" : "OFF", sub: "适配器开关" },
                { key: "ONLINE", value: `${online}/${total}`, sub: "在线 / 总数" },
                { key: "UPLINK", value: String(s.today.up + s.today.event), sub: "今日上报核心" },
                { key: "DOWNLINK", value: String(s.today.down), sub: "今日核心下发" },
            ],
            panels: statusPanels(),
        }),
    });
}
/**
 * @description 本版变更最多显示几条
 * 这页走单图，不会被分片，也就没人替它兜底：不设限的话一个大版本二十几条能把图拉到近 6000px，而过高的图不少
 * QQ 适配器会拒发或压成马赛克。12 条时出图 4135px，仍在能发的量级，也覆盖了目前所有已发布版本的实际条目数。
 */
const CHANGE_LIMIT = 12;
/** @description 按 CHANGE_LIMIT 裁剪变更条目，超出的在末尾留一句说明 */
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
    // 省略的条目数明说，免得用户以为这版就改了这么多。挂在最后一个分类下而不是新起一节：它是个注脚
    if (dropped > 0 && groups.length)
        groups[groups.length - 1].items.push(`…另有 ${dropped} 条，详见 CHANGELOG.md`);
    return { ...r, groups };
}
/**
 * @description 渲染关于页（#早柚版本）
 * 与 #早柚更新日志 的分工：那条命令答「代码更新到哪了」（git 提交，按提交），这条答「我是谁、跑在什么环境上、
 * 这版改了什么」（CHANGELOG.md，按发布），所以这里不列任何 git 提交信息。
 */
export async function renderAbout() {
    const { total, online } = collect();
    const sys = sysInfo();
    // 缺失的 Bot 能力：兼容层能垫的都垫了，但 fileToUrl 垫不了，会真实影响大文件发送。
    // 这页顺带把探测结果摆出来，省得用户去翻启动日志
    const missing = missingBotApis();
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
            // 顺序即版面顺序，两列从左到右、从上到下铺。连接数这类会变的状态信息不放这页 —— 那是 #早柚状态 的事
            rows: [
                {
                    key: "操作系统",
                    value: sys.os,
                    sub: `${sys.platform} · ${sys.arch}`,
                },
                {
                    key: "运行框架",
                    value: frameLabel(),
                    sub: "按 Bot.uin 的形状判定：TRSS 存数组，喵崽继承 ICQQ 存单个数字",
                },
                {
                    key: "Node.js 版本",
                    value: `v${nodeVersion()}`,
                    mono: true,
                    sub: `V8 ${process.versions.v8}`,
                },
                {
                    key: "运行状态",
                    value: enabled() ? "已启用" : "已禁用",
                    mono: true,
                    sub: enabled() ? "云崽作为 ws 客户端主动连接核心" : "用 #早柚设置适配器开启 启用",
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
                    value: fwdLabel(),
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
            // 标题右侧速览：三项都是「此刻好不好」，扫一眼就走，和下面要一条条读的环境摘要不同。
            // 取值都短（个数、百分比、时长），44px 下不会顶到标题
            glance: [
                { key: "LINKS", value: `${online}/${total}` },
                { key: "MEMORY", value: `${sys.memoryPercent}%` },
                { key: "UPTIME", value: sys.processUptime },
            ],
            // 注意：传裸版本号（2.1.0）而不是 describe 串 —— CHANGELOG 的小节标题是纯 semver，
            // 拿 v2.1.0-2-gc6522ee-dirty 去比永远对不上
            changes: trimChanges(currentRelease(bareVersion)),
            // 四条铺满三列网格的两行（Docs 跨两列，见 About.tsx 的阈值判断）。
            // 注意：Repo 写死常量而不是读 git remote —— 远端地址可能内嵌凭据
            links: [
                { key: "License", value: "GPL-3.0-only" },
                { key: "Repo", value: "github.com/fanxiaocuo/gscore-adapter" },
                { key: "Core", value: "github.com/Genshin-bots/gsuid_core" },
                { key: "Docs", value: "docs.sayu-bot.com/LinkBots/AdapterList.html" },
            ],
        }),
    });
}
/**
 * @description 渲染更新日志图，两种语境共用一张版式
 * 有新提交（info.hasUpdate）时列远端比本地多的那些、语气是「可以更新了」；已最新时列本地最近的提交。
 * 判定哪种由调用方给的 info 决定，本函数只负责排版。
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
                // 注意：只显示引用名（origin/main），不显示仓库地址 —— 地址可能内嵌凭据
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
