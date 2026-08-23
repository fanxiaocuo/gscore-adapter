/**
 * @description 连接地址规范化，指令（apps/admin.ts）与 web 面板共用同一套规则
 * 注意：两处规则不一致时同一地址会被存成两个串，而 `find()` 按名字/序号定位刚好看不出来。
 */
import { readIds } from "./ids.js"

/** @description 只填 host:port 时补的默认路径。核心后台显示的就是这一段 */
export const DEFAULT_WS_PATH = "/ws/Yunzai"

/**
 * `/ws/Yunzai-<账号>`：{@link materializeAccountUrl} 生成的形状，手写配置里也有。
 * 后缀必须带数字，以免把用户自己起的 `/ws/Yunzai-backup` 认成账号路径。
 */
const AUTO_ACCOUNT_PATH = /^\/ws\/Yunzai-[0-9A-Za-z_-]*\d[0-9A-Za-z_-]*$/

/** @description 默认 `/ws/Yunzai`，以及带账号后缀的同路径 */
export function isAutoYunzaiPath(pathname: string): boolean {
  return pathname === DEFAULT_WS_PATH || AUTO_ACCOUNT_PATH.test(pathname)
}

/**
 * @description 自动端点规范化：只补协议、去掉根路径与 fragment，不补 `/ws/Yunzai`（路由段由 bind 账号在建连时生成）
 * 注意：根路径的查询串必须留下 —— 砍掉会让 `ws://h:8765/?token=x` 的凭据在规范化时消失，
 * 而 token 字段本来是空的，面板与状态图会一致地报「未配 token」。
 */
export function normalizeEndpoint(url: string | null | undefined): string {
  if (!url) return ""
  url = String(url).trim()
  // 注意：只在「没写协议」时补 ws://。原来是「不是 ws/wss 就补」，于是 http://h:1/ws 被拼成
  // ws://http//h:1/ws —— host 是 "http" 的合法 URL，requireWsUrl 的协议校验永远看到 ws: 而放行。
  // 带协议的原样留下，交给 requireWsUrl/requireUrl 去校验
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `ws://${url}`
  try {
    const u = new URL(url)
    if (u.pathname === "/" || u.pathname === "") {
      // 注意：查询串拼在 origin 后面而不走 u.toString() —— 后者会补一个 `/`，于是规范化后的地址
      // 必然不等于原值，编辑路径（webadapter 的 patch.url、admin 的 nextUrl）会顺手改写用户的地址行。
      return u.search ? `${u.origin}${u.search}` : u.origin
    }
    return u.toString()
  } catch {
    return url
  }
}

/**
 * @description 编辑地址时把旧地址上的非 token 查询参数搬到用户新填的地址上
 *
 * 用户改地址的常见动机是「核心搬了机器」：只重写 host 和端口，原地址上的 `?tenant=abc`
 * 之类会一起消失，而那些参数是核心侧反代与多租户网关用来路由的 —— 丢了握手被打回，
 * 或者更糟：连上了但落到别的租户上。
 *
 * 注意：用 `searchParams.has` 判「新地址写没写这个名字」而不是看值，`?tenant=` 是「清成空」的明确表态。
 * 注意：token 一律不搬（它有专用字段，搬过来等于把凭据塞回会进面板与状态图的地址里）；
 * 但用户自己写进新地址的 token 不动，砍掉会让面板与状态图一致地报「未配 token」。
 * 注意：旧值解析不了就当没有可搬的参数直接返回，不抛 —— 地址改坏了正是用户来改它的原因。
 * 结果过一遍 {@link normalizeEndpoint} 收敛，否则同一地址经两条路会存成两个不同的串。
 */
export function mergeEndpointQuery(
  prev: string | null | undefined,
  next: string | null | undefined,
): string {
  const base = normalizeEndpoint(next)
  if (!base) return base
  let target: URL
  let source: URL
  try {
    target = new URL(base)
    source = new URL(normalizeEndpoint(prev))
  } catch {
    return base
  }
  // 注意：keys() 对 `?a=1&a=2` 会吐两次 "a"，先去重才不会把 getAll 的结果追加两遍；
  // 用 getAll/append 而不是 get/set —— 同名参数重复是合法的多值语义，压成一个等于换了条网关路由规则。
  for (const name of new Set(source.searchParams.keys())) {
    if (name === "token") continue
    if (target.searchParams.has(name)) continue
    for (const value of source.searchParams.getAll(name)) target.searchParams.append(name, value)
  }
  return normalizeEndpoint(target.toString())
}

/**
 * @description 地址里内联的凭据；没内联、或内联的是空写的 `?token=`，都回 null
 *
 * 注意：先过 {@link normalizeEndpoint}（配置允许不写协议，直接 new URL 会抛），判据要与 expand 那边一致，
 * 否则会出现「运行时取到了凭据，面板与状态图却说没配 token」。
 * 注意：这函数问的是「有没有一份凭据」，与 modules/client/expand.ts 的 detachInlineToken 有意分开 ——
 * 那个问的是「有没有一个 token 参数要搬走并在运行时照原样复现」（形状问题，空参数也得复现）。
 * 合并两者就会得到「面板说已配 token，握手却带出去一个空参数」。
 */
export function inlineToken(url: string | null | undefined): string | null {
  try {
    const u = new URL(normalizeEndpoint(String(url ?? "")))
    return u.searchParams.get("token") || null
  } catch {
    return null
  }
}

/**
 * @description 由根端点派生 `/ws/Yunzai-<账号>`，账号只当一个 path segment（不许注入 `/`、`?`、`#`）
 *
 * 注意：只砍 token，非 token 查询参数要留下 —— 整串清掉会让「自定义路径」与「根端点派生」
 * 两种写法对 `tenant`、`access_token` 行为不一致，而那些参数正是反代与多租户网关用来路由的。
 * 注意：仍显式删 token 而不信任调用方 —— runtimeUrl 会进面板 path 字段与状态图，
 * 保留整串 search 等于把「凭据不进 runtimeUrl」的成立条件从一处 detach 扩大到所有调用方。
 */
export function materializeAccountUrl(endpoint: string, account: string): string {
  const id = encodeURIComponent(String(account).trim())
  if (!id) throw new Error("绑定账号不能为空")
  const u = new URL(endpoint)
  if (u.pathname !== "/" && u.pathname !== "") throw new Error("自定义路径不能生成账号连接地址")
  u.pathname = `${DEFAULT_WS_PATH}-${id}`
  u.searchParams.delete("token")
  // fragment 不会发给服务端，留着只会让运行时地址与日志里多一段噪声
  u.hash = ""
  return u.toString()
}

/**
 * @description 运行时身份：协议 + 主机 + 端口 + 路径，query/token 不参与
 *
 * 注意：协议与主机归一到小写，路径保留大小写 —— 核心把 `/ws/<bot_id>` 整段当客户端标识，
 * 而 HTTP 路径大小写敏感，整串小写会让 expandConnections 认为 `BotA` 与 `bota` 同路由、静默跳掉一条。
 * 反过来协议与主机必须归一，否则会真开两条 ws 到同一路由、后连上的顶掉先连上的。
 * 解析不了的串退回整串小写（那时没有可分的协议/主机/路径）。
 */
export function routeKey(url?: string): string {
  if (!url) return ""
  try {
    const u = new URL(String(url))
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}`
  } catch {
    return String(url).trim().toLowerCase()
  }
}

/**
 * @description 找出与「同一地址（按 origin）+ 同一账号」冲突的既有连接
 *
 * 不按地址判重：多 Bot 共存时 A 号加过的核心，B 号再加会被顶回「该地址已存在」，
 * 而用户要的恰恰是第二条 —— 换账号再加由 {@link findSameCore} 合并 bind，不新建 ws。
 * 注意：「任一侧 bind 为空即算重复」这条只对**添加**成立，编辑时是错的（会把自己认成冲突），
 * 所以编辑路径的两个调用方都不用它。
 * 注意：两侧都过 {@link readIds} 再比 —— 手写的 `bind: [" 111"]` 不归一化就比不上 `["111"]`，
 * 于是真重复被漏掉、添加时新建出第二条而不是并进既有那条。
 *
 * @param list 既有连接
 * @param url  已 normalizeEndpoint 过的地址
 * @param bind 新连接的账号白名单，空数组 = 不限
 * @returns 冲突的那条，没有则 undefined
 */
export function findDuplicate<T extends { url?: string; bind?: unknown }>(
  list: T[],
  url: string,
  bind: string[],
): T | undefined {
  const want = new Set(readIds(bind))
  const target = coreKey(url)
  return list.find(c => {
    if (coreKey(c.url) !== target) return false
    const has = readIds(c.bind)
    // 任一侧不限账号 -> 覆盖对方，算重复
    if (!has.length || !want.size) return true
    return has.some(id => want.has(id))
  })
}

/**
 * @description 找出指向同一个核心、可以合并 bind 的已有连接
 * 只合并自动补的 `/ws/Yunzai`；用户显式写的 `/ws/MyBot` 不擅自并进去。
 */
export function findSameCore<T extends { url?: string }>(list: T[], url: string): T | undefined {
  const target = coreKey(url)
  if (!target) return undefined
  let newPath = ""
  let newAuto = false
  try {
    const u = new URL(url)
    newPath = u.pathname
    newAuto = isAutoYunzaiPath(u.pathname)
  } catch {
    return list.find(c => coreKey(c.url) === target)
  }
  return list.find(c => {
    if (coreKey(c.url) !== target) return false
    try {
      const p = new URL(String(c.url || "")).pathname
      if (newAuto && isAutoYunzaiPath(p)) return true
      return p === newPath
    } catch {
      return false
    }
  })
}

/**
 * @description 一个核心的身份：协议 + 主机 + 端口
 * 路径不参与（它标的是「这条 ws 在核心后台叫什么」而不是「哪个核心」），token 也不参与；
 * 解析不了就退回原串比较。
 */
export function coreKey(url?: string) {
  if (!url) return ""
  try {
    return new URL(String(url)).origin.toLowerCase()
  } catch {
    return String(url).trim().toLowerCase()
  }
}

/**
 * @description 回显前脱敏：砍掉查询串、fragment 与 userinfo
 *
 * 两类调用点都要它：抛错话术会被指令层原样回进群（而抛错时的输入最可能是带 `?token=` 的完整地址），
 * 以及所有对外显示的地址（面板 connView、状态图 collect —— 那里显示的是配置原串，查询串一路留着）。
 * 注意：故意不走 `new URL()` 而按字符切 —— 本函数最主要的调用点就是「URL 解析失败」那一支。
 * 空输入回「(空)」而不是空串，因为第一批调用点是错误话术。
 */
export function redactUrl(value: string | null | undefined): string {
  const s = String(value ?? "").trim()
  if (!s) return "(空)"
  // 先砍 ? 与 #，再砍 userinfo。顺序要紧：查询串里也可能出现 @
  const cut = s.split(/[?#]/)[0]
  return cut.replace(/^([a-z][a-z0-9+.-]*:\/\/)?[^/@]*@/i, "$1")
}

/**
 * @description 校验并规范化连接地址，非法时抛错；两个添加入口（admin 的 add、webadapter 的 addConnection）都只走这个门
 * 注意：必须在这里拦掉 http:// —— ws@8 会把 `http:` 改写成 `ws:`（ws/lib/websocket.js:700-704），
 * 落盘后建连不报协议错，只是 403 + 重连循环，日志里没有一句说得出协议填错了。
 */
export function requireWsUrl(url: string | null | undefined): string {
  const s = normalizeEndpoint(url)
  if (!s) throw new Error("连接地址不能为空")
  let u: URL
  try {
    u = new URL(s)
  } catch {
    throw new Error(`连接地址无法解析：${redactUrl(url)}`)
  }
  if (u.protocol === "http:" || u.protocol === "https:") {
    const suggest = redactUrl(s).replace(/^http/i, "ws")
    throw new Error(
      `不支持 http://，早柚核心只能用 WebSocket 连。请改用：${suggest}\n` +
        // 建议里的查询串已被 redactUrl 砍掉，顺带说清 token 该写哪儿，否则用户照抄会丢掉内联的凭据
        "token 请用 t=<token> 单独给，不要写在地址里",
    )
  }
  if (!["ws:", "wss:"].includes(u.protocol)) throw new Error("连接地址仅支持 ws:// / wss://")
  return s
}
