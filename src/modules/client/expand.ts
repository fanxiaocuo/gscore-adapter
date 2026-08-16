/**
 * 逻辑连接 → 运行时连接
 *
 * 配置里只存「核心端点 + 绑定账号」；核心侧以 `/ws/{bot_id}` 作为客户端身份，
 * 因而根端点必须按有效账号展开，避免多个机器人共用路径时互相顶替。
 * 自定义与旧路径则保持兼容：只生成一条连接，不擅自派生账号路径。
 */
import type { RuntimeWsConnection, WsConnection } from "@/types"
import {
  isAutoYunzaiPath,
  materializeAccountUrl,
  normalizeEndpoint,
  routeKey,
} from "@/utils/url.js"

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
export function effectiveAccounts(conf: WsConnection): { accounts: string[]; conflicts: string[] } {
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

/**
 * 这条逻辑连接在日志、错误话术与运行时名字里的显示名
 *
 * 没起名字时用来源序号而不是 url：地址可能内联着 `?token=`（normalizeEndpoint 只砍
 * fragment，查询串一路留着），而这些话术既进日志，也随面板整包回给前端
 * （webui/api.ts 的 Payload.errors）。
 */
export function sourceLabel(conf: WsConnection, sourceIndex: number): string {
  return conf.name || `连接 #${sourceIndex + 1}`
}

/**
 * 账号级运行时连接的名字，也是停起（lifecycle.stopClient）与计数（stats.forName）的键
 *
 * 单独抽一个函数是给「只停一个账号」的调用点用的：面板的绑定开关关掉一个号时按
 * 名字停那一条客户端（modules/webadapter 的 bindConnection），名字与这里拼得不一样
 * 就会停不掉，而且不会报错 —— stopClient 找不到人只回 false。
 */
export function accountRuntimeName(label: string, account: string): string {
  return `${label} [${account}]`
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

/**
 * 地址里的鉴权参数归回配置字段，运行时目标本身不携带凭据。
 *
 * 根端点与自定义路径两条分支都要过这一步，否则同一份凭据换个写法就会被丢掉。
 * URLSearchParams.get() 读取首个精确名称匹配；delete() 清除全部同名项。
 *
 * 谁盖谁：空写的 `?token=` 不算提供了凭据
 * ------
 * 地址里**有值**的鉴权参数优先于 token 字段，保持现有客户端 getter 的语义。但空写的
 * `?token=` 不能顶掉 token 字段里那份真的：顶掉之后运行时拿空值去握手、核心拒连，
 * 而面板与状态图看的是配置（`!!conf.token` 就足够为真），一致地回一句「已配 token」
 * —— 用户拿着确实写了 token 的配置，收到的是「配好了」加一个连不上，而且没有一处
 * 话术指得到那个空参数上。
 *
 * 只有 token 字段本身也没凭据时，空参数才照原样带上：那是用户显式写下的形状，
 * 运行时按它复现（GsCoreClient 的 url getter 凭 inlineToken 标记补回空参数）。
 * 这里用 `searchParams.has` 是在问形状（有没有参数要搬要复现），而 utils/url.ts 的
 * inlineToken() 问的是有没有凭据，空写回 null —— 两处有意不同，各自的注释都说了。
 */
function detachInlineToken(
  url: URL,
  configured: unknown,
): { runtimeUrl: string; token?: string; inlineToken?: boolean } {
  const present = url.searchParams.has("token")
  const inline = url.searchParams.get("token") || ""
  url.searchParams.delete("token")
  const wins = present && (!!inline || !String(configured ?? ""))
  return {
    runtimeUrl: url.toString(),
    ...(wins ? { token: inline, inlineToken: true } : {}),
  }
}

/** 自动端点仅指 pathname 为空或根路径；显式非根路径按自定义兼容连接处理 */
function isRootEndpoint(url: URL): boolean {
  return url.pathname === "" || url.pathname === "/"
}

/**
 * 是不是「自动端点」：地址能解析成 ws/wss 且 pathname 为空或根
 *
 * 自动端点按有效账号逐条派生运行时连接，一个账号一条 ws；非根路径只起一条兼容
 * 连接，bind 在它上头是转发过滤器（GsCoreClient.accept）而不是路由来源。两者对
 * 「改了 bind 之后要重启哪些客户端」的答案不一样，所以调用方需要能问这一句。
 */
export function isAutomaticEndpoint(conf: WsConnection): boolean {
  const url = normalizeEndpoint(conf.url)
  if (!url) return false
  const parsed = parseEndpoint(url)
  return !!parsed && isRootEndpoint(parsed)
}

/**
 * 自动端点必须至少有一个有效账号；通过返回 null，不通过返回给用户看的话术。
 * 指令与面板共用这一入口，避免 bind/exclude 的有效账号规则漂移。
 */
export function requireAccounts(conf: WsConnection): string | null {
  const url = normalizeEndpoint(conf.url)
  if (!url) return "缺少核心地址"
  const parsed = parseEndpoint(url)
  if (!parsed) return "核心地址无法解析或不是 WebSocket 地址"
  if (!isRootEndpoint(parsed)) return null
  if (effectiveAccounts(conf).accounts.length) return null
  return (
    "自动连接至少要绑定一个机器人账号：核心侧的客户端标识就是 /ws/Yunzai-<账号>。\n" +
    "请用 bind=<账号> 指定；不想连了请停用或删除整条连接"
  )
}

/**
 * 展开时跳过或降级一条连接的原因，带上是**哪一条**出的问题
 *
 * 带 sourceIndex 是给「只重启一条」的调用点用的：面板每个开关都会走
 * lifecycle 的 startSource(i)，而展开必须喂完整列表（路由冲突是全局裁决）。
 * 只有一串字符串的话它没法分辨哪条错误属于自己，于是把**全部**错误按 error
 * 级重打一遍 —— 用户点一下与本次操作无关的开关，控制台就再刷一遍别条连接的
 * 冲突报错，看着像刚出的新故障。
 *
 * 冲突记在**被跳过**那条的名下（不是留下的那条）：它才是启动不起来的那个。
 */
export interface ExpandError {
  /** 出问题的连接在配置列表里的下标，与 {@link RuntimeWsConnection.sourceIndex} 同源 */
  sourceIndex: number
  /**
   * 这条原因是不是「有运行时连接没起来」
   *
   * 不是所有 errors 都意味着连接起不来 —— bind 与 exclude 撞、以及还在用共享
   * `/ws/Yunzai` 这两条，`fail` 之后都继续走到 claim()，连接照常跑。而面板把整包
   * errors 列在一个标题为「有连接没能启动」的红框里：一条 `ws://h:8765/ws/Yunzai`
   * 的兼容连接不填账号（老配置升级后的默认形态），面板上就是绿点「已连接」，头顶
   * 一个红框说它没能启动，每次轮询复现一次 —— 用户去查一条正在正常收发的连接。
   *
   * 光看话术分不可靠：真跳过的都以「已跳过」收尾，但那是措辞约定，前端解析措辞
   * 就等于把话术冻成契约，改一个字就错位。所以在数据里标出来。
   *
   * 账号编码失败算 true：它 `continue` 跳过的是那**一个账号**，同连接的其他账号照
   * 起 —— 但那个账号的运行时连接确实没起来，面板该看见。
   */
  skipped: boolean
  /**
   * 给人看的原因
   *
   * 只含连接名、来源序号与 pathname，不含完整地址 —— 这些话术会经面板整包回到
   * 前端，也会进日志，而地址里可能内联着凭据。
   */
  message: string
}

export function expandConnections(list: WsConnection[]): {
  runtime: RuntimeWsConnection[]
  errors: ExpandError[]
} {
  const runtime: RuntimeWsConnection[] = []
  const errors: ExpandError[] = []
  const taken = new Map<string, Pick<RuntimeWsConnection, "runtimeName" | "sourceIndex">>()
  const named = new Map<string, number>()

  const claim = (conn: RuntimeWsConnection) => {
    const key = routeKey(conn.runtimeUrl)
    const prev = taken.get(key)
    if (prev) {
      errors.push({
        // 记在被跳过的那条名下：留下的那条好好地跑着，起不来的是这一条
        sourceIndex: conn.sourceIndex,
        skipped: true,
        message:
          `连接路径冲突，已保留 ${prev.runtimeName}（来源 #${prev.sourceIndex + 1}），` +
          `跳过 ${conn.runtimeName}（来源 #${conn.sourceIndex + 1}）。` +
          `核心侧后连上的会顶掉先连上的，请检查绑定账号或自定义路径。`,
      })
      return
    }

    /**
     * 运行时名字也必须唯一，路由唯一并不蕴含名字唯一
     *
     * {@link accountRuntimeName} 只拼 `连接名 [账号]`，**不含 host**。所以两条同名
     * 连接绑同一个账号、指向不同的核心时，routeKey 不撞（host 不同）而名字撞：
     *
     *     - name: 核心   url: ws://a:8765   bind: ["111"]
     *     - name: 核心   url: ws://b:8765   bind: ["111"]
     *
     * 不拦的后果不是「少一条连接」这么轻：
     * - lifecycle.startClient 的同名去重（`clients.some(c => c.name === name)`）
     *   会静默 return null，一句日志都不打，`startSource` 只是少数一个；
     * - 面板（webadapter 的 connView）与状态图（render/pages.ts）都用
     *   `clients.find(c => c.name === runtimeName)` 找活客户端，两条同名时第二条
     *   拿到的是**第一条**的客户端 —— 显示成「已连接」，是**假绿**；
     * - `stats.forName` 也按这个名字存，两条共享一份收发计数；
     * - 而文字版 `#早柚连接列表` 按 sourceIndex 筛（apps/admin.ts），显示「未启动」。
     *   于是三个视图各说各话，最难查的那种。
     *
     * 为什么修在这儿，不在两个 edit 入口补重名检查
     * ------
     * 两个 add 入口本来就有重名自动加后缀（apps/admin.ts、webadapter），两个 edit
     * 入口都没有，而 findRouteConflict 的 next 只带 url/bind/exclude/enable，压根
     * 不看 name —— 改名这个动作从头到尾没被检查过。但补在入口是补不齐的：锅巴整表
     * 保存与手改 yaml 都能直接写出重名。这里是所有入口的必经之路，且与路由冲突同
     * 一套「全局唯一性裁决」语义，报错也跟着走同一条路（lifecycle 打日志、面板整包
     * 回前端）。
     *
     * 跳过而不是自动改名：名字是用户写的，运行时替他改一个，他在面板上看到的名字
     * 与配置里的对不上，而且下次保存又会写回去。报出来让他改。
     */
    const namedAt = named.get(conn.runtimeName)
    if (namedAt !== undefined) {
      errors.push({
        sourceIndex: conn.sourceIndex,
        skipped: true,
        message:
          `运行时名字冲突：来源 #${namedAt + 1} 与来源 #${conn.sourceIndex + 1} ` +
          `都叫 ${conn.runtimeName}，已跳过后者。名字是停起与计数的键，重名会让这一条` +
          `起不来，而面板与状态图会把它显示成另一条的状态。请给其中一条连接改个名字。`,
      })
      return
    }

    taken.set(key, { runtimeName: conn.runtimeName, sourceIndex: conn.sourceIndex })
    named.set(conn.runtimeName, conn.sourceIndex)
    runtime.push(conn)
  }

  list.forEach((conf, sourceIndex) => {
    if (conf.enable === false) return

    const label = sourceLabel(conf, sourceIndex)
    // fail = 有运行时连接没起来；warn = 报出来但连接照常跑（见 ExpandError.skipped）
    const fail = (message: string) => errors.push({ sourceIndex, skipped: true, message })
    const warn = (message: string) => errors.push({ sourceIndex, skipped: false, message })
    const url = normalizeEndpoint(conf.url)
    if (!url) {
      fail(`连接 ${label} 缺少 url，已跳过`)
      return
    }

    const parsed = parseEndpoint(url)
    if (!parsed) {
      fail(`连接 ${label} 的 url 无法解析或不是 WebSocket 地址，已跳过`)
      return
    }

    const { accounts, conflicts } = effectiveAccounts(conf)
    if (conflicts.length) {
      warn(
        `连接 ${label} 的账号 ${conflicts.join("、")} 同时出现在 bind 与 exclude，按 exclude 处理`,
      )
    }

    // 自定义路径与旧 Yunzai 路径只起一条兼容连接，路径原样不动。
    if (!isRootEndpoint(parsed)) {
      if (isAutoYunzaiPath(parsed.pathname) && !accounts.length) {
        warn(
          `连接 ${label} 仍使用共享路径 ${parsed.pathname}，多个机器人会互相顶掉。` +
            `请改为只填 host:port 并补上绑定账号。`,
        )
      }
      const { runtimeUrl, ...auth } = detachInlineToken(parsed, conf.token)
      claim({
        ...conf,
        ...auth,
        sourceIndex,
        account: null,
        runtimeName: label,
        runtimeUrl,
        automatic: false,
        bind: accounts,
      })
      return
    }

    if (!accounts.length) {
      fail(`连接 ${label} 没有可用的绑定账号，已跳过。请至少绑定一个机器人账号。`)
      return
    }

    // 根端点的内联凭据同样要摘进 token 字段。materializeAccountUrl 会清空 search，
    // 不摘就等于在这一步把 `ws://h:8765/?token=x` 的凭据丢掉：握手不带凭据、核心拒连，
    // 而这个分支原来压根不调 detachInlineToken（只有非根那支调），于是同一份配置
    // 写成自定义路径能连、写成核心地址连不上。
    //
    // 派生地址从摘干净的 endpoint 上长出来，而不是再拿原串 url 走一遍：那样「凭据不进
    // runtimeUrl」就得靠 materializeAccountUrl 也清一次 search 才成立 —— 两处各扫一遍、
    // 谁也不知道对方在扫。它哪天改成保留无害查询参数（自定义路径那支本来就留 mode=
    // 这类），凭据立刻跟着进 runtimeUrl，而 runtimeUrl 会进面板的 path 字段、也随状态图
    // 发进群。摘一次、后面全用摘过的那个串，这条不变式就只依赖这一行。
    const { runtimeUrl: endpoint, ...auth } = detachInlineToken(parsed, conf.token)

    for (const account of accounts) {
      let runtimeUrl: string
      try {
        runtimeUrl = materializeAccountUrl(endpoint, account)
      } catch {
        fail(`连接 ${label} 的账号编码失败，已跳过`)
        continue
      }
      claim({
        ...conf,
        ...auth,
        sourceIndex,
        account,
        runtimeName: accountRuntimeName(label, account),
        runtimeUrl,
        automatic: true,
        // 收窄成单账号：客户端 accept(self_id) 仍是最后防线。
        bind: [account],
      })
    }
  })

  return { runtime, errors }
}
