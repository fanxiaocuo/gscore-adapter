/**
 * 框架配置读取
 *
 * 只用来读 cfg.master（判断主人）。
 *
 * 路径由 YunzaiPath 拼出绝对地址后动态 import，不再用
 * ../../../lib/config/config.js 这类相对路径 —— 那种写法依赖编译产物与
 * 源码同层深度，一改目录层级或 outDir 就断（旧实现即如此）。
 *
 * 仍保留 try/catch：换 fork 或框架挪走 lib/config/ 时降级而不是崩。
 * 取不到 master 时的后果：user_pm 不会给出 1（主人），
 * 早柚核心侧的主人专属命令会失效 —— 功能降级，但不影响普通消息。
 */
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { YunzaiPath } from "@/dir"

export let cfg: {
  master: Record<string, (string | number)[]>
} = {
  master: {},
}

try {
  // 框架的 config 模块导出的是带 watcher / change_bot 的完整对象，
  // 这里只取 master 一个字段，结构不重叠，需经 unknown 中转
  const url = pathToFileURL(join(YunzaiPath, "lib/config/config.js")).href
  cfg = (await import(url)).default as unknown as typeof cfg
} catch (err) {
  Bot.makeLog(
    "error",
    ["读取框架配置失败，主人识别将失效（早柚核心侧主人命令不可用）", err],
    "GsCore",
  )
}
