/**
 * @description git 查询，返回结构化结果供出图排版
 * 直接用 Node 内置的 child_process 而不是本体的 Update.exec：后者调的是 Bot.exec，只有 TRSS 有。
 * 也不复用本体的 getLog()：它末尾直接 Bot.makeForwardArray()，返回拼好的转发消息而不是数据，拿不到 hash /
 * 时间 / 标题分开的字段。取数命令与本体保持一致（同样的 --pretty/--date），行为不会分叉。
 */
import { execFile } from "node:child_process";
import { PluginPath } from "../../dir.js";
/** @description git 子命令超时。拉远端要走网络，给宽一点；本地查询很快，用不满 */
const TIMEOUT = 60000;
/**
 * @description 在插件目录执行 git
 * 注意：用 execFile 而不是 exec —— exec 把整条命令交给 shell 拼接，参数里只要有空格或引号就可能被重新解析
 * （提交标题里这两样都很常见）。execFile 直接传 argv，不经过 shell。
 */
function git(args) {
    return new Promise(resolve => {
        execFile("git", args, { cwd: PluginPath, timeout: TIMEOUT, maxBuffer: 1024 * 1024 * 10, windowsHide: true }, (error, stdout, stderr) => {
            resolve({
                ok: !error,
                out: String(stdout || "").trim(),
                err: String(stderr || error?.message || "").trim(),
            });
        });
    });
}
/** @description 插件目录是不是一个 git 仓库（压缩包安装的没有 .git，所有更新功能都该跳过） */
export async function isRepo() {
    return (await git(["rev-parse", "--is-inside-work-tree"])).out === "true";
}
/** @description 当前分支名 */
export async function currentBranch() {
    return (await git(["branch", "--show-current"])).out;
}
/**
 * @description 当前分支跟踪的远端引用，如 origin/main
 * 与本体 getRemoteBranch() 同样的思路：从 git config 读实际配置，而不是假定 origin/<当前分支> ——
 * 改过 remote 名或跟踪分支的仓库会算错。
 */
export async function upstream() {
    const branch = await currentBranch();
    if (!branch)
        return "";
    const remote = (await git(["config", `branch.${branch}.remote`])).out;
    if (!remote)
        return "";
    return `${remote}/${branch}`;
}
/** @description 本地 HEAD 短 hash */
export async function localCommit() {
    return (await git(["rev-parse", "--short", "HEAD"])).out;
}
/**
 * @description 拉取远端信息但不改工作区
 * 只有 fetch 过远端引用才是新的，否则下面的比较永远是「已最新」。用 fetch 而不是 pull：检查更新不该动工作区。
 */
export async function fetch() {
    const r = await git(["fetch", "--quiet"]);
    return { ok: r.ok, err: r.err };
}
/**
 * @description 本地落后远端多少个提交，0 就是已最新
 * rev-list --count A..B = B 有而 A 没有的提交数，即「远端比本地多几个」。
 */
export async function behind(ref) {
    const r = await git(["rev-list", "--count", `HEAD..${ref}`]);
    const n = Number(r.out);
    return Number.isFinite(n) ? n : 0;
}
/**
 * @description 读提交记录
 * 注意：分隔符用 \x1f（ASCII 单元分隔符）而不是本体的 "||" —— 提交标题里出现「||」虽然少见但完全合法，
 * 真出现就会把标题截断；\x1f 不可能出现在标题里。
 * @param range 传 "HEAD..origin/main" 取未拉取的新提交；留空取本地已有的
 * @param limit 最多几条
 */
export async function log(range, limit = 30) {
    const args = ["log", `-${limit}`, "--pretty=%h\x1f%cd\x1f%s", "--date=format:%F %T"];
    if (range)
        args.push(range);
    const r = await git(args);
    if (!r.ok || !r.out)
        return [];
    const list = [];
    for (const line of r.out.split("\n")) {
        const [hash, date, ...rest] = line.split("\x1f");
        const subject = rest.join("\x1f");
        if (!hash || !subject)
            continue;
        // 与本体一致：跳过 merge 提交，它们对使用者没有信息量
        if (subject.startsWith("Merge branch") || subject.startsWith("Merge pull request"))
            continue;
        list.push({ hash, date, subject });
    }
    return list;
}
/** @description 远端仓库地址，去掉可能内嵌的凭据 */
export async function remoteUrl() {
    const branch = await currentBranch();
    const remote = branch ? (await git(["config", `branch.${branch}.remote`])).out : "";
    const r = await git(["config", `remote.${remote || "origin"}.url`]);
    // 注意：https://user:pass@host 里的凭据必须抹掉 —— 这个字符串会进图片，截图会被转发出去
    return r.out.replace(/\/\/([^@/]+)@/, "//");
}
/**
 * @description 检查远端是否有新提交
 * @param doFetch 是否先 fetch。定时任务要，纯看日志不用
 */
export async function checkUpdate(doFetch = true) {
    const empty = {
        hasUpdate: false,
        behind: 0,
        local: "",
        ref: "",
        commits: [],
        error: "",
    };
    if (!(await isRepo()))
        return { ...empty, error: "插件目录不是 git 仓库，无法检查更新" };
    if (doFetch) {
        const f = await fetch();
        // fetch 失败不算致命：可能只是暂时断网，本地信息仍可用来展示
        if (!f.ok)
            return { ...empty, local: await localCommit(), error: `拉取远端失败：${f.err}` };
    }
    const ref = await upstream();
    if (!ref)
        return { ...empty, local: await localCommit(), error: "当前分支没有跟踪的远端分支" };
    const n = await behind(ref);
    return {
        hasUpdate: n > 0,
        behind: n,
        local: await localCommit(),
        ref,
        commits: n > 0 ? await log(`HEAD..${ref}`, 30) : [],
        error: "",
    };
}
