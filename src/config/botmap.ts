/**
 * 按账号写入 bot_id_map
 *
 * 单独一个文件：upgrade.ts 与 config/index.ts 都要用，而 upgrade 被 index
 * import，再反向 import 就成环。本文件只依赖 guessPlatform / getBot。
 *
 * 每个 bind 过的机器人账号都该在这张表里有自己的平台标识，而不是写在连接的
 * `bot_id` 上——那一个字段会替所有账号断言同一个平台。
 */
import YAML from "yaml"
import type { YAMLMap } from "yaml"
import { guessPlatform } from "@/utils/platform.js"
import { getBot } from "@/utils/bots.js"

/** yaml Document 上实际用到的两个方法，避免 import config/index 的类型 */
export interface MapDoc {
  getIn(path: readonly (string | number)[], keep?: boolean): unknown
  setIn(path: readonly (string | number)[], value: unknown): void
}

/**
 * yaml 里 `111: onebot` 的键是数字，`getIn(["bot_id_map", "111"])` 找不到。
 * 覆盖时必须用原来的键类型，否则会并排出一个字符串键。
 */
function mapKey(doc: MapDoc, sid: string): string | number {
  const asStr = doc.getIn(["bot_id_map", sid])
  if (asStr != null && String(asStr).trim() !== "") return sid
  if (/^\d+$/.test(sid)) {
    const n = Number(sid)
    const asNum = doc.getIn(["bot_id_map", n])
    if (asNum != null && String(asNum).trim() !== "") return n
  }
  return sid
}

function mapValue(doc: MapDoc, sid: string): string {
  const key = mapKey(doc, sid)
  const v = doc.getIn(["bot_id_map", key])
  return v == null ? "" : String(v).trim()
}

/**
 * 给一个账号补一条 bot_id_map，已有记录不覆盖
 *
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
  const sid = String(selfId || "").trim()
  if (!sid) return ""
  if (!force && existingMap?.[sid]) return ""
  if (!force && mapValue(doc, sid)) return ""
  const guessed =
    (platform && String(platform).trim()) || guessPlatform(sid, getBot(sid))
  if (!guessed) return ""
  doc.setIn(["bot_id_map", mapKey(doc, sid)], guessed)
  return guessed
}

/** 一批账号，返回「id=platform」列表方便回复里念出来 */
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

function readIdList(item: YAMLMap, key: string): string[] {
  const node = item.get(key, true)
  if (!YAML.isSeq(node)) return []
  return [
    ...new Set(
      node.items
        .map(n => (YAML.isScalar(n) ? String(n.value ?? "").trim() : ""))
        .filter(Boolean),
    ),
  ]
}

/**
 * 锅巴整表写回 connections 时补齐：给每个 bind 账号在 bot_id_map 里落一行
 *
 * 只读连接、只写 bot_id_map —— 用户刚在面板上手填的地址与 bind 不能替他改。
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
