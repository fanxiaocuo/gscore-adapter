/**
 * 面板接口的数据形状（前后端共用）
 *
 * 为什么单独一份而不是各写一遍
 * -------------------------
 * `modules/webadapter/index.ts` 的 `payload()` 造这个对象，`webui/main.tsx` 读它，
 * 两边隔着一次 JSON 序列化 —— 编译器看不出关联，字段改了名只会在运行时表现为
 * 面板上一个 `undefined`。所以把契约写在这里，让两端都对着它检查：
 * 后端 `payload()` 的返回值标成 {@link Payload}，前端 state 也标成它。
 *
 * 放在 `webui/` 而不是 `types/` 是因为**浏览器侧只能 import 它**：
 * `tsconfig.webui.json` 的 `types` 只有 react，而 `@/types` 那个桶会连带
 * 拉进 `trss-yunzai` 与 node 的声明（`AdapterEvent.bot` 就是 `Client`），
 * 在浏览器那份配置下解析不了。这个文件刻意不 import 任何东西。
 *
 * 只描述**接口回什么**，不复用 `WsConnection`
 * ----------------------------------------
 * 面板拿到的连接视图与配置里的连接项是两种东西：`connView` 刻意逐字段挑，
 * token 换成 `has_token`，还额外带上运行时状态（status / retry / up / down）。
 * 复用 `WsConnection` 会让前端以为能读到 `token`。
 */

/**
 * 机器人档案
 *
 * 与 `utils/bots.ts` 的 BotProfile 同形。本文件刻意不 import（见文件头），
 * 形状靠 webadapter 里 `botProfile()` 的赋值点由编译器对齐。
 */
export interface BotProfile {
  /** 账号（self_id） */
  id: string
  /** 昵称，取不到时等于账号 */
  name: string
  /** 头像 URL，可能为空串（前端回退成首字圆） */
  avatar: string
  /** 是否在线 */
  online: boolean
  /** 上报用的平台标识 */
  platform?: string
}

/**
 * 一条逻辑连接派生出的账号级运行时连接，对应一个 GsCoreClient
 *
 * 配置里一条「核心地址 + 绑定账号」在运行时是 N 条 ws，各自有独立的状态与计数。
 * 没有这一层的话面板只能显示其中一条，另外几条连没连上看不出来。
 */
export interface RuntimeConnView {
  /** 自动端点为账号；自定义路径的兼容连接为 undefined */
  account?: string
  /** 运行时名称，形如 `早柚核心 [3889017463]`，也是计数与停起的键 */
  name: string
  /** 只到 pathname，绝不含 token 查询参数 */
  path: string
  status: 0 | 1 | 2 | 3
  status_text: string
  retry: number
  up: number
  down: number
}

/** 一条连接在面板上的视图，对应 `connView()` */
export interface ConnView {
  /** 在 client.connections 里的下标，改/删/开关都用它定位 */
  index: number
  name: string
  url: string
  enable: boolean
  /** 只说明配没配，不回原值 */
  has_token: boolean
  reconnect_interval: number
  max_reconnect_attempts: number
  bind: (string | number)[]
  exclude: (string | number)[]
  /**
   * 这条连接的绑定候选：在线的全部机器人 + 本连接已绑定的账号（含离线）
   *
   * 不是 `bind` 的一一对应视图 —— 面板要为每个候选画一个开关，只回已绑定的
   * 就没法在面板上绑一个新号；只回在线的又没法解绑一个已离线的号。
   * 开关的开合状态看 {@link bind}，这里只提供可选项与档案。
   */
  bind_bots: BotProfile[]
  /** 展开出的账号级运行时连接，逐条带自己的状态与计数 */
  runtime: RuntimeConnView[]
  /** 0 未连接 1 已连接 2 连接中 3 断线待重连；由 runtime 聚合：任一已连接即 1 */
  status: 0 | 1 | 2 | 3
  status_text: string
  retry: number
  /** 上行条数（含 meta 事件），runtime 各条之和 */
  up: number
  down: number
}

/** 全局设置区，字段与 FIELDS 表一一对应 */
export interface PayloadConfig {
  enable: boolean
  heartbeat: number
  heartbeat_timeout: number
  notify_master: boolean
  media_max_size: number
  filter: {
    report_private: boolean
    report_group: boolean
    report_meta: boolean
    only_reply_at: boolean
  }
}

/** 中转计数 */
export interface Counters {
  up: number
  down: number
  event: number
}

/** GET /config 回的整包，也是每个 POST 成功后的回包 */
export interface Payload {
  ok: true
  plugin: { name: string; version: string; configFile: string }
  config: PayloadConfig
  connections: ConnView[]
  /** 连接总览：逻辑配置数、运行时连接数、其中已连接数 */
  totals: { logical: number; runtime: number; connected: number }
  /** 当前在线的机器人，供「添加绑定」候选 */
  bots: BotProfile[]
  stats: {
    total: Counters
    today: Counters
    /**
     * 计数起始时间，epoch 毫秒
     *
     * 落盘可用时是库里最早那天的起点（`db.metaSince`），否则是本次进程启动的时刻。
     * 是数字不是格式化后的字符串 —— 前端要显示得自己 `new Date()`，
     * 这样时区按浏览器算而不是按云崽所在的机器
     */
    since: number
    /** 计数是否落盘（sqlite 起不来时只在内存里） */
    persisted: boolean
    /** 当前记着多少条 QQBot 被动回复会话 */
    passive: number
  }
  /** POST 回包带一句结果说明，GET 没有 */
  message?: string
}
