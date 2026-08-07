# gscore-adapter meta events 支持

日期：2026-08-07

## 背景

`plugins/gscore-adapter` 已实现早柚核心（gsuid_core）双向适配：客户端方向（云崽 → 核心）、服务端方向（核心 → 云崽）、消息段双向转换、连接管理指令，5 个测试文件共 96 条断言全绿。

唯一缺口是非消息事件。`lib/client.js` 的转发钩子只挂了 `Bot.on("message")`，并在入口处 `if (e.post_type !== "message") return false`，因此入群、退群、戳一戳等通知完全不会上报给核心。参考实现 `xiowo/napcat-plugin-gscore-adapter` 支持这三种事件，本次补齐。

## 目标

上报三种 meta event，与参考实现严格对齐：

| 云崽 notice 事件 | 上报段 type |
|---|---|
| `notice_type=group`, `sub_type=increase` | `meta-user_join_group` |
| `notice_type=group`, `sub_type=decrease` | `meta-user_exit_group` |
| `sub_type=poke`（群聊或私聊） | `meta-poke` |

不做：入群申请/好友申请（request 事件）、消息撤回、配置开关。

## 关键约束：本 fork 的 notice 事件形状

**照抄参考实现的匹配条件在本项目上一条都匹配不到。**

参考实现基于 NapCat，匹配 OneBot 原生的 `notice_type === "group_increase"`。本 fork 的适配器把事件名拆成了两段：

- `plugins/adapter/OneBotv11.js:1330-1333` 显式拆分：`group_increase` → `notice_type="group"` + `sub_type="increase"`
- ICQQ 原生即为此形状（`notice_type: "group"` / `"friend"` + `sub_type`），OneBotv11 的拆分正是为对齐它
- 最终触发的事件名为 `notice.group.increase` / `notice.group.decrease` / `notice.group.poke`

因此匹配的主键是 `sub_type`：入群/退群额外要求 `notice_type === "group"`，poke 则两种 `notice_type` 都接受。任何形如 `notice_type === "group_increase"` 的判断在本项目上恒为 false。

**poke 的字段语义**：`plugins/adapter/OneBotv11.js:1170` 将 `operator_id` 赋为戳人者。戳人者取 `operator_id ?? user_id`，被戳者取 `target_id`，`target_id` 缺失时兜底为 bot 自身 id。

**入退群的原始 sub_type 已丢失**：OneBot 原生的 `group_increase` 带 `sub_type=approve|invite`、`group_decrease` 带 `kick|leave`，但 `OneBotv11.js:1333` 的 `data.sub_type = notice` 会用拆出来的 `"increase"`/`"decrease"` 覆盖掉它。参考实现会转发这个原始 sub_type，本项目无法提供，故 data 中不含 `sub_type` 字段。poke 不受影响：其 `notice_type` 在 1165-1166 行已被改写为 `"group"`/`"friend"`，拆分后余部为空，`sub_type="poke"` 得以保留。

**事件冒泡**：`lib/bot.js:363` 的 `Bot.em` 逐级冒泡（`notice.group.increase` → `notice.group` → `notice`），故监听 `Bot.on("notice")` 即可覆盖全部。

## 架构

数据流与现有 message 路径同构，三层职责分离：

```
适配器 (ICQQ/OneBotv11/…)
  └─ Bot.em("notice.group.increase", e)
       └─ Bot.on("notice", onYunzaiNotice)      ← client.js 新增，与现有 message 钩子并列
            ├─ shouldForwardNotice(e)            ← 轻量守卫，notice 专用
            ├─ noticeToMeta(e)                   ← lib/notice.js 纯函数
            └─ for (c of clients) c.sendMeta(…)  ← 复用现有 send()，二进制帧
```

对照现有 message 路径 `shouldForward` → `yunzaiToGscore` → `sendReceive`：守卫决定要不要发，纯函数决定发成什么，client 决定发给谁。刻意保持同构，读代码的人不必学第二套心智模型。

### 新增 `lib/notice.js`

只导出两个纯函数，不 import ws、不碰全局状态：

```js
export function noticeToMeta(e)                      // → { eventName, data } | null
export function metaToGscore(e, meta, botId, opts)   // → MessageReceive | null
```

单独成文件的理由：`lib/convert.js` 已 456 行，职责是「消息段双向转换」；meta event 不走 `content` 消息语义，是事件通知，属于另一个关注点。插件现有分层（config / convert / client / server）干净，meta 作为第五个独立关注点自成一文件符合既有风格，也让测试能像 `test/protocol.js` 那样直接调纯函数断言。

`noticeToMeta` 中 poke 判断置于 group/friend 分支之前，因 poke 在两种 `notice_type` 下均出现。所有 id 统一 `String()`；必需字段（`user_id`，入退群时还有 `group_id`）缺失时整体返回 `null`，可选字段（`operator_id`、`sub_type`）为空则从 data 中剔除，不发 `operator_id: ""` 这类脏字段。此即参考实现的 `stringifyId` 语义。

### 上报包结构

复用现有 `resolveBotId()`（`lib/config.js:101`）解析 `bot_id`。固定字段照参考实现：

- `msg_id: ""`、`sender: {}`
- `user_pm`：主人 1，否则 6。主人判断复用 `client.js:446` 的 `cfg.master[e.self_id]?.includes(String(e.user_id))`
- `user_type`：有 `group_id` 则 `"group"`，否则 `"direct"`
- `content: [{ type: "meta-" + eventName, data }]`

### 回环防护

不复用 `shouldForward()` —— 其中的回显检测、文本前缀过滤、`only_reply_at` 对 notice 无意义（notice 没有 message 数组）。新建轻量守卫，保留三项：

1. `e.gscore_origin` 标记 + adapter id 检查（`server.js:139` 打的标记），否则 server 方向来的事件会绕回去形成死循环
2. `filter` 的群/用户黑白名单 —— 拉黑的群不该再收到其入群通知
3. 各连接的 `accept(self_id)` bind/exclude（复用现有方法）

## 错误处理

| 失败点 | 处理 |
|---|---|
| 映射失败（未知 sub_type / 缺必需字段） | 返回 `null`，**debug 级**日志，静默丢弃 |
| 连接未就绪 | `return false`，不排队不重试 |
| 单个连接抛异常 | per-connection try/catch，一个连接炸掉不影响其余 |
| 监听器本身抛异常 | 最外层 try/catch + `Bot.makeLog("error", …)` |

映射失败用 debug 而非 warn 是硬约束：群禁言、群头衔、消息撤回等大量事件都会走到这条路径，用 warn 会刷屏。参考实现同样是 debug。

监听器最外层的 try/catch 是硬要求：`Bot.em` 是同步 emit，逃逸的异常会直接冒到适配器的事件回调里。现有 `onYunzaiMessage` 已如此处理。

per-connection 收紧粒度（现有 message 路径是整个循环包一层）：notice 循环内无 await 转换开销，细粒度几乎零成本。

**非目标**：不做 meta event 送达确认。核心的 `meta_event_type` 是单向通知，无 echo/回执机制（不同于 MessageSend 的 `recall_message_id`）。发出即完成，不等不查。

## 接触面

只改两处，均为加法：

- `plugins/gscore-adapter/lib/notice.js` —— 新建
- `plugins/gscore-adapter/lib/client.js` —— `GsCoreClient` 加 `sendMeta()`；文件末尾加 `onYunzaiNotice()` 与 `shouldForwardNotice()`；`hook()` 内加一行 `Bot.on("notice", onYunzaiNotice)`，复用现有 `hooked` 幂等标志

`convert.js`、`server.js`、`config.js`、`apps/`、配置文件全部不动。

## 测试

新增 `test/meta.js`，与 `test/protocol.js` 同构：纯 Node，无测试框架，自建 stub，`check(name, cond)` 计数，末尾打印通过/失败数。

单独成文件而非并入 `protocol.js`：后者 stub 中 `Bot.on` 是空函数，而 meta 测试的核心恰是「监听器被正确挂上并触发」，同一 stub 内无法兼顾。

18 条断言：

**A. 映射正确性（纯函数，不起 ws）**
1. `sub_type=increase` → `meta-user_join_group`，含 user_id/group_id
2. `sub_type=decrease` → `meta-user_exit_group`
3. `notice_type=group, sub_type=poke` → `meta-poke`，带 group_id
4. `notice_type=friend, sub_type=poke` → `meta-poke`，不带 group_id
5. `operator_id` 存在时写入 data；入退群事件的 data 不含 `sub_type`（见「关键约束」）
6. 所有 id 均为 string 类型

第 1-3 条是本次改动的核心风险点，用的是本 fork 拆分后的 `sub_type` 形状。测试文件顶部注释须写明形状来源（`plugins/adapter/OneBotv11.js:1330-1333`），使后来者知道不是笔误。

**B. 丢弃逻辑**

7. 入群但缺 `group_id` → `null`
8. 缺 `user_id` → `null`
9. `sub_type=ban`/`title` 等未映射事件 → `null`，且日志级别是 debug 不是 warn
10. `post_type !== "notice"` → `null`

第 9 条显式断言日志级别，将「不刷屏」这一设计约束钉住。

**C. poke 的 target_id 兜底**

11. `target_id` 存在时原样使用
12. `target_id` 缺失时兜底为 `bot_self_id`

**D. 上报包结构**

13. `msg_id === ""`、`sender` 为 `{}`
14. 主人 `user_pm===1`，非主人 `===6`
15. 有 group_id → `user_type==="group"`，否则 `"direct"`

**E. 端到端（起 mock ws 服务端）**

16. 核心侧收到二进制帧
17. 黑名单群的 notice 不上报
18. 带 `gscore_origin` 标记的事件不上报

第 16 条与 `protocol.js` 第 1 条同源：文档 `CodeAdapter/Protocol.html` 称「均使用 text 类型」，但 `gsuid_core/core.py` 实际是 `await websocket.receive_bytes()`，参考实现也发 `Buffer.from(payload)`。文档过时，以源码为准。此矛盾必须在 meta 路径上同样钉住，否则将来有人「照文档修正」会同时打断两条路径。

### 回归

改完跑全部 5 个测试文件，现有 96 条须仍全绿。重点关注 `e2e.js` —— 它 import 了 `client.js`，而本次改动会动 `hook()`。

## 协议验证状态

核心 `gsuid_core/handler.py` 源码已逐条核对，协议主体为**已证实**，非推断：

| 设计假设 | 状态 | 证据 |
|---|---|---|
| 段 type 用 `meta-` 前缀 | 已证实 | `handler.py` `_extract_meta_segment`：`if seg.type and seg.type.startswith("meta-")` |
| 前缀后的部分即事件名 | 已证实 | `handler.py` `msg_process`：`event.meta_event_type = _msg.type[len("meta-"):]` |
| `data` 为 dict 时整体进 `meta_event_data` | 已证实 | 同上，dict 分支 |
| 上报二进制帧 | 已证实 | `core.py`：`await websocket.receive_bytes()`；参考实现 `Buffer.from(payload)` |
| meta 事件走独立分发路径 | 已证实 | `handle_event` 在黑名单及常规管道之前即分流至 `handle_meta_event` |

**核心会从 data 回填顶层缺失的 id**：

```python
if not event.user_id and "user_id" in _msg.data and _msg.data["user_id"] is not None:
```

`group_id` 同理，源码注释说明目的是保证「权限/黑白名单/area 可用」。这印证了「必需字段缺失即整体丢弃」的设计决定：`data.user_id` 不只是业务字段，核心的 `_sv_authorized` 鉴权链路依赖它；发出缺 `user_id` 的包会导致核心侧鉴权失效。测试断言 7、8 钉住此点。

**唯一仍属推断的部分**：`user_join_group` / `user_exit_group` / `poke` 这三个具体字符串。核心用事件名匹配 `_sv.TL["meta"]` 中注册的触发器，对名称本身透明、不做校验——即认不认这三个名字取决于装了哪些核心插件，而非核心本身。故此项无法通过阅读核心源码或连接空核心来确认，唯一权威来源是参考实现，本设计已与其逐字对齐。

风险等级：从「协议可能整体错误」降至「事件名可能与某些核心插件的期望不一致」，后者仅在装有对应插件时才谈得上，且修正成本为一行字符串。

## 验证边界

代码层面只能验证到 mock 层：测试全绿证明发出的包符合上述已证实的协议规格，但不覆盖真实核心插件对事件名的接受情况。若某核心插件未响应，先核对其注册的 meta 触发器名称。

