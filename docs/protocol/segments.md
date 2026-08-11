# 消息段

云崽与核心之间的消息段双向转换。下面除了支持列表，还记了三处「不直觉但有意为之」的行为——它们都是照核心源码的实际表现对齐的，不是笔误。

## 支持的类型

`text` / `image`（+ `image_size`）/ `record` / `video` / `file` / `at` / `reply` / `button`（核心侧叫 `buttons`）/ `node`（合并转发）/ `markdown`，均双向。

## log_* 段

核心下发的 `log_*` 段（如 `log_INFO`）会转成云崽日志打印，不作为消息发出；同一包里若还有真实内容则照常发送，只有整包纯日志时才完全跳过。

## 三处不直觉但有意为之的行为

### `@全体成员` 不上报

云崽用 `at` 段的 `qq: "all"` 表示它，而核心 `handler.py:754-762` 只把 at 分成「等于 `bot_self_id`」和「其它」，`"all"` 会落进后者被 append 进 `at_list`。而 `at_list` 是一串用户 id——`core_pm` 会把它直接 extend 进封禁参数，`handler.py:671` 又拿 `not at_list` 当「没 @ 具体某人」的判据，字面量混进去两边都会误判。所以这一段整体丢弃，正文照常上报。

### 引用消息只传 message_id

不把被引用消息的图片一并抓下来。核心 `handler.py:773` 只做 `event.reply = data`，消费者拿它当**键**去查核心自己缓存的图（GenshinUID 的「原图」功能），额外注入 `image` 段会污染 `event.image` / `image_list`，让「引用了一张图」在插件眼里变成「刚发了一张图」。

### 引用回复在 ICQQ 上曾完全失效

icqq 的 `e.source` 只有 `user_id` / `time` / `seq` / `rand`，**没有 `message_id`**；而框架的 `e.reply_id` 派生自 `reply` **段**，偏偏 icqq 的 parser 永不产出该段。两个常规字段双双为空，引用信息传不到核心且不报错。

现由 `utils/reply.ts` 用 icqq 自己的 `genGroupMessageId` / `genDmMessageId` 从 `seq`/`rand`/`time` 反算——与当初上报时用的 id 必然一致，核心才查得到自己缓存的图。

::: info 核心把权限字段拼成了 `permisson`
`Button` 结构中权限字段拼写为 **`permisson`**（少一个 i），是核心源码即如此，非笔误。转换层照此对齐。
:::
