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
  /**
   * 只有状态名（`已连接` / `断线重连中` …），或 `已停用` / `未启动`
   *
   * 不含重连次数 —— 那在 {@link retry} 里，前端单独渲一个标签。别改回
   * `client.statusText`：那个 getter 为文字指令服务，把次数拼进了括号，用它就成了
   * 同一行里把同一个数写两遍（还曾经是两种措辞）。
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
   * 已脱敏的连接地址：查询串、fragment 与 userinfo 都被砍掉
   *
   * 凭据可能内联在 `?token=` 里（核心地址与自定义路径都可能），所以这一栏
   * 一定过 redactUrl，不是配置原值。要判配没配读 {@link has_token}。
   */
  url: string
  enable: boolean
  /** 只说明配没配，不回原值；内联在地址查询串里的也算配了 */
  has_token: boolean
  reconnect_interval: number
  max_reconnect_attempts: number
  /**
   * 用户写下的绑定意图，原样回（YAML 里写成数字就是数字）
   *
   * **不是开关状态** —— 一个号可以同时出现在这里和 {@link exclude} 里，那时它绑了
   * 却不会连。开关读 {@link accounts}，见那一项的说明。
   */
  bind: (string | number)[]
  exclude: (string | number)[]
  /**
   * 真正会派生出运行时连接的账号：bind 减掉 exclude 之后的那批
   *
   * **这就是开关的开合判据**（等价于 `id ∈ bind && id ∉ exclude`）。不看 {@link bind}：
   * 那样被 exclude 排除的号会显示成一个绿着却不转发的开关，同一行还挂着「已被排除，
   * 不会转发」，自相矛盾。灰着才是实话，而拨开它本来就会把这个号从 exclude 里放出来
   * （webadapter 的 bindConnection 的 freed 分支），一步自愈。
   *
   * {@link conflicts} 只做标记：那个号仍要显示在列表里，否则它会整条消失，
   * 用户会以为自己没绑过它。
   */
  accounts: string[]
  /**
   * bind 与 exclude 都写了的账号
   *
   * 手写配置或整份提交 bind 数组时可以造出这种组合（写入路径只拦「一个有效账号都
   * 没有」）。面板要把它与普通已绑定账号区分开显示 —— 它既在 bind 里，又不会连。
   */
  conflicts: string[]
  /**
   * 这条连接的绑定候选：在线的全部机器人 + 本连接已绑定的账号（含离线）
   *
   * 不是 `bind` 的一一对应视图 —— 面板要为每个候选画一个开关，只回已绑定的
   * 就没法在面板上绑一个新号；只回在线的又没法解绑一个已离线的号。
   * 开关的开合状态看 {@link accounts}，这里只提供可选项与档案。
   * 被 exclude 排除的账号仍在候选里：面板要留一个能把它放回来的入口，
   * 那一行另挂 {@link conflicts} 的标记说明它绑了但不会连。
   */
  bind_bots: BotProfile[]
  /**
   * 是不是「自动端点」：地址的 pathname 为空或根，运行时按账号逐条派生 ws
   *
   * 前端靠它分辨两种连接上「关掉最后一个开关」的后果：自动端点会被后端
   * requireAccounts 拒（零有效账号等于这条连接不存在），所以最后一个开关直接
   * 禁用并说明；非根路径的兼容连接只有一条 ws，bind 在它上头是转发过滤器，
   * 清空确实等于「不限账号」，那种连接才该弹确认。
   */
  automatic: boolean
  /** 展开出的账号级运行时连接，逐条带自己的状态与计数 */
  runtime: RuntimeConnView[]
  /**
   * 0 未连接 1 已连接 2 连接中 3 断线待重连
   *
   * 由 runtime 聚合，按 1 > 2 > 3 > 0 取：一个账号已连接就算这条核心通了，
   * 都没连上时正在握手的（2）优先于待重连（3）、待重连优先于停着的（0）。
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
   * 展开时跳过了什么、为什么
   *
   * 一条启用中的连接可能一条运行时连接都派生不出来：路由冲突、地址无法解析、
   * 账号编码失败、没有可用的绑定账号、以及共享 `/ws/Yunzai` 的警告。这些原因只在
   * 展开那一刻存在，面板上那条连接看起来只是一直停在「未启动」，所以整包带一份。
   *
   * 是整包级而不是逐条挂在 {@link ConnView} 上：话术里自带「连接 <名字>」与
   * 「来源 #<序号>」，读的人能对上是哪一条。服务端的 `ExpandError` 其实带着
   * `sourceIndex`（lifecycle 靠它只打属于自己那条的日志），这里只上话术 ——
   * 前端把错误统一列在顶部一个块里，真要改成逐卡显示再把下标带上来。
   *
   * 里头不含完整地址 —— 各条话术只用连接名、来源序号与 pathname
   * （modules/client/expand.ts 的 ExpandError 各处），连接名本身也不会退化成 url
   * （`sourceLabel` 没名字时用 `连接 #n`）。
   */
  errors: string[]
  /**
   * 报出来但连接照常跑的原因
   *
   * 与 {@link errors} 同源（服务端 `ExpandError`，按 `skipped` 分流），分开是因为
   * 前端要渲两个不同的框：`errors` 那个标题是「有连接没能启动」，而这里的两条
   * —— bind 与 exclude 撞了、以及还在用共享 `/ws/Yunzai` —— `fail` 之后都继续走到
   * `claim()`，连接是起来的。混在一起会让一条正在正常收发的连接绿着点、同时顶着
   * 一个红框说它没能启动，而且每次轮询复现一次。
   *
   * 别改成前端按话术分（真跳过的都以「已跳过」收尾）：那等于把措辞冻成契约。
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
