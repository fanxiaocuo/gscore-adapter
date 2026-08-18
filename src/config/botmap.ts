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

/** yaml Document 上实际用到的三个方法，避免 import config/index 的类型 */
export interface MapDoc {
  getIn(path: readonly (string | number)[], keep?: boolean): unknown
  setIn(path: readonly (string | number)[], value: unknown): void
  hasIn(path: readonly (string | number)[]): boolean
}

/**
 * yaml 里 `111: onebot` 的键是数字，`getIn(["bot_id_map", "111"])` 找不到。
 * 覆盖时必须用原来的键类型，否则会并排出一个字符串键。
 *
 * 判据是「键在不在」，不是「值空不空」
 * ------
 * 原来这里要求旧值非空才复用旧键类型，于是 `111: ""` 或 `111:`（手改 yaml 才会有
 * 的形状）会漏过去，写出并排的两行：
 *
 *     bot_id_map:
 *       111: ""
 *       "111": onebot
 *
 * yaml 里数字键与字符串键是**两个**键，所以这不是重复键报错，文件照样能读。解析成
 * JS 之后两者都成了属性 `"111"`、靠后的赢 —— 值是对的，坑在于用户之后去改上面那个
 * `111:` 会**静默无效**。用 hasIn 就地覆盖，不再并排。
 *
 * 数字键必须原样往返才认
 * ------
 * 只判 `/^\d+$/` 是不够的：`Number("007") === 7`，于是账号 `007` 会认领 `bot_id_map`
 * 里**账号 7** 那一行。读的时候是把 7 的平台当成 007 的，`force`（指令里显式
 * `id=<平台>`）时更糟 —— `setIn(["bot_id_map", 7], …)` 直接改掉账号 7 的平台，而
 * 账号 007 一条记录都没落下。用户说的是「设 007 的平台」，被改的是另一个账号，
 * 之后那个账号上报给核心的 bot_id 就一直是错的，且没有一处话术提得到。
 * 超过 `Number.MAX_SAFE_INTEGER` 的账号同理（精度丢了就不是同一个键），
 * 往返判据一并挡住。
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
  const guessed = (platform && String(platform).trim()) || guessPlatform(sid, getBot(sid))
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
      node.items.map(n => (YAML.isScalar(n) ? String(n.value ?? "").trim() : "")).filter(Boolean),
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
