/**
 * @description 发送侧的 bot 与会话对象：只标本插件实际会调的方法，其余字段透传
 * 不用 @types/trss-yunzai 的 Client / Group / Friend：`getBot(self_id)` 拿到的可能是单实例、也可能是全局 Bot 兜底
 * （前者 adapter 是 Adapter、后者是 Adapter[]），而 pick 出来的会话对象各适配器形状各异（ICQQ 给 Group / Friend、
 * QQBot-Plugin 给自造的字面量对象），交集就是下面这几个方法；这条路径只把它交给 isQQBot / passiveSender 按能力探测。
 * 注意：方法参数一律 `(...args: any[])` —— 参数位置是逆变的，标窄了各适配器的真实签名就赋不进来（同一个 sendMsg 在 ICQQ / QQBot / OneBot 上是三种签名）
 */
export {};
