/**
 * 日志工具
 *
 * 统一插件的日志前缀，避免各处硬编码 "GsCore" 字符串。
 */
import { config } from "@/config"
import { makeLog, toStr } from "./compat.js"

/** 默认日志前缀 */
export const LOG_TAG = "GsCore"

/**
 * 打一条插件日志
 *
 * `msg` 是 any 而不是 string：与 `Bot.makeLog` 的契约一致 —— 它收对象、Error、
 * 以及「数组表示分段格式化」，由 compat 的垫片负责转成可读文本。收窄成 string
 * 会让每个调用点先自己 `toStr` 一遍，反而绕过框架原生的格式化
 */
export function log(level: string, msg: any, tag = LOG_TAG, force = false) {
  return makeLog(level, msg, tag, force)
}

/**
 * 日志用：截断 base64，避免刷屏
 * config.log_truncate 为 false 时原样输出
 *
 * 同上，收任意值 —— 它就是给「要打进日志的东西」用的
 */
export function logStr(msg: any) {
  const s = toStr(msg)
  return config.log_truncate === false ? s : s.replace(/base64:\/\/[^"'\],]{32,}/g, "base64://...")
}
