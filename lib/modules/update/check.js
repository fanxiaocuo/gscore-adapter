/**
 * 更新检查：手动指令与定时任务共用的一层
 *
 * 移植自 karin-plugin-kkk 的 kkk-更新检测（packages/core/src/apps/update.ts），
 * 保留了它三个关键设计：
 *   1. 检查与更新分离——只通知，不自动 git pull。自动更新会在用户不知情时
 *      改动代码并重启，出问题很难回溯
 *   2. 版本锁：同一个版本只播报一次，否则每个周期都会私聊主人一遍
 *   3. 首次检查延迟：错开启动高峰
 *
 * 两处按本仓库改写：
 *   - 判定方式：kkk 比 npm registry 上的 semver，本插件是 git 安装、没有发布
 *     版本号，改比「本地 HEAD 落后跟踪分支几个提交」（见 git.ts）
 *   - 锁的存储：kkk 用 redis 存 UPDATE_LOCK_KEY。这里用进程内变量——锁只需要
 *     防「同一次运行里反复播报」，重启后本就该重新播报一次（用户可能正是重启
 *     后才想知道有没有更新）。少一个外部依赖，也不会在 redis 里留垃圾键。
 */
import { config } from "../../config/index.js";
import { makeLog } from "../../utils/compat.js";
import { renderChangelog } from "../../modules/render/pages.js";
import { checkUpdate, log } from "./git.js";
/** 已播报过的版本标记，值为「本地 HEAD + 远端落后数」 */
let announced = "";
/** 上次真正跑检查的时刻，用于把固定 cron 节流成配置里的间隔 */
let lastRun = 0;
/** 纯文本回退：渲染失败或没有 puppeteer 时用 */
export function changelogText(info, local = []) {
    const commits = info.hasUpdate ? info.commits : local;
    const out = [];
    if (info.hasUpdate)
        out.push(`早柚核心适配器有新版本，落后 ${info.behind} 个提交`);
    else
        out.push("早柚核心适配器已是最新");
    if (info.local)
        out.push(`本地：${info.local}`);
    if (info.ref)
        out.push(`跟踪：${info.ref}`);
    if (info.error)
        out.push(`注意：${info.error}`);
    if (commits.length) {
        out.push("", info.hasUpdate ? "新提交：" : "最近提交：");
        // 文本里只列前 10 条：私聊长文本会被平台截断，图片才是主路径
        for (const c of commits.slice(0, 10))
            out.push(`${c.hash} [${c.date}] ${c.subject}`);
        if (commits.length > 10)
            out.push(`…… 其余 ${commits.length - 10} 条见 #早柚更新日志`);
    }
    if (info.hasUpdate)
        out.push("", "用 #早柚更新 拉取");
    return out.join("\n");
}
/**
 * 取更新日志的消息（图优先，失败回退文本）
 *
 * @param doFetch 是否先 fetch 远端
 */
export async function changelogMsg(doFetch) {
    const info = await checkUpdate(doFetch);
    // 已最新时列本地提交，让「更新日志」这个指令名字对得上内容
    const local = info.hasUpdate ? [] : await log("", 20);
    let msg = false;
    try {
        msg = await renderChangelog(info, local);
    }
    catch (err) {
        makeLog("error", ["渲染更新日志失败", err], "GsCore");
    }
    return { info, msg: msg || changelogText(info, local) };
}
/** 跑一次检查，有新提交且开了 notify 就私聊主人 */
export async function runCheck() {
    const info = await checkUpdate(true);
    if (info.error) {
        // 定时任务里 fetch 失败是常态（断网、限流），只记日志不打扰主人
        makeLog("debug", `更新检查：${info.error}`, "GsCore");
        return info;
    }
    if (!info.hasUpdate) {
        makeLog("debug", "更新检查：已是最新", "GsCore");
        return info;
    }
    const tag = `${info.local}-${info.behind}`;
    if (tag === announced) {
        makeLog("debug", `更新检查：${tag} 已播报过，跳过`, "GsCore");
        return info;
    }
    announced = tag;
    makeLog("mark", `插件有新提交（落后 ${info.behind} 个）`, "GsCore");
    if (config.update_check?.notify === false)
        return info;
    let msg = false;
    try {
        msg = await renderChangelog(info);
    }
    catch (err) {
        makeLog("error", ["渲染更新日志失败", err], "GsCore");
    }
    try {
        // 与 GsCoreClient.notify 同一套：sendMasterMsg 未必存在，返回值也未必是 Promise
        const ret = Bot.sendMasterMsg?.(msg || changelogText(info));
        if (ret?.catch)
            ret.catch(() => { });
    }
    catch { }
    return info;
}
/** 进程启动时刻，用来实现「启动后 delay 分钟才做第一次检查」 */
const bootAt = Date.now();
/**
 * 定时任务回调，交给本体的 task 机制按 cron 调用
 *
 * 为什么用本体 task 而不是自己 setInterval：
 * 本体 loader 已经用 node-schedule 管定时任务了（lib/plugins/loader.js:537-551），
 * 顺带把开始/结束日志和异常兜底都做了（startTask，同文件 516-534），
 * 并且会计入启动时的「加载定时任务[N个]」——用户能看见它存在。
 * 自己搓 setInterval 就是把这些重写一遍，还会因为 setInterval 不对齐时钟而漂移。
 *
 * 为什么 cron 写死每 5 分钟、间隔在函数里判：
 * collectTask 只在插件实例化时读一次 plugin.task（loader.js:143 + 507-514），
 * cron 字符串之后改不动。所以固定一个高频 tick，真正的节流用 lastRun 比时间差，
 * 这样配置改了间隔无需重启即刻生效。
 */
export async function tick() {
    const conf = config.update_check;
    if (!conf?.enable)
        return;
    const now = Date.now();
    // 下限 30 分钟：每次检查都要 fetch 一次远端，更密没有意义且对托管方不友好
    const interval = Math.max(30, Number(conf.interval) || 180) * 60000;
    const delay = Math.max(0, Number(conf.delay) || 0) * 60000;
    // 启动后先静默 delay：刚起来时连接还在建、渲染要拉浏览器，别再插一次 fetch
    if (now - bootAt < delay)
        return;
    if (lastRun && now - lastRun < interval)
        return;
    lastRun = now;
    await runCheck();
}
