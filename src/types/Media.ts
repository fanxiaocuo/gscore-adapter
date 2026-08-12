/**
 * 媒体入参类型
 *
 * 云崽消息段里的 file / url 字段没有统一声明：ICQQ 的 ImageElem.file 是
 * `string | Buffer | Readable`，各适配器自造的段又常常只填 url，
 * 而 `Bot.Buffer` 的入参声明宽到 `any`（util.d.ts:208）。
 * 这里收成一个具名类型，让 utils/media.ts 与 convert/ 两侧对得上。
 */
/**
 * 能被 {@link import("@/utils/compat").toBuffer} 解析的文件入参
 *
 * 字符串一路涵盖 `base64://` / `data:` / `http(s)://` / `file://` / 裸路径，
 * 具体分派见 compat.toBuffer 与云崽 lib/util.js:272 的 `Bot.Buffer`。
 *
 * 为什么不含 Readable
 * -----------------
 * `segment.image` 的声明是 `file: string | Readable | Buffer`（ICQQ 侧支持流），
 * 但**读文件这一路不支持**：`Bot.Buffer` 对非 Buffer 入参第一句就是
 * `data = this.String(data)`（lib/util.js:274），流会被字符串化成
 * `[object Object]` 再当路径去 stat，垫片同样只做 `String(file)`。
 * 写进 FileLike 就等于声明"能处理"，而实际会静默产出一张坏图。
 * 真有流入参在调用点报错是对的 —— 那是在提示该先自己读成 Buffer。
 */
export type FileLike = string | Buffer

/**
 * 消息段里可能出现的媒体入参，比 {@link FileLike} 多一个 `Readable`
 *
 * 两者的区别是「段里能带什么」与「`toBuffer` 能读什么」：
 *   - `ImageElem.file` 声明是 `string | Buffer | Readable`（icqq.d.ts:691），
 *     所以段**确实可能**带着流 —— 别的适配器收到的段、或用户自己构造的段
 *   - 但 `Bot.Buffer` 对非 Buffer 入参第一句就是 `data = this.String(data)`
 *     （lib/util.js:274），流会变成 `[object Object]` 再当路径去 stat
 *
 * 所以 `FileLike` 保持窄（描述能读什么），媒体转换的入口用这个宽类型
 * （描述能收什么），流在 `utils/media.ts` 的入口处先读成 Buffer 再往下走。
 * 早先这里没区分，流会一路走到 `toBuffer` 被静默转成坏图。
 */
export type MediaInput = FileLike | import("node:stream").Readable

/**
 * 云崽消息段中承载媒体的那部分字段
 *
 * 收到的消息带 url，自己构造的消息带 file，file 段还可能只有 fid，
 * 所以 convert/toGscore.ts 一律 `i.url ?? i.file ?? i.fid` 地取。
 */
export interface MediaSegmentLike {
  url?: FileLike
  file?: FileLike
  fid?: string
  name?: string
  width?: number | string
  height?: number | string
}
