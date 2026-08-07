import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
/**
 * 插件根目录
 * 编译后本文件位于 lib/dir.js，上跳一级即插件根
 */
export const PluginPath = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * 云崽根目录
 *
 * 由 PluginPath 上跳两级（plugins/<name>/ -> 根）得到，不用 process.cwd() ——
 * cwd 取决于**从哪儿启动进程**，在插件目录里跑脚本时它就是插件目录，
 * 于框架配置会被拼成 plugins/<name>/lib/config/config.js 而找不到。
 * 插件必须放在 plugins/ 下才会被框架 loader 扫到，所以这个层级关系是稳定的。
 */
export const YunzaiPath = join(PluginPath, "../..");
/** 插件名 */
export const PluginName = basename(PluginPath);
/** 编译产物目录 */
export const libDir = join(PluginPath, "lib");
/** apps 目录 */
export const AppsDir = join(libDir, "apps");
/** resources 目录 */
export const ResPath = join(PluginPath, "resources");
/** 配置目录 */
export const ConfigPath = join(ResPath, "config");
