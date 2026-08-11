# 回环防护

避免 `核心 → 云崽 → 核心` 死循环。三层拦截，任一层命中即丢弃。

## 三层

1. 适配器回显自己发出的消息（`user_id === self_id` / `message_sent` / `sub_type === "self"`）
2. 来源 adapter id 是 `GSUIDCore` 或 `GsCore`，或事件带 `gscore_origin` 标记
3. 内容指纹：本插件刚代发出去的内容在 10s 内被回显则丢弃

## 为什么第 2 层还留着 `gscore_origin`

`gscore_origin` 由本插件已移除的 server 方向打过；现在保留是为了兼容**其他**早柚核心适配器（如框架自带的 `GSUIDCore.js`）打的同名标记——判断成本极低，挡不住的话就是死循环。
