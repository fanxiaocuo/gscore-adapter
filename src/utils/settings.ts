/**
 * 中文设置项的表与解析
 *
 * 为什么从 apps/admin.ts 拆出来
 * ---------------------------
 * parseCN 是这轮新增里最容易出错的一段：它自己啃字符串（键按长度倒序匹配、
 * 开关词表有前缀关系、mb 要换算），而 admin.ts 整个模块 import 了 @/config 与
 * @/modules/client —— 那两个有副作用（配置文件监听、ws 连接），且 admin.ts 顶层
 * 就是 `class ... extends plugin`，没有云崽的那个全局连模块都求值不了。
 * 结果是这段逻辑在测试里根本碰不到。
 *
 * 拆到这里之后本模块**不 import 任何东西**，test/settings.test.mjs 直接引它。
 * 与 utils/platform.ts 同一个理由（见那边的文件头）。
 */

/**
 * 中文设置项 → 内部字段名
 *
 * `#早柚设置 media_max_size=10485760` 在手机上要敲二十多个字符，还得先知道
 * 1 MB = 1048576。中文写法是 `#早柚设置最大媒体大小 2`。
 *
 * kind 决定后面那个词怎么解析：bool 认开关词表，mb 收 MB 数再换算成字节
 * （配置文件里仍然存字节，字段语义没变，锅巴面板与 web 面板都不用动）。
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

/** 开关词：中文与英文都收，`开` 要排在最后，否则 `开启` 会先被它的前缀吃掉 */
export const ON_WORDS = ["开启", "启用", "打开", "true", "on", "开"]
export const OFF_WORDS = ["关闭", "停用", "禁用", "false", "off", "关"]

/** 内部字段名 → 中文名，用于结果图里的成功/失败行 */
export const CN_LABEL: Record<string, string> = Object.fromEntries(
  CN_KEYS.map(k => [k.key, k.cn]),
)

/** 可设项的中文名清单，用于用法提示与「未知项」的报错 */
export const CN_NAMES = CN_KEYS.map(k => k.cn).join(" / ")

/**
 * 一条成功行的文案
 *
 * 无论用户发的是中文还是英文写法，结果都用中文报 —— 那张图是给人看的，
 * `report_private = false` 要在脑子里翻两道弯（字段名 + 布尔值）。
 */
export function doneLine(key: string, on: boolean): string {
  return `${CN_LABEL[key] || key} = ${on ? "开启" : "关闭"}`
}

/**
 * 中文设置串 → 与 parseKV 同形的 key/value 表
 *
 * 只在 `parseKV` 一个都没解析出来时才试（见 admin.ts 的 set()）：`KV_RE` 那个正则
 * 要防「`ws://host` 里的 `ws:` 被当成 key」，往里塞中文键会扩大它的匹配面。
 *
 * 先把空白与逗号全删掉，`#早柚设置适配器开启` 与 `#早柚设置 适配器 开启` 就走同一条路。
 * 键按长度倒序匹配 —— 现有八个键之间没有前缀关系，但将来加词时（比如同时有
 * 「上报」与「私聊上报」）长的必须先试，否则短的会先命中、剩下的字变成值。
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
    // 换算放在这里而不是 set() 的 case 里：那个 case 还要服务英文写法
    // （media_max_size=10485760 收的是字节），两种单位混在一个分支里会出错
    out[hit.key] = String(Math.round(Number(m[1]) * 1024 * 1024))
  }

  return out
}
