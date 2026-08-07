# gscore-adapter

Miao-Yunzai / TRSS-Yunzai 的**早柚核心（gsuid_core）双向适配器**。

把云崽接到早柚核心，让核心侧的插件（原神、星铁等）通过云崽已有的机器人账号收发消息。支持双向：云崽主动连核心（client），或核心主动连云崽（server）。

---

## 特性

- **两个方向都支持**，可单开也可同开
  - `client`：云崽作为 ws 客户端连接核心，即文档 [AdapterList](https://docs.sayu-bot.com/LinkBots/AdapterList.html) 描述的连接器形态
  - `server`：云崽作为 ws 服务端等核心来连，等价于框架自带的 `plugins/adapter/GSUIDCore.js`。核心送来的 `bot_self_id` 会被注册成一个虚拟 Bot，云崽本地无需登录任何账号
- **多连接**：client 方向可同时连多个核心，各自独立重连、独立账号绑定
- **消息段双向转换**：文本 / 图片 / 语音 / 视频 / 文件 / @ / 引用 / 按钮 / 合并转发 / markdown
- **非消息事件**：入群、退群、戳一戳上报为核心的 meta event
- **控制指令**：核心下发的撤回消息、禁言用户
- **命令式管理**：`#早柚添加连接` 等指令直接改配置并热启动，不必手改 yaml 重启
- **回环防护**：四层拦截，避免 `核心 → 云崽 → 核心` 死循环
- **路由冲突检测**：与 `GSUIDCore.js` 抢同一 ws 路由时主动报错而非静默双收

---

## 安装

放到 `plugins/gscore-adapter/`，然后**编译一次**：

```bash
cd plugins/gscore-adapter
pnpm install   # 安装 typescript 等开发依赖
pnpm build     # src/*.ts -> lib/*.js
```

再重启云崽。首次运行会自动把 `resources/config/default_config.yaml` 复制成 `config/config.yaml`。

> 源码是 TypeScript，放在 `src/`；运行时加载的是编译产物 `lib/`（已在 `.gitignore` 中，不入库）。
> **改完 `src/` 必须重新 `pnpm build`**，否则改动不会生效。开发时可用 `pnpm build:watch` 自动增量编译。

**改 `config/config.yaml`，别改 `resources/config/default_config.yaml`**（后者是出厂默认值，升级会被覆盖）。`config/` 已在 `.gitignore` 中，你的改动不会入库。配置只需写想改的项，其余自动继承默认值。

装了[锅巴](https://github.com/guoba-yunzai/guoba-plugin)的话也可以在面板里改，无需手动编辑 yaml。

运行时依赖 `ws`、`yaml`、`chokidar`，均为云崽自带，无需额外安装。

---

## 快速开始

最常见的场景 —— 本机已跑着早柚核心（默认 8765 端口），想让云崽连过去：

```yaml
# config/config.yaml
mode: client
client:
  connections:
    - name: gsuid_core
      url: ws://127.0.0.1:8765/ws/Yunzai
      token: ""
      enable: true
```

重启后 `#早柚状态` 应显示「已连接」。

也可以不碰配置文件，直接发指令：

```
#早柚添加连接 127.0.0.1:8765
```

地址只填 `host:port` 时会自动补全为 `/ws/Yunzai`。

### 反过来：让核心连云崽

```yaml
# config/config.yaml
mode: server
server:
  path: GsCore
```

核心侧填 `ws://<云崽IP>:2536/GsCore`（端口取自云崽 `config/config/server.yaml`）。详见下方 [server](#server) 一节 —— 两个方向的账号模型不同，不是单纯的方向反转。

---

## 配置说明

### mode

| 值 | 含义 |
|---|---|
| `client` | 云崽主动连核心（**默认**） |
| `server` | 核心主动连云崽 |
| `both` | 同时开启 |
| `off` | 全部关闭 |

> ⚠️ `both` 模式下，两个方向不要互相指向自己，否则消息死循环。插件会在地址指向本机端口时打 warn 提醒，但拦不住所有情况。

### client

```yaml
client:
  heartbeat: 30           # ws ping 间隔（秒），0 关闭
  heartbeat_timeout: 90   # 超时无 pong 判定掉线，0 关闭
  connections:
    - name: gsuid_core                        # 连接名，仅用于日志和 #早柚状态
      url: ws://127.0.0.1:8765/ws/Yunzai      # 路由 /ws/{bot_id}，bot_id 可自定义
      token: ""                               # 核心以 ?token= 查询参数接收
      bot_id: ""                              # 上报的平台标识，留空则按 bot_id_map 推断
      enable: true
      reconnect_interval: 5                   # 重连间隔（秒）
      max_reconnect_attempts: 0               # <=0 无限重连
      bind: []                                # 只转发这些 self_id，留空为全部
      exclude: []                             # 排除这些 self_id（优先级高于 bind）
```

`bind` / `exclude` 用于多账号场景：让 A 号走核心 1、B 号走核心 2。

### server

```yaml
server:
  path: GsCore        # ws 路由，最终地址 ws://<云崽地址>/GsCore
  id: GsCore
  name: 早柚核心
  on_conflict: abort  # 路由被占用时：abort 放弃注册（推荐）/ force 强行注册
```

`path` 默认值刻意与框架自带的 `GSUIDCore` 区分。若两者路由相同，云崽的 `Bot.wsf[path]` 会挂两个处理器，**同一条消息被处理两次且完全静默无报错** —— `on_conflict: abort` 就是为了让这种情况直接报错。`force` 仅调试用。

#### 怎么用

云崽的 ws 服务端口取自 `config/config/server.yaml` 的 `port`（默认 **2536**）。所以核心侧要填的地址是：

```
ws://<云崽IP>:2536/GsCore
```

路径就是上面配的 `server.path`，**没有 `/ws/` 前缀**（那是 client 方向连核心时才有的路由格式，两边不一样，容易混）。

在核心侧把这个地址配成它要连的适配器，核心会主动连过来。连上后云崽日志出现 `早柚核心(GsCore) 已连接`，`#早柚状态` 里会显示 `服务端：/GsCore 已监听`。

#### 与 client 方向的区别

不只是「谁先发起连接」的差别，两者的**账号模型是反的**：

| | client | server |
|---|---|---|
| 谁是 ws 发起方 | 云崽 | 核心 |
| 消息用哪个账号收发 | 云崽已有的真实账号（QQ 等） | 核心侧送来的 `bot_self_id`，注册成一个**虚拟 Bot** |
| `Bot.adapter` | 不注册 | 注册一个适配器实例 |
| 适用场景 | 想让核心插件借用云崽的 QQ 号 | 核心自己管着账号，云崽只做消息中转/渲染 |

server 方向下，`makeBot()` 会用核心送来的 `bot_self_id` 在 `Bot[self_id]` 上凭空建一个 Bot 实例（带 `pickFriend`/`pickGroup`/`fl`/`gl`/`gml`），云崽本地**不需要登录任何账号**也能跑。这就是它和 client 的根本不同。

#### 复合 group_id

核心的 `user_type` 有 `group`/`direct`/`channel`/`sub_channel` 四种，但云崽只有「群/私聊」二元。为了不丢频道信息，收消息时 `group_id` 被拼成 `${user_type}-${真实id}`（如 `group-12345`、`channel-67890`），发送时由 `sendGroupMsg` 按已知 `user_type` 前缀拆回。

**副作用**：你在云崽侧看到的群号会带前缀。若有插件硬编码比对群号，需注意这点。

#### 回环防护

server 方向收到的每个事件都会打上 `gscore_origin: <适配器id>` 标记（[adapter.ts:184](src/modules/server/adapter.ts#L184)），client 方向据此拒绝把它再发回核心。`both` 模式下这是防死循环的关键一环 —— 别去掉它。

### filter（仅影响 client 方向的上报）

```yaml
filter:
  only_reply_at: false    # 仅在被 @ 或带前缀时才上报群消息
  prefix: ["#", "*"]      # only_reply_at 为 true 时，这些前缀也视为触发
  block_prefix: []        # 命中即不上报（避免与本地插件抢命令）
  block_include: []       # 包含任意一项就丢弃
  white_group: []         # 只上报这些群，留空为全部
  black_group: []
  black_user: []
```

黑白名单同时作用于消息和 meta 事件；`only_reply_at` / `block_prefix` / `block_include` 基于文本，只作用于消息。

### bot_id_map

把云崽的适配器 id 映射成核心认识的平台标识：

```yaml
bot_id_map:
  ICQQ: onebot
  OneBotv11: onebot
  QQBot: qqgroup
  Satori: onebot
  default: onebot     # 兜底
```

优先级：连接自身的 `bot_id` > `self_id` 精确匹配 > 适配器 id > `default`。

### 其它

| 项 | 默认 | 说明 |
|---|---|---|
| `media_max_size` | 10 MiB | 媒体转 base64 上限，超过改用 `link://` 外链 |
| `file_max_size` | 50 MiB | file 段必须内联 base64（协议无 URL 形式），超过直接拒发 |
| `link_expire` | 300000 | 外链有效期（毫秒）。云崽默认只留 1 分钟，核心拉取慢会拿到超时占位图 |
| `log_truncate` | true | 日志中截断 base64 |
| `notify_master` | false | 断线/重连通知主人 |

> ⚠️ `link://` 用的是云崽自身的文件服务地址（`cfg.server.url`）。**若核心跑在 Docker 里，`127.0.0.1` 解析不到**，需要把 `server.url` 配成核心可达的地址。

---

## 指令

全部限主人使用，`#` 可省略。

| 指令 | 说明 |
|---|---|
| `#早柚状态` | 查看运行模式、服务端监听、各连接状态 |
| `#早柚重连` | 重连全部客户端连接 |
| `#早柚连接列表` | 列出所有连接及其实时状态 |
| `#早柚添加连接 <地址> [name=x] [token=x] [bot_id=x]` | 添加并立即启动 |
| `#早柚删除连接 <名字或序号>` | |
| `#早柚开启连接 <名字或序号>` | |
| `#早柚关闭连接 <名字或序号>` | |
| `#早柚设置 <key>=<value>` | 可设 `mode` / `only_reply_at` / `notify_master` / `media_max_size` |
| `#早柚帮助` | |

示例：

```
#早柚添加连接 ws://127.0.0.1:8765/ws/Yunzai
#早柚添加连接 127.0.0.1:8765 name=主核心 token=abc
#早柚删除连接 2
#早柚设置 mode=both
```

改配置会**保留 yaml 原有注释**。`mode` 的变更需重启生效，其余即时生效。

---

## 支持的消息段

| 云崽 | 早柚核心 | 方向 |
|---|---|---|
| `text` | `text` | 双向 |
| `image` | `image`（+ `image_size`） | 双向 |
| `record` | `record` | 双向 |
| `video` | `video` | 双向 |
| `file` | `file` | 双向 |
| `at` | `at` | 双向 |
| `reply` | `reply` | 双向 |
| `button` | `buttons` | 双向 |
| `node`（合并转发） | `node` | 双向 |
| `markdown` | `markdown` | 双向 |

核心下发的 `log_*` 段（如 `log_INFO`、`log_WARNING`）会被转成云崽日志打印，不作为消息发出；同一包里若还有真实内容，内容照常发送，只有整包纯日志时才完全跳过。

> 核心的 `Button` 结构中权限字段拼写为 **`permisson`**（少一个 i），是核心源码即如此，非笔误。转换层照此对齐。

---

## 非消息事件（meta events）

client 方向会把以下事件上报为核心的 meta event：

| 云崽 notice | 上报段 type |
|---|---|
| `notice_type=group`, `sub_type=increase` | `meta-user_join_group` |
| `notice_type=group`, `sub_type=decrease` | `meta-user_exit_group` |
| `sub_type=poke`（群聊或私聊） | `meta-poke` |

其余事件（禁言、头衔、撤回等）静默丢弃，只打 debug 日志。

**注意事件形状**：本 fork 的 `plugins/adapter/OneBotv11.js:1330-1333` 会把 `notice_type` 按 `_` 拆成两段（`group_increase` → `notice_type="group"` + `sub_type="increase"`），ICQQ 原生亦是此形状。所以匹配主键是 `sub_type` —— 写成 `notice_type === "group_increase"` 在本项目上**恒为 false**。

**已知限制**：OneBot 原生的 `approve`/`invite`/`kick`/`leave` 这个原始 `sub_type` 被上述拆分覆盖，取不回来，故上报的 data 中不含 `sub_type` 字段。要恢复需改框架适配器文件。

设计细节见 [docs/2026-08-07-gscore-meta-events-design.md](docs/2026-08-07-gscore-meta-events-design.md)。

---

## 协议要点

几处容易踩的坑，都已对核心源码核实：

- **上行必须是二进制帧**。核心 `core.py` 的读循环是 `await websocket.receive_bytes()`。文档 `CodeAdapter/Protocol.html` 称「均使用 text 类型」，**文档过时，以源码为准**。改成文本帧会让 Starlette 侧直接报错。
- **鉴权走 `?token=` 查询参数**，不是请求头。
- **meta 段的 type 带 `meta-` 前缀**，核心 `handler.py` 用 `startswith("meta-")` 识别，剥离前缀后作为 `meta_event_type`；data 为 dict 时整体存入 `meta_event_data`，并用其中的 `user_id`/`group_id` 回填顶层缺失字段供鉴权使用 —— 所以必需字段缺失时本插件宁可整包丢弃，不发残包。
- **撤回回执必须回**。核心 `bot.py` 的 `target_send` 在 `wait_recall` 时会等 `recall_message_id`（超时 10s），连续 3 次拿不到就把本适配器标记为 `_supports_recall=False` **永久关掉撤回能力**。故本插件即使发送失败也回一帧（id 给 `null`）。
- **核心下发的控制指令拼写是 `excute_` 不是 `execute_`**（`excute_delete_message` / `excute_ban_user`），核心源码即如此。

---

## 回环防护

`核心 → 云崽 → 核心` 的死循环有四层拦截：

1. 适配器回显自己发出的消息（`user_id === self_id` / `message_sent` / `sub_type === "self"`）
2. 来源 adapter id 是 `GSUIDCore` 或本插件的 server id
3. `e.gscore_origin` 标记（server.js 打的，比查 adapter 更精确，且在 `prepareEvent` 整体 no-op 时仍有效）
4. 内容指纹：本插件刚代发出去的内容在 10s 内被回显则丢弃

---

## 目录结构

```
gscore-adapter/
├── index.js                入口，仅 re-export lib/index.js（框架 loader 只认 index.js，故保持 .js）
├── guoba.support.js        锅巴面板入口，同理保持 .js
├── src/                    TypeScript 源码 —— 改这里
│   ├── index.ts            真正的入口：按 mode 拉起方向，并加载 apps
│   ├── dir.ts              路径常量（插件根、resources 等，全部由 import.meta.url 推出）
│   ├── types/              类型声明（纯类型，无运行时代码）
│   │   ├── Protocol.ts     早柚核心协议
│   │   └── Config.ts       插件配置
│   ├── constants/          状态文案、回环缓存上限、日志正则等常量
│   ├── config/             配置读写、热重载、bot_id 解析
│   ├── utils/              日志、媒体、消息判定等无状态工具
│   ├── modules/
│   │   ├── convert/        消息段双向转换（toGscore / toYunzai / buttons）
│   │   ├── notice/         meta event 转换（纯函数）
│   │   ├── client/         客户端方向：连接类、生命周期、钩子、回环缓存
│   │   ├── server/         服务端方向（Bot.adapter 实现，import 即注册）
│   │   ├── guoba/          锅巴配置面板
│   │   └── loader/         自动加载 apps
│   └── apps/
│       ├── status.ts       #早柚状态 / #早柚重连
│       └── admin.ts        连接增删改查
├── lib/                    编译产物，pnpm build 生成（已 gitignore，勿手改）
├── resources/
│   └── config/
│       └── default_config.yaml  出厂默认，勿改（升级会覆盖）
├── config/
│   └── config.yaml         用户配置（首次运行自动生成，整个目录已 gitignore）
├── tsconfig.json
├── eslint.config.js
├── docs/
└── test/                   测试跑的是 lib/ 下的编译产物，目录划分对齐 src/modules
```

源码内一律用 `@/` 路径别名（如 `@/config`、`@/modules/client`），编译时由 `tsc-alias` 改写成相对路径。所以 `pnpm build` 是 `tsc && tsc-alias` 两步，只跑 `tsc` 产物无法运行。

`outDir` 设为 `lib/`（而非常见的 `dist/`）纯属沿用习惯，不再有额外含义：框架配置由 `modules/client/framework.ts` 从 `YunzaiPath` 拼绝对路径动态 import，不像旧版那样依赖 `../../../lib/config/config.js` 这种与目录深度绑定的相对路径。

---

## 测试

纯 Node 脚本，自建全局桩，无测试框架。**测试跑的是 `lib/` 编译产物，所以要先 `pnpm build`。**

一次跑完全部（在插件目录下）：

```bash
pnpm test
```

或逐个运行。各套件都由自身位置（`import.meta.url`）推出插件目录，在哪执行都一样：

```bash
node test/modules/client.js       # 客户端方向端到端（含 1005 重连）
node test/modules/notice.js       # 非消息事件
node test/modules/server.js       # 服务端方向（含帧类型断言）
node test/apps/admin.js           # 管理指令（yaml 注释保留）
node test/integration/e2e.js      # 协议与消息段转换、回环防护
node test/integration/conflict.js # 路由冲突检测
```

当前 130 个断言全部通过。各文件末尾打印通过/失败数（`conflict.js` 只打 PASS 行，靠退出码表达结果），失败时退出码非 0。测试会起本地 mock ws 服务端，不连真实核心；`admin.js` 通过 `GSCORE_CONFIG` 环境变量把配置指向临时文件，不会动你的 `config/config.yaml`。

类型检查（不产出文件）：

```bash
pnpm run typecheck
```

> `modules/notice.js` 与 `modules/server.js` 都用 18766 端口，**别并行跑这两个**，逐个执行即可。

**验证边界**：测试证明发出的包符合已核实的协议规格，但不覆盖真实核心插件对 meta 事件名的接受情况 —— 核心用事件名匹配插件注册的触发器、自身不做校验，认不认 `user_join_group` 这三个名字取决于装了哪些核心插件。这部分只能连真实核心验证。

---

## 常见问题

**连不上，日志刷「连接错误」**
检查核心是否在跑、地址端口是否正确、`token` 是否匹配。路由要带 `/ws/{bot_id}`，只填 host:port 时插件会自动补 `/ws/Yunzai`。

**连上了但核心没反应**
核心侧看是否收到消息。若消息到了但插件没触发，多半是 `bot_id` 不对 —— 核心用它区分平台，改 `bot_id_map` 或连接的 `bot_id`。

**每条消息被处理两次**
`server` 方向的路由和框架自带的 `GSUIDCore.js` 撞了。`on_conflict: abort`（默认）会直接报错阻止；若你改成了 `force`，改回来，或者改 `server.path`，或者删掉 `plugins/adapter/GSUIDCore.js`。

**图片发不出去 / 核心拿到占位图**
核心跑在 Docker 里而 `link://` 外链指向 `127.0.0.1`。把云崽的 `cfg.server.url` 配成核心可达的地址；或调大 `media_max_size` 让图片走 base64 内联。

**撤回功能突然失效**
核心连续 3 次拿不到 `recall_message_id` 就会永久关掉撤回。重启核心恢复。若反复出现，说明当前适配器的 `sendMsg` 返回值里取不到 message_id。

---

## 相关

- [早柚核心 gsuid_core](https://github.com/Genshin-bots/gsuid_core)
- [适配器列表文档](https://docs.sayu-bot.com/LinkBots/AdapterList.html)

---

## 致谢

本插件借鉴了以下项目，在此致谢：

- **[XasYer/ws-plugin](https://github.com/XasYer/ws-plugin)**
  —— 早柚核心对接的主要对照实现，消息段转换与客户端连接的许多细节都参考自它。

- **[KaguyaJs/Yunzai-DF-Plugin](https://github.com/KaguyaJs/Yunzai-DF-Plugin)**
  —— 目录结构与工程约定的参考来源。`src/` 分层（`dir.ts` 路径常量、`types/`、`utils/`、
  `constants/`、`modules/`）、`@/*` 路径别名配合 `tsc-alias` 的构建方式、
  `index.js` 只做 re-export 的薄壳入口、`modules/loader/` 自动加载 apps，
  以及 `guoba.support.js` 转调 `lib/modules/guoba/` 的写法，均参照该项目。

- **[xiowo/napcat-plugin-gscore-adapter](https://github.com/xiowo/napcat-plugin-gscore-adapter)**
  —— 早柚核心适配的参考实现。

- **[Genshin-bots/gsuid_core](https://github.com/Genshin-bots/gsuid_core)**
  —— 协议细节以核心源码为准，包括 `Button.permisson` 的拼写、
  `excute_delete_message` / `excute_ban_user` 的命名、
  `/ws/{bot_id}` 用 `receive_bytes()` 只收二进制帧等。本插件照其实际行为对齐，
  而非按字面直觉修正。

- **TRSS-Yunzai 自带的 `plugins/adapter/GSUIDCore.js`**
  —— server 方向（核心主动连云崽）的行为基准。本插件的 `server.path`
  默认值刻意与其区分，并加了路由冲突检测，避免两者同时启用时同一条消息被静默处理两次。
