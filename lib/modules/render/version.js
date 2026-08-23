/**
 * @description 插件版本号与构建标识，判据是分支名 + git describe
 * 只看 package.json 不够：三个分支的版本号全一样（release-please 只在发版时改它），`2.1.0` 既可能是
 * release 上的正式版，也可能是 main 上多跑了十几个提交的开发版。
 * 注意：preview / release 是编译产物分支，历史与 main 不连通，`git describe` 在那里直接报
 * "No tags can describe"（实测），所以 describe 只有 main 能用，另两条必须靠分支名判定。
 * 注意：package.json 运行时读而不是 import —— import 能过编译，但 rootDir 是 src/，JSON 不会被复制到
 * lib/，产物里那个 require 会指向不存在的路径。
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { PluginPath } from "../../dir.js";
function read() {
    try {
        const pkg = JSON.parse(fs.readFileSync(join(PluginPath, "package.json"), "utf8"));
        return pkg.version || "0.0.0";
    }
    catch {
        return "0.0.0";
    }
}
/**
 * @description 同步跑一条 git 子命令，失败返回空串
 * 注意：这里必须同步 —— 下面几个常量是模块加载时求值的，页脚与状态图都从同步调用点读它们，改成异步就得
 * 把调用方全改成 await。git 本地查询是毫秒级，且只在加载时跑一次。
 * 压缩包安装（没有 .git）、机器上没装 git、目录不是仓库都会落到 catch，返回空串由调用方降级。
 */
function git(args) {
    try {
        return String(execFileSync("git", args, {
            cwd: PluginPath,
            timeout: 3000,
            windowsHide: true,
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf8",
        })).trim();
    }
    catch {
        return "";
    }
}
/** @description 安装所在的分支名；压缩包安装或游离 HEAD 时为空串 */
export const branch = git(["branch", "--show-current"]);
/**
 * @description git describe 结果，如 v2.1.0 或 v2.1.0-2-gc6522ee
 * --tags 允许用轻量 tag；--always 兜底成裸 hash，省得整个串变空。只有 main 能算出带 tag 的结果。
 */
export const describe = git(["describe", "--tags", "--always", "--dirty"]);
/** @description 本地 HEAD 短 hash */
export const commit = git(["rev-parse", "--short", "HEAD"]);
export const version = read();
/**
 * @description 展示用版本串，git describe 风格
 * main 上直接用 describe（`v2.1.0-2-gc6522ee` 一眼能看出「比 2.1.0 多两个提交」）；preview / release 因为
 * 历史断开只剩 hash，拼成 `v2.1.0+40f2dd4` —— 加号是 semver 的构建元数据分隔符，语义正好。
 * 没有 git 信息时退回裸版本号。
 */
export function versionLabel() {
    if (!describe)
        return `v${version}`;
    // 带 tag 的 describe 自己就以 v 开头，不要再拼一次
    if (/^v?\d+\.\d+\.\d+/.test(describe))
        return describe.startsWith("v") ? describe : `v${describe}`;
    return `v${version}+${describe}`;
}
