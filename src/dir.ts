import { fileURLToPath } from "node:url"
import { dirname, join, basename } from "node:path"

/**
 * 插件根目录
 *
 * 打包产物是 lib/index.js，上跳一级即插件根。
 *
 * 这条依赖「产物就在 lib/ 一层里」——tsdown.config.ts 的 outDir 必须保持
 * lib/、且不能开子目录分块，否则 ResPath / YunzaiPath 会整体偏一层，
 * 表现是读不到 resources/ 和框架配置。改 outDir 前先看这里。
 */
export const PluginPath = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * 云崽根目录
 *
 * 由 PluginPath 上跳两级（plugins/<name>/ -> 根）得到，不用 process.cwd() ——
 * cwd 取决于**从哪儿启动进程**，在插件目录里跑脚本时它就是插件目录，
 * 于框架配置会被拼成 plugins/<name>/lib/config/config.js 而找不到。
 * 插件必须放在 plugins/ 下才会被框架 loader 扫到，所以这个层级关系是稳定的。
 */
export const YunzaiPath = join(PluginPath, "../..")

/** 插件名 */
export const PluginName = basename(PluginPath)

/** resources 目录 */
export const ResPath = join(PluginPath, "resources")

/** 配置目录 */
export const ConfigPath = join(ResPath, "config")
