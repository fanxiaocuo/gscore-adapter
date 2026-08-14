# 多 Bot 账号精确解析设计

## 背景

TRSS-Yunzai 的全局 `Bot` 是以 `this.bots` 为目标对象的 Proxy。账号适配器会把每个在线账号注册到 `Bot.bots[self_id]`；NapCat 对应的 OneBotv11 适配器也会在连接时创建 `Bot[data.self_id]`，并将事件的 `data.bot` 指向同一实例。

正常账号键上，`Bot[self_id]` 与 `Bot.bots[self_id]` 通常得到同一对象。但全局 Proxy 还承担框架工具方法与兼容重定向：访问不存在的属性时，可能从在线 Bot 实例上寻找同名属性。全局 `Bot.pickFriend`、`Bot.pickGroup` 等方法还会在目标不存在时选择其他账号。因此，下行发送若退回全局 `Bot`，可能由错误账号发送。

Yenai Plugin 的账号模型是：事件场景以 `e.self_id` 为账号，汇总场景遍历 `Bot.uin`，随后逐个按账号取得 Bot 实例。gscore-adapter 应保持同样的账号隔离语义，同时使用 TRSS 的底层注册表消除 Proxy 重定向边界。

## 目标

1. TRSS 下行消息、撤回和禁言只使用核心给出的 `bot_self_id` 对应账号。
2. 未知、空白或离线账号绝不由其他在线 Bot 代替。
3. 上行事件始终把事件所属账号作为 `bot_self_id` 发给核心。
4. 保持 Miao-Yunzai 单账号兼容，但只允许目标账号与全局 Bot 的 `uin` 相等时使用全局实例。
5. 账号解析失败时仍完成核心要求的 recall 回执，避免超时和能力误判。
6. 用回归测试固定 TRSS Proxy、多 Bot、OneBotv11 初始化时序与 Miao 单账号边界。

## 非目标

- 不改变连接 `bind`、`exclude` 或 `bot_id_map` 的业务语义。
- 不为核心主动推送自动选择任意 TRSS 账号。
- 不新增 `self_id -> e.bot` 长期缓存。
- 不修改 TRSS、NapCat、OneBotv11 或 gsuid_core 源码。
- 不处理与本问题无关的样式死规则。

## 已验证的运行时行为

### TRSS Bot 注册表

TRSS 的 `Yunzai` 实例保存普通对象 `bots = {}`，构造函数返回以该对象为 target 的 Proxy。适配器通过 `Bot[id] = instance` 或 `Bot.bots[id] = instance` 注册账号；因为 Proxy 没有 `set` trap，两种写法最终都写入同一注册表。

框架准备事件时先验证 `this.bots[data.self_id]`，再把该实例挂为不可枚举的 `data.bot`。因此，完整事件上的 `e.self_id` 与 `e.bot` 本应描述同一个账号。

### NapCat / OneBotv11

OneBotv11 在 lifecycle 连接事件中创建 `Bot[data.self_id]`，立即令 `data.bot = Bot[data.self_id]`，随后加入 `Bot.uin` 并异步读取登录信息。普通消息、通知和请求在处理前也按 `data.self_id` 获取同一账号实例。

实例的 `uin` getter 依赖异步填充的 `info.user_id`。刚注册但登录信息尚未读取完成时，实例已经有效，`uin` 却可能暂时为空。因此，精确注册表命中不能再用 `bot.uin` 作为必要验证条件。

### Miao-Yunzai

Miao 只有一个全局 Client。登录完成后，它将 `bot[bot.uin] = bot` 并把该对象赋给 `global.Bot`。Miao 没有 TRSS 的 `Bot.bots` 多账号表，故需要保留“目标账号等于全局 `Bot.uin` 时返回根 Bot”的兼容路径。

### gsuid_core 下行

由普通入站事件触发的回复会把原事件 `bot_self_id` 原样带回适配器。核心的部分主动推送入口允许 `bot_self_id` 为空以保持旧行为；这种输入在 TRSS 多账号环境中没有无歧义的发送账号，适配器不得自行猜测。

## 方案比较

### 方案 A：精确读取注册表（采用）

TRSS 只从 `Bot.bots` 的自有属性中按规范化账号键取实例；Miao 仅在根 `uin` 相等时返回全局 Bot。

优点：

- 不触发 Proxy 未知属性重定向。
- 不受全局 `Bot.pickFriend` / `Bot.pickGroup` 的随机或跨账号选择影响。
- 不依赖 OneBotv11 尚未初始化完成的 `uin` getter。
- 行为容易用纯单元测试固定。

代价：

- 表面写法不是 Yenai 的直接 `Bot[i]`，但账号语义与其一致。
- 需要显式处理原型属性名与空账号。

### 方案 B：直接读取 `Bot[self_id]` 并校验

优点是写法贴近 Yenai。缺点是仍进入 Proxy 的属性解析顺序，可能与框架/工具属性重名；若再通过 `uin` 校验，会误拒 OneBotv11 刚注册的有效实例。为覆盖这些边界需要更复杂且更脆弱的身份判定，故不采用。

### 方案 C：缓存上行事件的 `e.bot`

该方案可以复用事件已绑定的账号实例，但主动推送没有原事件，账号重连后缓存会陈旧，还需要生命周期清理。它增加状态却不能覆盖所有发送路径，故不采用。

## 详细设计

### `getBot(id)`

`src/utils/bots.ts` 提供唯一的账号实例解析入口：

1. `null`、`undefined`、空字符串和仅空白的账号直接返回 `null`。
2. 读取 `globalThis.Bot`；不存在则返回 `null`。
3. 若 `Bot.bots` 是对象：
   - 将账号规范化为字符串键。
   - 使用 `Object.prototype.hasOwnProperty.call(Bot.bots, key)` 判断是否真实注册。
   - 命中时直接返回 `Bot.bots[key]`，不读取 `Bot[key]`，也不要求实例的 `uin` 已可用。
   - 未命中返回 `null`，不得扫描 `Bot.uin` 或其他实例。
4. 若不存在 TRSS 注册表，则按 Miao 兼容路径处理：只有 `Bot.uin` 为非数组标量，且 `String(Bot.uin) === key` 时返回根 Bot。
5. getter 或对象形状异常时返回 `null`，不得改用其他账号。

自有属性检查用于避免把 `constructor`、`toString` 等原型属性误判为账号实例。

### 上行账号解析

`resolveSelfId(e)` 保持以下优先级：

1. 非空 `e.self_id`。
2. 非空 `e.bot.uin`。
3. 仅当全局 `Bot.uin` 是长度为 1 的数组时，使用唯一在线账号。
4. 否则返回空字符串。

多 Bot 时绝不调用 `Bot.uin.toString()` 或 `toJSON()` 猜账号。解析出的字符串会同时用于：

- 连接 `bind` / `exclude` 判断；
- 回环与自消息检测；
- 主人判断；
- 被动回复键；
- 上报协议的 `bot_self_id`；
- 平台 `bot_id_map` 精确查找。

这样上行和下行使用同一账号标识。

### 下行发送

`GsCoreClient.onMessage` 解析核心帧后，以 `getBot(data.bot_self_id)` 获取发送实例。

- 命中：控制指令、目标选择和消息发送全部使用该实例。
- 未命中：记录包含连接名和目标 `bot_self_id` 的错误，并跳过控制指令及消息发送。
- 不使用全局 TRSS `Bot` 作为 fallback。
- Miao 的根 Bot fallback 已封装在 `getBot` 内，调用方不再自行按 `Array.isArray(Bot.uin)` 推断框架。

`echoKey`、`markSent` 和被动回复的账号部分继续使用协议中的 `data.bot_self_id`，确保回显键与发送账号一致。

### Recall 回执

消息发送主流程继续由 `try/finally` 包裹。账号解析失败、目标不存在、消息为空或发送抛错时，若下行帧带 `echo`，均回传 `recall_message_id: null`。

控制指令不要求 recall 回执，行为保持不变；账号未命中时控制指令不会执行，并继续进入消息路径的失败处理，以便普通带 echo 帧完成回执。

### 平台推断与档案

`botProfile`、`accountPlatform` 和配置迁移中的在线实例读取统一调用 `getBot`。平台推断不读取 TRSS Proxy 的未知账号 fallback。

账号档案的在线状态以注册表精确命中为准。昵称和头像 getter 失败时继续回退到账号文本或可推导头像，不影响账号身份判断。

## 错误处理与可观测性

- 空账号日志显示为空账号或明确占位，避免日志看起来像成功选择了某个 Bot。
- 未注册账号日志至少包含连接名与 `bot_self_id`。
- 不重复发起发送，不回退到其他账号。
- 上行事件缺少账号且多 Bot 在线时沿用现有去重告警，说明插件拒绝猜号。
- 账号 getter 或注册表读取异常按离线处理，避免异常中断其他连接。

## 测试设计

新增或调整账号解析测试，使用仿真的 TRSS 根对象和 Proxy：

1. 三个账号在线时，逐个 `getBot(id)` 始终返回各自实例。
2. 未注册账号返回 `null`，即使 Proxy 对未知属性伪造其他 Bot。
3. 数字和字符串形式访问同一普通对象键。
4. `constructor`、`toString` 等继承属性未显式注册时返回 `null`。
5. OneBotv11 风格实例已经注册但 `uin` 暂时为空时仍能返回。
6. Miao 根 Bot 在目标账号与 `uin` 相等时返回自身。
7. Miao 空账号或错误账号返回 `null`。
8. `resolveSelfId` 保持事件账号优先、`e.bot.uin` 回退、单 TRSS Bot 唯一回退、多 Bot 不猜。
9. 平台推断在未显式传入实例时只使用精确注册表命中，不读取 Proxy 随机 fallback。
10. 下行未知账号不调用 `pickFriend`、`pickGroup` 或控制能力。
11. 下行未知账号且带 `echo` 时仍发送空 recall 回执。
12. 正常 NapCat/OneBot 帧使用对应账号实例的目标选择和发送方法。

## 验证步骤

1. 运行账号解析和平台推断相关测试。
2. 运行 `pnpm typecheck`，同时修复当前工作树中误删的 `echoKey`、`markSent` import。
3. 运行完整 `pnpm test`。
4. 若完整测试仍只有已知 CSS 死规则失败，单独报告为与本修复无关的既有工作区问题；账号相关失败必须全部解决。
5. 在可用的真实 TRSS + NapCat 环境中，以至少两个账号验证：
   - 两个账号各自触发核心回复，发送日志与实际发送账号一致；
   - 使用不存在的 `bot_self_id` 主动推送，任何账号都不发送；
   - 指定有效 `bot_self_id` 主动推送，仅目标账号发送。

## 验收标准

- TRSS 中不存在任何下行路径因账号解析失败而使用全局 `Bot`。
- 多账号下同一目标会话不会由错误账号发送。
- 正常 NapCat 事件的 `self_id` 原样往返核心并命中对应 OneBot 实例。
- Miao 正常单账号回复保持可用，错号和空号不会发送。
- 未命中账号的带 echo 帧及时收到空 recall 回执。
- TypeScript 检查通过；所有账号相关测试通过。
