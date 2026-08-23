/**
 * @description 日志工具：给 `Bot.makeLog` 补上插件默认前缀，并按需截断 base64 免得刷屏
 * 注意：绝大多数调用点直接写 `makeLog(..., "GsCore")`，这里的前缀只是 `log()` 的默认值，不是全局唯一真源。
 */
import { config } from "@/config"
import { makeLog, toStr } from "./compat.js"

/** 默认日志前缀，只作 log() 的默认参数 */
const LOG_TAG = "GsCore"

/**
 * @description 打一条插件日志
 * `msg` 标 any 与 `Bot.makeLog` 的契约一致（收对象、Error、数组=分段格式化）；
 * 收窄成 string 会让调用点各自 toStr 一遍，反而绕过框架原生格式化。
 */
export function log(level: string, msg: any, tag = LOG_TAG, force = false) {
  return makeLog(level, msg, tag, force)
}

/**
 * @description 日志用：截断 base64 避免刷屏，`config.log_truncate` 为 false 时不截断
 */
export function logStr(msg: any) {
  const s = toStr(msg)
  return config.log_truncate === false ? s : s.replace(/base64:\/\/[^"'\],]{32,}/g, "base64://...")
}
