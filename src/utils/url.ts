/**
 * 连接地址规范化
 *
 * 指令（apps/admin.ts）与 web 面板（modules/webadapter）都要用同一套规则，
 * 所以放在这儿而不是各写一份 —— 两处规则不一致时，同一个地址在两个入口
 * 会被存成不同的串，`find()` 按名字/序号定位又刚好看不出来。
 */

/** 只填 host:port 时补的默认路径。核心后台显示的就是这一段 */
export const DEFAULT_WS_PATH = "/ws/Yunzai"

/**
 * 旧配置自动拼的 `/ws/Yunzai-<账号>`。后缀必须带数字，
 * 以免把用户自己起的 `/ws/Yunzai-backup` 当成账号路径收掉。
 */
const AUTO_ACCOUNT_PATH = /^\/ws\/Yunzai-[0-9A-Za-z_-]*\d[0-9A-Za-z_-]*$/

/** 默认 `/ws/Yunzai`，以及旧配置里带账号后缀的同路径 */
export function isAutoYunzaiPath(pathname: string): boolean {
  return pathname === DEFAULT_WS_PATH || AUTO_ACCOUNT_PATH.test(pathname)
}

/** 旧路径收到 `/ws/Yunzai`；自定义路径不动，token 查询参数保留 */
export function stripAccountPath(url: string): string {
  try {
    const u = new URL(url)
    if (AUTO_ACCOUNT_PATH.test(u.pathname)) {
      u.pathname = DEFAULT_WS_PATH
      return u.toString()
    }
  } catch {
    // 解析不了就原样返回
  }
  return url
}

/**
 * 自动端点规范化
 *
 * 只补协议、去掉根路径，**不再**补 `/ws/Yunzai` —— 路由段现在由 bind 账号在
 * 建连时生成（materializeAccountUrl），配置里不该再出现派生信息。
 */
export function normalizeEndpoint(url: string | null | undefined): string {
  if (!url) return ""
  url = String(url).trim()
  // 只在「没写协议」时补 ws://。原来是「不是 ws/wss 就补」，于是 http://h:1/ws 被
  // 拼成 ws://http//h:1/ws —— 一个能解析、host 是 "http" 的合法 URL，requireWsUrl
  // 的协议校验因此永远看到 ws: 而放行，连接直到重连循环里才失败。
  // 带协议的原样留下，交给 requireWsUrl/requireUrl 去校验
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `ws://${url}`
  try {
    const u = new URL(url)
    if (u.pathname === "/" || u.pathname === "") return u.origin
    return u.toString()
  } catch {
    return url
  }
}

/** 账号只当一个 path segment：不许注入 `/`、`?`、`#` */
export function materializeAccountUrl(endpoint: string, account: string): string {
  const id = encodeURIComponent(String(account).trim())
  if (!id) throw new Error("绑定账号不能为空")
  const u = new URL(endpoint)
  if (u.pathname !== "/" && u.pathname !== "") throw new Error("自定义路径不能生成账号连接地址")
  u.pathname = `${DEFAULT_WS_PATH}-${id}`
  u.search = ""
  u.hash = ""
  return u.toString()
}

/** 运行时身份：协议 + 主机 + 端口 + 路径，query/token 不参与 */
export function routeKey(url?: string): string {
  if (!url) return ""
  try {
    const u = new URL(String(url))
    return `${u.protocol}//${u.host}${u.pathname}`.toLowerCase()
  } catch {
    return String(url).trim().toLowerCase()
  }
}

/**
 * 找出与「同一地址 + 同一账号」冲突的既有连接
 *
 * 为什么不是按地址判重
 * ------------------
 * 原来两个入口都写 `list.some(c => c.url === url)`。多 Bot 共存时这是错的：在 A 号
 * 上加过 127.0.0.1:8765，再到 B 号上加同一个核心就被顶回「该地址已存在」，而用户
 * 想要的恰恰是第二条——把 B 绑进已有连接。判重只拦「这个账号已经在这条核心上了」；
 * 「换个账号再加一次」由 {@link findSameCore} 去合并 bind，而不是新建一条 ws。
 *
 * 「同一个核心」按 origin 比，不是按整个 URL（路径只是后台显示名）。
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
  const want = new Set(bind.map(String))
  const target = coreKey(url)
  return list.find(c => {
    if (coreKey(c.url) !== target) return false
    const has = (Array.isArray(c.bind) ? c.bind : []).map(String)
    // 任一侧不限账号 -> 覆盖对方，算重复
    if (!has.length || !want.size) return true
    return has.some(id => want.has(id))
  })
}

/**
 * 找出指向同一个核心、可以合并 bind 的已有连接
 *
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
 * 一个核心的身份：协议 + 主机 + 端口
 *
 * 路径段不参与 —— 它标的是「这条 ws 在核心后台叫什么」而不是「哪个核心」。
 * token 也不参与：同一个核心换个 token 仍是同一个核心。解析不了就退回原串比较。
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
 * 回显前脱敏：砍掉查询串、fragment 与 userinfo
 *
 * 这两条错误话术会被指令层原样回进群里（apps/admin.ts 的 add/edit 两个 catch），
 * 而抛错时的输入恰好最可能是从旧模型复制粘贴过来的完整地址 —— 那种地址里
 * `?token=` 是常态。成功路径由 admin 的 safeUrl() 把守，失败路径只能在这里守：
 * 抛出去之后调用方看到的就只是一句话，没法再按 URL 结构过滤。
 *
 * 不走 new URL()：这个函数最主要的调用点就是「URL 解析失败」那一支，
 * 能解析的话也就不需要它了。所以按字符切，宁可粗一点也不能漏。
 */
function redactUrl(value: string | null | undefined): string {
  const s = String(value ?? "").trim()
  if (!s) return "(空)"
  // 先砍 ? 与 #，再砍 userinfo。顺序要紧：查询串里也可能出现 @
  const cut = s.split(/[?#]/)[0]
  return cut.replace(/^([a-z][a-z0-9+.-]*:\/\/)?[^/@]*@/i, "$1")
}

/**
 * 校验并规范化，非法时抛错
 *
 * 两个添加入口（apps/admin 的 add、webadapter 的 addConnection）都只走这一个门，
 * 面板尤其需要：它收的是任意 HTTP 请求体，不能像指令那样默认使用者是主人且大致
 * 会写对。
 *
 * 为什么必须在这里拦掉 http://
 * -------------------------
 * `http://` 落盘后**不会**在建连时报协议错：ws@8 会把 `http:` 改写成 `ws:`
 * （node_modules/ws/lib/websocket.js:700-704），于是它变成一次朝那个地址发起的
 * WebSocket 握手。本机实测拿到 403，接着进重连循环，而日志里没有一句说得出
 * 协议填错了 —— 用户会去查网络、查 token、查防火墙。所以宁可在入口拒掉，
 * 并把地址换算成 ws 形式一起给出去。
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
        // 建议里的查询串已被 redactUrl 砍掉，所以顺带说清 token 该写哪儿，
        // 否则用户照抄这条建议会丢掉原来内联在地址里的凭据
        "token 请用 t=<token> 单独给，不要写在地址里",
    )
  }
  if (!["ws:", "wss:"].includes(u.protocol)) throw new Error("连接地址仅支持 ws:// / wss://")
  return s
}
