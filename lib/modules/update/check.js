/**
 * @description 更新检查：手动指令与定时任务共用的一层
 * 移植自 kkk 的 kkk-更新检测，保留它三个设计：检查与更新分离（只通知、不自动 git pull，自动更新会在用户不知情时
 * 改动代码并重启）、版本锁（同一个版本只播报一次）、首次检查延迟（错开启动高峰）。
 * 判定方式按本仓库改写：git 安装没有发布版本号，所以比「本地 HEAD 落后跟踪分支几个提交」（见 git.ts）。
 * 注意：播报锁刻意存进程内变量而不是 redis —— 锁只需要防「同一次运行里反复播报」，重启后本就该重新播报一次
 * （用户可能正是重启后才想知道有没有更新）。这是有意的，别改成持久化。
 */
import { config } from "../../config/index.js";
import { makeLog } from "../../utils/compat.js";
import { renderChangelog } from "../../modules/render/pages.js";
import { checkUpdate, log } from "./git.js";
/** @description 已播报过的版本标记，值为「本地 HEAD + 远端落后数」。注意：进程内，重启后重新播报是有意的 */
let announced = "";
/** @description 上次真正跑检查的时刻，用于把固定 cron 节流成配置里的间隔 */
let lastRun = 0;
/** @description 纯文本回退：渲染失败或没有 puppeteer 时用 */
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
 * @description 取更新日志的消息（图优先，失败回退文本）
 * @param doFetch 是否先 fetch 远端
 * @returns msg 可直接交给 `reply` / `sendMasterMsg` —— 出图成功是图片段，失败则是 `changelogText` 的纯文本
 */
export async function changelogMsg(doFetch) {
    const info = await checkUpdate(doFetch);
    // 已最新时列本地提交，让「更新日志」这个指令名字对得上内容
    const local = info.hasUpdate ? [] : await log("", 20);
    // false 表示「还没出图」：render 那条路径出错也返回 false（它把异常收进返回值），最后统一 `msg || 文本` 兜底
    let msg = false;
    try {
        msg = await renderChangelog(info, local);
    }
    catch (err) {
        makeLog("error", ["渲染更新日志失败", err], "GsCore");
    }
    return { info, msg: msg || changelogText(info, local) };
}
/** @description 跑一次检查，有新提交且开了 notify 就私聊主人 */
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
/** @description 进程启动时刻，用来实现「启动后 delay 分钟才做第一次检查」 */
const bootAt = Date.now();
/**
 * @description 定时任务回调，交给本体的 task 机制按 cron 调用
 * 用本体 task 而不是自己 setInterval：本体 loader 已用 node-schedule 管定时任务，顺带做了开始/结束日志与异常
 * 兜底，还会计入启动时的「加载定时任务[N个]」让用户看见它存在；自己搓 setInterval 要重写这些，还会因不对齐
 * 时钟而漂移。
 * 注意：cron 写死每 5 分钟、真正的间隔在函数里判 —— collectTask 只在插件实例化时读一次 plugin.task，
 * cron 字符串之后改不动，所以固定一个高频 tick、用 lastRun 比时间差，配置改了间隔无需重启即刻生效。
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
