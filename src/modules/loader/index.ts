/**
 * 应用加载器
 *
 * 把 src/apps/ 下的插件 class 收集进 apps 表，交给 index.ts 导出给框架。
 *
 * 为什么是静态 import 而不是扫目录
 * ------------------------------
 * 原先这里 readdir 遍历 lib/apps/*.js 再逐个动态 import。打包之后 lib/ 只剩
 * 一个 index.js，那个目录根本不存在，扫出来是空表——三个指令会全部静默失效
 * （框架只读 apps 对象，不会报错，见 Miao-Yunzai 的 lib/plugins/loader.js）。
 *
 * 换成静态 import 还顺带修掉了两个隐患：打包器能看见依赖关系（动态路径它看不
 * 见，会把 apps 整块从产物里摇掉）；新增 app 忘了注册的话 tsc 立刻报，而不是
 * 等到运行时发现指令没反应。代价是加一个 app 要多改这一行，可以接受——三个。
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
