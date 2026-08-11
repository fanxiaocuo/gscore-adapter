# 协议要点

几处容易踩的坑，都已对核心源码核实。文档与源码不一致时以源码为准。

## 上行必须是二进制帧

核心 `core.py` 的读循环是 `await websocket.receive_bytes()`。

::: warning 官方文档在这一点上过时了
文档 `CodeAdapter/Protocol.html` 称「均使用 text 类型」，**文档过时，以源码为准**。改成文本帧会让 Starlette 侧直接报错。
:::

## 鉴权走 `?token=` 查询参数

不是请求头。

## meta 段的 type 带 `meta-` 前缀

核心用 `startswith("meta-")` 识别，剥离前缀后作为 `meta_event_type`；data 为 dict 时整体存入 `meta_event_data`，并用其中的 `user_id`/`group_id` 回填顶层缺失字段供鉴权使用——所以必需字段缺失时本插件宁可整包丢弃，不发残包。

## 撤回回执必须回

核心 `bot.py` 的 `target_send` 在 `wait_recall` 时会等 `recall_message_id`（超时 10s），连续 3 次拿不到就把本适配器标记为 `_supports_recall=False` **永久关掉撤回能力**。故本插件即使发送失败也回一帧（id 给 `null`）。

## 控制指令拼写是 `excute_` 不是 `execute_`

`excute_delete_message` / `excute_ban_user`，核心源码即如此。
