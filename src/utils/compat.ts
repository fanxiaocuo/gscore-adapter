/**
 * @description 框架兼容层：TRSS 挂在 `Bot` 上的 makeLog / String / Buffer / fileToUrl 在 Miao-Yunzai 全部没有，本模块统一提供垫片
 *
 * Miao 的 lib/bot.js 是 `class Yunzai extends Client`（ICQQ 的 Client），只有协议方法。
 * 直接调用会抛 TypeError，且第一条日志就在插件加载时打出，等于一装即崩。
 * 注意：一律**按能力探测，不按框架名分支** —— 目录名由用户随意取（本机就叫 `Yunzai`），package.json 的
 * name 也是 fork 一改就失效。谁缺补谁，将来 Miao 补齐了任何一个就自动改用原生实现。
 * 注意：文件内的 `const B: any = globalThis.Bot` 是有意的 —— 探测的正是类型里没有的方法
 * （@types/trss-yunzai 还把 fileToUrl 拼成了 fileToUrll），标类型只能标成谎话；any 收在函数第一行不外泄。
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
 * @description Bot.makeLog 垫片，TRSS 签名 `makeLog(level, msg, tag, force)`
 * Miao 只有全局 logger、无 tag 概念，所以把 tag 拼进消息里保持可读性。
 */
export function makeLog(level: string, msg: any, tag?: string, force = false) {
  const B: any = globalThis.Bot
  if (typeof B?.makeLog === "function") return B.makeLog(level, msg, tag, force)

  const lg: any = globalThis.logger
  if (!lg) return

  const lv = typeof lg[level] === "function" ? level : LEVEL_FALLBACK[level] || "info"
  const prefix = tag ? `[${tag}]` : ""

  // makeLog 的 msg 允许是数组（各段分别格式化），logger 直接展开即可
  if (Array.isArray(msg)) return lg[lv](prefix, ...msg)
  return lg[lv](prefix, msg)
}

/* ============================ 字符串化 ============================ */

/**
 * @description Bot.String 垫片：把 Error / Buffer / 循环引用对象都转成可读字符串
 * 对齐要点：字符串原样返回（不加引号），Error 带 stack，对象走 JSON。
 * 注意：必须处理循环引用 —— 事件对象上挂着 e.bot，不处理会直接抛
 * TypeError: Converting circular structure to JSON。
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
 * @description Bot.Buffer 垫片，保持 TRSS 的三路返回：Buffer / http URL 原样（opts.http 为真时）/ 超过 opts.size 时的 file:// 路径
 * 注意：这三路语义必须保持，否则 media.ts 的分支会走错。
 * 入参形式对齐云崽的 file 字段：Buffer / base64:// / data: / http(s):// / file:// / 裸路径。
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
 * @description Bot.fileToUrl 垫片；Miao 没有文件服务，**无法模拟**，直接抛错让调用方 catch 后降级
 * 后果：Miao 上超过 media_max_size 的大图/大文件发不出去，小文件走 base64 正常 —— 这是能力缺失不是 bug，
 * 伪造假 URL 只会让核心侧拿到打不开的链接。
 * 注意：@types/trss-yunzai 把它拼成了 fileToUrll，以框架源码（lib/bot.js:274）为准，不迁就上游错拼。
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
 * @description Bot.makeForwardMsg 垫片，按**返回值形状**而非方法是否存在来分派
 *
 * 注意：这是唯一不能按「方法是否存在」探测的能力 —— 两边都有同名方法但语义相反。
 * TRSS（lib/bot.js:554）同步返回 `{ type:"node", data:msg }` 纯标记；Miao 的 Bot 上没有，
 * 却从 ICQQ Client 继承到一个 async 版本，且从 Bot 上调必然同步抛
 * `TypeError: (intermediate value)(...) is not a function`（icqq client.js:397，丢了 this 绑定）。
 * 所以拿到 type:"node" 的同步对象就用它，否则走 target 上的原生实现。
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
 * @description 当前框架能否制作转发消息，供自检使用
 * 两边都「有方法」，所以按上面那条形状规则实际判定。
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
 * @description 返回缺失的 Bot 方法名，空数组表示框架能力齐全
 * 供启动自检使用 —— 静默降级最难排查，缺什么要明说。
 */
export function missingBotApis(): string[] {
  const B: any = globalThis.Bot
  return REQUIRED.filter(m => typeof B?.[m] !== "function")
}

/**
 * @description 启动自检：垫片能补的只在 debug 留痕，fileToUrl 缺失单独 warn
 * 注意：必须在 online 之后调用 —— 早于此刻 Bot 还没扩展完，会误报。
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
