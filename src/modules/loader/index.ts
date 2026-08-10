/**
 * 应用加载器
 *
 * 把 src/apps/ 下的插件 class 收集进 apps 表，交给 index.ts 导出给框架。
 *
 * 为什么是静态 import 而不是扫目录
 * ------------------------------
 * 原先这里 readdir 遍历 lib/apps/*.js 再逐个动态 import。产物现在与 src/ 结构
 * 一一对应，lib/apps/ 确实存在，扫目录在技术上可行——但静态表更好：新增 app
 * 忘了注册的话 tsc 立刻报错，而扫目录漏了文件只会静默少一条指令（框架只读
 * apps 对象，不会报错，见 Miao-Yunzai 的 lib/plugins/loader.js）。
 * 代价是加一个 app 要多改这一行，可以接受——三个。
 */
import { PluginName } from "@/dir"
import GsCoreAdmin from "@/apps/admin"
import GsCoreStatus from "@/apps/status"
import GsCoreUpdate from "@/apps/update"

/**
 * 载入全部应用
 *
 * 保持 async 与 `{ apps }` 的返回形状不变：index.ts 是 `await loadApps()`，
 * 改成同步会连带改动导出时序，收益为零。
 */
export async function loadApps() {
  const apps = { GsCoreAdmin, GsCoreStatus, GsCoreUpdate }
  logger.info(`[${PluginName}] 应用加载完成：${Object.keys(apps).length} 个`)
  return { apps }
}
