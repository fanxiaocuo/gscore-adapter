/**
 * 入口（真实逻辑）
 *
 * 由 index.js 转调，index.js 保持 .js 是因为框架 loader 只认
 * plugins/<name>/index.js（lib/plugins/loader.js:55）。
 */
import { configFile } from "./config/index.js";
export declare const apps: Record<string, any>;
export { configFile };
