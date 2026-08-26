/**
 * @description 中文设置项的表与解析，从 apps/admin.ts 拆出来只为可测
 * 注意：本模块不 import 任何东西（同 utils/platform.ts 的理由）—— admin.ts 顶层 import 了
 * @/config 与 @/modules/client（有副作用），且 `class ... extends plugin` 没有云崽全局连模块都求值不了，
 * parseCN 这段最容易出错的字符串解析在测试里根本碰不到。
 */

/**
 * @description 中文设置项 → 内部字段名，让 `#早柚设置最大媒体大小 2` 代替 `media_max_size=2097152`
 * kind 决定后面那个词怎么解析：bool 认开关词表，mb 收 MB 数再换算成字节
 * （配置文件里仍存字节，字段语义没变，锅巴与 web 面板都不用动）。
 */
export const CN_KEYS: { cn: string; key: string; kind: "bool" | "mb" }[] = [
  { cn: "适配器", key: "enable", kind: "bool" },
  { cn: "仅响应at", key: "only_reply_at", kind: "bool" },
  { cn: "私聊上报", key: "report_private", kind: "bool" },
  { cn: "群聊上报", key: "report_group", kind: "bool" },
  { cn: "事件上报", key: "report_meta", kind: "bool" },
  { cn: "断线通知", key: "notify_master", kind: "bool" },
  { cn: "更新检查", key: "update_check", kind: "bool" },
  { cn: "最大媒体大小", key: "media_max_size", kind: "mb" },
]

/** @description 开关词，中英都收。注意：`开` 要排在最后，否则 `开启` 会先被它的前缀吃掉 */
export const ON_WORDS = ["开启", "启用", "打开", "true", "on", "开"]
export const OFF_WORDS = ["关闭", "停用", "禁用", "false", "off", "关"]

/** @description 内部字段名 → 中文名，用于结果图里的成功/失败行 */
export const CN_LABEL: Record<string, string> = Object.fromEntries(CN_KEYS.map(k => [k.key, k.cn]))

/** @description 可设项的中文名清单，用于用法提示与「未知项」的报错 */
export const CN_NAMES = CN_KEYS.map(k => k.cn).join(" / ")

/**
 * @description 一条成功行的文案，无论用户发中文还是英文写法都用中文报
 * 那张图是给人看的，`report_private = false` 要在脑子里翻两道弯（字段名 + 布尔值）。
 */
export function doneLine(key: string, on: boolean): string {
  return `${CN_LABEL[key] || key} = ${on ? "开启" : "关闭"}`
}

/**
 * @description 中文设置串 → 与 parseKV 同形的 key/value 表
 *
 * 先删掉空白与逗号，`#早柚设置适配器开启` 与 `#早柚设置 适配器 开启` 就走同一条路。
 * 注意：只在 `parseKV` 一个都没解析出来时才试（见 admin.ts 的 set()）—— `KV_RE` 要防
 * 「`ws://host` 里的 `ws:` 被当成 key」，往里塞中文键会扩大它的匹配面。
 * 注意：键按长度倒序匹配 —— 现有八个键没有前缀关系，但将来加词时长的必须先试，
 * 否则短的先命中、剩下的字会变成值。
 *
 * @returns 解析到的项；一个都没有时返回空对象
 */
export function parseCN(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let rest = text.replace(/[\s，,、]/g, "")
  const keys = [...CN_KEYS].sort((a, b) => b.cn.length - a.cn.length)

  // 允许一条指令里连写多项（#早柚设置私聊上报关闭群聊上报开启），所以循环啃
  let guard = 0
  while (rest && guard++ < CN_KEYS.length) {
    const hit = keys.find(k => rest.startsWith(k.cn))
    if (!hit) break
    rest = rest.slice(hit.cn.length)

    if (hit.kind === "bool") {
      const on = ON_WORDS.find(w => rest.toLowerCase().startsWith(w))
      const off = on ? null : OFF_WORDS.find(w => rest.toLowerCase().startsWith(w))
      if (!on && !off) break
      rest = rest.slice((on || off)!.length)
      out[hit.key] = on ? "true" : "false"
      continue
    }

    // mb：收一个数字（允许小数，`0.5` → 524288）
    const m = rest.match(/^(\d+(?:\.\d+)?)/)
    if (!m) break
    rest = rest.slice(m[1].length)
    // 注意：换算放这里而不是 set() 的 case 里 —— 那个 case 还要服务英文写法（收的是字节），
    // 两种单位混在一个分支里会出错
    out[hit.key] = String(Math.round(Number(m[1]) * 1024 * 1024))
  }

  return out
}
