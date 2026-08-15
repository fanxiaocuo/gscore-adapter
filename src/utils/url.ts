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
 * `/ws/Yunzai-<账号>`：{@link materializeAccountUrl} 生成的形状，手写配置里也有。
 * 后缀必须带数字，以免把用户自己起的 `/ws/Yunzai-backup` 认成账号路径。
 */
const AUTO_ACCOUNT_PATH = /^\/ws\/Yunzai-[0-9A-Za-z_-]*\d[0-9A-Za-z_-]*$/

/** 默认 `/ws/Yunzai`，以及带账号后缀的同路径 */
export function isAutoYunzaiPath(pathname: string): boolean {
  return pathname === DEFAULT_WS_PATH || AUTO_ACCOUNT_PATH.test(pathname)
}

/**
 * 自动端点规范化
 *
 * 只补协议、去掉根路径，**不再**补 `/ws/Yunzai` —— 路由段现在由 bind 账号在
 * 建连时生成（materializeAccountUrl），配置里不该再出现派生信息。
 *
 * 根路径的查询串必须留下
 * ------------------
 * 原来这一支直接回 `u.origin`，于是 `ws://h:8765/?token=x` 的凭据在规范化时就没了：
 * 握手不带 token 被核心拒掉，而 token 字段本来是空的、{@link inlineToken} 走同一套
 * 规范化也看不见它 —— 面板与状态图一致地报「未配 token」，用户对着配置里明明写着的
 * token 无从下手。fragment 是唯一确定用不上的（不会发给服务端），只砍它。
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
    if (u.pathname === "/" || u.pathname === "") {
      // 查询串拼在 origin 后面，而不是走 u.toString()：后者会补一个 `/`，于是同一个核心
      // 内联了凭据就显示成 `ws://h:8765/`、没内联就是 `ws://h:8765`；更要紧的是配置里
      // 写成 `h:8765?token=x` 的地址规范化后必然不等于原值，编辑路径那一步
      // （webadapter 的 patch.url、admin 的 nextUrl）就会顺手把用户的地址行改写一遍
      // —— 插件不改用户写的地址，改名字、改绑定都不该顺带动它。
      return u.search ? `${u.origin}${u.search}` : u.origin
    }
    return u.toString()
  } catch {
    return url
  }
}

/**
 * 地址里内联的凭据；没内联、或内联的是空写的 `?token=`，都回 null
 *
 * 先过 {@link normalizeEndpoint} —— 配置里允许不写协议（`h:8765/ws/X`），直接
 * `new URL` 会抛，而 expand 那边是规范化之后才解析的。两边判据一旦不一致，就会出现
 * 「运行时确实取到了凭据，面板与状态图却说没配 token」。
 *
 * 根路径地址（`ws://h:8765/?token=x`）同样报得出来：{@link normalizeEndpoint} 留住了
 * 根路径的查询串，expand 的根路径分支也先过 detachInlineToken 把凭据摘进 token 字段，
 * 派生地址再由 {@link materializeAccountUrl} 清空 search。
 *
 * 空写的 `?token=` 回 null，与 detachInlineToken 的 `searchParams.has` 有意分开
 * ------
 * 两个函数问的不是一件事：detachInlineToken 问「这条地址里有没有一个 token 参数要我
 * 搬走、并在运行时照原样复现」——那是**形状**问题，空参数也得复现；这个函数问「有没有
 * 一份凭据」，四个调用点（面板 has_token、状态图那一行、指令与面板改地址时的搬运）
 * 要的都是后者。
 *
 * 空值算「配过」的话，`?token=` 空写且 token 字段也空的配置会让面板和状态图一起说
 * 「已配 token」，而握手带出去的是个空参数 —— 正是这段注释原本警告的那个病，只是方向
 * 反了：用户什么也没配，被告知配好了，然后连不上，且没有一处话术指得到那个空参数上。
 * expand 的 detachInlineToken 早已认定空写不算提供凭据（空写不顶掉 token 字段里那份
 * 真的），这里跟上，四处话术才一致。
 */
export function inlineToken(url: string | null | undefined): string | null {
  try {
    const u = new URL(normalizeEndpoint(String(url ?? "")))
    return u.searchParams.get("token") || null
  } catch {
    return null
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
 * 抛错路径
 * ------
 * 下面两条错误话术会被指令层原样回进群里（apps/admin.ts 的 add/edit 两个 catch），
 * 而抛错时的输入恰好最可能是从旧模型复制粘贴过来的完整地址 —— 那种地址里
 * `?token=` 是常态。成功路径由 admin 的 safeUrl() 把守，失败路径只能在这里守：
 * 抛出去之后调用方看到的就只是一句话，没法再按 URL 结构过滤。
 *
 * 显示路径（导出的原因）
 * ------
 * 面板视图（modules/webadapter 的 connView）与状态图（modules/render/pages.ts 的
 * collect）显示的是配置里的原始地址，而 {@link normalizeEndpoint} 只砍 fragment、
 * 查询串一路留着（根路径也留 —— 凭据允许内联在那儿）。于是
 * `ws://host:port/ws/Custom?token=xxx` 这种配置的凭据只存在于 url 字段里、
 * `token` 字段是空的 —— 原样回给前端等于把凭据发进浏览器，落进截图更是永久留痕。
 * 所以这个函数不只守抛错话术，也守所有对外显示的地址。
 *
 * 不走 new URL()：这个函数最主要的调用点就是「URL 解析失败」那一支，
 * 能解析的话也就不需要它了。所以按字符切，宁可粗一点也不能漏。
 * 空输入回「(空)」而不是空串 —— 它的第一批调用点是错误话术。
 */
export function redactUrl(value: string | null | undefined): string {
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
