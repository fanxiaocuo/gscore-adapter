# 账号级核心连接、QQBot 图片与响应式面板设计

## 背景

本设计合并三个相互关联的改动：

1. QQBot 发送“ww帮助”后，早柚核心已经生成并记录下发图片，但用户没有收到该图片。
2. 多 Bot 连接不再把 `/ws/Yunzai` 或 `/ws/Yunzai-<账号>` 作为主要持久化配置；配置保存核心 `host:port` 与 `bind` 账号，启动时按账号生成 WebSocket 路径。
3. Web 面板适配移动端并优化为接近 Apple 设置页的界面；绑定账号可展开为机器人列表，通过绿色开关逐账号绑定。

现有[多 Bot 账号精确解析设计](./2026-08-14-exact-multi-bot-resolution-design.md)已经规定：下行只能使用 `bot_self_id` 对应的精确 Bot，未知、空白或离线账号不得由其他账号代发。本设计建立在该约束上，不修改其账号安全边界。

### 已验证的故障证据

目标 QQBot 请求在 gsuid_core 日志中具有以下特征：

- `bot_id='qqgroup'`；
- `bot_self_id='3889017463'`；
- “ww帮助”命中插件；
- 核心记录了图片处理和下发；
- `WS_BOT_ID='Yunzai'`，仍使用共享 WebSocket 身份。

同一环境中的普通 QQBot 图片能够经 QQBot-Plugin 上传并以 markdown 图片发送，说明问题不是“QQBot 完全不能发图片”。gscore-adapter 的核心下行转换也会把 `image` 转成 `segment.image(...)`，没有主动丢弃图片。

gsuid_core 以 `/ws/{bot_id}` 的路径参数作为 `active_ws` 与 `active_bot` 的键。两个客户端使用相同 `/ws/Yunzai` 时，后连接会覆盖先连接；断开和重连也围绕相同键清理或替换 socket。目标事件由共享 `WS_BOT_ID='Yunzai'` 进入，因此账号间的 WebSocket 身份冲突是本次“核心已下发、adapter 未见对应下行帧”的主要故障域。

图片传输仍需单独补齐端到端测试和发送错误观测，不能只凭连接拆分推断图片问题已经解决。

## 目标

1. 配置只需保存核心 WebSocket origin（如 `ws://127.0.0.1:8765`）及明确的 `bind` 账号。
2. 一个逻辑核心配置按有效 `bind` 展开为多个账号级运行时连接。
3. 每个账号连接使用 `/ws/Yunzai-<账号>`，在核心侧获得独立 `WS_BOT_ID`。
4. 路径只在内存中生成，不把派生路径写回新配置。
5. 自定义 WebSocket 路径继续作为高级兼容模式使用，不被自动改写。
6. QQBot 的早柚核心图片完整通过 `onMessage → gscoreToYunzai → doSend → QQBot-Plugin`，并在发送失败时留下可诊断错误。
7. Web 面板在桌面与手机上都可用，不产生页面级横向滚动。
8. 绑定账号区自动展示机器人头像、昵称、`self_id`、平台 `bot_id` 和在线状态。
9. 每个机器人通过独立 Apple 风格绿色开关管理绑定：开即绑定，关即不绑定。
10. 已绑定账号暂时离线时仍保留在面板和配置中，不因掉线自动解绑。

## 非目标

- 不在 gscore-adapter 内复制 QQBot-Plugin 的图片上传、图床和 markdown 拼接实现。
- 不修改 gsuid_core、QQBot-Plugin 或 Yunzai 框架源码。
- 不在多 Bot 环境中从 `Bot.uin.toJSON()`、全局 Bot 或任意在线账号猜测绑定对象。
- 不让连接 `bind` 代替框架的主人权限表；“账号能否使用早柚指令”的权限仍由云崽 master 配置决定。
- 不因关闭绑定开关删除 `bot_id_map`；平台映射可供该账号在其他连接或以后重新绑定时复用。
- 不在面板接口中返回 token 原文。
- 不对无关页面或渲染模板做整体重写。

## 方案比较

### 方案 A：逻辑端点持久化，按 `bind` 展开运行时连接（采用）

配置保存：

```yaml
client:
  connections:
    - name: 早柚核心
      url: ws://127.0.0.1:8765
      bind:
        - 3889017463
        - 2978070909
```

运行时展开为：

```text
ws://127.0.0.1:8765/ws/Yunzai-3889017463
ws://127.0.0.1:8765/ws/Yunzai-2978070909
```

优点：

- 配置符合“核心地址与绑定账号关联”的心智模型。
- 账号在核心侧有独立身份，不会因共享 `Yunzai` socket 被覆盖。
- 上行、下行、状态、统计和重连均可精确到账号。
- 派生信息不污染配置。

代价：

- 持久化连接与运行时客户端不再一一对应。
- 自动端点必须有明确账号，不能继续用空 `bind` 表示“全部”。

### 方案 B：配置仍按账号保存多条相同 origin

每项只绑定一个账号，运行时补路径。实现较简单，但同一核心地址在 YAML 中重复，面板也会展示多个近似连接项，不符合一条核心配置集中管理多个账号的目标。

### 方案 C：隐藏路径但继续共享 `/ws/Yunzai`

改动最小，却保留了 gsuid_core 中相同 `bot_id` 覆盖 socket 的根本风险，也无法解释和消除当前图片下行缺失。故不采用。

## 配置模型

### 持久化连接

`WsConnection` 继续作为用户配置中的逻辑连接：

```ts
interface WsConnection {
  name?: string
  url: string
  token?: string
  enable?: boolean
  reconnect_interval?: number
  max_reconnect_attempts?: number
  bind?: (string | number)[]
  exclude?: (string | number)[]
}
```

字段语义调整如下：

- 自动端点的 `url` 保存 WebSocket origin，不保存 `/ws/Yunzai`。
- 自动端点的 `bind` 是明确账号集合，不再以空数组表达“所有账号”。
- `exclude` 继续作为兼容和高级过滤项，优先于 `bind`。
- `bot_id_map` 继续独立保存“账号 → 核心平台标识”，例如 `3889017463: qqgroup`。
- 连接级旧字段 `bot_id` 仍只用于迁移，运行时不读取。

### 自动端点与自定义路径

URL 解析后：

- pathname 为 `/` 或空时，视为自动端点；保存为 origin。
- pathname 为 `/ws/Yunzai` 或符合旧 `/ws/Yunzai-<账号>` 形式时，由迁移规则处理。
- 其他显式 pathname 视为自定义路径，例如 `/ws/MyAdapter`；保留完整路径并只创建一个兼容客户端。

自定义路径不自动追加账号后缀，因为路径可能是用户与核心约定的稳定身份。它仍可使用 `bind`/`exclude` 过滤上行账号，但不会展开为多条账号路径。

### 运行时连接

新增仅在内存存在的运行时形状，概念上包含：

```ts
interface RuntimeWsConnection extends WsConnection {
  sourceIndex: number
  account: string | null
  runtimeName: string
  runtimeUrl: string
  automatic: boolean
}
```

含义：

- `sourceIndex`：来源逻辑配置的索引，用于状态聚合和面板定位。
- `account`：自动端点对应的唯一账号；自定义路径为 `null`。
- `runtimeName`：日志、状态、重连和统计使用的唯一名称。
- `runtimeUrl`：最终连接地址。
- `automatic`：是否由 origin + bind 派生。

该对象在构造后不会反向写入持久化配置。

### 有效绑定账号

自动端点的有效账号为：

```text
deduplicate(bind.map(String)) - exclude.map(String)
```

规则：

1. 空字符串和纯空白项剔除。
2. 保持首次出现顺序。
3. 同一账号在 `bind` 与 `exclude` 中同时出现时，`exclude` 胜出并输出配置错误。
4. 有效账号为空时不启动自动连接，明确报错。
5. 不把当前在线机器人自动写进 `bind`；只有用户打开开关才持久化绑定。

## URL 规范化与路径生成

URL 工具拆分为四个清晰职责。

### `normalizeEndpoint(input)`

用于持久化自动端点：

```text
127.0.0.1:8765
→ ws://127.0.0.1:8765
```

要求：

- 无协议时补 `ws://`。
- 仅接受 `ws:` 和 `wss:`。
- 自动端点去掉根 `/`，以稳定 origin 形式保存。
- 不自动补 `/ws/Yunzai`。
- 不把 `http:` 悄悄转成 `ws:`；继续返回可操作的错误提示。

### `materializeAccountUrl(endpoint, account)`

把自动端点生成账号路径：

```text
ws://127.0.0.1:8765 + 3889017463
→ ws://127.0.0.1:8765/ws/Yunzai-3889017463
```

账号作为单个 URL path segment 编码，不能注入 `/`、`?` 或 `#`。现有 QQ、微信、Telegram、Discord 等账号前缀都可保留其可读字符。

### 自定义路径规范化

自定义路径只做协议、host 和 URL 合法性校验，不改变 pathname。查询参数保留，但面板和日志不得显示敏感参数。

### 冲突键

运行时冲突键使用：

```text
lowercase(protocol + host + effective port + pathname)
```

查询参数和 token 不参与核心身份判定。同一最终路径由多个配置生成时：

- 第一条有效运行时连接启动；
- 后续冲突连接跳过；
- 日志指出来源逻辑连接和冲突账号；
- 不允许两个 socket 先后连接后再由核心覆盖。

## 生命周期与状态模型

### 两阶段启动

客户端启动流程改为：

```text
读取 WsConnection[]
  → 规范化并展开 RuntimeWsConnection[]
  → 校验有效账号和最终路径冲突
  → 创建 GsCoreClient[]
```

一条逻辑连接：

```yaml
name: 早柚核心
url: ws://127.0.0.1:8765
bind: [111, 222]
```

生成：

```text
早柚核心 [111]
早柚核心 [222]
```

每个自动运行时客户端把自己的 `bind` 收窄成单账号，使现有 `accept(self_id)` 仍可作为最终防线。

### 唯一身份与显示名称

运行时客户端不能只靠用户填写的 `name` 判重。内部唯一键由来源逻辑连接和账号构成；用户可见名称使用：

```text
<逻辑连接名> [<账号>]
```

用于：

- WebSocket 日志；
- 状态命令；
- 重连控制；
- 上下行统计；
- Web 面板运行时连接列表。

### 重载

逻辑连接的 URL、token、重连参数、enable、bind 或 exclude 改变时，重建该逻辑连接派生的全部运行时客户端。首版允许沿用“重建所有客户端”的安全实现；优化为按来源局部重建不是验收前提。

关闭某个账号的绑定开关后：

1. 保存新的 `bind`；
2. 关闭该逻辑连接现有运行时客户端；
3. 按新集合展开并重连；
4. 被移除账号不再生成连接。

## 上行与下行数据流

### 上行

```text
机器人 3889017463 收到“ww帮助”
  → resolveSelfId = 3889017463
  → 仅运行时客户端“早柚核心 [3889017463]”通过 accept
  → 上报到 /ws/Yunzai-3889017463
  → gsuid_core 设置 WS_BOT_ID = Yunzai-3889017463
```

同一入站事件不能通过该逻辑连接的其他账号客户端重复上报。

### 下行

```text
gsuid_core 依据事件 WS_BOT_ID 定位 Yunzai-3889017463
  → 图片帧回到同一账号 socket
  → GsCoreClient.onMessage
  → getBot(data.bot_self_id)
  → gscoreToYunzai
  → QQBot-Plugin
```

下行继续遵守精确账号设计：

- 仅用 `data.bot_self_id` 查 Bot；
- 找不到账号时不使用全局 Bot；
- 无论账号、目标、转换或发送失败，带 echo 的普通帧都在 `finally` 中回空 recall 回执。

## QQBot 图片处理

### 转换边界

现有转换链保留：

```text
core Message(type="image")
  → fromGscoreMedia(data)
  → segment.image(file)
  → QQBot-Plugin makeRawMarkdownMsg/makeMsg
  → QQBot SDK
```

`fromGscoreMedia` 继续接受：

- `base64://...`；
- `data:image/...;base64,...`，转换为 `base64://...`；
- `link://...`；
- `http://` / `https://`；
- Buffer。

不在 adapter 内预先把图片变成 QQ markdown，也不直接调用 QQBot 图床。QQBot-Plugin 已负责 `Bot.Buffer`、图片上传、尺寸识别和 markdown 图片格式；复制这一层会产生两套上传策略和错误处理。

### 被动回复与回退

QQBot 优先使用最近入站消息 ID 做被动回复。发送流程保证：

1. 调用 adapter 级 `sendFriendMsg` / `sendGroupMsg` 前，先确认 picked target 包含 `self_id`、`bot`、`user_id` 或 `group_id`、`platform`。
2. 被动发送接收完整的原消息数组，包括图片段。
3. 被动发送抛错或 `sendError(ret)` 返回错误时，使用同一消息内容回退到 `target.sendMsg(message)`。
4. 两条路径不得就地删除或替换原 image 段。
5. QQBot-Plugin 返回 `{ error: [...] }` 等非抛出失败时，仍视为失败。
6. 最终成功后才增加下行统计并提取 message ID。
7. 最终失败时记录错误、不计成功下行，并回 `recall_message_id: null`。

### 图片诊断日志

新增 debug 级下行摘要：

- 运行时连接名；
- `bot_self_id`；
- 目标类型与目标 ID；
- 消息段类型及数量，例如 `image×1,text×1`；
- 被动发送是否回退；
- 最终发送成功或错误摘要。

日志不得输出：

- token；
- 完整 base64；
- 含 token 的 URL；
- 私密媒体正文。

## 配置迁移

迁移使用 YAML Document API，保留用户注释，并保证幂等。

### 旧账号路径

```yaml
url: ws://host:8765/ws/Yunzai-3889017463
```

迁移为：

```yaml
url: ws://host:8765
bind:
  - 3889017463
```

若已有 `bind`，恢复出的账号合并并去重。

### 旧共享路径且已有绑定

```yaml
url: ws://host:8765/ws/Yunzai
bind: [111, 222]
```

迁移为：

```yaml
url: ws://host:8765
bind: [111, 222]
```

运行时按账号生成两条路径。

### 同核心旧配置合并

只有以下传输属性一致时才合并为一条逻辑连接：

- origin；
- token；
- enable；
- reconnect interval；
- max reconnect attempts。

名称不同时保留首项名称。传输属性不一致则保留独立逻辑项；若最终生成同一账号路径，由运行时冲突检查跳过后项并报错，不能静默覆盖用户设置。

### 旧共享路径且没有绑定

无法为 `/ws/Yunzai` 安全推导账号时：

- 保留为显式兼容连接；
- 只启动一个共享路径客户端；
- 输出一次迁移警告；
- 不从在线 Bot 中任意挑选账号；
- 用户补充 bind 并保存后，转换为自动端点。

这是旧配置的兼容例外。新建自动端点不允许空 bind。

### `bot_id_map`

迁移旧连接级 `bot_id` 时，按该连接的全部绑定账号写入 `bot_id_map`。关闭绑定开关不删除映射；已有显式映射也不被平台推断覆盖。

## 指令与锅巴配置

### 添加连接

指令示例：

```text
#早柚添加连接 ws://127.0.0.1:8765 bind=3889017463,2978070909
```

保存 origin 与明确 bind。若命令事件有无歧义的当前 `self_id`，可以默认绑定当前账号；解析不到明确账号时必须要求 `bind`，不使用多 Bot 随机兜底。

### 修改连接

保留：

```text
bind+=账号
bind-=账号
bind=账号1,账号2
```

自动端点不能删掉最后一个有效绑定，除非同时停用或删除连接。指令回复展示生成的账号路径或账号数量，不再暗示配置中持久化了 `/ws/Yunzai`。

### 锅巴

锅巴 schema 将 `url` 说明改为核心 origin，并明确 bind 会在运行时展开。锅巴无法提供与 Web 面板同等的实时 Bot 头像选择器时，仍允许列表形式编辑 bind；后端校验规则保持一致。

## Web 面板信息架构

### 响应式布局

面板采用系统设置式信息层级：

- 桌面端：标题和操作栏、统计概览、连接列表、全局设置。
- 移动端：单列分组、紧凑标题、触控友好的整行设置项。
- 主断点以内容能否容纳为准，目标在约 `720px` 以下切换为移动布局。
- 页面主体不允许横向滚动；长 URL、账号和错误文本在自己的容器中换行或截断。
- 表格形数据在手机上改成纵向列表，不压缩为不可读的多列。
- 可操作控件最小触控区域约 44×44 CSS 像素。

### 视觉风格

- 字体使用 `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif`。
- 浅色背景接近 `#F5F5F7`，内容组使用白色和细分隔线。
- 深色模式跟随 `prefers-color-scheme`，保持现有 iframe 限制下的自动适配。
- 只在需要表达分组时使用适度圆角，避免装饰性大卡片层层嵌套。
- 主操作继续使用清晰蓝色；开关启用色固定为 Apple 系统绿 `#34C759`，深色模式可使用 `#30D158`。
- 状态色与开关语义分开：绿色开关表示用户选择“启用/绑定”，连接状态另有文字与状态点。

### Apple 风格开关

所有布尔设置和机器人绑定使用统一 Switch 组件：

- 宽约 46–51px，高约 28–31px；
- 圆形白色滑块带轻微阴影；
- 关闭为系统灰，开启为系统绿；
- 动画约 160–220ms，并遵守 `prefers-reduced-motion`；
- 使用原生 checkbox 或等效 `role="switch"`、`aria-checked`、键盘 Space/Enter 操作；
- 焦点态可见，不能只靠颜色表达；
- 开关旁不重复显示“开启/关闭”文字，但行标题必须清晰说明控制对象。

## 绑定账号展开区

### 数据来源

面板对每条逻辑连接展示机器人集合：

```text
当前在线机器人 ∪ 当前连接 bind 中保存的账号
```

其中：

- 在线机器人来自框架的明确账号清单，并通过精确 `getBot(id)` 获取实例。
- 当前 `bind` 中的离线账号仍展示，避免掉线后无法管理。
- 不把其他连接中出现、但本连接未绑定且当前也不在线的历史账号自动塞入列表。
- 机器人重新上线后，下一次面板轮询自动补齐实时昵称、头像和平台信息。

每个 `BotProfile` 至少返回：

```ts
interface BotProfile {
  id: string       // self_id
  name: string
  avatar: string
  online: boolean
  platform?: string // 上报给核心的 bot_id
}
```

头像优先级：

1. Bot 实例提供的头像；
2. Bot 登录信息中的头像；
3. 对可识别 QQ 账号使用 qlogo 回退；
4. 图片加载失败时显示昵称或账号首字圆。

平台 `bot_id` 使用 `accountPlatform(id)`：显式 `bot_id_map[id]` 优先，否则按精确在线实例和账号形状推断。列表把 `self_id` 与平台 `bot_id` 分行或分标签展示，避免把两种 ID 混为一谈。

### 展开交互

连接卡片收起时显示：

- 前几个已绑定账号头像；
- “绑定 X/Y 个账号”；
- 展开箭头。

展开后每个机器人一行：

- 头像；
- 昵称；
- `self_id`；
- 平台 `bot_id` 标签；
- 在线/离线状态；
- 独立绑定开关。

移动端把元信息堆叠到头像右侧，开关固定在行尾，避免横向滚动。

### 开关语义

显示为绿色的条件是：

```text
id ∈ bind 且 id ∉ exclude
```

用户打开开关：

1. 将账号加入 bind；
2. 若账号也在 exclude，则同时从 exclude 移除，确保“开”真实代表绑定；
3. 保留或按需补齐该账号的 `bot_id_map`；
4. 保存并重建运行时连接。

用户关闭开关：

1. 从 bind 移除账号；
2. 不自动加入 exclude；
3. 不删除 `bot_id_map`；
4. 保存并移除该账号的运行时连接。

自动端点关闭最后一个有效开关时拒绝操作并提示：需保留至少一个绑定账号，或停用/删除整条连接。这样不会出现开关全灰但运行时语义却是“不限账号”的反直觉状态。

### 保存与并发

开关采用即时保存，不再要求用户另点一次“保存”：

- 点击后仅禁用当前连接的账号开关，防止连续请求覆盖。
- 后端接收完整的新 bind/exclude 集合并原子写入。
- 成功后使用接口返回的最新 payload 更新 UI。
- 失败时恢复原状态并显示错误 toast。
- 定时轮询在请求在途或编辑弹层打开时不覆盖本地交互。

新增连接弹层也使用同一机器人开关列表，并要求至少选中一个账号后才可提交自动端点。高级自定义路径可以保持兼容的 bind 规则。

## 面板接口与状态聚合

### Payload

逻辑连接视图继续隐藏 token，仅返回 `has_token`。同时扩充运行时状态：

```ts
interface RuntimeConnView {
  account?: string
  name: string
  path: string
  status: 0 | 1 | 2 | 3
  status_text: string
  retry: number
  up: number
  down: number
}

interface ConnView {
  // 现有逻辑配置字段
  bind_bots: BotProfile[]
  runtime: RuntimeConnView[]
}
```

`Payload.bots` 返回当前在线机器人；前端与 `bind_bots` 合并并按 `id` 去重。连接总览分别表达：

- 逻辑配置数量；
- 账号级运行时连接总数；
- 已连接运行时连接数。

### 安全

- token 只返回 `has_token`，编辑时留空表示不修改。
- runtime path 可展示 pathname，但不得把 token 查询参数传给前端。
- 头像 URL 作为展示数据处理；加载失败不影响面板。
- 后端继续对白名单字段逐个写入，拒绝原型链污染键。

## 错误处理与可观测性

- 自动端点无有效 bind：报错并跳过启动。
- bind 与 exclude 冲突：指出账号，exclude 胜出。
- 相同最终路径冲突：报出两项来源并跳过后项。
- 自定义路径与自动生成路径冲突：按最终路径同样拦截。
- 绑定开关保存失败：UI 回滚，不显示虚假绑定。
- 头像失败：首字圆回退，不阻塞其他账号渲染。
- 平台 `bot_id` 无法确定：展示“未识别”，不伪装成默认 onebot；实际事件上报仍按既有 `resolveBotId` 最终兜底规则执行。
- QQBot 图片下行：记录安全段摘要和最终发送结果。
- 未知 `bot_self_id`：不发送，但仍回空 recall 回执。
- 逻辑连接状态由派生运行时状态聚合，不以任意一条客户端覆盖其他账号状态。

## 测试设计

### URL 与展开纯函数

1. `host:port` 保存为 WebSocket origin，不补 `/ws/Yunzai`。
2. `wss://` 保留。
3. 自动端点按账号生成 `/ws/Yunzai-<编码账号>`。
4. 自定义路径不被改写。
5. query/token 不出现在展示 URL。
6. 多 bind 展开为多个单账号运行时配置。
7. 重复 bind 去重并保持顺序。
8. exclude 从有效账号中移除。
9. 空有效 bind 返回明确错误。
10. 最终路径冲突稳定识别。
11. 展开函数不修改原持久化对象。

### 迁移

1. `/ws/Yunzai-账号` 恢复 origin 和 bind。
2. `/ws/Yunzai + bind` 去除持久化路径。
3. 同核心旧账号连接在传输属性一致时合并 bind。
4. token、enable 或重连参数不同的配置不错误合并。
5. 共享 `/ws/Yunzai` 且无 bind 时保留兼容路径并告警。
6. 旧连接 `bot_id` 按账号迁入 `bot_id_map`。
7. 迁移幂等，第二次加载不再修改文件。
8. YAML 注释保持。

### 生命周期与路由

1. 一个账号只通过自己的运行时客户端上报。
2. 同逻辑连接的其他账号客户端拒绝该事件。
3. 两账号同时在线时核心获得不同 WS_BOT_ID。
4. 关闭绑定后对应客户端被关闭并移除。
5. 运行时名称、状态和计数按账号隔离。
6. 未知下行账号不回退到另一 Bot。
7. 带 echo 的失败帧仍返回 null recall receipt。

### QQBot 图片集成

构造完整 `GsCoreClient.onMessage` 边界测试：

1. 核心下发单图片，转换后仍为 image 段。
2. data URI 转成 `base64://` 且内容保持。
3. QQBot 私聊被动发送收到完整 target 上下文与图片段。
4. QQBot 群聊被动发送收到完整 target 上下文与图片段。
5. 被动发送返回 `{ error: [...] }` 时，普通发送收到同一图片段。
6. 被动发送抛错时同样回退。
7. 最终成功才增加 down 计数并回真实 message ID。
8. 两次发送均失败时不计数并回 null receipt。
9. 日志摘要不含 base64 和 token。

### 面板后端

1. `Payload.bots` 包含全部当前在线机器人及其精确档案。
2. `bind_bots` 包含已绑定离线账号。
3. 平台标签优先使用 `bot_id_map[id]`。
4. 打开开关添加 bind，并从 exclude 移除冲突账号。
5. 关闭开关只删除 bind，不删除 `bot_id_map`。
6. 自动端点不能关闭最后一个有效账号。
7. runtime 视图不暴露 token。
8. 并发或非法请求不产生部分写入。

### 面板前端与可访问性

1. 桌面和窄屏均无页面级横向滚动。
2. 机器人行在窄屏变为头像、文字、开关三列。
3. 长昵称、账号、URL 和错误信息不撑破容器。
4. 开关支持键盘操作，并具备 `role="switch"`/原生 checkbox 语义。
5. 开启、关闭、disabled、focus-visible、saving 和 error 状态可识别。
6. 深浅模式对比度满足可读要求。
7. `prefers-reduced-motion` 下关闭非必要滑动动画。
8. 头像加载失败显示首字圆。
9. API 保存失败后开关回滚。

## 验证步骤

1. 运行 `pnpm typecheck`。
2. 运行 `pnpm test`。
3. 运行 `pnpm build`，确认 Node 插件、渲染资源和 Web 面板产物均可构建。
4. 在桌面宽度、约 390px 手机宽度和深色模式下检查面板。
5. 仅使用键盘完成展开绑定列表、切换账号和保存连接。
6. 在真实 TRSS 多 Bot 环境中至少连接 QQBot 与另一个账号：
   - 面板自动显示全部在线机器人、头像、昵称、self_id 和平台 bot_id；
   - 开关绑定两个账号后，核心后台出现两个不同的 `Yunzai-<账号>`；
   - 关闭其中一个开关后，仅对应连接消失；
   - 账号掉线后仍可在该连接绑定列表看到并关闭；
   - QQBot 私聊发送“ww帮助”后收到早柚核心生成的帮助图片；
   - 图片由 QQBot 账号发送，不由其他 Bot 代发；
   - adapter 日志记录 image 段到达和发送成功，但不含媒体正文或 token。

真机验证是发布前必需步骤，自动测试不能替代 QQBot 平台实际上传和被动回复窗口验证。

## 验收标准

- 新自动连接配置无需出现 `/ws/Yunzai`。
- 一个逻辑端点可按多个 bind 生成账号级独立连接。
- 核心侧每个绑定账号具有不同 `WS_BOT_ID`，不会因共享路径互相覆盖。
- 自定义路径和无 bind 的旧共享路径有明确兼容行为。
- QQBot “ww帮助”能够收到核心生成的图片。
- 图片失败会被识别并记录，不会计为成功下行。
- Web 面板在桌面和手机上都可操作且无页面级横向滚动。
- 绑定区自动展示全部在线机器人及已绑定离线账号。
- 每个机器人均显示头像、昵称、self_id、平台 bot_id 和状态。
- 绿色开关严格表示已绑定，灰色严格表示未绑定。
- 关闭绑定不删除平台映射，机器人离线不自动解绑。
- token、完整 base64 和敏感 URL 不出现在面板或日志。
- TypeScript 检查、测试和构建全部通过，并完成真实 QQBot 多账号验证。
