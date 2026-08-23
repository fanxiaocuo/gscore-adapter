/**
 * @description 按账号写入 bot_id_map：每个 bind 过的账号在这张表里各有一行平台标识
 * 单独一个文件是为了避环：upgrade.ts 与 config/index.ts 都要用，而 upgrade 被 index import。
 * 注意：平台标识不写在连接的 `bot_id` 上 —— 那一个字段会替连接上所有账号断言同一个平台
 */
import YAML from "yaml"
import type { YAMLMap } from "yaml"
import { guessPlatform } from "@/utils/platform.js"
import { getBot } from "@/utils/bots.js"

/** @description yaml Document 上实际用到的三个方法，避免 import config/index 的类型 */
export interface MapDoc {
  getIn(path: readonly (string | number)[], keep?: boolean): unknown
  setIn(path: readonly (string | number)[], value: unknown): void
  hasIn(path: readonly (string | number)[]): boolean
}

/**
 * @description 取该账号在 bot_id_map 里实际使用的键类型（yaml 里 `111: onebot` 的键是数字）
 * 判据是「键在不在」而不是「值空不空」，`111: ""` 这种手改出来的形状也要就地覆盖。
 * 注意：不就地覆盖会写出并排的 `111:` 与 `"111":` —— yaml 里那是两个键、不报重复，解析后靠后的赢，用户之后改上面那行会静默无效
 * 注意：数字键必须原样往返（`String(Number(sid)) === sid`）才认，否则账号 `007` 会认领账号 7 那一行 —— 显式 `id=` 时直接改掉账号 7 的平台；超 MAX_SAFE_INTEGER 同理
 */
function mapKey(doc: MapDoc, sid: string): string | number {
  if (doc.hasIn(["bot_id_map", sid])) return sid
  const n = Number(sid)
  if (/^\d+$/.test(sid) && String(n) === sid && doc.hasIn(["bot_id_map", n])) return n
  return sid
}

function mapValue(doc: MapDoc, sid: string): string {
  const key = mapKey(doc, sid)
  const v = doc.getIn(["bot_id_map", key])
  return v == null ? "" : String(v).trim()
}

/**
 * @description 给一个账号补一条 bot_id_map，已有记录不覆盖
 * @param platform 显式指定的平台；不传则按账号形状 / 在线 Bot 推断
 * @param existingMap 运行时已加载的表（写盘前 config 还是旧的），有记录也不覆盖
 * @param force 用户显式 `id=` 时覆盖已有记录
 * @returns 真正写进去的平台标识；没写则空串
 */
export function writeAccountBotId(
  doc: MapDoc,
  selfId: string | number,
  platform?: string | null,
  existingMap?: Record<string, string>,
  force = false,
): string {
  const sid = String(selfId ?? "").trim()
  if (!sid) return ""
  if (!force && existingMap?.[sid]) return ""
  if (!force && mapValue(doc, sid)) return ""
  const guessed = (platform && String(platform).trim()) || guessPlatform(sid, getBot(sid))
  if (!guessed) return ""
  doc.setIn(["bot_id_map", mapKey(doc, sid)], guessed)
  return guessed
}

/** @description 给一批账号各补一条，返回「id=platform」列表方便回复里念出来 */
export function writeAccountBotIds(
  doc: MapDoc,
  ids: Array<string | number>,
  existingMap?: Record<string, string>,
): string[] {
  const written: string[] = []
  for (const id of ids) {
    const p = writeAccountBotId(doc, id, undefined, existingMap)
    if (p) written.push(`${id}=${p}`)
  }
  return written
}

/** @description 取连接项里某个 id 列表字段（bind / exclude）：去重、去空、一律转成字符串 */
export function readIdList(item: YAMLMap, key: string): string[] {
  const node = item.get(key, true)
  if (!YAML.isSeq(node)) return []
  return [
    ...new Set(
      node.items.map(n => (YAML.isScalar(n) ? String(n.value ?? "").trim() : "")).filter(Boolean),
    ),
  ]
}

/**
 * @description 锅巴整表写回 connections 时补齐：给每个 bind 账号在 bot_id_map 里落一行
 * 注意：只读连接、只写 bot_id_map —— 用户刚在面板上手填的地址与 bind 不能替他改
 */
export function syncConnectionAccounts(
  doc: MapDoc,
  existingMap?: Record<string, string>,
): string[] {
  const seq = doc.getIn(["client", "connections"], true)
  if (!YAML.isSeq(seq)) return []
  const written: string[] = []
  for (const item of seq.items) {
    if (!YAML.isMap(item)) continue
    written.push(...writeAccountBotIds(doc, readIdList(item, "bind"), existingMap))
  }
  return written
}
