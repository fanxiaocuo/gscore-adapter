/**
 * 客户端连接池
 *
 * 单独成文件是为了断开 lifecycle 与 hooks 之间的循环引用：
 * 两者都要读 clients，但 hooks 不该反向依赖 lifecycle。
 */
import type { GsCoreClient } from "./GsCoreClient.js"

export const clients: GsCoreClient[] = []
