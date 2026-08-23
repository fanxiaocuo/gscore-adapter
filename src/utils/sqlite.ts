/**
 * @description sqlite 落盘的公共底座：打开库、串行化写、事务批处理
 *
 * 为什么是 sqlite 而不是 redis：这两份数据一个要长期留存、一个要跨重启活过 5 分钟，
 * 而 redis 是缓存语义（宿主可能配了淘汰策略）。运行时解析到宿主的 sqlite3
 * （`"sqlite3": "npm:@karinjs/sqlite3"`，在宿主的 dependencies 里）；本插件只在
 * devDependencies 放同一个 spec 给测试用，不进 dependencies。
 *
 * 注意：sqlite3 按可选依赖对待 —— import 不到时返回 null，调用方退化成纯内存，不抛。
 * 注意：各调用方保持自己的 .db 文件，别合并 —— 计数的「清空统计」要能直接 DELETE
 * 整张表，不必避开别人的行。
 */
import fs from "node:fs"
import path from "node:path"
import type { SqliteDatabase, SqliteModule, SqliteValue } from "@/types"
import { makeLog } from "@/utils/compat"

/** 一条写语句：sql 加它的参数 */
export interface SqlStatement {
  sql: string
  params?: readonly SqliteValue[]
}

/** 打开成功后拿到的句柄 */
export interface SqliteHandle {
  /** 执行一条语句 */
  run(sql: string, params?: readonly SqliteValue[]): Promise<void>
  /** 查询多行，无结果返回空数组 */
  all<T>(sql: string, params?: readonly SqliteValue[]): Promise<T[]>
  /** 排进写队列串行执行；库已关闭时直接跳过 */
  queue<T>(fn: () => Promise<T>): Promise<T | undefined>
  /** 一个事务包住整批，任一条失败则整批回滚 */
  tx(statements: readonly SqlStatement[]): Promise<void>
  /** 等写队列排空后关库，让 WAL 正常合并 */
  close(): Promise<void>
  /** 库是否还开着 */
  available(): boolean
}

export interface OpenOptions {
  /** 库文件绝对路径，调用方自己处理环境变量覆盖 */
  file: string
  /** 建表 / 迁移语句，按序执行 */
  ddl: readonly string[]
  /** 可以失败的语句（如给老库补列），报错吞掉 */
  optionalDdl?: readonly string[]
  /** 日志里的中文前缀，如「中转计数」 */
  label: string
  /** 依赖缺失时那句话的后半段，如「改用内存计数」 */
  fallbackHint: string
}

/**
 * WAL 自动检查点的页数上限
 *
 * 默认 1000 页时 -wal 文件会稳定停在 4MB 上下，而这两份数据本身只有几十 KB。
 * 128 页（约 500KB）足够让写不阻塞读，又不会让日志比数据大两个数量级。
 */
const WAL_PAGES = 128

/**
 * @description 打开 sqlite 库并建表，失败返回 null 让调用方退化成纯内存
 *
 * 注意：写队列建在这个闭包里，即每个库文件一条独立的链。共用一条链会让两个库的
 * 事务互等；而同一条链上事务嵌套时，第二个 BEGIN 会报
 * "cannot start a transaction within a transaction"，紧随的 close() 还会把没提交
 * 的那批一起回滚。
 */
export async function openDb(opts: OpenOptions): Promise<SqliteHandle | null> {
  const { file, ddl, optionalDdl = [], label, fallbackHint } = opts

  let sqlite3: SqliteModule
  try {
    sqlite3 = (await import("sqlite3")).default as unknown as SqliteModule
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    makeLog("debug", `${label}：sqlite3 不可用（${message}），${fallbackHint}`, "GsCore")
    return null
  }

  let db: SqliteDatabase | null = null

  const run = (sql: string, params: readonly SqliteValue[] = []): Promise<void> =>
    new Promise((resolve, reject) => {
      db!.run(sql, params, (err: Error | null) => (err ? reject(err) : resolve()))
    })

  const all = <T>(sql: string, params: readonly SqliteValue[] = []): Promise<T[]> =>
    new Promise((resolve, reject) => {
      db!.all<T>(sql, params, (err: Error | null, rows: T[]) =>
        err ? reject(err) : resolve(rows || []),
      )
    })

  // 失败也要继续排下去，否则一次报错卡死整条队列
  let chain: Promise<unknown> = Promise.resolve()

  const queue = <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    const next = chain.then(
      () => (db ? fn() : undefined),
      () => (db ? fn() : undefined),
    )
    chain = next.catch(() => {})
    return next
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    db = await new Promise<SqliteDatabase>((resolve, reject) => {
      const d = new sqlite3.Database(file, (err: Error | null) => (err ? reject(err) : resolve(d)))
    })

    // WAL：写不阻塞读。注意读并不发生在出图路径上 —— 出图与面板全走内存（passiveCount /
    // snapshot），查库只在启动灌载（initStats / initPassive）和 #早柚清空统计 的 metaSince。
    // 所以 WAL 在这里防的是「后台定时回写」与这几次读之间的争用，以及多进程开同一个库文件
    await run("PRAGMA journal_mode = WAL")
    // NORMAL：不为每次事务等 fsync，掉电最多丢最后几秒
    await run("PRAGMA synchronous = NORMAL")
    await run(`PRAGMA wal_autocheckpoint = ${WAL_PAGES}`)

    for (const sql of ddl) await run(sql)
    for (const sql of optionalDdl) await run(sql).catch(() => {})

    return {
      run,
      all,
      queue,
      available: () => !!db,

      async tx(statements) {
        if (!statements.length) return
        await queue(async () => {
          // 一个事务包住整批：逐条提交要各自等一次 WAL 落盘
          await run("BEGIN")
          try {
            for (const s of statements) await run(s.sql, s.params ?? [])
            await run("COMMIT")
          } catch (err) {
            await run("ROLLBACK").catch(() => {})
            throw err
          }
        })
      },

      async close() {
        // 先等写队列排空：关在未提交的事务中间那批会被回滚掉
        await chain.catch(() => {})
        const d = db
        db = null
        if (!d) return
        await new Promise<void>(resolve => d.close(() => resolve()))
      },
    }
  } catch (err) {
    makeLog("error", [`${label}：打开数据库失败，${fallbackHint}`, err], "GsCore")
    // 连接建成之后 PRAGMA / ddl 才抛的话，这个句柄已经开着了：不 close 它就会占着
    // 文件描述符和 sqlite 锁直到进程退出，而调用方按「没打开」回落了内存，没人再碰它。
    // 持锁不用比不开更糟 —— 下次重启或另一个进程开同一个库文件会更容易失败。
    // 注意：close 的错误只记 debug，原始错误才是要给用户看的那条，别让它盖掉
    const d = db
    db = null
    if (d)
      await new Promise<void>(resolve => {
        try {
          d.close((closeErr: Error | null) => {
            if (closeErr) makeLog("debug", [`${label}：关闭半开的连接失败`, closeErr], "GsCore")
            resolve()
          })
        } catch (closeErr) {
          makeLog("debug", [`${label}：关闭半开的连接失败`, closeErr], "GsCore")
          resolve()
        }
      })
    return null
  }
}
