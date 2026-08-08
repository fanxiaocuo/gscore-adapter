/**
 * 日志工具
 *
 * 统一插件的日志前缀，避免各处硬编码 "GsCore" 字符串。
 */
import { config } from "../config/index.js";
import { makeLog, toStr } from "./compat.js";
/** 默认日志前缀 */
export const LOG_TAG = "GsCore";
/** 打一条插件日志 */
export function log(level, msg, tag = LOG_TAG, force = false) {
    return makeLog(level, msg, tag, force);
}
/**
 * 日志用：截断 base64，避免刷屏
 * config.log_truncate 为 false 时原样输出
 */
export function logStr(msg) {
    const s = toStr(msg);
    return config.log_truncate === false ? s : s.replace(/base64:\/\/[^"'\],]{32,}/g, "base64://...");
}
