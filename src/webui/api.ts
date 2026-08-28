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
   * @description 用户写下的绑定意图，读什么回什么（手改 yaml 写成数字的就是数字）
   * 注意：类型留着 number 是因为**读**这一侧不归一化 —— 但凡经指令或面板改过一次，落盘的就都是字符串了
   * （plan 那边统一走 readIds），所以别指望数字类型能保持
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

/**
 * @description 全局设置区，字段与 `webui/fields.ts` 的字段表一一对应
 *
 * 分层照 yaml 原样（client / filter / update_check / file_server 各一层），不摊平：字段表里的 key
 * 写成 `filter.report_private` 这种点号路径，前端 `dig()` 按它取值。
 *
 * 注意：三栏的**单位不是落盘单位** —— 换算在服务端做（`config/units.ts`），面板收 MB 与秒，
 * yaml 里仍是字节与毫秒。前端一个换算都不做，否则 `MEDIA_SIZE_MAX` 那道校验与显示会各持一种口径
 * 注意：回的是**效力值**而不是 yaml 原值 —— `media_max_size` 等项写 0 时下游按「没配」跑默认值
 *（utils/media.ts 的 `|| 默认`），原样回 0 会让面板与实际生效值一致地对不上
 */
export interface PayloadConfig {
  enable: boolean
  /** 媒体内联上限，**单位 MB**（落盘字节） */
  media_max_size: number
  /** file 段内联上限，**单位 MB**（落盘字节） */
  file_max_size: number
  /** 外链有效期，**单位秒**（落盘毫秒） */
  link_expire: number
  log_truncate: boolean
  notify_master: boolean
  /** 自定义图床模块路径，空串为没配。不是凭据，原样回 */
  upload_hook: string
  client: {
    heartbeat: number
    heartbeat_timeout: number
    /**
     * @description ws 这条通路的开关，与顶层 {@link PayloadConfig.enable} 不同
     * enable 关掉连都不连；这一项只关 ws。改了必须 reloadClients，否则等于没生效
     */
    enable_ws: boolean
  }
  filter: {
    report_private: boolean
    report_group: boolean
    report_meta: boolean
    only_reply_at: boolean
    prefix: string[]
    block_prefix: string[]
    block_include: string[]
    /** 群号原样回（yaml 里写成数字就是数字），前端只显示与增删，不改类型 */
    white_group: (string | number)[]
    black_group: (string | number)[]
    black_user: (string | number)[]
  }
  update_check: {
    enable: boolean
    /** 分钟。低于 30 会被下游按 30 处理，面板照原值显示 */
    interval: number
    delay: number
    notify: boolean
  }
  /**
   * @description 内置文件服务。仅 Miao-Yunzai 生效（TRSS 自带文件服务），面板要说清这件事
   * 注意：`imagebed_token` 不在这里 —— 凭据不回前端，只回 {@link has_imagebed_token}
   */
  file_server: {
    enable: boolean
    /** 0 为每次随机取可用端口 */
    port: number
    host: string
    public_host: string
    once: boolean
    /** 只说明配没配，不回原值（同连接的 `has_token`） */
    has_imagebed_token: boolean
  }
}

/**
 * @description 群 / 好友选择器的候选，`GET /targets?kind=group|friend` 回这个
 * 不进 {@link Payload} 整包：整包每 10 秒轮询一次，几千个群跟着来回传毫无必要，所以开弹层时才拉
 */
export interface TargetsPayload {
  ok: true
  kind: "group" | "friend"
  /**
   * @description 候选条目。`avatar` 可能是空串 —— 前端回退成首字圆
   * 注意：QQBot 的群**没有**头像（官方 API 不提供），那一档恒为空串，别当成 bug 去「补上」
   */
  items: { id: string; name: string; avatar: string }[]
  /**
   * @description 列表取不到时的说明，正常时为空串
   * 注意：取不到必须说出来而不是回空数组了事 —— 账号离线时列表是空的，用户以为「本来就没有」
   * 一按保存就把存着的名单抹平（锅巴那边 `friendIds()` 返回 null 就是为这件事）
   */
  note: string
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
