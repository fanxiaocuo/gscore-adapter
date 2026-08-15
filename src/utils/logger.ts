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
 * URL 查询串脱敏：`https://h/x.png?rkey=xxx` -> `https://h/x.png?…`
 *
 * 媒体外链的查询串就是凭据本体
 * ------
 * 上行媒体自 b1a2c19 起是裸 HTTPS（`link://` 只是下行标记），而 QQ 的图片外链
 * 带的 `rkey` 是有时效的访问凭据，腾讯 CDN 的签名参数同理；下行侧 media.ts 的
 * fromGscoreMedia 也会把核心的 `link://` 还原成裸 http(s) 塞进 image 段的 file。
 * 于是 GsCoreClient 那条 info 级「早柚核心消息」会把整条外链连签名一起打进日志。
 *
 * 只砍查询串不砍路径：排查媒体问题要看的是主机与扩展名（能不能公网访问、
 * 是不是预期的图），而这两样都在 `?` 左边。
 *
 * 两侧都用「URL 合法字符」白名单，不用 `[^\s"']` 那种黑名单
 * ------
 * 日志里的外链多半嵌在中文句子或 JSON 里，而 `，、。` 这些既不是空白也不是引号。
 * 黑名单写法会让 `.*?` 跨过它们去够后面的 `?`，于是
 *   `下载 http://h/x.png?rkey=X，然后看`
 * 的尾段会把 `，然后看` 一起吞掉 —— 脱敏顺手删掉了日志正文，比漏一个 rkey 更难查。
 * 白名单里没有 CJK，匹配自然停在 URL 结束的地方。
 */
function redactQuery(s: string): string {
  return s.replace(
    /(https?:\/\/[A-Za-z0-9\-._~:/[\]@!$&*+,;=%]*)\?[A-Za-z0-9\-._~:/@!$&*+,;=%?#]*/gi,
    "$1?…",
  )
}

/**
 * 日志用：截断 base64、砍掉外链查询串，避免刷屏与凭据外泄
 * config.log_truncate 为 false 时只做脱敏，不截断
 *
 * 同上，收任意值 —— 它就是给「要打进日志的东西」用的
 *
 * 脱敏不受 log_truncate 影响：那个开关是给「日志太长」用的，
 * 而凭据不该因为用户想看完整内容就跟着漏出去。
 */
export function logStr(msg: any) {
  const s = redactQuery(toStr(msg))
  return config.log_truncate === false ? s : s.replace(/base64:\/\/[^"'\],]{32,}/g, "base64://...")
}
