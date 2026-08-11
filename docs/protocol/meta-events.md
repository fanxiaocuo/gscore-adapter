# 非消息事件

入群、退群、戳一戳会上报为核心的 meta event。其余事件（禁言、头衔、撤回等）静默丢弃，只打 debug 日志。

## 映射表

| 云崽 notice | 上报段 type |
| :--- | :--- |
| `notice_type=group`, `sub_type=increase` | `meta-user_join_group` |
| `notice_type=group`, `sub_type=decrease` | `meta-user_exit_group` |
| `sub_type=poke`（群聊或私聊） | `meta-poke` |

## 注意事件形状

`plugins/adapter/OneBotv11.js:1330-1333` 会把 `notice_type` 按 `_` 拆成两段（`group_increase` → `notice_type="group"` + `sub_type="increase"`），ICQQ 原生亦是此形状。

::: warning 匹配主键是 `sub_type`
写成 `notice_type === "group_increase"` **恒为 false**。
:::

## 已知限制

OneBot 原生的 `approve`/`invite`/`kick`/`leave` 这个原始 `sub_type` 被上述拆分覆盖、取不回来，故上报的 data 中不含 `sub_type` 字段。
