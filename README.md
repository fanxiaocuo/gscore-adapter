# gscore-adapter

Miao-Yunzai / TRSS-Yunzai 的**早柚核心（gsuid_core）适配器**。

把云崽接到早柚核心，让核心侧的插件（原神、星铁等）通过云崽已有的机器人账号收发消息。

云崽作为 ws 客户端主动连接核心，即文档 [AdapterList](https://docs.sayu-bot.com/LinkBots/AdapterList.html) 描述的连接器形态。

> **只有 client 一个方向**：早柚核心 `core.py` 只有入站路由 `@app.websocket("/ws/{bot_id}")`，
> 全仓库没有任何出站连接——**核心不会主动来连云崽**。本插件曾实现过的 server 方向已移除，
> 框架自带的 `plugins/adapter/GSUIDCore.js` 是为旧版核心准备的，同样不适用于当前版本。
> 老配置写着 `mode: server` / `both` 不会报错，会按 `client` 运行并提示改配置。

---

## 特性

- **多连接**：可同时连多个核心，各自独立重连、独立账号绑定
- **消息段双向转换**：文本 / 图片 / 语音 / 视频 / 文件 / @ / 引用 / 按钮 / 合并转发 / markdown
- **非消息事件**：入群、退群、戳一戳上报为核心的 meta event
- **控制指令**：核心下发的撤回消息、禁言用户
- **命令式管理**：`#早柚添加连接` 等指令直接改配置并热启动，不必手改 yaml 重启
- **插件自更新**：`#早柚更新`，转调本体更新逻辑，自动重装依赖并重启
- **回环防护**：三层拦截，避免 `核心 → 云崽 → 核心` 死循环

---

## 使用范围

本插件面向个人、朋友间的小范围自用，**请勿用于商业用途**，也不建议部署在大规模对外服务上。

这是作者的意愿声明，不是许可证条款——代码本身按 [GPL-3.0](LICENSE) 授权，
该协议在法律上并不禁止商业使用。请尊重上述意愿。

---

## 安装

仓库分三个分支，**大多数人用 `release`**：

| 分支 | 内容 | 适合 |
| --- | --- | --- |
| `release` | 编译好的 js，随发版更新 | 日常使用（推荐） |
| `preview` | 编译好的 js，跟 `main` 每次提交 | 想尝鲜最新改动 |
| `main` | TypeScript 源码 | 参与开发 |

### 直接使用（release / preview）

```bash
cd plugins
git clone -b release https://github.com/fanxiaocuo/gscore-adapter.git
```

克隆下来就能跑，**不需要 `pnpm install`，也不需要编译**。重启云崽即可。

后续更新：

```bash
cd plugins/gscore-adapter && git pull
```

### 参与开发（main）

```bash
cd plugins
git clone https://github.com/fanxiaocuo/gscore-adapter.git
cd gscore-adapter
pnpm install   # typescript 等开发依赖
pnpm build     # src/*.ts -> lib/*.js
```

> 运行时加载的是编译产物 `lib/`（不入库）。
> **改完 `src/` 必须重新 `pnpm build`**，否则改动不会生效。
> 开发时可用 `pnpm build:watch` 自动增量编译。

### 配置

首次运行会自动把 `resources/config/default_config.yaml` 复制成 `config/config.yaml`。

**改 `config/config.yaml`，别改 `resources/config/default_config.yaml`**（后者是出厂默认值，升级会被覆盖）。`config/` 已在 `.gitignore` 中，你的改动不会入库，升级也不会被覆盖。配置只需写想改的项，其余自动继承默认值。

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

---

## 配置说明

### mode

| 值 | 含义 |
|---|---|
| `client` | 云崽主动连核心（**默认**） |
| `off` | 关闭 |

> `server` / `both` 已移除，见开头说明。

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

### filter（影响上报到核心的消息）

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
#早柚设置 only_reply_at=true
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

**`@全体成员` 不上报**。云崽用 `at` 段的 `qq: "all"` 表示它，早柚核心没有这个概念：`handler.py:754-762` 只把 at 分成「等于 `bot_self_id`」和「其它」，`"all"` 会落进后者被 append 进 `at_list`。而 `at_list` 是一串用户 id —— `core_pm` 会把它直接 extend 进封禁参数，`handler.py:671` 又拿 `not at_list` 当「没 @ 具体某人」的判据，字面量混进去两边都会误判。所以这一段整体丢弃，同条消息的正文照常上报。

**引用消息只传 message_id**，不会把被引用消息的图片一并抓下来发过去。核心 `handler.py:773` 只做 `event.reply = data`，消费者拿它当**键**去查核心自己缓存的图片（GenshinUID 的「原图」功能），额外注入 `image` 段会污染 `event.image` / `image_list`，让「引用了一张图」在插件眼里变成「刚发了一张图」。

---

## 非消息事件（meta events）

以下事件会上报为核心的 meta event：

| 云崽 notice | 上报段 type |
|---|---|
| `notice_type=group`, `sub_type=increase` | `meta-user_join_group` |
| `notice_type=group`, `sub_type=decrease` | `meta-user_exit_group` |
| `sub_type=poke`（群聊或私聊） | `meta-poke` |

其余事件（禁言、头衔、撤回等）静默丢弃，只打 debug 日志。

**注意事件形状**：本 fork 的 `plugins/adapter/OneBotv11.js:1330-1333` 会把 `notice_type` 按 `_` 拆成两段（`group_increase` → `notice_type="group"` + `sub_type="increase"`），ICQQ 原生亦是此形状。所以匹配主键是 `sub_type` —— 写成 `notice_type === "group_increase"` 在本项目上**恒为 false**。

**已知限制**：OneBot 原生的 `approve`/`invite`/`kick`/`leave` 这个原始 `sub_type` 被上述拆分覆盖，取不回来，故上报的 data 中不含 `sub_type` 字段。要恢复需改框架适配器文件。

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

`核心 → 云崽 → 核心` 的死循环有三层拦截：

1. 适配器回显自己发出的消息（`user_id === self_id` / `message_sent` / `sub_type === "self"`）
2. 来源 adapter id 是 `GSUIDCore` 或 `GsCore`，或事件带 `gscore_origin` 标记
3. 内容指纹：本插件刚代发出去的内容在 10s 内被回显则丢弃

第 2 层里 `gscore_origin` 由本插件已移除的 server 方向打过；现在保留是为了兼容**其他**早柚核心适配器（如框架自带的 `GSUIDCore.js`）打的同名标记 —— 判断成本极低，挡不住的话就是死循环。

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
│   │   ├── client/         连接类、生命周期、钩子、回环缓存
│   │   ├── guoba/          锅巴配置面板
│   │   └── loader/         自动加载 apps
│   └── apps/
│       ├── status.ts       #早柚状态 / #早柚重连
│       ├── admin.ts        连接增删改查
│       └── update.ts       #早柚更新，转调本体更新插件
├── lib/                    编译产物，pnpm build 生成（已 gitignore，勿手改）
├── resources/
│   └── config/
│       └── default_config.yaml  出厂默认，勿改（升级会覆盖）
├── config/
│   └── config.yaml         用户配置（首次运行自动生成，整个目录已 gitignore）
├── tsconfig.json
└── eslint.config.js

另有 docs/（开发笔记）与 test/（测试，目录划分对齐 src/modules）仅存于本地，
两者都在 .gitignore 里，克隆下来的仓库没有它们。
```

源码内一律用 `@/` 路径别名（如 `@/config`、`@/modules/client`），编译时由 `tsc-alias` 改写成相对路径。所以 `pnpm build` 是 `tsc && tsc-alias` 两步，只跑 `tsc` 产物无法运行。

`outDir` 设为 `lib/`（而非常见的 `dist/`）纯属沿用习惯，不再有额外含义：框架配置由 `modules/client/framework.ts` 从 `YunzaiPath` 拼绝对路径动态 import，不像旧版那样依赖 `../../../lib/config/config.js` 这种与目录深度绑定的相对路径。

---

## 测试

> **测试不入库**（`test/` 在 `.gitignore` 里，同 `docs/`）。克隆下来的仓库没有 `test/`，
> 下面的内容面向手上有这份目录的开发者。CI 也因此没有测试步骤，
> 把关的是 `typecheck` / `lint` / `build` 三道加产物完整性自检。

纯 Node 脚本，自建全局桩，无测试框架。**测试跑的是 `lib/` 编译产物，所以要先 `pnpm build`。**

一次跑完全部（在插件目录下）：

```bash
pnpm test
```

或逐个运行。各套件都由自身位置（`import.meta.url`）推出插件目录，在哪执行都一样：

```bash
node test/modules/client.js       # 连接端到端（含 1005 重连）
node test/modules/notice.js       # 非消息事件
node test/apps/admin.js           # 管理指令（yaml 注释保留）
node test/integration/e2e.js      # 协议与消息段转换、回环防护
```

当前 122 个断言全部通过。各文件末尾打印通过/失败数，失败时退出码非 0。测试会起本地 mock ws 服务端，不连真实核心；`admin.js` 通过 `GSCORE_CONFIG` 环境变量把配置指向临时文件，不会动你的 `config/config.yaml`。

类型检查（不产出文件）：

```bash
pnpm run typecheck
```

**验证边界**：测试证明发出的包符合已核实的协议规格，但不覆盖真实核心插件对 meta 事件名的接受情况 —— 核心用事件名匹配插件注册的触发器、自身不做校验，认不认 `user_join_group` 这三个名字取决于装了哪些核心插件。这部分只能连真实核心验证。

---

## 常见问题

**连不上，日志刷「连接错误」**
检查核心是否在跑、地址端口是否正确、`token` 是否匹配。路由要带 `/ws/{bot_id}`，只填 host:port 时插件会自动补 `/ws/Yunzai`。

**连上了但核心没反应**
核心侧看是否收到消息。若消息到了但插件没触发，多半是 `bot_id` 不对 —— 核心用它区分平台，改 `bot_id_map` 或连接的 `bot_id`。

**每条消息被处理两次**
同一条消息被两个早柚核心适配器上报了。检查是否还装着框架自带的 `plugins/adapter/GSUIDCore.js` 或其他核心适配器（如 ws-plugin 的相关功能），只留一个。也可能是同一个核心配了多条连接，用 `#早柚连接列表` 查。

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
  —— 消息段映射的早期参照。该适配器面向的是旧版核心（等核心来连云崽），
  与当前核心的实际行为已不一致，本插件未沿用其连接方向。
