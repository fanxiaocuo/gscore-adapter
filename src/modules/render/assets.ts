/**
 * @description 图片资源 -> data URI，让页面完全自包含
 * 不写 <img src="file://...">：本体把 HTML 写到 temp/html/{name}/ 下再让 puppeteer 打开，相对路径的基准是
 * 那个临时目录，绝对 file:// 又要处理 Windows 盘符与中文路径的转义。与 styles/ 内联 CSS 同一个理由。
 * 注意：MIME 按魔数嗅探而不是按扩展名 —— 母版 frame-logo.png 实际是 JPEG（开头 ff d8），写死 image/png
 * 虽然 Chromium 仍能靠嗅探显示，但声明与内容不一致是埋着的坑。
 */
import fs from "node:fs"
import { join } from "node:path"
import { ResPath } from "@/dir"
import { makeLog } from "@/utils/compat"

/** @description 按魔数判 MIME，认不出返回空串 */
function sniff(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return "image/png"
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF") return "image/webp"
  if (buf.length >= 6 && buf.subarray(0, 3).toString("latin1") === "GIF") return "image/gif"
  return ""
}

/** @description 已读过的资源。图片在进程生命周期里不会变，读一次就够 */
const cache = new Map<string, string>()

/**
 * @description 读 resources/template/image/<name> 并转成 data URI
 * @returns data URI；文件不存在或格式认不出返回空串（调用方据此不渲染 <img>）
 */
export function imageDataUri(name: string): string {
  const hit = cache.get(name)
  if (hit !== undefined) return hit

  let uri = ""
  try {
    const buf = fs.readFileSync(join(ResPath, "template", "image", name))
    const mime = sniff(buf)
    if (mime) uri = `data:${mime};base64,${buf.toString("base64")}`
    else makeLog("warn", `资源 ${name} 不是可识别的图片格式，已跳过`, "GsCore")
  } catch {
    // 资源缺失不该让整张图渲染失败，静默降级成不显示
  }

  cache.set(name, uri)
  return uri
}

/**
 * @description 插件图标（早柚），用于 #早柚版本 的主视觉与页脚角标
 * 512×512 的 WebP，40KB。原先是 1024² 的 PNG（base64 后 1.03MB），而每个页面都内联一份，整页 HTML
 * 96% 是这张图。512 够用且有余量：最大的用法是关于页主视觉 200px。
 * 用 WebP 而不是只缩尺寸：这是带柔边渐变的插画，PNG 存它很不划算（512px PNG 191KB，WebP q90 只要 40KB）。
 * 要再生成的话：sharp(logo.png).resize(512,512).webp({quality:90})；母版 1024² PNG 留在库里不再引用。
 */
export const PLUGIN_LOGO = "logo.webp"

/**
 * @description 框架图标，用于页脚角标
 * 同上转成 256×256 WebP（11KB），页脚只画 80px，256 是两倍余量。
 * 注意：源文件 frame-logo.png 的扩展名是错的，内容其实是 JPEG（开头 ff d8）—— sniff() 按魔数判 MIME
 * 就是为了这个，母版留着不动。
 */
export const FRAME_LOGO = "frame-logo.webp"
