/**
 * @description 内置文件服务：框架没有 Bot.fileToUrl（Miao-Yunzai）时自己起一个 HTTP 服务把大文件挂出去，让核心能拉取
 *
 * 设计要点：懒启动、内存暂存 + 到期自动清（不落盘）、随机 token 路径（不可枚举）、一次性（核心取走即删，可配）。
 * 注意：不用 express（Miao 没装，lib/tools/web.js 的 import 是孤儿脚本，照抄真机会 ERR_MODULE_NOT_FOUND）；node:http 零依赖够用。
 */
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomBytes } from "node:crypto"
import { config } from "@/config"
import { makeLog } from "./compat.js"

interface Entry {
  buf: Buffer
  name?: string
  type: string
  expire: number
  timer: NodeJS.Timeout
}

const files = new Map<string, Entry>()

let server: http.Server | null = null
let starting: Promise<http.Server | null> | null = null

function fsConf() {
  return config.file_server || {}
}

/** @description 内置文件服务是否可用（未显式关闭） */
export function fileServerEnabled() {
  return fsConf().enable !== false
}

/**
 * @description 扩展名 → Content-Type，只覆盖早柚核心实际会走的几类媒体
 * 注意：核心侧（PIL / 浏览器）靠它决定怎么解码，给错了会拿不到图；其余给 octet-stream。
 */
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  amr: "audio/amr",
  silk: "audio/silk",
  mp4: "video/mp4",
  mov: "video/quicktime",
}

function guessType(name?: string) {
  const ext = String(name || "")
    .split(".")
    .pop()
    ?.toLowerCase()
  return (ext && MIME[ext]) || "application/octet-stream"
}

/**
 * @description 起服务，失败不抛错（调用方会降级到 upload_hook 或跳过该段）；端口占不到不该让消息发送整体崩掉
 */
function start(): Promise<http.Server | null> {
  if (server?.listening) return Promise.resolve(server)
  if (starting) return starting

  starting = new Promise<http.Server | null>(resolve => {
    const srv = http.createServer(handle)
    let settled = false

    // 注意：error 在启动失败与运行期都会触发，只有前者算「起不来」；已 listening 后再报错不能把 server 置空，否则后续请求全走降级
    srv.on("error", err => {
      if (settled) {
        makeLog("warn", ["内置文件服务运行时错误", err], "GsCore")
        return
      }
      settled = true
      makeLog("error", ["内置文件服务启动失败，大文件将无法生成外链", err], "GsCore")
      srv.close()
      server = null
      starting = null
      resolve(null)
    })

    // 注意：host 默认 0.0.0.0 —— 核心常跑在 Docker / 另一台机器上，只听 127.0.0.1 它连不进来
    const port = Number(fsConf().port) || 0
    const host = String(fsConf().host || "0.0.0.0")

    srv.listen(port, host, () => {
      settled = true
      server = srv
      starting = null
      // unref：文件服务是附属设施，不该拖着进程不退出
      srv.unref?.()
      const p = (srv.address() as AddressInfo)?.port
      makeLog("info", `内置文件服务已启动 ${host}:${p}（仅用于大文件外链）`, "GsCore")
      resolve(srv)
    })
  })

  return starting
}

/**
 * @description 重起文件服务的结果，三种情形要分开报给用户
 * 注意：不能压成一个 `number` —— 「本来就没在听」与「起不来」都得 0，但前者正常（TRSS 上这服务永远不该起），后者是故障（端口被占用，大文件外链从此全废）
 */
export interface RestartResult {
  /** 之前有没有在听。false 表示这次什么都没做 */
  was: boolean
  /** 重起后实际监听的端口；`was` 为 false 或起不来时为 null */
  port: number | null
}

/**
 * @description 按新配置重起文件服务：只重起本来就在听的那个，绝不凭空起新的
 *
 * 只在 `port`/`host`/`enable` 真改了时调用；`public_host`/`once`/`imagebed_token` 每次请求现读，为它们重启纯属白丢在途外链。
 * 注意：必须先判「现在有没有在听」—— 服务懒起，只有框架 `Bot.fileToUrl` 抛错时才走 media.ts 的 viaFallback 起它（即只有 Miao 那类框架）。TRSS 自带文件服务、这几栏无效，无条件 start() 会在 TRSS 上凭空绑一个监听端口、把 BED_PATH 暴露在第二个端口上直到进程退出。
 * 注意：重启作废在途外链（旧端口没人听了），{@link files} 里的暂存留给各自定时器清（最长一个 link_expire）；不在这里清空，端口没变老链接还能用。
 * 注意：图床转接口不用重挂 —— 挂在 `Bot.express` 上的那条与本服务无关，没有 express 的框架（Miao）走本服务的 {@link handle}，重起后照样分流 BED_PATH。
 */
export async function restartFileServer(): Promise<RestartResult> {
  // 注意：先等在途 start() 落定 —— 它 resolve 时会写模块变量 server，不等就会把刚重起的服务顶掉
  if (starting) await starting

  const old = server
  // 本来就没在听：什么都不做，下次真需要外链时 start() 自然按新配置起
  if (!old) return { was: false, port: null }

  server = null
  starting = null
  await new Promise<void>(resolve => {
    old.close(() => resolve())
    // 注意：close 会等现有连接自己结束，核心正拉一个大文件时会挂住整个保存请求
    old.closeAllConnections?.()
  })

  // 关掉就是关掉：enable 由 true 改 false 时不再听端口，也不起新的
  if (!fileServerEnabled()) return { was: true, port: null }

  // 注意：start() 把启动失败吞成 resolve(null)，所以这里必须把 null 与「起来了」分开回，否则端口被占用会被报成「已按新配置重启」，而实际旧服务已 close、新的没起来，此后所有大文件外链都拿不到
  const srv = await start()
  return { was: true, port: srv ? ((srv.address() as AddressInfo)?.port ?? null) : null }
}

/**
 * @description 图床转接口的路径，本体 express 与自带服务两条路共用
 * 注意：带 gscore 前缀 —— 挂到 `Bot.express` 是全局命名空间，别的插件也挂路由，裸的 /imagebed 太容易撞（ImageBed-Plugin 就占了 /imagebed-config 与 /imagebed-test）。
 */
const BED_PATH = "/gscore/imagebed"

/** @description 图床转接口的凭据；留空表示只放行本机来源（同机部署因此无需配它） */
function imagebedToken() {
  return String(fsConf().imagebed_token || "").trim()
}

/** @description 是否本机来源。v4-mapped（::ffff:127.0.0.1）也算 */
function isLoopback(addr?: string) {
  const a = String(addr || "").replace(/^::ffff:/, "")
  return a === "::1" || a.startsWith("127.")
}

/**
 * @description 从 Content-Type 里取 multipart 的边界串
 * 边界可能带引号（`boundary="----x"`），也可能后面还跟着别的参数，两种都要认。
 */
function boundaryOf(ct?: string): string {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(ct || ""))
  return (m?.[1] || m?.[2] || "").trim()
}

/**
 * @description 从 multipart 正文里挑出名为 file 的那一段（自己解而不引 busboy/formidable，运行时依赖为零）
 * 注意：全程在 Buffer 上做，不能先 toString —— 图片是二进制，转字符串再切会把非法字节替换成 U+FFFD，写回就是坏图；只有段头（几行 ASCII）才按 latin1 读出来做正则。
 * 注意：每段正文末尾有一个属于分隔符的 CRLF，必须剪掉，否则图片尾部多两字节。
 */
function pickFilePart(body: Buffer, boundary: string): { buf: Buffer; name?: string } | null {
  const sep = Buffer.from(`--${boundary}`)
  let pos = body.indexOf(sep)

  while (pos !== -1) {
    const start = pos + sep.length
    // 收尾标记是 `--boundary--`，到这儿就没有更多段了
    if (body.subarray(start, start + 2).toString("latin1") === "--") return null

    const next = body.indexOf(sep, start)
    const end = next === -1 ? body.length : next
    const part = body.subarray(start, end)

    const hdrEnd = part.indexOf("\r\n\r\n")
    if (hdrEnd !== -1) {
      const head = part.subarray(0, hdrEnd).toString("latin1")
      if (/name="file"/i.test(head)) {
        const fn = /filename="([^"]*)"/i.exec(head)?.[1]
        // 段尾那个 CRLF 属于分隔符，不属于内容
        let stop = part.length
        if (part.subarray(stop - 2, stop).toString("latin1") === "\r\n") stop -= 2
        return { buf: Buffer.from(part.subarray(hdrEnd + 4, stop)), name: fn || undefined }
      }
    }
    pos = next
  }
  return null
}

/**
 * @description 读完请求体，超过上限就断开
 * 注意：上限借 file_max_size（默认 50 MB）—— 收的是要发出去的图，更大的本来也发不出去；不设上限一个大 POST 就能把云崽内存顶穿。
 */
function readBody(req: http.IncomingMessage, cap: number): Promise<Buffer | null> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > cap) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", () => resolve(null))
  })
}

/** @description 转接口的响应：core 那边无条件取 `raw_data[0]`，所以恒定是数组 */
interface BedResult {
  code: number
  payload: unknown
}

function bedFail(why: string, code = 400): BedResult {
  makeLog("warn", `图床转接口：${why}`, "GsCore")
  return { code, payload: [{ error: why }] }
}

/**
 * @description 鉴权：本机来源直接放行，非本机必须带 token（同机部署占多数，能连上 127.0.0.1 就已在本机，口令挡不住任何人）
 * 注意：判断依赖 socket 对端地址，不看任何请求头 —— X-Forwarded-For 那类客户端可伪造；放在反代后面时必须配 token（反代过来的对端地址恒为本机）。
 */
function bedAuth(remote: string | undefined, token: string): string | null {
  if (isLoopback(remote)) return null
  const want = imagebedToken()
  if (!want) return `非本机来源（${remote || "未知"}）且没有配 imagebed_token，已拒绝`
  if (token !== want) return "凭据不对"
  return null
}

/**
 * @description 从 URL 查询串或请求头里取 token，两种都认（核心的 custom_url 能带查询串、custom_header 能带头）
 */
function bedToken(req: http.IncomingMessage): string {
  const q = new URL(String(req.url || "/"), "http://x").searchParams.get("token")
  return q || String(req.headers["x-imagebed-token"] || "")
}

/**
 * @description 图床转接口的正体：把 ImageBed-Plugin 的 `Bot.imageToUrl` 包成早柚核心要的响应形状
 *
 * 核心（utils/upload/custom.py）契约三条都得对上：POST + multipart 字段名恒为 `file`；响应必须是数组且 `raw_data[0]["image_info_array"]["url"]` 取得到；失败仍返回数组、第一项没有 image_info_array，核心那句 `in` 为假就走自己的失败分支（打日志、回退成字节），不抛。
 * 注意：别返回对象或裸字符串 —— 核心先 `resp.json()` 再无条件 `raw_data[0]`，返回 `{}` 会 KeyError、返回字符串会按下标取到一个字符，两种都在核心侧炸。
 */
async function bedUpload(body: Buffer | null, ct?: string): Promise<BedResult> {
  const boundary = boundaryOf(ct)
  if (!boundary) return bedFail("不是 multipart/form-data")

  const cap = Number(config.file_max_size) || 50 * 1024 * 1024
  // 注意：除数是 1048576（换成 1000 会与 #早柚设置算出不同字节数）
  if (!body) return bedFail(`请求体超过 ${(cap / 1048576).toFixed(0)} MB 或读取中断`, 413)

  const part = pickFilePart(body, boundary)
  if (!part?.buf.length) return bedFail("multipart 里没有名为 file 的段")

  // 注意：没扩展名的文件名不如不给 —— aiohttp 的 `data={"file": bytes}` 会把 filename 填成 `file`（核心正是这么发，实测收到 `name=file`），原样传下去图床存无扩展名对象、取回 Content-Type 多半 octet-stream，QQ 当不成图；丢掉让 ImageBed 用默认名（image.png），各家图床基本按 magic bytes 认类型（chatglm 走 fileTypeFromBuffer），比假扩展名可靠。
  const name = part.name && /\.[a-z0-9]{2,5}$/i.test(part.name) ? part.name : undefined

  // imageToUrl 由 ImageBed-Plugin 挂在全局 Bot 上；没装那个插件时退回本体的 fileToUrl（公网可达性由调用方的 public_host 决定）
  const B = globalThis.Bot as
    { imageToUrl?: (f: Buffer, o?: { name?: string }) => Promise<string> } | undefined

  try {
    const url = B?.imageToUrl
      ? String((await B.imageToUrl(part.buf, { name })) || "")
      : await serveFile(part.buf, name)

    if (!/^https?:\/\//.test(url)) return bedFail(`图床没有返回 http 链接：${url || "(空)"}`, 502)

    makeLog("info", `图床转接口：${name || "image"}（${part.buf.length} 字节）→ ${url}`, "GsCore")
    return { code: 200, payload: [{ image_info_array: { url } }] }
  } catch (err) {
    return bedFail(`上传失败 ${err instanceof Error ? err.message : String(err)}`, 502)
  }
}

/**
 * @description node:http 与 express 共用的处理入口
 * 注意：刻意自己读流而不用 express.raw() —— 本体的四个 body 中间件（urlencoded/json/raw/text）都不匹配 multipart/form-data，流到这里还没被消费；也就不必 import express，Miao 那条路照样能走。
 */
async function serveBed(req: http.IncomingMessage, res: http.ServerResponse) {
  const bad = bedAuth(req.socket?.remoteAddress, bedToken(req))
  const out = bad
    ? bedFail(bad, 403)
    : await bedUpload(
        await readBody(req, Number(config.file_max_size) || 50 * 1024 * 1024),
        req.headers["content-type"],
      )

  res
    .writeHead(out.code, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    .end(JSON.stringify(out.payload))
}

function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const path = String(req.url || "").split("?")[0]

  // 图床转接口先分流：它是 POST，下面那段把任何路径当文件 id 查会把它 404 掉
  if (path === BED_PATH || path === `${BED_PATH}/`) {
    if (req.method !== "POST") {
      res.writeHead(405).end("405")
      return
    }
    // 不 await：handle 是 http 的同步回调，响应由 serveBed 自己写完
    void serveBed(req, res)
    return
  }

  const id = path.replace(/^\/+/, "")
  const item = files.get(id)

  if (!item || item.expire < Date.now()) {
    res.writeHead(404).end("404")
    return
  }

  res.writeHead(200, {
    "Content-Type": item.type,
    "Content-Length": String(item.buf.length),
    // 外链是一次性临时地址，别让任何中间层缓存
    "Cache-Control": "no-store",
  })
  // HEAD 只要头部，不写 body
  if (req.method === "HEAD") res.end()
  else res.end(item.buf)

  // 取走即删：核心已拿到内容，留着只是扩大重放窗口；核心侧会重试的可把 once 关掉
  if (fsConf().once !== false) drop(id)
}

function drop(id: string) {
  const item = files.get(id)
  if (!item) return
  clearTimeout(item.timer)
  files.delete(id)
}

/**
 * @description 对外地址的 host：优先配置里的 public_host，没配就用已连上的 ws 的本地地址（那正是能路由到核心的那张网卡；硬写 127.0.0.1 在核心跑 Docker / 另一台机器时指向它自己）
 */
function publicHost() {
  const conf = String(fsConf().public_host || "").trim()
  if (conf) return conf

  // v4-mapped 地址（::ffff:192.168.1.5）剥掉前缀
  const v4 = localHint.replace(/^::ffff:/, "")
  if (v4 && v4 !== "::" && v4 !== "0.0.0.0" && !v4.startsWith("127.")) {
    // 裸 IPv6 做 URL host 要加方括号
    return v4.includes(":") ? `[${v4}]` : v4
  }
  return "127.0.0.1"
}

/**
 * @description ws 连接的本地地址，由客户端在连上时写入，用于推断外链 host
 * 放模块级而不透传参数：外链用哪个 host 是传输层的事，消息转换层不该为此改签名；多连接时后连上的覆盖前者（通常同网段），真要区分就配 public_host。
 */
let localHint = ""

/** @description 记录 ws 本地地址，用于推断外链 host */
export function setLocalHint(addr?: string) {
  const s = String(addr || "").trim()
  if (s) localHint = s
}

/**
 * @description 把内容挂上去，返回 http 外链
 * @param name 用于猜 Content-Type
 * @returns http 链接；服务起不来时返回空串
 */
export async function serveFile(buf: Buffer, name?: string): Promise<string> {
  const srv = await start()
  if (!srv) return ""

  const ttl = Number(config.link_expire) || 300000
  const id = `${randomBytes(16).toString("hex")}${name ? `/${encodeURIComponent(name)}` : ""}`

  const timer = setTimeout(() => files.delete(id), ttl)
  // 定时器不该拖着进程不退出
  timer.unref?.()

  files.set(id, {
    buf,
    name,
    type: guessType(name),
    expire: Date.now() + ttl,
    timer,
  })

  const port = (srv.address() as AddressInfo)?.port
  return `http://${publicHost()}:${port}/${id}`
}

/** @description 当前暂存文件数，供 #早柚状态 显示 */
export function pendingFiles() {
  return files.size
}

/**
 * @description 挂载图床转接口：优先挂到本体的 express 上，没有它才用自带的文件服务
 *
 * 优先 express：TRSS 本体已跑着 HTTP 服务（`Bot.express`，端口在 config/bot.yaml），复用那个端口 —— 核心侧 custom_url 是固定地址，不必为本插件单独定端口，也不受 file_server.port 是不是 0（随机）的影响。Miao 没有 `Bot.express`，回落到自带服务，此时才要求把 port 固定（随机端口与写死的 custom_url 天然矛盾）。
 * 注意：本体的 serverAuth 在 `cfg.server.auth` 没配时完全放行，所以本接口访问控制只能靠自己（见 bedAuth：本机免凭据、跨机必须带 token），别改成无条件放行。
 */
export async function initImagebed(): Promise<void> {
  if (!fileServerEnabled()) return

  const B = globalThis.Bot as
    | { express?: { post?: (p: string, h: typeof serveBed) => void; skip_auth?: string[] } }
    | undefined
  const app = B?.express

  if (typeof app?.post === "function") {
    // 加进 skip_auth：用户若配了 cfg.server.auth，核心那个 POST 不带那对头/查询参数会被 401 挡掉；本接口自己有 bedAuth（本机 / token），不靠本体那道
    if (Array.isArray(app.skip_auth) && !app.skip_auth.includes(BED_PATH))
      app.skip_auth.push(BED_PATH)
    app.post(BED_PATH, serveBed)

    const port =
      Number((globalThis as { cfg?: { server?: { port?: number } } }).cfg?.server?.port) || 2536
    makeLog(
      "mark",
      `图床转接口已挂载：POST http://127.0.0.1:${port}${BED_PATH}\n` +
        `  填进早柚核心 pic_upload_config：PicUploader=custom、custom_url=上面这个地址、custom_header={}\n` +
        `  同机免凭据；核心跨机时给 file_server.imagebed_token 配个口令，并在地址后加 ?token=<口令>`,
      "GsCore",
    )
    return
  }

  // 没有 Bot.express（Miao）：回落到自带文件服务，此时端口必须固定
  const port = Number(fsConf().port) || 0
  if (!port) {
    if (imagebedToken())
      makeLog(
        "warn",
        "配了 imagebed_token，但本框架没有 Bot.express 且 file_server.port 是 0（随机端口）。" +
          "核心的 custom_url 是死地址，随机端口每次重启都对不上 —— 先把 port 固定成一个具体端口。",
        "GsCore",
      )
    return
  }

  const srv = await start()
  if (!srv) return

  makeLog(
    "mark",
    `图床转接口已挂载：POST http://${publicHost()}:${port}${BED_PATH}\n` +
      `  填进早柚核心 pic_upload_config：PicUploader=custom、custom_url=上面这个地址、custom_header={}`,
    "GsCore",
  )
}
