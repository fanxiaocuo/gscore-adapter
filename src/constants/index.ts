/** 连接状态数值的可读名 */
export const STATUS_TEXT = {
  0: "未连接",
  1: "已连接",
  2: "连接中",
  3: "断线重连中",
}

/**
 * 聚合状态的取值顺序：已连接 > 连接中 > 断线待重连 > 未连接
 *
 * 一条逻辑连接的多个账号各有状态，对外只显示一个。原来只特判「已连接」、其余按
 * 第一条取，于是账号 A 重连耗尽停在 0、账号 B 正在握手（2）时会说整条连接
 * 「未连接」—— 而 B 其实正连着。
 *
 * 注意这不是 WebSocket 的 readyState，是本插件自己的状态码
 * （见 {@link STATUS_TEXT}：0 未连接 / 1 已连接 / 2 连接中 / 3 断线重连中），
 * 所以 [1,2,3,0] 这个顺序不能按 readyState 的语义去「修正」。
 */
export const STATUS_ORDER: (0 | 1 | 2 | 3)[] = [1, 2, 3, 0]

/**
 * 状态在 {@link STATUS_ORDER} 里的名次，数字越大越糟
 *
 * 与 {@link pickByStatus} 是同一张顺序表的两种问法：那个答「这条逻辑连接对外算
 * 什么状态」，这个答「几个账号之间谁更该被人看到」—— 状态图的账号级子行有条数
 * 上限，要挑掉哪几条就得有个可比的名次。两处共用一张表，否则会出现「代表状态说
 * 通了，而被折叠掉的偏偏是唯一没通的那个账号」。
 *
 * 表里没有的状态码排到最后（最糟）：出现了不认识的状态更该被看见，不该被折叠掉。
 */
export function statusRank(status: number): number {
  const at = STATUS_ORDER.indexOf(status as 0 | 1 | 2 | 3)
  return at === -1 ? STATUS_ORDER.length : at
}

/**
 * 按 {@link STATUS_ORDER} 挑出代表整条逻辑连接的那一项
 *
 * 放在 constants 而不是各模块自己写一遍：Web 面板（modules/webadapter）与状态图
 * （modules/render）都要回答「这条核心通不通」，规则各存一份就会漂 —— 面板说这条
 * 通了、状态图说没连上，而两处读的是同一批客户端。泛型是因为两边喂进来的东西不同
 * （面板是已序列化的运行时视图，状态图是 GsCoreClient 本身），共同点只有 status。
 *
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
 * 默认最大重连次数
 *
 * 原来是 0（无限重连）。指数退避封顶在 interval*12（默认 60s），所以核心真的
 * 下线时那条连接会每分钟敲一次门、日志一直刷，直到有人注意到。
 * 5 次配 5s 起步的退避约覆盖 5+10+20+40+60 ≈ 2.3 分钟——核心重启（哪怕带
 * 迁移）都够了，而真正的「地址写错了」不会拖着日志跑一整夜。
 * 停下后 #早柚重连 一句就能恢复，代价很小。
 *
 * 想要旧行为写 max_reconnect_attempts: 0，语义未变（<=0 为无限）。
 */
export const DEFAULT_MAX_RECONNECT = 5

/** 回环防护：记录本插件代发内容的有效期与容量上限 */
export const ECHO_TTL = 10000
export const ECHO_MAX = 500

/** log_{level} 段，仅出现在 MessageSend 方向 */
export const GS_LOG_RE = /^log_/i

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "mark"]

/**
 * 早柚核心 segment.py 的 MessageSegment.log 只发这四种（大写）：
 *   Literal["INFO", "WARNING", "ERROR", "SUCCESS"]
 * 其中 WARNING / SUCCESS 不是云崽 logger 的方法名，需要映射，
 * 否则会静默降级成 info、丢掉告警级别。
 */
export const LOG_ALIAS = { warning: "warn", success: "mark", critical: "fatal" }

/**
 * 本 fork 的 notice 事件形状与 OneBot 原生不同。
 * plugins/adapter/OneBotv11.js:1330-1333 把 notice_type 按 _ 拆成两段：
 *   group_increase -> notice_type="group", sub_type="increase"
 * ICQQ 原生即是这个形状，OneBotv11 的拆分正是为了对齐它。
 * 故匹配主键是 sub_type；写成 notice_type === "group_increase" 恒为 false。
 *
 * 标 `Record<string, string | undefined>` 而不是让它推成字面量对象：查表的键是
 * `e.sub_type`（任意字符串），而没命中就是「这个事件不映射」—— 那是正常分支，
 * notice/index.ts 靠 `if (!eventName) return null` 处理。
 */
export const SUB_TYPE_MAP: Record<string, string | undefined> = {
  increase: "user_join_group",
  decrease: "user_exit_group",
}

/** 早柚核心的会话类型 */
export const USER_TYPES = ["group", "direct", "channel", "sub_channel"]
