/**
 * @description QQBot 被动回复：最近入站消息 id 的落盘层，底座见 utils/sqlite.ts
 * 被动回复窗口只有 5 分钟，不落盘的话云崽一重启这 5 分钟内的下发全都不带 id，回复掉出引用形态。
 * 与 stats 一样内存是权威值，这里只是副本：热路径只写内存，按脏标记定时回写。
 */
import path from "node:path"
import { PluginPath } from "@/dir"
import { openDb, type SqliteHandle } from "@/utils/sqlite"

// 测试用：指向临时库
const dbFile = process.env.GSCORE_PASSIVE_DB || path.join(PluginPath, "data", "passive.db")

const DDL = [
  `CREATE TABLE IF NOT EXISTS passive (
    key  TEXT PRIMARY KEY,
    id   TEXT    NOT NULL,
    at   INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  )`,
]

// 开发期建的库（9883c4d 那版建表只有 key/id/at，ada6022 才加 used，两者都在 v2.2.0 之前）
// 没有 used 列 —— 发布版从来没缺过它。sqlite 没有 ADD COLUMN IF NOT EXISTS，报错即说明
// 列已在，吞掉比查 PRAGMA table_info 再判省事
const OPTIONAL_DDL = ["ALTER TABLE passive ADD COLUMN used INTEGER NOT NULL DEFAULT 0"]

const UPSERT = `INSERT INTO passive (key, id, at, used) VALUES (?, ?, ?, ?)
  ON CONFLICT (key) DO UPDATE SET id = excluded.id, at = excluded.at, used = excluded.used`

/**
 * @description 一行：某会话最近一条入站消息
 * 注意：key 里的 target_id 原样用上报时那个串，**不做规范化** —— toGscore.ts 上报的 group_id 与核心回传的 target_id 本就是同一个字符串（两端都把它当不透明定位符），「顺手规范化」只会让键对不上
 */
export interface PassiveRow {
  /** `${self_id}:${target_type}:${target_id}` */
  key: string
  id: string
  /** 记录时刻（毫秒），用于判过期 */
  at: number
  /** 这条 id 已被用作被动回复几次，见 index.ts 的 MAX_USES */
  used: number
}

let db: SqliteHandle | null = null

/** @description 打开并建表。失败返回 false，调用方退化成纯内存 */
export async function open(): Promise<boolean> {
  if (db?.available()) return true
  db = await openDb({
    file: dbFile,
    ddl: DDL,
    optionalDdl: OPTIONAL_DDL,
    label: "被动回复",
    fallbackHint: "改用内存缓存",
  })
  return !!db
}

/** @description 读全部未过期的行，启动时灌进内存 */
export function load(minAt: number): Promise<PassiveRow[]> {
  if (!db) return Promise.resolve([])
  return db.all<PassiveRow>("SELECT key, id, at, used FROM passive WHERE at >= ?", [minAt])
}

/** @description 回写若干行（绝对值，幂等） */
export function save(rows: PassiveRow[]): Promise<void> {
  if (!db || !rows.length) return Promise.resolve()
  return db.tx(rows.map(r => ({ sql: UPSERT, params: [r.key, r.id, r.at, r.used] })))
}

/**
 * @description 删掉指定 key（id 已被消费或已过期）
 * 逐条删而不是拼 IN (...)：keys 来自内部且量很小，拼串还要处理占位符个数。
 */
export function remove(keys: string[]): Promise<void> {
  if (!db || !keys.length) return Promise.resolve()
  return db.tx(keys.map(k => ({ sql: "DELETE FROM passive WHERE key = ?", params: [k] })))
}

/** @description 删掉过期行，避免表无限增长 */
export function prune(minAt: number): Promise<void> {
  const h = db
  if (!h) return Promise.resolve()
  return h.queue(() => h.run("DELETE FROM passive WHERE at < ?", [minAt]))
}

/** @description 关闭数据库，让 WAL 正常合并 */
export async function close(): Promise<void> {
  await db?.close()
  db = null
}

/** @description 数据库是否可用 */
export function available(): boolean {
  return db?.available() ?? false
}
