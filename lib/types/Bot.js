/**
 * 发送侧的 bot 与会话对象
 *
 * 为什么不直接用 @types/trss-yunzai 的 Client / Group / Friend
 * ---------------------------------------------------------
 * 下行发送这条路径拿到的 bot 是 `Bot.bots[self_id] || Bot`，两种形状并存：
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
export {};
