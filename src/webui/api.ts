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

/** 一条连接在面板上的视图，对应 `connView()` */
export interface ConnView {
  /** 在 ws_connections 里的下标，改/删/开关都用它定位 */
  index: number
  name: string
  url: string
  bot_id: string
  enable: boolean
  /** 只说明配没配，不回原值 */
  has_token: boolean
  reconnect_interval: number
  max_reconnect_attempts: number
  bind: (string | number)[]
  exclude: (string | number)[]
  /** 0 未连接 1 已连接 2 连接中 3 断线待重连 */
  status: 0 | 1 | 2 | 3
  status_text: string
  retry: number
  /** 上行条数（含 meta 事件） */
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
