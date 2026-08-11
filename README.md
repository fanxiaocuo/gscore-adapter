# gscore-adapter

Miao-Yunzai / TRSS-Yunzai 的 **早柚核心（[gsuid_core](https://github.com/Genshin-bots/gsuid_core)）适配器**。

把云崽接到早柚核心，让核心侧的插件（原神、星铁等）通过云崽已有的机器人账号收发消息。云崽作为 ws 客户端主动连接核心，即 [AdapterList](https://docs.sayu-bot.com/LinkBots/AdapterList.html) 描述的连接器形态。

> **只有 client 一个方向。** 核心 `core.py` 只有入站路由 `@app.websocket("/ws/{bot_id}")`，全仓库没有任何出站连接——核心不会主动来连云崽。所以配置里只有一个总开关 `enable`。

## ✨ 特性

- **多连接**：同时连多个核心，各自独立重连、独立账号绑定
- **消息段双向转换**：文本 / 图片 / 语音 / 视频 / 文件 / @ / 引用 / 按钮 / 合并转发 / markdown
- **非消息事件**：入群、退群、戳一戳上报为核心的 meta event
- **命令式管理**：`#早柚添加连接` 等指令直接改配置并热启动，不必手改 yaml 重启
- **回环防护**：三层拦截，避免 `核心 → 云崽 → 核心` 死循环
- **双框架兼容**：TRSS / Miao 均可运行，**按能力探测**自动适配，改过名的 fork 也认得
- **大文件外链**：框架没有文件服务时自带一个（零依赖、零配置），大图不再发不出去
- **QQBot 引用回复**：官方 Bot 上带原消息 id 发送，回复挂到用户那条消息下，窗口记录落盘
- **出图**：状态 / 帮助 / 版本 / 更新日志四页，React SSR + Tailwind，深浅主题按时段切

## 🛠️ 安装

在 **Yunzai 根目录**（不是 `plugins/`）任选一条运行，两个分支都是编译好的 js，不用自己编译：

```bash
# 稳定版（推荐，发版后更新）
git clone --depth=1 --branch release https://github.com/fanxiaocuo/gscore-adapter.git ./plugins/gscore-adapter

# 预览版（跟 main 每次提交即时更新，没经过发版把关）
git clone --depth=1 --branch preview https://github.com/fanxiaocuo/gscore-adapter.git ./plugins/gscore-adapter
```

克隆完装一次运行时依赖，然后重启云崽：

```bash
cd plugins/gscore-adapter && pnpm install --prod
```

> 出图用 JSX 写版式，运行时要 `react` / `react-dom` / `lucide-react` / `@karinjs/template-react`，而产物分支不带 `node_modules`。不装会在第一个 import 处报 `Cannot find package 'react'`。`ws` / `yaml` / `chokidar` 是云崽自带的，不用管。

后续更新：`git pull && pnpm install --prod`

<details>
<summary>两版之间切换 / 我装的是哪个版本</summary>

不必重新克隆（`--depth=1` 的浅克隆也适用）：

```bash
cd plugins/gscore-adapter
git remote set-branches origin '*'
git fetch --depth=1 origin
git checkout -B preview origin/preview   # 换成 release 即切回稳定版
```

三个分支的版本号是同一个，光看版本号分不出来，所以 `#早柚版本` 按**本地分支**判定：`release` → 正式版，`preview` → 预览版，`main` → 开发版；识别不出分支（如下载 zip）时按预览版算，不会误报成正式版。

</details>

## 📝 配置

首次运行自动把 `resources/config/default_config.yaml` 复制成 `config/config.yaml`。**改后者**，前者是出厂默认值、升级会被覆盖。只需写想改的项，其余自动继承默认。装了[锅巴](https://github.com/guoba-yunzai/guoba-plugin)或 QQBot-Web-Adapter 也可以在面板里改，见下。

> **升级会自动补新增的配置项。** 插件更新后多出来的顶层配置，启动时会连同注释一起追加到你的 `config/config.yaml` 末尾，已有的项一律不动。补写前会先备份成 `config.yaml.bak`。

<details>
<summary>Web 面板</summary>

装了 **QQBot-Web-Adapter** 的话，它的控制台左侧会多一页「早柚核心适配器」🦊：连接的实时状态、今日/累计中转计数、连接的增删改与启停、全局设置，都能点着改。页面里用的是插件自己的图标；导航栏那颗只能是 emoji，宿主按纯文本渲染它。

面板不自带服务器，是挂在那个宿主上的插件页 —— 它开机时扫 `webadapter/index.js` 并注册页面与接口，接口由宿主统一加登录鉴权（非内网直接 403）。宿主没装时这部分就是死代码，不影响插件其余功能。

改配置走的是和指令同一条路径，**yaml 里的注释会保留**。一处例外要知道：心跳参数改了会自动重连一次。token 在面板上只显示「已配 token」，不回原值，留空保存表示不改动。

</details>

最常见的场景——本机已跑着核心（默认 8765），想让云崽连过去：

```yaml
# config/config.yaml
enable: true
client:
  connections:
    - name: gsuid_core
      url: ws://127.0.0.1:8765/ws/Yunzai
      token: ""
      enable: true
```

重启后 `#早柚状态` 应显示「已连接」。也可以不碰配置文件，直接发 `#早柚添加连接 127.0.0.1:8765`，只填 `host:port` 时会自动补全为 `/ws/Yunzai`。

| 配置项 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `enable` | 总开关，`false` 则完全不连核心（改完即时生效） | `true` |
| `client.heartbeat` | ws ping 间隔（秒），0 关闭 | `30` |
| `client.heartbeat_timeout` | 超时无 pong 判定掉线，0 关闭 | `90` |
| `client.connections[]` | 连接列表，见下 | — |
| `filter.report_private` | 是否上报私聊消息 | `true` |
| `filter.report_group` | 是否上报群消息（QQ 频道也算群） | `true` |
| `filter.report_meta` | 是否上报进群 / 退群 / 戳一戳 | `true` |
| `filter.only_reply_at` | 仅在被 @ 或带前缀时才上报群消息 | `false` |
| `bot_id_map` | 云崽适配器 → 核心平台标识，见下 | 见默认配置 |
| `media_max_size` | 媒体转 base64 上限，超过改用外链 | 10 MiB |
| `file_max_size` | file 段必须内联 base64，超过直接拒发 | 50 MiB |
| `link_expire` | 外链有效期（毫秒），也是内置文件服务的暂存时长 | `300000` |
| `file_server` | 内置文件服务，见下 | 开 |
| `upload_hook` | 自定义图床模块路径，内置服务的后备 | `""` |
| `log_truncate` | 日志中截断 base64 | `true` |
| `notify_master` | 断线 / 重连通知主人 | `false` |
| `update_check` | 定时检查插件更新 | 关 |

<details>
<summary>连接项的全部字段 · 多账号分流</summary>

```yaml
client:
  connections:
    - name: gsuid_core                        # 连接名，仅用于日志和 #早柚状态
      url: ws://127.0.0.1:8765/ws/Yunzai      # 路由 /ws/{bot_id}，bot_id 可自定义
      token: ""                               # 核心以 ?token= 查询参数接收
      bot_id: ""                              # 上报的平台标识，留空按 bot_id_map 推断
      enable: true
      reconnect_interval: 5                   # 重连间隔（秒）
      max_reconnect_attempts: 0               # <=0 无限重连
      bind: []                                # 只转发这些 self_id，留空为全部
      exclude: []                             # 排除这些 self_id（优先级高于 bind）
```

`bind` / `exclude` 用于多账号场景：让 A 号走核心 1、B 号走核心 2。

</details>

<details>
<summary>filter 的其余字段</summary>

```yaml
filter:
  prefix: ["#", "*"]      # only_reply_at 为 true 时，这些前缀也视为触发
  block_prefix: []        # 命中即不上报（避免与本地插件抢命令）
  block_include: []       # 包含任意一项就丢弃
  white_group: []         # 只上报这些群，留空为全部
  black_group: []
  black_user: []
```

三个 `report_*` 是最粗的一刀，默认全开：想「只让群消息过核心」时不必把所有私聊用户列进 `black_user`；核心侧没装消费 meta 事件的插件时，关掉 `report_meta` 能省下全部无用上报。

黑白名单同时作用于消息和 meta 事件；`only_reply_at` / `block_prefix` / `block_include` 基于文本，只作用于消息。

</details>

<details>
<summary>bot_id_map：为什么 id 和 name 都要查</summary>

```yaml
bot_id_map:
  QQ: onebot            # adapter.id 粗粒度，一个键覆盖多家
  QQBot: qqgroup
  ICQQ: onebot          # adapter.name 精确到具体适配器，优先级低于 id
  QQGuild: qqguild      # 频道特判
  default: onebot       # 兜底
```

优先级：连接自身的 `bot_id` > `self_id` 精确匹配 > 频道特判 > `adapter.id` > `adapter.name` > `default`。

框架填的 `adapter_id` 取自 `adapter.id`，而 ICQQ / OneBotv11 / OPQBot 三家的 `adapter.id` **全是 `QQ`**——只查 id 分不开它们，只查 name 则 `QQ` 这种粗粒度键写了没用。所以两者都查。

> 旧版默认配置把键写成了 `ICQQ` / `OneBotv11` / `OPQBot` / `ComWeChat`，那些是 `name` 不是 `id`，**实际从未命中**，只是恰好都该映射成 `onebot`、被 `default` 掩盖了。

**频道单独判**：QQBot-Plugin 用同一个 adapter 同时处理 QQ 群和频道（`adapter.id` 恒为 `QQBot`），按适配器查表分不开，而核心侧 `qqgroup` 与 `qqguild` 是两个平台。所以频道按事件形状识别（`group_id` 带 `qg_` 前缀）。

</details>

<details>
<summary>大文件外链：谁来发、怎么配</summary>

超过 `media_max_size` 的图片 / 语音 / 视频没法塞进 base64，需要一个 http 外链让核心来拉。降级顺序（按能力探测，不看框架名）：

```
Bot.fileToUrl  →  内置文件服务  →  upload_hook 图床  →  跳过并打 warn
```

TRSS 有 `Bot.fileToUrl`；Miao 没有，**插件会自己起一个内置文件服务**顶上，默认开启、不用配置。它用 `node:http` 实现（只是按 URL 返回一个 buffer，为此加 express 不划算，Miao 本身也没装）：

- 只在真的需要外链时才监听端口；TRSS 用户、以及从不发大图的用户，端口始终不开
- 文件只存在内存里，`link_expire` 到期自动清，不落盘
- 路径是 16 字节随机 token，不可枚举；核心取走即删
- 外链 host 取 **ws 连接的本机出口地址**而非写死 `127.0.0.1`——核心在 Docker 或另一台机器上时，`127.0.0.1` 指的是它自己

```yaml
file_server:
  enable: true      # 关掉则回落到 upload_hook
  port: 0           # 0 = 随机可用端口
  host: 0.0.0.0     # 核心常在 Docker/异机，只听 127.0.0.1 它连不进来
  public_host: ""   # 留空自动推断；推断不对时在这写死云崽的可达地址
  once: true        # 取走即删；核心侧会重试时设为 false
```

`upload_hook` 是后备（内置服务被关或端口起不来时用，内网穿透场景下它给的是公网地址）。指向一个模块，默认导出上传函数：

```js
// 相对云崽根目录或绝对路径，如 plugins/gscore-adapter/my-upload.js
export default async (buf, name) => "https://图床地址/xxx.png"
```

返回 http(s) 链接算成功；返回空或抛错则跳过该段并打日志。也可以直接调大 `media_max_size` 让大文件走 base64，代价是内存占用和单帧体积。

</details>

<details>
<summary>update_check 四项</summary>

`enable`（默认 `false`，关掉后 `#早柚检查更新` 仍可手动用）、`interval`（间隔分钟，默认 180，低于 30 按 30 处理）、`delay`（启动后多久做第一次检查，默认 5 分钟，错开启动高峰）、`notify`（发现新版本时私聊通知主人，默认 `true`）。改完即时生效，不用重启。

</details>

## ☄️ 指令

全部限主人使用，`#` 可省略。

| 指令 | 说明 |
| :--- | :--- |
| `#早柚状态` | 运行模式、各连接状态、中转计数（出图） |
| `#早柚连接列表` | 只列连接及其实时状态（出图） |
| `#早柚帮助` | 指令一览（出图） |
| `#早柚版本` | 插件版本、发布类型与本机运行环境快照（出图） |
| `#早柚更新日志` | 本地已有的提交记录（出图） |
| `#早柚重连` | 重连全部客户端连接 |
| `#早柚添加连接 <地址> [name=x] [token=x] [bot_id=x]` | 添加并立即启动 |
| `#早柚删除连接 <名字或序号>` | 也可 `开启` / `关闭` 连接 |
| `#早柚设置 <key>=<value>` | 可设 `enable` / `only_reply_at` / `report_*` / `notify_master` / `media_max_size` |
| `#早柚检查更新` | 拉一次远端，看有没有新提交 |
| `#早柚更新` | 拉取更新（`#早柚强制更新` 覆盖本地改动） |

出图需要框架的 puppeteer 可用，拉不起浏览器时自动降级成文本。改配置会**保留 yaml 原有注释**，且全部即时生效，不用重启云崽。

```
#早柚添加连接 127.0.0.1:8765 name=主核心 token=abc
#早柚设置 report_private=false
```

## ❓ 常见问题

<details>
<summary>连不上，日志刷「连接错误」</summary>

检查核心是否在跑、地址端口是否正确、`token` 是否匹配。路由要带 `/ws/{bot_id}`，只填 `host:port` 时插件会自动补 `/ws/Yunzai`。容器部署时别把地址写成容器内的 `127.0.0.1`。

</details>

<details>
<summary>连上了但核心没反应</summary>

核心侧看是否收到消息。若消息到了但插件没触发，多半是 `bot_id` 不对——核心用它区分平台，改 `bot_id_map` 或连接的 `bot_id`。

</details>

<details>
<summary>每条消息被处理两次</summary>

同一条消息被两个早柚核心适配器上报了。检查是否还装着框架自带的 `plugins/adapter/GSUIDCore.js` 或其他核心适配器（如 ws-plugin 的相关功能），只留一个。也可能是同一个核心配了多条连接，用 `#早柚连接列表` 查。

</details>

<details>
<summary>图片发不出去 / 核心拿到占位图</summary>

先看外链是谁发的。TRSS 走 `cfg.server.url`，核心在 Docker 里而它指向 `127.0.0.1` 就拉不到，改成核心可达的地址。

Miao 走内置文件服务，正常会自动取 ws 连接的出口地址；若跨网段 / 跨容器导致推断不对，用 `file_server.public_host` 写死云崽的可达地址，并确认 `file_server.host` 不是 `127.0.0.1`。日志里「内置文件服务启动失败」多半是端口被占，`port: 0` 交给系统分配即可。

实在不想折腾就调大 `media_max_size` 让图片走 base64 内联。

</details>

<details>
<summary>撤回功能突然失效</summary>

核心连续 3 次拿不到 `recall_message_id` 就会永久关掉撤回。重启核心恢复。若反复出现，说明当前适配器的 `sendMsg` 返回值里取不到 message_id。

</details>

<details>
<summary>按钮 / markdown 发出去没了</summary>

不是每个适配器都发得出这些段，而核心不知道下游是什么平台、会按 onebot 一律照发。Milky / OneBotv11 的 `makeMsg` 没有 button / markdown 分支，OPQBot 连 `video` / `file` / `reply` 都直接跳过。

本插件**不做降级**：适配器本来就会丢弃它们，再加一层「转成文本」只是用噪音替换静默丢弃，内容并没有真的送达。按钮目前基本只有 QQBot 在用，而 QQBot 原生支持。要按钮就用支持按钮的适配器。

</details>

## 🔌 协议与兼容

<details>
<summary>支持的消息段</summary>

`text` / `image`（+ `image_size`）/ `record` / `video` / `file` / `at` / `reply` / `button`（核心侧叫 `buttons`）/ `node`（合并转发）/ `markdown`，均双向。

核心下发的 `log_*` 段（如 `log_INFO`）会转成云崽日志打印，不作为消息发出；同一包里若还有真实内容则照常发送，只有整包纯日志时才完全跳过。

三处不直觉但有意为之的行为：

- **`@全体成员` 不上报。** 云崽用 `at` 段的 `qq: "all"` 表示它，而核心 `handler.py:754-762` 只把 at 分成「等于 `bot_self_id`」和「其它」，`"all"` 会落进后者被 append 进 `at_list`。而 `at_list` 是一串用户 id——`core_pm` 会把它直接 extend 进封禁参数，`handler.py:671` 又拿 `not at_list` 当「没 @ 具体某人」的判据，字面量混进去两边都会误判。所以这一段整体丢弃，正文照常上报。
- **引用消息只传 message_id**，不把被引用消息的图片一并抓下来。核心 `handler.py:773` 只做 `event.reply = data`，消费者拿它当**键**去查核心自己缓存的图（GenshinUID 的「原图」功能），额外注入 `image` 段会污染 `event.image` / `image_list`，让「引用了一张图」在插件眼里变成「刚发了一张图」。
- **引用回复在 ICQQ 上曾完全失效。** icqq 的 `e.source` 只有 `user_id` / `time` / `seq` / `rand`，**没有 `message_id`**；而框架的 `e.reply_id` 派生自 `reply` **段**，偏偏 icqq 的 parser 永不产出该段。两个常规字段双双为空，引用信息传不到核心且不报错。现由 `utils/reply.ts` 用 icqq 自己的 `genGroupMessageId` / `genDmMessageId` 从 `seq`/`rand`/`time` 反算——与当初上报时用的 id 必然一致，核心才查得到自己缓存的图。

> 核心 `Button` 结构中权限字段拼写为 **`permisson`**（少一个 i），是核心源码即如此，非笔误。转换层照此对齐。

</details>

<details>
<summary>非消息事件（meta events）</summary>

| 云崽 notice | 上报段 type |
| :--- | :--- |
| `notice_type=group`, `sub_type=increase` | `meta-user_join_group` |
| `notice_type=group`, `sub_type=decrease` | `meta-user_exit_group` |
| `sub_type=poke`（群聊或私聊） | `meta-poke` |

其余事件（禁言、头衔、撤回等）静默丢弃，只打 debug 日志。

**注意事件形状**：`plugins/adapter/OneBotv11.js:1330-1333` 会把 `notice_type` 按 `_` 拆成两段（`group_increase` → `notice_type="group"` + `sub_type="increase"`），ICQQ 原生亦是此形状。所以匹配主键是 `sub_type`——写成 `notice_type === "group_increase"` **恒为 false**。

**已知限制**：OneBot 原生的 `approve`/`invite`/`kick`/`leave` 这个原始 `sub_type` 被上述拆分覆盖、取不回来，故上报的 data 中不含 `sub_type` 字段。

</details>

<details>
<summary>协议要点（几处容易踩的坑，都已对核心源码核实）</summary>

- **上行必须是二进制帧。** 核心 `core.py` 的读循环是 `await websocket.receive_bytes()`。文档 `CodeAdapter/Protocol.html` 称「均使用 text 类型」，**文档过时，以源码为准**。改成文本帧会让 Starlette 侧直接报错。
- **鉴权走 `?token=` 查询参数**，不是请求头。
- **meta 段的 type 带 `meta-` 前缀**，核心用 `startswith("meta-")` 识别，剥离前缀后作为 `meta_event_type`；data 为 dict 时整体存入 `meta_event_data`，并用其中的 `user_id`/`group_id` 回填顶层缺失字段供鉴权使用——所以必需字段缺失时本插件宁可整包丢弃，不发残包。
- **撤回回执必须回。** 核心 `bot.py` 的 `target_send` 在 `wait_recall` 时会等 `recall_message_id`（超时 10s），连续 3 次拿不到就把本适配器标记为 `_supports_recall=False` **永久关掉撤回能力**。故本插件即使发送失败也回一帧（id 给 `null`）。
- **控制指令拼写是 `excute_` 不是 `execute_`**（`excute_delete_message` / `excute_ban_user`），核心源码即如此。

</details>

<details>
<summary>回环防护的三层拦截</summary>

1. 适配器回显自己发出的消息（`user_id === self_id` / `message_sent` / `sub_type === "self"`）
2. 来源 adapter id 是 `GSUIDCore` 或 `GsCore`，或事件带 `gscore_origin` 标记
3. 内容指纹：本插件刚代发出去的内容在 10s 内被回显则丢弃

第 2 层里 `gscore_origin` 由本插件已移除的 server 方向打过；现在保留是为了兼容**其他**早柚核心适配器（如框架自带的 `GSUIDCore.js`）打的同名标记——判断成本极低，挡不住的话就是死循环。

</details>

<details>
<summary>双框架兼容：按能力探测，不按框架名分支</summary>

两个框架的 `Bot` 对象差异不小：Miao 的 `lib/bot.js` 是 `class Yunzai extends Client`（ICQQ 的 Client），只有协议方法，TRSS 额外挂的那批工具函数它一个都没有。插件通过 [`src/utils/compat.ts`](src/utils/compat.ts) 逐个探测、缺谁补谁，所以改过名的 fork 也能正确识别。

| 能力 | TRSS | Miao | 处理 |
| :--- | :-: | :-: | :--- |
| `Bot.makeLog` | ✅ | ❌ | 垫片转 `global.logger` |
| `Bot.String` | ✅ | ❌ | 垫片（含循环引用处理） |
| `Bot.Buffer` | ✅ | ❌ | 垫片（保持三路返回语义） |
| `Bot.makeForwardMsg` | ✅ 标记对象 | ⚠️ 语义不同 | 按返回值形状判定，转走 Group/Friend 原生实现 |
| 主人配置 | `master` 分账号 + `masterQQ` | 仅 `masterQQ` | 按字段形状探测，两种结构都认 |
| `Bot.fileToUrl` | ✅ | ❌ | 无法垫片，改用内置文件服务顶上 |

</details>

## 🧑‍💻 参与开发

`main` 分支放 TypeScript 源码，跑之前必须自己编译：

```bash
git clone https://github.com/fanxiaocuo/gscore-adapter.git ./plugins/gscore-adapter
cd plugins/gscore-adapter
pnpm install
pnpm build       # src/*.ts -> lib/*.js，再出 Tailwind CSS
```

运行时加载的是 `lib/`（不入库），**改完 `src/` 必须重新 build**，或用 `pnpm build:watch` 增量编译。`pnpm dev` 起长驻服务器，改完存盘自动重建并刷新浏览器。

| 分支 | 内容 |
| :--- | :--- |
| `main` | TypeScript 源码，外加 `docs/` 里的文档站源码 |
| `release` | 插件产物，稳定版，跟发版 |
| `preview` | 插件产物，预览版，跟 main 每次提交 |
| `gh-pages` | 文档站产物，由 Actions 自动发布，勿手改 |

<details>
<summary>文档站</summary>

源码在 `docs/`（VitePress），产物由 `.github/workflows/docs.yml` 发到 `gh-pages`，站点是 <https://fanxiaocuo.github.io/gscore-adapter/>。

```bash
pnpm docs:dev       # http://localhost:5173/gscore-adapter/
pnpm docs:build     # 产物在 docs/.vitepress/dist
pnpm docs:preview   # 预览构建产物
```

依赖是**独立**的一份（`docs/package.json`），第一次跑先 `pnpm --dir docs install`。插件本身的 `pnpm install` 不会把 vitepress 拖下来。

死链会让构建失败（`ignoreDeadLinks: false`），站内链接写错在 CI 就会拦下。版式规范见 `docs/.vitepress/DESIGN.md`。

只改 `docs/` 不会触发发版（`release.yml` 排除了该路径），也不会重新出插件产物。

</details>

<details>
<summary>目录结构与构建链</summary>

```
src/
├── index.ts        真正的入口：按 enable 拉起连接，并加载 apps
├── dir.ts          路径常量（全部由 import.meta.url 推出）
├── types/          协议与配置的类型声明（无运行时代码）
├── constants/      状态文案、回环缓存上限、日志正则
├── config/         配置读写、热重载、bot_id 解析
├── utils/          日志 / 媒体 / 会话判定 / 引用 id 反算 / 发送结果判定 / 能力探测
├── modules/
│   ├── convert/    消息段双向转换      ├── client/    连接类、生命周期、回环缓存
│   ├── notice/     meta event 转换     ├── render/    出图
│   ├── stats/      中转计数            ├── update/    检查更新与拉取
│   ├── passive/    QQBot 被动回复窗口  ├── guoba/     锅巴面板
│   ├── conflict/   适配器冲突检测      ├── webadapter/ web 面板
│   └── loader/     apps 静态导入表
└── apps/           status / admin / update 三组指令
```

产物由 `tsc` **逐文件**输出到 `lib/`，镜像 `src/` 的层级，不打包（`tsc-alias` 负责把 `@/` 别名与目录 import 补成完整路径）。不用打包器的理由：`sqlite3` 是原生模块，打进去会让降级分支永远走失败路径；`ws` / `yaml` / `chokidar` 复用宿主那一份；而单文件产物既不导出组件供测试 import，import 它还会触发插件的全部副作用。

产物必须落在 `lib/index.js` 这一层——框架 loader 只认 `plugins/<name>/index.js`，根目录 `index.js` 只是 `export * from "./lib/index.js"`；`src/dir.ts` 也靠 `import.meta.url` 上跳一级定位插件根。

`build:css` 把 `src/modules/render/styles/tailwind.css` 编译到 `resources/template/css/`（不入库）。它扫的是 **`lib/` 下的组件产物**，所以必须排在 `tsc` 之后。

</details>

<details>
<summary>出图那条链</summary>

```
React 组件 → @karinjs/template-react 的 createRenderer / HtmlWrapper
          → 整页 HTML 写到 temp/html/ → 本体 screenshot() 打开并截图
```

外壳与 SSR 写盘直接用 `@karinjs/template-react`（kkk 那条渲染路径本身）。它按「目录即路由」约定扫 `.ktr/`，本插件绕过了这层，直接给 `createRenderer` 一张 route → 组件的表。

仍然走本体 `screenshot()` 而不自己驱动 puppeteer——它还管着浏览器生命周期、超时强制重启、每 N 次渲染主动重启、分片截图的 viewport 计算。三个坑：

- **CSS 必须内联**，不能 `<link>`。puppeteer 用 `file://` 打开临时目录下的 HTML，相对路径的基准是那个目录，链不到插件里的文件。
- **高清用 `zoom` 而非 `transform: scale`**。本体截的是 `#container` 的 boundingBox，`scale` 不改布局盒尺寸，图会被裁。
- **本体按路径缓存模板且永不失效**（`lib/renderer/Renderer.js`）。取「每页固定文件名 + 渲染前清掉该键」：路径固定则 watcher 不会无限增长，清缓存则每次读到新内容。两者缺一都会静默出错——要么图永远不更新，要么 watcher 泄漏。

</details>

<details>
<summary>测试</summary>

> `test/` 在 `.gitignore` 里，克隆下来的仓库没有它。CI 因此没有测试步骤，把关的是 `typecheck` / `lint` / `build` 三道加产物完整性自检。

```bash
node test/modules/client.js       # 连接端到端（含 1005 重连）
node test/modules/notice.js       # 非消息事件
node test/apps/admin.js           # 管理指令（yaml 注释保留）
node test/integration/e2e.js      # 协议与消息段转换、回环防护
pnpm test                         # 渲染层，node:test，直读 src/ 需 --import tsx
```

前四套跑的是 `lib/` 编译产物，先 `pnpm build`。它们起本地 mock ws 服务端，不连真实核心；`admin.js` 用 `GSCORE_CONFIG` 把配置指向临时文件，不会动你的 `config/config.yaml`。

改版式不靠肉眼验，靠逐元素比对 computed style：`pnpm preview` 出静态 HTML，`test/geom.mjs` 抓每个元素的 boundingBox + computed style，`test/geomdiff.mjs` 逐项比对（忽略 `cls` 字段，类名本来就该变）。Tailwind 迁移与 ktr 迁移都是这么验的，零差异。

**验证边界**：测试证明发出的包符合已核实的协议规格，但不覆盖真实核心插件对 meta 事件名的接受情况——核心用事件名匹配插件注册的触发器、自身不做校验，认不认那三个名字取决于装了哪些核心插件。这部分只能连真实核心验证。

</details>

## 🤝 致谢

- **[XasYer/ws-plugin](https://github.com/XasYer/ws-plugin)** —— 早柚核心对接的主要对照实现，消息段转换与客户端连接的许多细节参考自它。
- **[KaguyaJs/Yunzai-DF-Plugin](https://github.com/KaguyaJs/Yunzai-DF-Plugin)** —— 目录结构与工程约定的参考来源：`src/` 分层、`@/*` 路径别名、`index.js` 只做 re-export 的薄壳入口、`guoba.support.js` 转调 `lib/modules/guoba/`，以及 `tsc` + `tsc-alias` 逐文件输出、产物镜像 `src/` 的构建链。一处分了道：`modules/loader/` 用静态导入表而非扫目录动态 import——忘了注册在编译期就报错，而扫目录扫空只是静默地一个功能都不注册。
- **[xiowo/napcat-plugin-gscore-adapter](https://github.com/xiowo/napcat-plugin-gscore-adapter)**（MIT）—— 早柚核心适配的参考实现。
- **[xiowo/yunzai-gscore-adapter](https://github.com/xiowo/yunzai-gscore-adapter)**（MIT）—— 同作者的云崽版。三处实现参照了它：`bot_id_map` 补上 `QQGuild` / `KOOK` / `Telegram` / `Discord` 四个平台标识（对照其 `ADAPTER_BOT_ID_MAP`）、`filter.report_*` 三个上报开关（对照其 `DEFAULT_CONFIG` 的 `reportPrivate` 等）、以及 QQBot 带原消息 id 回复的思路（对照其 `QQBOT_MESSAGE_ID_TTL` / `QQBOT_MESSAGE_ID_KEY_PREFIX`，单 id 回满 5 次即降级则对照其 `QQBOT_MESSAGE_ID_REPLY_LIMIT`）。落盘换成了 sqlite——本插件已为中转计数开了 sqlite，不必只为几行短命数据再引一个 redis 连接。
- **[xiaoye12123/ws-plugin](https://gitee.com/xiaoye12123/ws-plugin)**（小叶，GPL-3.0）—— 多适配器 bot 查找与发送结果判定的思路来源。`utils/send.ts` 区分「抛错派」与「返回错误对象派」适配器：只 `await` 不看返回值会把 Milky / OneBot 那种「失败也不抛错」的情况误记成一次成功中转。
  > 该思路是从 [smoadrareun 的 fork](https://gitee.com/smoadrareun/ws-plugin) 读到的，但那个 fork 把上游作者信息全部抹除（`package.json`、`guoba.support.js`、CHANGELOG、README 均改为自己），git 历史也是压平重提交。GPL-3.0 要求保留作者署名，故此处按实际来源致谢原作者 **xiaoye12123**。
- **[ikenxuan/karin-plugin-kkk](https://github.com/ikenxuan/karin-plugin-kkk)** —— 图片版式与设计 token 的参考来源。`modules/render/` 的画布结构（弥散光背景、概览统计条、分组卡片、页脚角标）照其 React 组件的思路重写，`#早柚版本` 也是对照它的 `#kkk版本` 做的。样式管线也对齐了：两边都用 Tailwind v4 在构建期扫 JSX 产出一份 CSS，且都是运行时 SSR。
- **[KarinJS/template-react](https://github.com/KarinJS/template-react)** —— 出图的整页 HTML 外壳与 SSR 写盘直接用它的 `createRenderer` / `HtmlWrapper`，即 kkk 那条渲染路径本身。
- **[Genshin-bots/gsuid_core](https://github.com/Genshin-bots/gsuid_core)** —— 协议细节以核心源码为准，包括 `Button.permisson` 的拼写、`excute_*` 的命名、`/ws/{bot_id}` 只收二进制帧等。本插件照其实际行为对齐，而非按字面直觉修正。
- **[TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)** 与 **[Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai)** —— 运行本插件的两个框架。前者的 `Bot.makeLog` / `Bot.Buffer` / `Bot.fileToUrl` 等工具方法是 `utils/compat.ts` 里能力探测的对照物；后者没有那批方法，兼容层与内置文件服务正是为它准备的。
- **各协议适配器** —— 适配器之间的差异是能力探测与降级逻辑的全部依据：[icqq](https://github.com/icqqjs/icqq)（`e.source` 无 `message_id`；`data:` URI 在 `Image` 构造器里不被识别）、[QQBot-Plugin](https://github.com/TimeRainStarSky/Yunzai-QQBot-Plugin)（频道消息 `message_type` 标成 `group`、靠 `qg_` 前缀识别；被动回复所需的四条发送路径）、[Milky](https://milky.ntqqrev.org/)（`OutgoingSegment` 无 button / markdown，失败时返回错误对象而不抛错）。

## 📄 许可证

[GPL-3.0-only](LICENSE)。仅供学习交流使用，禁止用于任何违法用途；项目内资源来源于网络，如有侵权请联系删除。

> 相关：[早柚核心 gsuid_core](https://github.com/Genshin-bots/gsuid_core) · [适配器列表文档](https://docs.sayu-bot.com/LinkBots/AdapterList.html)

