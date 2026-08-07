/**
 * 插件根目录
 * 编译后本文件位于 lib/dir.js，上跳一级即插件根
 */
export declare const PluginPath: string;
/**
 * 云崽根目录
 *
 * 由 PluginPath 上跳两级（plugins/<name>/ -> 根）得到，不用 process.cwd() ——
 * cwd 取决于**从哪儿启动进程**，在插件目录里跑脚本时它就是插件目录，
 * 于框架配置会被拼成 plugins/<name>/lib/config/config.js 而找不到。
 * 插件必须放在 plugins/ 下才会被框架 loader 扫到，所以这个层级关系是稳定的。
 */
export declare const YunzaiPath: string;
/** 插件名 */
export declare const PluginName: string;
/** 编译产物目录 */
export declare const libDir: string;
/** apps 目录 */
export declare const AppsDir: string;
/** resources 目录 */
export declare const ResPath: string;
/** 配置目录 */
export declare const ConfigPath: string;
