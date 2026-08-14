/**
 * 插件配置类型声明
 *
 * 对应 resources/config/default_config.yaml
 */


/** WebSocket 连接配置 */
export interface WsConnection {
  /** 连接名，仅用于日志与 #早柚状态 */
  name?: string
  /** 早柚核心 WebSocket 地址，默认路由 /ws/Yunzai */
  url: string
  /** 鉴权 token，作为 ?token= 查询参数附加；留空则不发送 */
  token?: string
  /** 旧字段，升级时迁入 bot_id_map 后删除；上报不再读取 */
  bot_id?: string
  /** 是否启用本连接 */
  enable?: boolean
  /** 重连间隔（秒） */
  reconnect_interval?: number
  /** 最大重连次数，<=0 为无限重连。缺省按 DEFAULT_MAX_RECONNECT（5）算 */
  max_reconnect_attempts?: number
  /** 只转发这些 self_id 的消息，留空表示全部 */
  bind?: (string | number)[]
  /** 排除这些 self_id（优先级高于 bind） */
  exclude?: (string | number)[]
}

/** 消息过滤，仅影响 client 方向的上报 */
export interface FilterConfig {
  /**
   * 是否上报私聊消息。
   * 比黑白名单粗一档：想「只让群消息过核心」时不必把所有私聊用户列进黑名单。
   * 思路取自 xiowo/yunzai-gscore-adapter 的 reportPrivate。
   */
  report_private?: boolean
  /** 是否上报群消息（含频道） */
  report_group?: boolean
  /** 是否上报非消息事件（入群/退群/戳一戳等 meta event） */
  report_meta?: boolean
  /** 仅在被 @ 或带前缀时才上报群消息 */
  only_reply_at?: boolean
  /** only_reply_at 为 true 时，这些前缀也视为触发 */
  prefix?: string[]
  /** 命中即不上报（黑名单前缀） */
  block_prefix?: string[]
  /** 命中即不上报（包含任意一项就丢弃） */
  block_include?: string[]
  /** 只上报这些群，留空为全部 */
  white_group?: (string | number)[]
  /** 不上报这些群 */
  black_group?: (string | number)[]
  /** 不上报这些用户 */
  black_user?: (string | number)[]
}

/**
 * 内置文件服务配置
 *
 * 只在框架没有 Bot.fileToUrl 时才会用到（Miao-Yunzai）；
 * TRSS-Yunzai 有自带文件服务，这一节全部无效。
 */
export interface FileServerConfig {
  /** 是否启用，默认 true。关掉则回落到 upload_hook */
  enable?: boolean
  /** 监听端口，0 为随机可用端口 */
  port?: number
  /** 监听地址，默认 0.0.0.0（核心可能在 Docker / 另一台机器） */
  host?: string
  /** 外链中使用的 host，留空则按 ws 连接的本机地址推断 */
  public_host?: string
  /** 取走即删，默认 true。核心侧会重试时可设为 false */
  once?: boolean
}

/**
 * 定时更新检查
 *
 * 思路来自 karin-plugin-kkk 的 kkk-更新检测 定时任务，但判定方式不同：
 * kkk 是 npm 包，比的是 registry 上的 semver；本插件是 git 仓库安装，
 * 没有可比的发布版本号，所以比的是「本地 HEAD 落后跟踪分支几个提交」。
 */
export interface UpdateCheckConfig {
  /** 是否启用定时检查；关掉后手动指令仍可用 */
  enable?: boolean
  /** 检查间隔（分钟），低于 30 按 30 处理 */
  interval?: number
  /** 启动后首次检查的延迟（分钟） */
  delay?: number
  /** 发现新提交时是否私聊通知主人 */
  notify?: boolean
}

/** 插件配置文件结构（对应 config/default_config/config.yaml） */
export interface Config {
  /**
   * 是否启用适配器。false 则完全不连早柚核心
   *
   * 改完即时生效：index.ts 在 onConfigReload 里按这个值热起停连接。
   */
  enable?: boolean
  /** 早柚核心连接。只有 WebSocket 一种 */
  client?: {
    /** ws ping 间隔（秒），0 关闭 */
    heartbeat?: number
    /** 超过多少秒没收到 pong 判定掉线，0 关闭 */
    heartbeat_timeout?: number
    /** 是否启用 WebSocket 连接 */
    enable_ws?: boolean
    /** WebSocket 连接列表 */
    connections?: WsConnection[]
    /** 3.2 短暂使用过的键名，启动时自动迁回 connections，仅用于迁移提示 */
    ws_connections?: unknown
  }
  filter?: FilterConfig
  /**
   * 适配器 id / name / self_id -> 早柚核心 bot_id 的映射，含 default 兜底。
   * 特殊键 QQGuild 用于 QQ 频道（与 QQ 群共用 adapter.id，只能按事件形状分）。
   */
  bot_id_map?: Record<string, string>
  /** 媒体转 base64 的大小上限（字节），超限改用 link:// 外链 */
  media_max_size?: number
  /** file 段内联上限（字节），超限拒绝发送 */
  file_max_size?: number
  /** link:// 外链有效期（毫秒），同时也是内置文件服务的暂存时长 */
  link_expire?: number
  /** 内置文件服务，仅在框架没有 Bot.fileToUrl 时启用 */
  file_server?: FileServerConfig
  /**
   * 自定义图床模块路径（可选）。默认导出 `(buf, name) => Promise<string>`。
   * 内置文件服务被关掉或起不来时的后备。
   */
  upload_hook?: string
  /** 日志中截断 base64 */
  log_truncate?: boolean
  /** 断线/重连是否通知主人 */
  notify_master?: boolean
  /** 定时更新检查 */
  update_check?: UpdateCheckConfig
}
