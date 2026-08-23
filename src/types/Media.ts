/**
 * @description 媒体入参类型
 * 云崽消息段里的 file / url 没有统一声明（ICQQ 的 ImageElem.file 是 `string | Buffer | Readable`，
 * 各适配器自造的段又常常只填 url，而 `Bot.Buffer` 的入参声明宽到 `any`），这里收成具名类型让两侧对得上。
 */
/**
 * @description 能被 {@link import("@/utils/compat").toBuffer} 解析的文件入参
 * 字符串一路涵盖 `base64://` / `data:` / `http(s)://` / `file://` / 裸路径，分派见 compat.toBuffer 与云崽 lib/util.js:272。
 * 注意：不含 `Readable` —— `Bot.Buffer` 对非 Buffer 入参第一句就是 `String(data)`（lib/util.js:274），流会变成 `[object Object]` 再当路径去 stat，声明支持就等于静默产出坏图
 */
export type FileLike = string | Buffer

/**
 * @description 消息段里可能出现的媒体入参，比 {@link FileLike} 多一个 `Readable`
 * 两者的区别是「段里能带什么」与「`toBuffer` 能读什么」：段确实可能带流（别的适配器收到的段、用户自己构造的段）。
 * 注意：流要在 `utils/media.ts` 的入口处先读成 Buffer 再往下走，早先没区分时流会一路走到 `toBuffer` 被静默转成坏图
 */
export type MediaInput = FileLike | import("node:stream").Readable

/**
 * @description 云崽消息段中承载媒体的那部分字段
 * 收到的消息带 url，自己构造的消息带 file，file 段还可能只有 fid，所以 convert/toGscore.ts 一律 `i.url ?? i.file ?? i.fid` 地取。
 */
export interface MediaSegmentLike {
  url?: FileLike
  file?: FileLike
  fid?: string
  name?: string
  width?: number | string
  height?: number | string
}
