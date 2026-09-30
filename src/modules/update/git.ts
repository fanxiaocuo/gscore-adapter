/**
 * @description git 查询，返回结构化结果供出图排版
 * 用 Node 内置 child_process 而非本体 Update.exec（它调 Bot.exec，只有 TRSS 有）；也不复用 getLog()（它末尾 Bot.makeForwardArray() 返回拼好的转发消息，拿不到 hash/时间/标题分开的字段）。取数命令与本体一致（同样 --pretty/--date），行为不分叉。
 */
import { execFile } from "node:child_process"
import { PluginPath } from "@/dir"

/** @description git 子命令超时。拉远端要走网络，给宽一点；本地查询很快，用不满 */
const TIMEOUT = 60000

/** @description 一条提交 */
export interface Commit {
  /** 短 hash */
  hash: string
  /** 提交时间，YYYY-MM-DD HH:mm:ss */
  date: string
  /** 标题（首行） */
  subject: string
}

/**
 * @description 在插件目录执行 git
 * 注意：用 execFile 而非 exec，exec 把命令交给 shell 拼接，参数里的空格/引号（提交标题常见）会被重新解析；execFile 直接传 argv 不经 shell。
 */
function git(args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise(resolve => {
    execFile(
      "git",
      args,
      { cwd: PluginPath, timeout: TIMEOUT, maxBuffer: 1024 * 1024 * 10, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          out: String(stdout || "").trim(),
          err: String(stderr || error?.message || "").trim(),
        })
      },
    )
  })
}

/** @description 插件目录是不是一个 git 仓库（压缩包安装的没有 .git，所有更新功能都该跳过） */
export async function isRepo(): Promise<boolean> {
  return (await git(["rev-parse", "--is-inside-work-tree"])).out === "true"
}

/** @description 当前分支名 */
export async function currentBranch(): Promise<string> {
  return (await git(["branch", "--show-current"])).out
}

/**
 * @description 当前分支跟踪的远端引用，如 origin/main
 * 从 git config 读实际配置而非假定 origin/<当前分支>，改过 remote 名或跟踪分支的仓库会算错。
 */
export async function upstream(): Promise<string> {
  const branch = await currentBranch()
  if (!branch) return ""
  const remote = (await git(["config", `branch.${branch}.remote`])).out
  if (!remote) return ""
  return `${remote}/${branch}`
}

/** @description 本地 HEAD 短 hash */
export async function localCommit(): Promise<string> {
  return (await git(["rev-parse", "--short", "HEAD"])).out
}

/**
 * @description 拉取远端信息但不改工作区
 * 不 fetch 远端引用就不是新的，比较永远是「已最新」；用 fetch 而非 pull，检查更新不该动工作区。
 */
export async function fetch(): Promise<{ ok: boolean; err: string }> {
  const r = await git(["fetch", "--quiet"])
  return { ok: r.ok, err: r.err }
}

/**
 * @description 本地落后远端多少个提交，0 就是已最新
 * rev-list --count A..B = B 有而 A 没有的提交数，即远端比本地多几个。
 */
export async function behind(ref: string): Promise<number> {
  const r = await git(["rev-list", "--count", `HEAD..${ref}`])
  const n = Number(r.out)
  return Number.isFinite(n) ? n : 0
}

/**
 * @description 读提交记录
 * 注意：分隔符用 \x1f（ASCII 单元分隔符）而非 "||"，提交标题里出现「||」合法且会截断标题，\x1f 不可能出现在标题里。
 * @param range 传 "HEAD..origin/main" 取未拉取的新提交；留空取本地已有的
 */
export async function log(range: string, limit = 30): Promise<Commit[]> {
  const args = ["log", `-${limit}`, "--pretty=%h\x1f%cd\x1f%s", "--date=format:%F %T"]
  if (range) args.push(range)
  const r = await git(args)
  if (!r.ok || !r.out) return []

  const list: Commit[] = []
  for (const line of r.out.split("\n")) {
    const [hash, date, ...rest] = line.split("\x1f")
    const subject = rest.join("\x1f")
    if (!hash || !subject) continue
    // 跳过 merge 提交，对使用者没有信息量
    if (subject.startsWith("Merge branch") || subject.startsWith("Merge pull request")) continue
    list.push({ hash, date, subject })
  }
  return list
}

/** @description 远端仓库地址，去掉可能内嵌的凭据 */
export async function remoteUrl(): Promise<string> {
  const branch = await currentBranch()
  const remote = branch ? (await git(["config", `branch.${branch}.remote`])).out : ""
  const r = await git(["config", `remote.${remote || "origin"}.url`])
  // 注意：https://user:pass@host 里的凭据必须抹掉，这个字符串会进图片被转发出去
  return r.out.replace(/\/\/([^@/]+)@/, "//")
}

/** @description 更新检查结果 */
export interface UpdateInfo {
  /** 是否有新提交 */
  hasUpdate: boolean
  /** 落后的提交数 */
  behind: number
  /** 本地 HEAD */
  local: string
  /** 跟踪的远端引用 */
  ref: string
  /** 新提交（远端有而本地没有的） */
  commits: Commit[]
  /** 出错原因，成功时为空 */
  error: string
}

/**
 * @description 检查远端是否有新提交
 * @param doFetch 是否先 fetch。定时任务要，纯看日志不用
 */
export async function checkUpdate(doFetch = true): Promise<UpdateInfo> {
  const empty: UpdateInfo = {
    hasUpdate: false,
    behind: 0,
    local: "",
    ref: "",
    commits: [],
    error: "",
  }

  if (!(await isRepo())) return { ...empty, error: "插件目录不是 git 仓库，无法检查更新" }

  if (doFetch) {
    const f = await fetch()
    // fetch 失败不算致命：可能只是暂时断网，本地信息仍可用来展示
    if (!f.ok) return { ...empty, local: await localCommit(), error: `拉取远端失败：${f.err}` }
  }

  const ref = await upstream()
  if (!ref) return { ...empty, local: await localCommit(), error: "当前分支没有跟踪的远端分支" }

  const n = await behind(ref)
  return {
    hasUpdate: n > 0,
    behind: n,
    local: await localCommit(),
    ref,
    commits: n > 0 ? await log(`HEAD..${ref}`, 30) : [],
    error: "",
  }
}
