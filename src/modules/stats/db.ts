/**
 * @description 中转计数的 sqlite 落盘层，底座见 utils/sqlite.ts
 * 只有 relay 一张按天分行的明细表，今日 / 累计 / 某连接累计都从它聚合，不额外存汇总行 ——
 * 省掉「明细和汇总不一致」这类要对账的问题。
 */
import path from "node:path"
import { PluginPath } from "@/dir"
import { openDb, type SqliteHandle } from "@/utils/sqlite"
import type { Counters } from "./counters.js"

/** @description 一行明细 */
export interface RelayRow extends Counters {
  /** 本地日期 YYYY-MM-DD */
  day: string
  /** 连接名；空串表示「没有归属连接」（count 不带 name 时） */
  name: string
}

// 测试用：指向临时库，免得动真实数据
const dbFile = process.env.GSCORE_STATS_DB || path.join(PluginPath, "data", "stats.db")

const DDL = [
  `CREATE TABLE IF NOT EXISTS relay (
    day   TEXT    NOT NULL,
    name  TEXT    NOT NULL,
    up    INTEGER NOT NULL DEFAULT 0,
    event INTEGER NOT NULL DEFAULT 0,
    down  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, name)
  )`,
  // 「某连接累计」按 name 过滤，明细页每条连接都要查一次
  "CREATE INDEX IF NOT EXISTS idx_relay_name ON relay (name)",
  // 计数起点落盘，否则重启一次「统计自」就跳回几分钟前，而累计值明明是几个月攒的
  `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
]

const UPSERT = `INSERT INTO relay (day, name, up, event, down) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (day, name) DO UPDATE SET
    up = excluded.up, event = excluded.event, down = excluded.down`

let db: SqliteHandle | null = null

/**
 * @description 打开数据库并建表
 * @returns 打开成功与否。失败不抛 —— 计数是展示用的辅助信息，不该因为落盘不可用就拖垮插件加载
 */
export async function open(): Promise<boolean> {
  if (db?.available()) return true
  db = await openDb({
    file: dbFile,
    ddl: DDL,
    label: "中转计数",
    fallbackHint: "改用内存计数",
  })
  return !!db
}

/** @description 关闭数据库（进程退出时调，让 WAL 正常合并） */
export async function close(): Promise<void> {
  await db?.close()
  db = null
}

/** @description 读 meta 里的计数起点，没有则写入 fallback 并返回它 */
export function metaSince(fallback: number): Promise<number> {
  const h = db
  if (!h) return Promise.resolve(fallback)
  return h
    .queue(async () => {
      const rows = await h.all<{ value: string }>("SELECT value FROM meta WHERE key = 'since'")
      const got = Number(rows[0]?.value)
      if (got > 0) return got
      await h.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('since', ?)", [
        String(fallback),
      ])
      return fallback
    })
    .then(got => got ?? fallback)
}

/** @description 读全部明细，用于启动时灌入内存 */
export function load(): Promise<RelayRow[]> {
  if (!db) return Promise.resolve([])
  return db.all<RelayRow>("SELECT day, name, up, event, down FROM relay")
}

/**
 * @description 回写若干 (day, name) 的计数
 * 注意：写的是绝对值而不是 `up = up + ?` 的增量 —— 内存里存的就是权威值，绝对值写入幂等，回写失败下个周期重试结果一样；增量写失败后重试会重复累加，而这个错误没法从结果上察觉
 */
export function save(rows: RelayRow[]): Promise<void> {
  if (!db || !rows.length) return Promise.resolve()
  return db.tx(rows.map(r => ({ sql: UPSERT, params: [r.day, r.name, r.up, r.event, r.down] })))
}

/** @description 清空所有计数。同样入队，免得和正在进行的回写抢事务 */
export function clear(): Promise<void> {
  const h = db
  if (!h) return Promise.resolve()
  return h.queue(async () => {
    await h.run("DELETE FROM relay")
    await h.run("DELETE FROM meta WHERE key = 'since'")
  })
}

/** @description 数据库是否可用 */
export function available(): boolean {
  return db?.available() ?? false
}
