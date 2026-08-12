/**
 * 框架兼容层
 *
 * TRSS-Yunzai 在 `Bot` 上挂了一批工具方法，Miao-Yunzai **完全没有**——
 * Miao 的 lib/bot.js 是 `class Yunzai extends Client`（ICQQ 的 Client），
 * 只有协议方法，没有这些便利函数。实测缺失清单：
 *
 *   Bot.makeLog / Bot.String / Bot.Buffer / Bot.fileToUrl   —— Miao 全部为 0 处
 *
 * 直接调用会在 Miao 上抛 TypeError，且第一条日志就在插件加载时打出，
 * 等于插件一装即崩。故本模块统一提供垫片。
 *
 * 原则：**按能力探测，不按框架名分支。**
 * 不学 `package.json.name.includes("trss")` 那种判法——同步读盘、依赖 cwd，
 * 且 fork 改名即失效（本仓库目录名就叫 Miao-Yunzai，实际却是 TRSS，正是反例）。
 * 每个方法各自探测，谁缺补谁；将来 Miao 补齐了任何一个，这里自动改用原生实现。
 *
 * 文件内的 `const B: any = globalThis.Bot` 是有意的：探测的正是**类型里没有**
 * 的方法（Miao 上不存在，@types/trss-yunzai 又把 fileToUrl 拼成了 fileToUrll），
 * 标类型只能标成谎话。any 收在每个函数第一行，不外泄到签名上。
 */
import type { FileLike } from "@/types"

/* ============================ 日志 ============================ */

/** TRSS 的 makeLog 支持 mark，Miao 的 logger 没有，退到 info */
const LEVEL_FALLBACK: Record<string, string> = {
  mark: "info",
  success: "info",
  fatal: "error",
}

/**
 * Bot.makeLog 垫片
 *
 * TRSS 签名：makeLog(level, msg, tag, force)
 * Miao 只有全局 logger，且无 tag 概念——把 tag 拼进消息里保持可读性。
 */
export function makeLog(level: string, msg: any, tag?: string, force = false) {
  const B: any = globalThis.Bot
  if (typeof B?.makeLog === "function") return B.makeLog(level, msg, tag, force)

  const lg: any = globalThis.logger
  if (!lg) return

  // Miao 的 logger 没有 mark/success 等级
  const lv = typeof lg[level] === "function" ? level : LEVEL_FALLBACK[level] || "info"
  const prefix = tag ? `[${tag}]` : ""

  // makeLog 的 msg 允许是数组（各段分别格式化），logger 直接展开即可
  if (Array.isArray(msg)) return lg[lv](prefix, ...msg)
  return lg[lv](prefix, msg)
}

/* ============================ 字符串化 ============================ */

/**
 * Bot.String 垫片
 *
 * TRSS 的 Bot.String 能把 Error / Buffer / 循环引用对象都转成可读字符串。
 * 垫片行为对齐要点：字符串原样返回（不要加引号），Error 带 stack，
 * 对象走 JSON 且**必须处理循环引用**——事件对象上挂着 e.bot，
 * 不处理会直接抛 TypeError: Converting circular structure to JSON。
 */
export function toStr(data: any): string {
  const B: any = globalThis.Bot
  if (typeof B?.String === "function") return B.String(data)

  if (typeof data === "string") return data
  if (data instanceof Error) return data.stack || data.message
  if (Buffer.isBuffer(data)) return `<Buffer ${data.length} bytes>`
  if (data === null || data === undefined) return String(data)
  if (typeof data !== "object") return String(data)

  try {
    const seen = new WeakSet()
    return JSON.stringify(data, (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]"
        seen.add(v)
      }
      if (Buffer.isBuffer(v)) return `<Buffer ${v.length} bytes>`
      return v
    })
  } catch {
    return String(data)
  }
}

/* ============================ 文件读取 ============================ */

/**
 * Bot.Buffer 垫片
 *
 * TRSS 的 Bot.Buffer(file, {http, size}) 三路返回：
 *   - Buffer                      —— 读到内容
 *   - http URL 原样               —— opts.http 为真且入参是网址时不下载
 *   - file:// 路径                —— 超过 opts.size 时不读进内存
 *
 * 垫片必须保持这三路语义，否则 media.ts 的分支会走错。
 * 支持的入参形式对齐云崽的 file 字段：Buffer / base64:// / data: /
 * http(s):// / file:// / 裸路径。
 */
export async function toBuffer(
  file: FileLike | null | undefined,
  opts: { http?: boolean; size?: number } = {},
): Promise<Buffer | string> {
  const B: any = globalThis.Bot
  if (typeof B?.Buffer === "function") return B.Buffer(file, opts)

  if (Buffer.isBuffer(file)) return file
  if (file == null) return file

  const s = String(file)

  if (s.startsWith("base64://")) return Buffer.from(s.slice(9), "base64")

  if (s.startsWith("data:")) {
    const i = s.indexOf("base64,")
    if (i !== -1) return Buffer.from(s.slice(i + 7), "base64")
    return file
  }

  if (/^https?:\/\//.test(s)) {
    // http 语义：调用方声明"网址原样返回"时不下载，交给下游转外链
    if (opts.http) return s
    try {
      const res = await fetch(s)
      if (!res.ok) return file
      const buf = Buffer.from(await res.arrayBuffer())
      // 超限时落盘不现实（无临时目录约定），保持原样交还
      if (opts.size && buf.length > opts.size) return s
      return buf
    } catch {
      return file
    }
  }

  // 本地文件：file:// 或裸路径
  try {
    const { readFile, stat } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    const path = s.startsWith("file://") ? fileURLToPath(s) : s

    // 先看大小：超限就回 file:// 让上层去转外链，别读进内存
    if (opts.size) {
      const st = await stat(path)
      if (st.size > opts.size) {
        const { pathToFileURL } = await import("node:url")
        return pathToFileURL(path).href
      }
    }
    return await readFile(path)
  } catch {
    return file
  }
}

/* ============================ 外链 ============================ */

/**
 * Bot.fileToUrl 垫片
 *
 * TRSS 用自带的文件服务把本地文件转成 http 外链。Miao 没有这个服务，
 * **无法用垫片模拟**——没有 HTTP 服务就没有外链可给。
 *
 * 故此处不伪造，直接抛错，由调用方 catch 后降级（media.ts 会打日志并跳过该段）。
 * 后果：Miao 上超过 media_max_size 的大图/大文件发不出去，小文件走 base64 正常。
 * 这是能力缺失，不是 bug——伪造一个假 URL 只会让核心侧拿到打不开的链接。
 *
 * @types/trss-yunzai 把 fileToUrl 拼成了 fileToUrll（多一个 l），
 * 框架实际方法名见 lib/bot.js:274 —— 以框架源码为准，不迁就上游错拼。
 */
export function fileToUrl(
  file: string,
  opts?: { name?: string; time?: number | false },
): Promise<string> {
  const B: any = globalThis.Bot
  if (typeof B?.fileToUrl === "function") return B.fileToUrl(file, opts)
  return Promise.reject(new Error("当前框架不支持 Bot.fileToUrl（文件外链服务），无法生成外链"))
}

/* ============================ 转发消息 ============================ */

/**
 * Bot.makeForwardMsg 垫片
 *
 * 这是**唯一一个不能按"方法是否存在"探测**的能力——两个框架都有同名方法，
 * 但语义完全相反，直接调用会在 Miao 上同步抛 TypeError：
 *
 *   TRSS  lib/bot.js:554  makeForwardMsg(msg) { return { type:"node", data:msg } }
 *         纯标记，同步返回，由各适配器在 sendMsg 时自行处理
 *
 *   Miao  **Bot 上没有**（lib/bot.js 里 0 处）。但 `class Yunzai extends Client`，
 *         于是继承到 ICQQ 的 Client.prototype.makeForwardMsg（client.d.ts:227）：
 *           makeForwardMsg(fake, dm=false, nt) {
 *             return (dm ? this.pickFriend : this.pickGroup)(this.uin).makeForwardMsg(fake, nt)
 *           }
 *         —— async、要真的走协议上传、且**从 Bot 上调必然失败**：
 *         `(this.pickGroup)(this.uin)` 丢了 this 绑定，实测同步抛
 *         `TypeError: (intermediate value)(...) is not a function`（icqq client.js:397）。
 *
 * 所以 `typeof Bot.makeForwardMsg === "function"` 在两边都为真，探测不出差别。
 * 这里改按**返回值形状**判定：TRSS 同步返回带 type:"node" 的普通对象，
 * 拿到即用；否则走 target 上的原生 makeForwardMsg（ICQQ 的 Group/Friend 实现）。
 *
 * @param nodes  [{ message, nickname, user_id }]
 * @param target 已 pick 出的 Group/Friend，Miao 路径必须有它才能上传
 */
export async function makeForwardMsg(nodes: any[], target?: any): Promise<any> {
  const B: any = globalThis.Bot

  // TRSS：同步返回标记对象。用 try 包住是因为 Miao 继承来的那个会同步抛。
  try {
    const r = B?.makeForwardMsg?.(nodes)
    if (r && typeof r === "object" && !(r instanceof Promise) && r.type === "node") return r
    // 万一将来某框架返回 Promise 形态的标记，也接住
    if (r instanceof Promise) {
      const v = await r
      if (v) return v
    }
  } catch {
    // 落到下面的 target 路径
  }

  // Miao：只能靠 Group/Friend 上的原生实现真正上传
  if (typeof target?.makeForwardMsg === "function") return await target.makeForwardMsg(nodes)

  return null
}

/**
 * 当前框架能否制作转发消息。
 * 供自检使用——两边都"有方法"，得按上面的形状规则实际判定。
 */
export function forwardMode(): "native" | "target" | "none" {
  const B: any = globalThis.Bot
  try {
    const r = B?.makeForwardMsg?.([])
    if (r && typeof r === "object" && !(r instanceof Promise) && r.type === "node") return "native"
  } catch {
    return "target"
  }
  return "target"
}

/* ============================ 能力自检 ============================ */

/** 本插件依赖、但框架可能没有的 Bot 方法 */
const REQUIRED = ["makeLog", "String", "Buffer", "fileToUrl"] as const

/**
 * 返回缺失的 Bot 方法名。空数组表示框架能力齐全。
 * 供启动自检使用——静默降级最难排查，缺什么要明说。
 */
export function missingBotApis(): string[] {
  const B: any = globalThis.Bot
  return REQUIRED.filter(m => typeof B?.[m] !== "function")
}

/**
 * 启动自检。在 online 之后调用（此时 Bot 已完成扩展，早于此刻检测会误报）。
 *
 * makeLog / String / Buffer 缺失都由本文件垫片补齐，属于"已处理"，
 * 只在 debug 里留痕，免得正常用户看见一堆无需处理的告警。
 *
 * fileToUrl 是唯一无法垫片的能力，会真实影响大文件发送，故单独 warn。
 */
export function checkFrameworkApis(): void {
  const missing = missingBotApis()
  if (!missing.length) return

  const shimmed = missing.filter(m => m !== "fileToUrl")
  if (shimmed.length)
    makeLog("debug", `框架缺少 ${shimmed.join("、")}，已由兼容层接管`, "GsCore", true)

  if (missing.includes("fileToUrl"))
    makeLog(
      "warn",
      "当前框架不提供 Bot.fileToUrl（文件外链服务）：" +
        "超过 media_max_size 的大图/大文件将无法上报，小文件走 base64 不受影响。",
      "GsCore",
    )
}
