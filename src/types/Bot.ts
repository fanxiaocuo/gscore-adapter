/**
 * 发送侧的 bot 与会话对象
 *
 * 为什么不直接用 @types/trss-yunzai 的 Client / Group / Friend
 * ---------------------------------------------------------
 * 下行发送这条路径拿到的 bot 是 `getBot(self_id)`（TRSS 即底层注册表的该账号），
 * Miao 仅在 self_id 与根 Bot.uin 相等时返回全局 Bot；错号同样空着。
 *
 *   Client（单个 bot 实例）   adapter 是 Adapter
 *   Yunzai（全局 Bot 兜底）   adapter 是 Adapter[]
 *
 * 用两者的联合去标，读 `bot.adapter` 就得先分辨是哪一种；而这条路径只把它交给
 * isQQBot / passiveSender 去**按能力探测**，分辨出来也没有用处。
 *
 * pick 出来的会话对象更没法用具体类型：ICQQ 给的是 Group / Friend，
 * QQBot-Plugin 给的是自己造的字面量对象（index.js:1051/1103，只有 sendMsg
 * 等几个键），Milky、OneBot 系各有一套。它们的交集就是下面列的这几个方法。
 *
 * 所以这里标「本插件实际会调的方法 + 其余透传」：调用点能查到方法名，
 * 各适配器多出来的字段照旧能读。
 *
 * 为什么方法参数一律 `(...args: any[])`
 * -----------------------------------
 * 参数位置是**逆变**的：标窄了各适配器的真实签名就赋不进来。同一个 sendMsg
 * 在 ICQQ 上是 `(msg, source?)`、在 QQBot-Plugin 上是 `(msg)`、在 OneBot 系上是
 * `(msg, quote, data)`，任何一个具体签名都会把另外两个挡在外面。
 * 这里要的只是「有这个方法可以调」，参数交给调用点自己负责
 * —— 同 AdapterEvent 里 getAvatarUrl 那条注释是同一类问题的两个方向。
 */

/** 已 pick 出的会话（群 / 好友 / 频道），只列本插件会调的方法 */
export interface SendTarget {
  /** 发消息。第二、三参数各适配器语义不同，本插件只用第一个 */
  sendMsg?: (...args: any[]) => any
  /** 撤回。ICQQ 在 Group/Friend 上有，部分适配器只在 bot 级有 */
  recallMsg?: (...args: any[]) => any
  /** 制作转发。Miao 上必须靠它才能真正上传，见 compat.makeForwardMsg */
  makeForwardMsg?: (...args: any[]) => any
  /** 禁言，仅群对象有 */
  muteMember?: (...args: any[]) => any
  /*
   * QQBot-Plugin 被动发送要从会话对象上读的上下文字段
   * ----
   * 显式列出来而不是全靠下面那条索引签名：passiveReady 逐条查这几项，而靠索引签名
   * 时它们的类型是 any —— 字段名写错、判据写错都不报错，代价是频道的被动回复被静默
   * 降级成普通发送（见 GsCoreClient 的 passiveReady 注释）。索引签名仍然留着：
   * 各适配器 pick 出来的对象字段远不止这些，本插件也不该去穷举。
   */
  self_id?: string | number
  /** 该会话所属的 Bot 实例。这里只判它在不在，不调它，所以不给具体形状 */
  bot?: unknown
  user_id?: string | number
  group_id?: string | number
  channel_id?: string | number
  [k: string]: any
}

/** 下行发送用到的账号实例（TRSS 精确注册表；Miao 仅同 uin 返回根 Bot） */
export interface SendBot {
  /** Client 上是 Adapter，全局 Bot 上是 Adapter[]，只交给能力探测用 */
  adapter?: any
  pickFriend?: (...args: any[]) => any
  pickGroup?: (...args: any[]) => any
  /** bot 级撤回，会话对象上没有 recallMsg 时退化到这里 */
  recallMsg?: (...args: any[]) => any
  [k: string]: any
}
