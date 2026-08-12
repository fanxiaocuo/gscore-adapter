/**
 * QQBot 被动回复：最近入站消息 id 的落盘层
 *
 * 为什么落盘
 * ---------
 * 被动回复窗口是 5 分钟。不落盘的话云崽一重启，这 5 分钟内所有下发都不带 id，
 * 回复就掉出引用形态。数据量极小（每个会话一行，只留最新一条），代价可以忽略。
 *
 * 为什么是 sqlite 而不是 redis
 * --------------------------
 * 参考实现（xiowo/yunzai-gscore-adapter）用的是 redis，键
 * `Yz:GscoreAdapter:QQBot:MessageId` 配 300s TTL。这里换 sqlite：宿主两者都有，
 * 但本插件已经为中转计数开了 sqlite（modules/stats/db.ts），再引一个 redis 连接
 * 只为存几行短命数据不值得；而且 redis 是缓存语义，宿主可能配了淘汰策略。
 *
 * 独立文件而不是塞进 stats.db
 * -------------------------
 * 两者生命周期完全不同：计数要长期留存、按天归档；这里的行 5 分钟就过期。
 * 混在一张库里会让「清空统计」这类操作不得不小心避开无关表。
 * WAL 模式下多文件多连接没有额外代价。
 *
 * 与内存的关系同 stats：**内存是权威值**，这里只是副本。热路径（每条入站消息）
 * 只写内存，按脏标记定时回写。掉电最多丢最后几秒的 id，那只意味着少几条回复带引用。
 */
import fs from "node:fs";
import path from "node:path";
import { PluginPath } from "../../dir.js";
import { makeLog } from "../../utils/compat.js";
const dbDir = path.join(PluginPath, "data");
// 测试用：指向临时库
const dbFile = process.env.GSCORE_PASSIVE_DB || path.join(dbDir, "passive.db");
let db = null;
/** 写操作串行化，理由同 stats/db.ts：避免事务嵌套 */
let chain = Promise.resolve();
function queue(fn) {
    const next = chain.then(fn, fn);
    chain = next.catch(() => { });
    return next;
}
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
}
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}
/** 打开并建表。失败返回 false，调用方退化成纯内存 */
export async function open() {
    if (db)
        return true;
    let sqlite3;
    try {
        sqlite3 = (await import("sqlite3")).default;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        makeLog("debug", `被动回复：sqlite3 不可用（${message}），改用内存缓存`, "GsCore");
        return false;
    }
    try {
        fs.mkdirSync(dbDir, { recursive: true });
        db = await new Promise((resolve, reject) => {
            const d = new sqlite3.Database(dbFile, (err) => (err ? reject(err) : resolve(d)));
        });
        await run("PRAGMA journal_mode = WAL");
        await run("PRAGMA synchronous = NORMAL");
        await run(`CREATE TABLE IF NOT EXISTS passive (
      key  TEXT PRIMARY KEY,
      id   TEXT    NOT NULL,
      at   INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    )`);
        // 老库（v2.1.0 及更早）没有 used 列。ALTER 失败即说明它已经在，吞掉即可 ——
        // sqlite 没有 ADD COLUMN IF NOT EXISTS，查 PRAGMA table_info 再判反而更啰嗦
        await run("ALTER TABLE passive ADD COLUMN used INTEGER NOT NULL DEFAULT 0").catch(() => { });
        return true;
    }
    catch (err) {
        makeLog("error", ["被动回复：打开数据库失败，改用内存缓存", err], "GsCore");
        db = null;
        return false;
    }
}
/** 读全部未过期的行，启动时灌进内存 */
export function load(minAt) {
    if (!db)
        return Promise.resolve([]);
    return all("SELECT key, id, at, used FROM passive WHERE at >= ?", [minAt]);
}
/** 回写若干行（绝对值，幂等） */
export function save(rows) {
    if (!db || !rows.length)
        return Promise.resolve();
    const sql = `INSERT INTO passive (key, id, at, used) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET id = excluded.id, at = excluded.at, used = excluded.used`;
    return queue(async () => {
        if (!db)
            return;
        await run("BEGIN");
        try {
            for (const r of rows)
                await run(sql, [r.key, r.id, r.at, r.used]);
            await run("COMMIT");
        }
        catch (err) {
            await run("ROLLBACK").catch(() => { });
            throw err;
        }
    });
}
/** 删掉指定 key（id 已被消费或已过期） */
export function remove(keys) {
    if (!db || !keys.length)
        return Promise.resolve();
    return queue(async () => {
        if (!db)
            return;
        // 逐条删而不是拼 IN (...)：keys 来自内部，量很小（一轮最多几十条），
        // 拼串还要处理占位符个数，没必要
        await run("BEGIN");
        try {
            for (const k of keys)
                await run("DELETE FROM passive WHERE key = ?", [k]);
            await run("COMMIT");
        }
        catch (err) {
            await run("ROLLBACK").catch(() => { });
            throw err;
        }
    });
}
/** 删掉过期行，避免表无限增长 */
export function prune(minAt) {
    if (!db)
        return Promise.resolve();
    return queue(async () => {
        if (!db)
            return;
        await run("DELETE FROM passive WHERE at < ?", [minAt]);
    });
}
export async function close() {
    await chain.catch(() => { });
    const d = db;
    db = null;
    if (!d)
        return;
    await new Promise(resolve => d.close(() => resolve()));
}
export function available() {
    return !!db;
}
