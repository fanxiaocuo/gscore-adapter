/**
 * @description 发送侧的 bot 与会话对象：只标本插件实际会调的方法，其余字段透传
 * 不用 @types/trss-yunzai 的 Client / Group / Friend：`getBot(self_id)` 拿到的可能是单实例、也可能是全局 Bot 兜底
 * （前者 adapter 是 Adapter、后者是 Adapter[]），而 pick 出来的会话对象各适配器形状各异（ICQQ 给 Group / Friend、
 * QQBot-Plugin 给自造的字面量对象），交集就是下面这几个方法；这条路径只把它交给 isQQBot / passiveSender 按能力探测。
 * 注意：方法参数一律 `(...args: any[])` —— 参数位置是逆变的，标窄了各适配器的真实签名就赋不进来（同一个 sendMsg 在 ICQQ / QQBot / OneBot 上是三种签名）
 */

/** @description 已 pick 出的会话（群 / 好友 / 频道），只列本插件会调的方法 */
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
   * QQBot-Plugin 被动发送要从会话对象上读的上下文字段（passiveReady 逐条查这几项）
   * 注意：显式列出而不是全靠下面那条索引签名 —— 靠索引签名时它们的类型是 any，字段名或判据写错都不报错，代价是频道的被动回复被静默降级成普通发送
   */
  self_id?: string | number
  /** 该会话所属的 Bot 实例。这里只判它在不在，不调它，所以不给具体形状 */
  bot?: unknown
  user_id?: string | number
  group_id?: string | number
  channel_id?: string | number
  [k: string]: any
}

/** @description 下行发送用到的账号实例（TRSS 精确注册表；Miao 仅同 uin 返回根 Bot） */
export interface SendBot {
  /** Client 上是 Adapter，全局 Bot 上是 Adapter[]，只交给能力探测用 */
  adapter?: any
  pickFriend?: (...args: any[]) => any
  pickGroup?: (...args: any[]) => any
  /** bot 级撤回，会话对象上没有 recallMsg 时退化到这里 */
  recallMsg?: (...args: any[]) => any
  [k: string]: any
}
