/**
 * @description 应用加载器：把 src/apps/ 下的插件 class 收集进 apps 表，交给 index.ts 导出给框架
 * 注意：用静态 import 而不是扫目录 —— 新增 app 忘了注册的话 tsc 立刻报错，而扫目录漏了文件只会静默少一条指令
 * （框架只读 apps 对象，不会报错）。代价是加一个 app 要多改一行。
 */
import { PluginName } from "../../dir.js";
import GsCoreAdmin from "../../apps/admin.js";
import GsCoreStatus from "../../apps/status.js";
import GsCoreUpdate from "../../apps/update.js";
/**
 * @description 载入全部应用
 * 保持 async 与 `{ apps }` 的返回形状不变：index.ts 是 `await loadApps()`，改成同步会连带改动导出时序。
 */
export async function loadApps() {
    const apps = { GsCoreAdmin, GsCoreStatus, GsCoreUpdate };
    logger.info(`[${PluginName}] 应用加载完成：${Object.keys(apps).length} 个`);
    return { apps };
}
