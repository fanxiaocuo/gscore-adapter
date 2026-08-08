/**
 * 插件配置类型声明
 *
 * 对应 resources/config/default_config.yaml
 */


/** 单条客户端连接配置 */
export interface ClientConnection {
  /** 连接名，仅用于日志与 #早柚状态 */
  name?: string
  /** 早柚核心地址，路由为 /ws/{bot_id}，bot_id 为本机器人平台名 */
  url: string
  /** 鉴权 token，作为 ?token= 查询参数附加；留空则不发送 */
  token?: string
  /** 上报时填入 MessageReceive.bot_id；留空则按 bot_id_map 推断 */
  bot_id?: string
  /** 是否启用本连接 */
  enable?: boolean
  /** 重连间隔（秒） */
  reconnect_interval?: number
  /** 最大重连次数，<=0 为无限重连 */
  max_reconnect_attempts?: number
  /** 只转发这些 self_id 的消息，留空表示全部 */
  bind?: (string | number)[]
  /** 排除这些 self_id（优先级高于 bind） */
  exclude?: (string | number)[]
}

/**
 * 插件运行模式
 *
 * "server" / "both" 已移除（早柚核心不会主动连云崽），
 * 但保留在类型里：老配置仍可能写着它们，src/index.ts 会按 client 兼容并提示。
 */
export type Mode = "off" | "client" | "server" | "both"

/** 消息过滤，仅影响 client 方向的上报 */
export interface FilterConfig {
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

/** 插件配置文件结构（对应 config/default_config/config.yaml） */
export interface Config {
  mode?: Mode
  client?: {
    /** ws ping 间隔（秒），0 关闭 */
    heartbeat?: number
    /** 超过多少秒没收到 pong 判定掉线，0 关闭 */
    heartbeat_timeout?: number
    connections?: ClientConnection[]
  }
  filter?: FilterConfig
  /** 适配器 id 或 self_id -> 早柚核心 bot_id 的映射，含 default 兜底 */
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
}
