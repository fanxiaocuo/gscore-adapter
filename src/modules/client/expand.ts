/**
 * 逻辑连接 → 运行时连接
 *
 * 配置里只存「核心端点 + 绑定账号」；核心侧以 `/ws/{bot_id}` 作为客户端身份，
 * 因而根端点必须按有效账号展开，避免多个机器人共用路径时互相顶替。
 * 自定义与旧路径则保持兼容：只生成一条连接，不擅自派生账号路径。
 */
import type { RuntimeWsConnection, WsConnection } from "@/types"
import { isAutoYunzaiPath, materializeAccountUrl, normalizeEndpoint, routeKey } from "@/utils/url.js"

/** 配置账号列表归一化：字符串化、去空白、丢空项、去重且保留首次顺序 */
export function readIds(v: unknown): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const value of Array.isArray(v) ? v : []) {
    const id = String(value).trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** bind 去重保序 - exclude，并报出两边都写了的账号 */
export function effectiveAccounts(
  conf: WsConnection,
): { accounts: string[]; conflicts: string[] } {
  const bind = readIds(conf.bind)
  const excluded = new Set(readIds(conf.exclude))
  const accounts: string[] = []
  const conflicts: string[] = []

  for (const id of bind) {
    if (excluded.has(id)) conflicts.push(id)
    else accounts.push(id)
  }
  return { accounts, conflicts }
}

function parseEndpoint(url: string): URL | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return null
    return parsed
  } catch {
    return null
  }
}

/** 自动端点仅指 pathname 为空或根路径；旧 Yunzai 路径留给后续迁移任务 */
function isRootEndpoint(url: URL): boolean {
  return url.pathname === "" || url.pathname === "/"
}

export function expandConnections(list: WsConnection[]): {
  runtime: RuntimeWsConnection[]
  errors: string[]
} {
  const runtime: RuntimeWsConnection[] = []
  const errors: string[] = []
  const taken = new Map<string, string>()

  const claim = (conn: RuntimeWsConnection) => {
    const key = routeKey(conn.runtimeUrl)
    const prev = taken.get(key)
    if (prev) {
      errors.push(
        `连接 ${conn.runtimeName} 与 ${prev} 的最终路径相同（${key}），` +
          `已保留 ${prev}，跳过 ${conn.runtimeName}。` +
          `核心侧后连上的会顶掉先连上的，请检查绑定账号或自定义路径。`,
      )
      return
    }
    taken.set(key, conn.runtimeName)
    runtime.push(conn)
  }

  list.forEach((conf, sourceIndex) => {
    if (conf.enable === false) return

    const label = conf.name || `连接 #${sourceIndex + 1}`
    const url = normalizeEndpoint(conf.url)
    if (!url) {
      errors.push(`连接 ${label} 缺少 url，已跳过`)
      return
    }

    const parsed = parseEndpoint(url)
    if (!parsed) {
      errors.push(`连接 ${label} 的 url 无法解析或不是 WebSocket 地址，已跳过`)
      return
    }

    const { accounts, conflicts } = effectiveAccounts(conf)
    if (conflicts.length) {
      errors.push(
        `连接 ${label} 的账号 ${conflicts.join("、")} 同时出现在 bind 与 exclude，按 exclude 处理`,
      )
    }

    // 自定义路径与旧 Yunzai 路径只起一条兼容连接，路径原样不动。
    if (!isRootEndpoint(parsed)) {
      if (isAutoYunzaiPath(parsed.pathname) && !accounts.length) {
        errors.push(
          `连接 ${label} 仍使用共享路径 ${parsed.pathname}，多个机器人会互相顶掉。` +
            `请改为只填 host:port 并补上绑定账号。`,
        )
      }
      claim({
        ...conf,
        sourceIndex,
        account: null,
        runtimeName: label,
        runtimeUrl: url,
        automatic: false,
        bind: accounts,
      })
      return
    }

    if (!accounts.length) {
      errors.push(`连接 ${label} 没有可用的绑定账号，已跳过。请至少绑定一个机器人账号。`)
      return
    }

    for (const account of accounts) {
      claim({
        ...conf,
        sourceIndex,
        account,
        runtimeName: `${label} [${account}]`,
        runtimeUrl: materializeAccountUrl(url, account),
        automatic: true,
        // 收窄成单账号：客户端 accept(self_id) 仍是最后防线。
        bind: [account],
      })
    }
  })

  return { runtime, errors }
}
