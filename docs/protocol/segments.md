# 消息段

云崽与核心之间的消息段双向转换。下面除了支持列表，还记了三处「不直觉但有意为之」的行为——它们都是照核心源码的实际表现对齐的，不是笔误。

## 支持的类型

`text` / `image`（+ `image_size`）/ `record` / `video` / `file` / `at` / `reply` / `reply_id` / `button`（核心侧叫 `buttons`）/ `node`（合并转发）/ `markdown`，均双向兼容。

## log_* 段

核心下发的 `log_*` 段（如 `log_INFO`）会转成云崽日志打印，不作为消息发出；同一包里若还有真实内容则照常发送，只有整包纯日志时才完全跳过。

## 三处不直觉但有意为之的行为

### `@全体成员` 不上报

云崽用 `at` 段的 `qq: "all"` 表示它，而核心 `handler.py:754-762` 只把 at 分成「等于 `bot_self_id`」和「其它」，`"all"` 会落进后者被 append 进 `at_list`。而 `at_list` 是一串用户 id——`core_pm` 会把它直接 extend 进封禁参数，`handler.py:671` 又拿 `not at_list` 当「没 @ 具体某人」的判据，字面量混进去两边都会误判。所以这一段整体丢弃，正文照常上报。

### 引用消息同时上报正文、id 与媒体

上行（云崽 -> 核心）时，`reply` 段的 `data` 是被引用消息正文，`reply_id` 段的 `data` 是被引用消息 id。引用中的图片不塞进正文，也不丢弃，而是继续作为独立的 `image` 段上报；对应尺寸继续使用紧随其后的 `image_size` 段。合并转发节点则以独立的 `node` 段上报，并在 `reply` 正文前加 `[合并转发]` 摘要，方便核心侧先完成文本匹配。

下行（核心 -> 云崽）时，旧的 `reply` 段和新的 `reply_id` 段都按消息 id 处理，转换为云崽平台的引用标记。这样既兼容核心已有的发送报文，也能消费新增字段。

### 引用正文的获取路径

TRSS 优先调用事件提供的 `getReply()`，从返回消息的 `message` 中提取正文和媒体。ICQQ 没有可用的 `getReply()` 时，按 `Common.js` 的兼容路径从当前群/好友的聊天记录读取一条引用消息：群聊使用 `e.source.seq`，私聊使用 `e.source.time`。

icqq 的 `e.source` 只有 `user_id` / `time` / `seq` / `rand`，**没有 `message_id`**；框架的 `e.reply_id` 也可能因 parser 没有产出 `reply` 段而为空。此时 `utils/reply.ts` 用 icqq 的 `genGroupMessageId` / `genDmMessageId` 从 `seq` / `rand` / `time` 反算 id，再与聊天记录回退配合，保证核心能关联到原消息。获取正文失败时仍保留 `reply_id`，不会阻断当前消息上报。

::: info 核心把权限字段拼成了 `permisson`
`Button` 结构中权限字段拼写为 **`permisson`**（少一个 i），是核心源码即如此，非笔误。转换层照此对齐。
:::
