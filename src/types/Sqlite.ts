export type SqliteValue = string | number | bigint | Buffer | null

export interface SqliteDatabase {
  run(sql: string, params: readonly SqliteValue[], callback: (err: Error | null) => void): unknown
  all<T>(
    sql: string,
    params: readonly SqliteValue[],
    callback: (err: Error | null, rows: T[]) => void,
  ): unknown
  close(callback: (err: Error | null) => void): unknown
}

export interface SqliteModule {
  Database: new (filename: string, callback: (err: Error | null) => void) => SqliteDatabase
}
