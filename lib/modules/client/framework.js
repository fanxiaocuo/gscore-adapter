/**
 * 框架配置读取 / 主人判定
 *
 * 路径由 YunzaiPath 拼出绝对地址后动态 import，不再用
 * ../../../lib/config/config.js 这类相对路径 —— 那种写法依赖编译产物与
 * 源码同层深度，一改目录层级或 outDir 就断（旧实现即如此）。
 *
 * 两个框架的主人配置**结构不同**，均已读源码实测：
 *
 *   TRSS  lib/config/config.js:75  get master()   -> { bot_id: [user_id] }  分账号
 *         lib/config/config.js:64  get masterQQ() -> [qq]                   扁平
 *   Miao  lib/config/config.js:76  get masterQQ() -> [qq]                   扁平
 *         **没有 master getter**
 *
 * 比较方式也不同：
 *   TRSS  lib/plugins/loader.js:406  cfg.master[e.self_id]?.includes(String(e.user_id))
 *   Miao  lib/plugins/loader.js:451  cfg.masterQQ.includes(Number(e.user_id) || String(e.user_id))
 *
 * 所以照抄任何一边的写法都会在另一边静默失效（isMaster 恒为 false，
 * 主人命令在早柚核心侧不可用，且不报错）。这里按**字段形状**探测，不按框架名分支。
 *
 * 仍保留 try/catch：换 fork 或框架挪走 lib/config/ 时降级而不是崩。
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { YunzaiPath } from "../../dir.js";
import { makeLog } from "../../utils/compat.js";
export let cfg = {};
/** 框架配置是否读取成功 —— 供启动自检报告降级 */
export let cfgLoaded = false;
try {
    // 框架的 config 模块导出的是带 watcher / change_bot 的完整对象，
    // 这里只取主人相关字段，结构不重叠，需经 unknown 中转
    const url = pathToFileURL(join(YunzaiPath, "lib/config/config.js")).href;
    cfg = (await import(url)).default;
    cfgLoaded = true;
}
catch (err) {
    makeLog("error", ["读取框架配置失败，主人识别将失效（早柚核心侧主人命令不可用）", err], "GsCore");
}
/**
 * 判断某用户是否为主人。
 *
 * 优先用框架自己算好的 e.isMaster —— 但**只读不写**：
 * TRSS loader.js:404 用 defineProperty 挂了 getter，setter 会拦截并打告警加调用栈；
 * Miao loader.js:452 则是普通赋值 `e.isMaster = true`，无保护。
 * 两边语义相反，所以一律不写，只在框架已算过时读取。
 *
 * 本插件的监听器可能早于框架的 dealEvent 执行，此时 e.isMaster 尚未挂上，
 * 故需自行按配置判定，兼容两种结构。
 *
 * @param self_id  机器人账号（TRSS 分账号映射要用）
 * @param user_id  待判定的用户
 * @param e        原始事件，可选；有则优先采信框架结论
 */
export function isMasterUser(self_id, user_id, e) {
    if (user_id == null)
        return false;
    // 框架已算过就直接采信（避免与框架判定不一致）
    if (e && typeof e.isMaster === "boolean")
        return e.isMaster;
    const uid = String(user_id);
    // TRSS：分账号映射，按 self_id 取，字符串比较
    const m = cfg.master;
    if (m && !Array.isArray(m) && typeof m === "object") {
        if (m[self_id]?.map(String).includes(uid))
            return true;
    }
    // Miao / TRSS 共有：扁平列表。
    // Miao 原生用 Number(user_id) || String(user_id) 比较，这里统一转字符串两边都覆盖
    const flat = cfg.masterQQ;
    if (Array.isArray(flat) && flat.map(String).includes(uid))
        return true;
    return false;
}
