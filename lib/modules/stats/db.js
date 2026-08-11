/**
 * 中转计数的 sqlite 落盘层
 *
 * 为什么是 sqlite 而不是 redis
 * ----------------------------
 * 两者宿主都有（TRSS-Yunzai 依赖里 redis 4 与 sqlite3 都在）。选 sqlite 是因为
 * 这份数据要的是**长期留存**：按天一行，累计值靠 SUM 出来，历史天数天然留着。
 * redis 存计数得靠 TTL 自清，想留历史就要自己滚键名 + 扫键清理，
 * 而且 redis 默认是缓存语义（宿主可能配了 maxmemory 淘汰策略），
 * 一份「累计中转多少条」的账被淘汰掉是说不通的。
 *
 * 用的是宿主的 sqlite3（package.json 里 `"sqlite3": "npm:@karinjs/sqlite3"`），
 * 不进插件自己的 dependencies——插件跑在宿主 node_modules 里，重复装一份没意义。
 * 因此它按可选依赖对待：require 不到就退化成纯内存（见 cache.ts 的 ready 处理）。
 *
 * 为什么不用 sequelize
 * -------------------
 * 宿主也带 sequelize，genshin / meme-plugin 都用它。但那是为了 ORM 的模型层，
 * 这里只有一张三列表、两条语句（UPSERT 和几个聚合 SELECT），
 * 引 ORM 要付一个 sync()、一套模型定义和方言层的启动开销，换不到东西。
 *
 * 表结构
 * ------
 * relay(day, name, up, event, down)，主键 (day, name)。
 *   day  本地日期 YYYY-MM-DD
 *   name 连接名；空串表示「没有归属连接」（count 不带 name 时）
 *
 * 所有派生值都从这张表聚合：
 *   今日 = WHERE day = 今天 的 SUM
 *   累计 = 全表 SUM
 *   某连接累计 = WHERE name = ? 的 SUM
 * 不额外存汇总行，省掉「明细和汇总不一致」这类要对账的问题。
 */
import fs from "node:fs";
import path from "node:path";
import { PluginPath } from "../../dir.js";
import { makeLog } from "../../utils/compat.js";
/** 数据库文件位置：插件自己的 data/ 下，与 meme-plugin 的约定一致 */
const dbDir = path.join(PluginPath, "data");
// 测试用：指向临时库，免得动真实数据
const dbFile = process.env.GSCORE_STATS_DB || path.join(dbDir, "stats.db");
/** sqlite3 的 Database 实例，拿不到依赖时为 null */
let db = null;
/**
 * 写操作串行队列
 *
 * save() 自带 BEGIN/COMMIT，而它有两个并发来源：定时回写与跨日翻页
 * （翻页发生在 count() 里，同步函数没法 await，只能 fire-and-forget）。
 * 同一条连接上两个事务嵌套，第二个 BEGIN 直接报
 * "cannot start a transaction within a transaction"，随后的 close()
 * 还会把没提交的那个一起回滚——两批计数一起丢。
 *
 * 所以所有写操作排成一条链。失败也要继续排下去，否则一次报错会把队列卡死。
 */
let chain = Promise.resolve();
function queue(fn) {
    const next = chain.then(fn, fn);
    chain = next.catch(() => { });
    return next;
}
/** run/all 的 Promise 包装。sqlite3 是 callback API，没有原生 Promise 接口 */
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
}
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}
/**
 * 打开数据库并建表
 *
 * @returns 打开成功与否。失败不抛——计数是展示用的辅助信息，
 *          不该因为落盘不可用就拖垮插件加载
 */
export async function open() {
    if (db)
        return true;
    let sqlite3;
    try {
        // 动态 import：宿主没装 sqlite3 时（理论上不会，它在 TRSS 依赖里）
        // 走内存模式而不是启动即崩
        sqlite3 = (await import("sqlite3")).default;
    }
    catch (err) {
        makeLog("debug", `中转计数：sqlite3 不可用（${err?.message}），改用内存计数`, "GsCore");
        return false;
    }
    try {
        fs.mkdirSync(dbDir, { recursive: true });
        db = await new Promise((resolve, reject) => {
            const d = new sqlite3.Database(dbFile, (err) => (err ? reject(err) : resolve(d)));
        });
        // WAL：写不阻塞读。这里的写是后台定时回写，读是出图时的一次性查询，
        // 默认的 rollback journal 下两者会互相等锁
        await run("PRAGMA journal_mode = WAL");
        // NORMAL：不为每次事务等 fsync。丢的最多是掉电前几秒的计数，
        // 对一个展示用的数字来说这个代价换来的写入延迟是值得的
        await run("PRAGMA synchronous = NORMAL");
        await run(`CREATE TABLE IF NOT EXISTS relay (
      day   TEXT    NOT NULL,
      name  TEXT    NOT NULL,
      up    INTEGER NOT NULL DEFAULT 0,
      event INTEGER NOT NULL DEFAULT 0,
      down  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, name)
    )`);
        // 「某连接累计」按 name 过滤，明细页每条连接都要查一次
        await run("CREATE INDEX IF NOT EXISTS idx_relay_name ON relay (name)");
        // 计数起点。原来是模块加载时刻（进程重启即归零），落盘后应当是
        // 「第一次记账那天」——否则重启一次「统计自」就跳回几分钟前，
        // 而下面的累计值明明是几个月攒的
        await run(`CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
        return true;
    }
    catch (err) {
        makeLog("error", ["中转计数：打开数据库失败，改用内存计数", err], "GsCore");
        db = null;
        return false;
    }
}
/**
 * 关闭数据库（进程退出时调，让 WAL 正常合并）
 *
 * 先等写队列排空：关在未提交的事务中间，那批计数会被回滚掉。
 */
export async function close() {
    await chain.catch(() => { });
    const d = db;
    db = null;
    if (!d)
        return;
    await new Promise(resolve => d.close(() => resolve()));
}
/** 读 meta，没有则写入 fallback 并返回它 */
export function metaSince(fallback) {
    if (!db)
        return Promise.resolve(fallback);
    return queue(async () => {
        if (!db)
            return fallback;
        const rows = await all("SELECT value FROM meta WHERE key = 'since'");
        const got = Number(rows[0]?.value);
        if (got > 0)
            return got;
        await run("INSERT OR REPLACE INTO meta (key, value) VALUES ('since', ?)", [String(fallback)]);
        return fallback;
    });
}
/** 读全部明细，用于启动时灌入内存 */
export function load() {
    if (!db)
        return Promise.resolve([]);
    return all("SELECT day, name, up, event, down FROM relay");
}
/**
 * 回写若干 (day, name) 的**绝对值**
 *
 * 写绝对值而不是 `up = up + ?` 的增量：内存里存的就是权威值，
 * 绝对值写入是幂等的——回写失败下个周期重试一次，结果一样；
 * 增量写失败后重试会重复累加，而这个错误没法从结果上察觉。
 */
export function save(rows) {
    if (!db || !rows.length)
        return Promise.resolve();
    const sql = `INSERT INTO relay (day, name, up, event, down) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (day, name) DO UPDATE SET
      up = excluded.up, event = excluded.event, down = excluded.down`;
    return queue(async () => {
        // 排到队首时数据库可能已经关了（退出时序）
        if (!db)
            return;
        // 一个事务包住整批：几十条连接各写一条时，逐条提交要各自等一次 WAL 落盘
        await run("BEGIN");
        try {
            for (const r of rows)
                await run(sql, [r.day, r.name, r.up, r.event, r.down]);
            await run("COMMIT");
        }
        catch (err) {
            await run("ROLLBACK").catch(() => { });
            throw err;
        }
    });
}
/** 清空所有计数。同样入队，免得和正在进行的回写抢事务 */
export function clear() {
    if (!db)
        return Promise.resolve();
    return queue(async () => {
        if (!db)
            return;
        await run("DELETE FROM relay");
        await run("DELETE FROM meta WHERE key = 'since'");
    });
}
/** 数据库是否可用 */
export function available() {
    return !!db;
}
