/**
 * @description 面板接口的数据形状，前后端共用的契约（`payload()` 造它，`webui/main.tsx` 读它）
 *
 * 两端隔着一次 JSON 序列化，编译器看不出关联，所以两边都标成这里的类型，字段改了名才会在
 * 编译期报，而不是运行时表现为面板上一个 undefined。
 * 注意：这份文件放在 webui/ 且刻意不 import 任何东西 —— 浏览器侧只能 import 它，
 * tsconfig.webui.json 的 types 只有 react，@/types 那个桶会连带拉进 trss-yunzai 与 node 的声明
 * 注意：不复用 WsConnection —— 面板视图逐字段挑过、token 换成 has_token，复用会让前端以为能读到 token
 */

/**
 * @description 机器人档案，与 `utils/bots.ts` 的 BotProfile 同形
 * 本文件刻意不 import（见文件头），形状靠 webadapter 里 `botProfile()` 的赋值点由编译器对齐
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
 * @description 一条逻辑连接派生出的账号级运行时连接，对应一个 GsCoreClient
 * 一条「核心地址 + 绑定账号」在运行时是 N 条 ws，各有独立状态与计数；没有这一层面板只能显示其中一条
 */
export interface RuntimeConnView {
  /** 自动端点为账号；自定义路径的兼容连接为 undefined */
  account?: string
  /** 运行时名称，形如 `早柚核心 [3889017463]`，也是计数与停起的键 */
  name: string
  /** 只到 pathname，绝不含 token 查询参数 */
  path: string
  status: 0 | 1 | 2 | 3
  /**
   * @description 只有状态名（`已连接` / `断线重连中` …），或 `已停用` / `未启动`
   * 注意：不含重连次数（那在 {@link retry} 里，前端单独渲一个标签），别改回 client.statusText ——
   * 那个 getter 为文字指令服务，把次数拼进了括号
   */
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
  /**
   * @description 已脱敏的连接地址：查询串、fragment 与 userinfo 都被砍掉，不是配置原值
   * 注意：凭据可能内联在 `?token=` 里，所以这一栏一定过 redactUrl；要判配没配读 {@link has_token}
   */
  url: string
  enable: boolean
  /** 只说明配没配，不回原值；内联在地址查询串里的也算配了 */
  has_token: boolean
  reconnect_interval: number
  max_reconnect_attempts: number
  /**
   * @description 用户写下的绑定意图，原样回（YAML 里写成数字就是数字）
   * 注意：不是开关状态 —— 一个号可以同时在这里与 {@link exclude} 里，那时它绑了却不会连；
   * 开关读 {@link accounts}
   */
  bind: (string | number)[]
  exclude: (string | number)[]
  /**
   * @description 真正会派生出运行时连接的账号（bind 减掉 exclude），也是开关的开合判据
   * 注意：开关别看 {@link bind} —— 被 exclude 排除的号会显示成绿着却不转发的开关；拨开它会把
   * 这个号从 exclude 里放出来（bindConnection 的 freed 分支），一步自愈。{@link conflicts} 只做标记
   */
  accounts: string[]
  /**
   * @description bind 与 exclude 都写了的账号，面板要与普通已绑定账号区分开显示
   * 手写配置或整份提交 bind 数组都能造出这种组合（写入路径只拦「一个有效账号都没有」）
   */
  conflicts: string[]
  /**
   * @description 这条连接的绑定候选：在线的全部机器人 + 本连接已绑定的账号（含离线）
   * 不是 {@link bind} 的一一对应视图（只回已绑定的就没法绑新号，只回在线的又没法解绑离线号），
   * 开合状态看 {@link accounts}。
   * 注意：被 exclude 排除的账号仍在候选里 —— 面板要留一个能把它放回来的入口
   */
  bind_bots: BotProfile[]
  /**
   * @description 是不是「自动端点」：地址的 pathname 为空或根，运行时按账号逐条派生 ws
   * 前端靠它分辨「关掉最后一个开关」的后果：自动端点会被后端 requireAccounts 拒，所以那个开关
   * 直接禁用；兼容连接只有一条 ws、bind 是转发过滤器，清空等于「不限账号」，那种才弹确认
   */
  automatic: boolean
  /** 展开出的账号级运行时连接，逐条带自己的状态与计数 */
  runtime: RuntimeConnView[]
  /**
   * @description 0 未连接 1 已连接 2 连接中 3 断线待重连，由 runtime 按 1 > 2 > 3 > 0 聚合
   * 一个账号已连接就算这条核心通了
   */
  status: 0 | 1 | 2 | 3
  /** 代表账号的状态名，或 `已停用` / `未启动`。同样不含次数，见 {@link RuntimeConnView.status_text} */
  status_text: string
  /** 各账号里最大的重连次数（最坏值）。逐账号的准确值在 {@link runtime} 里 */
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
  /**
   * @description 展开时跳过了什么、为什么（路由冲突、地址无法解析、没有可用的绑定账号……）
   * 这些原因只在展开那一刻存在，面板上那条连接看起来只是停在「未启动」，所以整包带一份。
   * 是整包级而不是逐条挂在 {@link ConnView} 上：话术自带「连接 <名字>」与「来源 #<序号>」。
   * 注意：里头不含完整地址 —— 各条话术只用连接名、来源序号与 pathname
   */
  errors: string[]
  /**
   * @description 报出来但连接照常跑的原因，与 {@link errors} 同源（服务端 ExpandError 按 skipped 分流）
   * 注意：必须与 errors 分成两个数组 —— 前端两个框的标题不同，混在一起会让一条正在正常收发的
   * 连接顶着「有连接没能启动」的红框，还每次轮询复现一次
   * 注意：别改成前端按话术分，那等于把措辞冻成契约
   */
  warnings: string[]
  /** 连接总览：逻辑配置数、运行时连接数、其中已连接数 */
  totals: { logical: number; runtime: number; connected: number }
  /** 当前在线的机器人，供「添加绑定」候选 */
  bots: BotProfile[]
  stats: {
    total: Counters
    today: Counters
    /**
     * @description 计数起始时间，epoch 毫秒：落盘可用时是库里最早那天的起点，否则是本次进程启动的时刻
     * 注意：是数字不是格式化好的字符串 —— 前端自己 new Date()，时区才按浏览器算而不是按云崽那台机器
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
