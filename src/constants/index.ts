/**
 * @description 连接状态数值的可读名
 * 显式标 Record 而不是让它推断：渲染两处拿 `0 | 1 | 2 | 3` 直接索引，标了之后「查表必有值」由类型保证，
 * 将来加了状态码 4 而漏配文案会在索引处编译报错。与 {@link statusRank} 的差别正在这里，那个收 `number`。
 */
export const STATUS_TEXT: Record<0 | 1 | 2 | 3, string> = {
  0: "未连接",
  1: "已连接",
  2: "连接中",
  3: "断线重连中",
}

/**
 * @description 聚合状态的取值顺序：已连接 > 连接中 > 断线待重连 > 未连接
 * 一条逻辑连接的多个账号各有状态，对外只显示一个（只特判「已连接」、其余取第一条会把正在握手的账号说成未连接）。
 * 注意：这不是 WebSocket 的 readyState 而是本插件自己的状态码（见 {@link STATUS_TEXT}），别按 readyState 的语义「修正」这个顺序
 */
export const STATUS_ORDER: (0 | 1 | 2 | 3)[] = [1, 2, 3, 0]

/**
 * @description 状态在 {@link STATUS_ORDER} 里的名次，数字越大越糟
 * 与 {@link pickByStatus} 共用同一张顺序表：那个答「这条逻辑连接对外算什么状态」，这个答「账号级子行超出条数上限时谁更该被看到」。
 * 注意：两处必须共用一张表，否则会出现「代表状态说通了，而被折叠掉的偏偏是唯一没通的账号」；表外的状态码排到最后（最糟），不认识的更该被看见
 */
export function statusRank(status: number): number {
  const at = STATUS_ORDER.indexOf(status as 0 | 1 | 2 | 3)
  return at === -1 ? STATUS_ORDER.length : at
}

/**
 * @description 按 {@link STATUS_ORDER} 挑出代表整条逻辑连接的那一项
 * 放在 constants 而不是各模块自己写一遍：Web 面板与状态图都要回答「这条核心通不通」，各存一份就会漂。
 * 泛型是因为两边喂进来的东西不同（面板是序列化后的运行时视图，状态图是 GsCoreClient），共同点只有 status。
 * 同名次内保持入参顺序（find 取首个），也就是展开顺序、亦即 bind 的书写顺序。
 */
export function pickByStatus<T extends { status: 0 | 1 | 2 | 3 }>(items: T[]): T | undefined {
  for (const status of STATUS_ORDER) {
    const hit = items.find(item => item.status === status)
    if (hit) return hit
  }
  return undefined
}

/**
 * @description 默认最大重连次数
 * 原来是 0（无限重连），而退避封顶在 interval*12（默认 60s），核心真下线时会每分钟敲一次门、日志一直刷。
 * 5 次配 5s 起步约覆盖 2.3 分钟，够核心重启，而「地址写错了」不会拖着日志跑一整夜；停下后 #早柚重连 即可恢复。
 * 想要旧行为写 max_reconnect_attempts: 0，语义未变（<=0 为无限）。
 */
export const DEFAULT_MAX_RECONNECT = 5

/**
 * @description media_max_size / file_max_size 的硬上限（字节），三个写入口共用
 * 这两项是「超过就改用 link:// 外链」的阈值，调爆等于关掉外链兜底、每个附件都在内存里 base64 一份。
 * 注意：256 MB 远高于任何真实 QQ 附件，它拦的是「把配置文件里读到的字节数原样敲进按 MB 收的中文指令」
 */
export const MEDIA_SIZE_MAX = 256 * 1024 * 1024

/** @description 回环防护：记录本插件代发内容的有效期与容量上限 */
export const ECHO_TTL = 10000
export const ECHO_MAX = 500

/** @description log_{level} 段，仅出现在 MessageSend 方向 */
export const GS_LOG_RE = /^log_/i

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "mark"]

/**
 * @description 早柚核心 segment.py 只发四种日志级别（大写）：INFO / WARNING / ERROR / SUCCESS
 * 注意：WARNING / SUCCESS 不是云崽 logger 的方法名，不映射会静默降级成 info、丢掉告警级别
 */
export const LOG_ALIAS = { warning: "warn", success: "mark", critical: "fatal" }

/**
 * @description notice 事件的 sub_type -> 早柚事件名映射
 * 注意：本 fork 把 notice_type 按 _ 拆成两段（OneBotv11.js:1330-1333，对齐 ICQQ 原生形状）：
 * group_increase -> notice_type="group" + sub_type="increase"，所以匹配主键是 sub_type，写 notice_type === "group_increase" 恒为 false
 * 标 `Record<string, string | undefined>` 而不是字面量对象：键是任意 `e.sub_type`，没命中是正常分支（notice/index.ts 靠 `if (!eventName) return null`）。
 */
export const SUB_TYPE_MAP: Record<string, string | undefined> = {
  increase: "user_join_group",
  decrease: "user_exit_group",
}

/** @description 早柚核心的会话类型 */
export const USER_TYPES = ["group", "direct", "channel", "sub_channel"]
