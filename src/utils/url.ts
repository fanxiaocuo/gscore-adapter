/**
 * @description 连接地址规范化，指令（apps/admin.ts）与 web 面板共用同一套规则
 * 注意：两处规则不一致时同一地址会被存成两个串，而 `find()` 按名字/序号定位看不出来。
 */
import { readIds } from "./ids"

/**
 * @description 早先版本生成的不带框架名的默认路径，现在只留作识别（新连接一律走 {@link framePathBase}）
 * 不能删：用户配置里已经存着这个形状的地址，{@link isAutoYunzaiPath} 认不出就会把它当自定义路径。
 */
export const DEFAULT_WS_PATH = "/ws/Yunzai"

/**
 * @description 带框架名的默认路径，核心后台靠它区分 TRSS 与喵崽（两个框架连同一个核心时都叫 Yunzai 分不清谁是谁）
 *
 * 判据取自 render/env.ts 的 frameName：`Bot.uin` 是不是数组（TRSS 多账号存数组，Miao 继承 ICQQ 是单个数字）。
 * 判据在这里重写一遍而不是 import —— url.ts 是只依赖 ids.js 的底层工具，反被 render/pages.ts 引用，
 * 引 render 就分层倒置了；而判据本身是两行零依赖的常量表达式，复制的代价小于成环。
 *
 * 比 frameName 多一档：`Bot.uin` 压根不存在时回退成不带框架名的 {@link DEFAULT_WS_PATH}，而不是
 * 像 frameName 那样兜底成喵崽。frameName 只印在图上，猜错顶多一行字难看；这里的结果会变成核心侧的
 * **客户端标识**，猜错等于给用户凭空开一条身份不对的连接。「探测不到」与「探测到是喵崽」得是两件事。
 * 注意：绝不能缓存 —— Bot.uin 要等框架挂上才有，早一步缓存会把所有连接永久钉在回退值上。
 */
export function framePathBase(): string {
  try {
    const uin = globalThis.Bot?.uin
    if (Array.isArray(uin)) return "/ws/TRSS-Yunzai"
    if (uin != null) return "/ws/Miao-Yunzai"
  } catch {
    // Bot 未初始化（单测、CI）走下面的回退，不猜框架
  }
  return DEFAULT_WS_PATH
}

/**
 * `/ws/<框架名>-<账号>`：{@link materializeAccountUrl} 生成的形状。后缀必须带数字，以免把用户自起的 `/ws/Yunzai-backup` 认成账号路径。
 * 三个前缀都认：新连接按框架名生成 TRSS-/Miao- 前缀，而早先生成的裸 `Yunzai-` 已经存在用户配置里，
 * 认不出会让那些连接被当成「用户自定义路径」而走兼容分支（不再按账号派生、多 Bot 互相顶掉）。
 */
const AUTO_ACCOUNT_PATH = /^\/ws\/(?:TRSS-|Miao-)?Yunzai-[0-9A-Za-z_-]*\d[0-9A-Za-z_-]*$/

/** @description 默认 `/ws/Yunzai`（含带框架名的两种），以及带账号后缀的同路径 */
export function isAutoYunzaiPath(pathname: string): boolean {
  if (pathname === DEFAULT_WS_PATH) return true
  if (pathname === "/ws/TRSS-Yunzai" || pathname === "/ws/Miao-Yunzai") return true
  return AUTO_ACCOUNT_PATH.test(pathname)
}

/**
 * @description 自动端点规范化：只补协议、去掉根路径与 fragment，不补路由段（那段由 bind 账号在建连时生成）
 * 注意：根路径的查询串必须留下，否则 `ws://h:8765/?token=x` 的内联凭据在规范化时丢失，面板与状态图会一致地报「未配 token」。
 */
export function normalizeEndpoint(url: string | null | undefined): string {
  if (!url) return ""
  url = String(url).trim()
  // 注意：只在「没写协议」时补 ws://，无条件补会把 http://h:1/ws 拼成 ws://http//h:1/ws
  //（host 成 "http" 的合法 URL，requireWsUrl 的协议校验永远看到 ws: 而放行）。带协议的原样留下交给校验
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `ws://${url}`
  try {
    const u = new URL(url)
    if (u.pathname === "/" || u.pathname === "") {
      // 注意：查询串拼在 origin 后面而不走 u.toString()，后者会补一个 `/` 让规范化后地址不等于原值，
      // 编辑路径（webadapter 的 patch.url、admin 的 nextUrl）会顺手改写用户的地址行。
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
 * 非 token 参数（如 `?tenant=abc`）是核心侧反代与多租户网关用来路由的，丢了握手被打回、或连上却落到别的租户。
 * 注意：用 `searchParams.has` 判「新地址写没写这个名字」而不是看值，`?tenant=` 是「清成空」的明确表态。
 * 注意：token 一律不搬（有专用字段），但用户自己写进新地址的 token 不动，砍掉会让面板与状态图一致地报「未配 token」。
 * 注意：旧值解析不了就当没有可搬的参数直接返回，不抛。
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
  // 注意：keys() 对 `?a=1&a=2` 会吐两次 "a"，先去重才不会把 getAll 的结果追加两遍。
  // 用 getAll/append 而不是 get/set：同名参数重复是合法的多值语义，压成一个等于换了条网关路由规则
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
 * 注意：先过 {@link normalizeEndpoint}（配置允许不写协议，直接 new URL 会抛），判据要与 expand 那边一致，否则「运行时取到凭据，面板却说没配 token」。
 * 注意：本函数问「有没有一份凭据」，与 modules/client/expand.ts 的 detachInlineToken（问「有没有一个 token 参数要搬走并原样复现」，空参数也复现）有意分开，合并会得到「面板说已配 token，握手却带出一个空参数」。
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
 * @description 由根端点派生 `/ws/<框架名>-<账号>`，账号只当一个 path segment（不许注入 `/`、`?`、`#`）
 *
 * 路径前缀带框架名（{@link framePathBase}），核心后台才分得清这条连接是 TRSS 还是喵崽。
 * 注意：只砍 token，非 token 参数要留下，否则「自定义路径」与「根端点派生」两种写法对 `tenant`、`access_token`（反代与多租户网关的路由参数）行为不一致。
 * 注意：仍显式删 token 而不信任调用方，runtimeUrl 会进面板 path 字段与状态图，保留整串 search 等于把「凭据不进 runtimeUrl」的成立条件从一处 detach 扩大到所有调用方。
 */
export function materializeAccountUrl(endpoint: string, account: string): string {
  const id = encodeURIComponent(String(account).trim())
  if (!id) throw new Error("绑定账号不能为空")
  const u = new URL(endpoint)
  if (u.pathname !== "/" && u.pathname !== "") throw new Error("自定义路径不能生成账号连接地址")
  u.pathname = `${framePathBase()}-${id}`
  u.searchParams.delete("token")
  // fragment 不会发给服务端，留着只会让运行时地址与日志多一段噪声
  u.hash = ""
  return u.toString()
}

/**
 * @description 运行时身份：协议 + 主机 + 端口 + 路径，query/token 不参与
 *
 * 注意：协议与主机归一小写、路径保留大小写：核心把 `/ws/<bot_id>` 整段当客户端标识，HTTP 路径大小写敏感，整串小写会让 expandConnections 认为 `BotA` 与 `bota` 同路由、静默跳掉一条。
 * 注意：协议与主机必须归一，否则会真开两条 ws 到同一路由、后连上的顶掉先连上的。解析不了的串退回整串小写。
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
 * 不按地址判重：多 Bot 共存时 A 号加过的核心 B 号再加会被顶回「该地址已存在」，而用户要的恰是第二条（换账号再加由 {@link findSameCore} 合并 bind，不新建 ws）。
 * 注意：「任一侧 bind 为空即算重复」只对**添加**成立，编辑时是错的（会把自己认成冲突），所以编辑路径的两个调用方都不用它。
 * 注意：两侧都过 {@link readIds} 再比，手写的 `bind: [" 111"]` 不归一化就比不上 `["111"]`，真重复会被漏掉、添加时新建出第二条。
 *
 * @param url  已 normalizeEndpoint 过的地址
 * @param bind 新连接的账号白名单，空数组 = 不限
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
 * 只合并自动派生的 Yunzai 路径（{@link isAutoYunzaiPath}，含旧的裸 `Yunzai-` 与带框架名的两种），
 * 用户显式写的 `/ws/MyBot` 不擅自并进去。
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
 * 路径不参与（它标的是「这条 ws 在核心后台叫什么」而非「哪个核心」），token 也不参与，解析不了就退回原串比较。
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
 * 用在抛错话术（会被指令层原样回进群）与所有对外显示的地址（面板 connView、状态图 collect）。
 * 注意：故意不走 `new URL()` 而按字符切，本函数最主要的调用点就是「URL 解析失败」那一支。
 * 注意：空输入回「(空)」而不是空串（调用点是错误话术）。
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
 * 注意：必须在这里拦掉 http://，ws@8 会把 `http:` 改写成 `ws:`（ws/lib/websocket.js:700-704），落盘后建连不报协议错，只 403 + 重连循环，日志里没有一句说得出协议填错了。
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
        // 建议里查询串已被 redactUrl 砍掉，顺带说清 token 该写哪，否则用户照抄会丢掉内联凭据
        "token 请用 t=<token> 单独给，不要写在地址里",
    )
  }
  if (!["ws:", "wss:"].includes(u.protocol)) throw new Error("连接地址仅支持 ws:// / wss://")
  return s
}
