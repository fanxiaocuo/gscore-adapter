# 配置

首次运行自动把 `resources/config/default_config.yaml` 复制成 `config/config.yaml`。**改后者**，前者是出厂默认值、升级会被覆盖。只需写想改的项，其余自动继承默认。

::: tip 升级会自动补新增的配置项
插件更新后多出来的顶层配置，启动时会连同注释一起追加到你的 `config/config.yaml`，已有的项一律不动——包括你写的连接地址，插件不会改写它。首次改动你的文件之前会备份一份 `config.yaml.bak`（只备份这一次，保留插件动过你文件之前的原样）。
:::

## 最小配置

本机已跑着核心（默认 8765），想让云崽连过去：

```yaml
# config/config.yaml
enable: true
client:
  enable_ws: true
  connections:
    - name: gsuid_core
      url: ws://127.0.0.1:8765     # 只写到 host:port
      token: ""
      enable: true
      bind: ["2463381624"]         # 要接入核心的机器人账号，至少一个
```

两处都是硬要求：`url` 只写核心地址（`host:port`，不带路径），`bind` 至少填一个账号——一个账号都没有的连接启动时会被跳过并报「没有可用的绑定账号」。路径不用你写，理由见下面的「路由段在运行时生成」。

重启后 `#早柚状态` 应显示「已连接」。也可以不碰配置文件，在要接入核心的那个号上发 `#早柚添加连接 127.0.0.1:8765`，默认就把发指令的账号绑进去。别的机器人在各自号上再发一次，会并进同一条连接的 `bind`。

## 全部配置项

| 配置项 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `enable` | 总开关，`false` 则完全不连核心（改完即时生效） | `true` |
| `client.heartbeat` | ws ping 间隔（秒），0 关闭 | `30` |
| `client.heartbeat_timeout` | 超时无 pong 判定掉线，0 关闭 | `90` |
| `client.enable_ws` | 是否启用 WebSocket 连接 | `true` |
| `client.connections[]` | WebSocket 连接列表，见下 | — |
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

## 连接项的全部字段

与核心之间只有 WebSocket 一种连接：

```yaml
client:
  enable_ws: true                             # 关掉则不建立任何 ws 连接
  connections:
    - name: gsuid_core                        # 连接名，用于日志、指令定位与 #早柚状态
      url: ws://127.0.0.1:8765                # 核心地址，只到 host:port
      token: ""                               # 核心以 ?token= 查询参数接收
      enable: true
      reconnect_interval: 5                   # 重连间隔（秒）
      max_reconnect_attempts: 5               # 默认 5 次，<=0 无限重连
      bind: ["2463381624"]                    # 接入这个核心的机器人账号，至少一个
      exclude: []                             # 排除这些 self_id（优先级高于 bind）
```

`token` 建议写在这个字段里。内联成地址的 `?token=` 也认——根地址与自定义路径都会把它摘回凭据，运行时地址、面板卡片与状态图上都不带查询串；只是手改配置里那行地址时容易把凭据一起改掉，写在字段里也一眼看得出配没配。

`bind` / `exclude` 都是账号列表。不必手改文件——指令 `#早柚修改连接 1 bind+=<账号>` 与 [Web 面板](./panel.md)的绑定开关（带头像与在线状态）都能增删；`#早柚连接列表` 出图时绑定账号显示为头像胶囊。`exclude` 优先级高于 `bind`：两边都写了同一个账号，那个账号不会连，日志里会说一句「按 exclude 处理」。

删除、开关连接时如果文件里还没有 `connections` 键（列表来自默认配置的示例连接），会自动把当前生效的列表物化进你的文件再操作，与 `#早柚连接列表` 看到的保持一致。

`#早柚添加连接` 只接受 `ws://` / `wss://`。填 `http://` 会被挡下来，并把地址换算成 ws 形式提示你重发。

## 路由段在运行时生成

配置里存的是**核心地址**，`/ws/Yunzai-<账号>` 这段路径由插件在建连时按 `bind` 里的每个账号拼出来，不写进配置文件，也不该出现在配置文件里。

原因在核心那侧：`core.py` 的入站路由是 `@app.websocket("/ws/{bot_id}")`，**路径就是这条客户端在核心侧的身份**。两个云崽账号共用一条路径时，核心把它们当成同一个客户端，后连上的顶掉先连上的——于是两个号轮流掉线。一个账号一条路径就各自独立。

所以一条配置在运行时是 N 条 ws：

```
配置 1 条                      运行时 3 条
─────────────────────────      ────────────────────────────────────
url:  ws://127.0.0.1:8765      ws://127.0.0.1:8765/ws/Yunzai-账号A
bind: [账号A, 账号B, 账号C]  →   ws://127.0.0.1:8765/ws/Yunzai-账号B
                               ws://127.0.0.1:8765/ws/Yunzai-账号C
```

由此带来的几个可见变化：

- 每条运行时连接有自己的名字（`连接名 [账号]`）、自己的状态、自己的收发计数与重连次数
- `#早柚状态` 与面板上，一条配置显示成一张卡片，卡片状态是聚合值（任一账号连上就算这个核心通了），下面按账号列子行
- 停起也是按账号的：面板上关掉一个绑定开关，只断那个账号那一条 ws，同一个核心上其他账号不受影响
- 同一条路径只允许一条运行时连接。真撞上了（例如两条配置绑了同一个账号）会保留先出现的那条，并在日志与面板上说明跳过了谁

## 自定义路径（高级）

`url` 里写了非根路径时，插件**不动它**：只起一条 ws，路径原样发给核心。适用于核心后台想看到一个特定名字的场景。

```yaml
    - name: 自定义
      url: ws://127.0.0.1:8765/ws/MyBot
      bind: []
```

这种连接的语义与上面那种完全不同，别混着理解：

| | 只填 `host:port` | 写了自定义路径 |
| :--- | :--- | :--- |
| ws 条数 | 每个绑定账号一条 | 恒为一条 |
| 路径 | 运行时生成 `/ws/Yunzai-<账号>` | 你写的那一段，原样 |
| `bind` 的含义 | 派生哪几条连接 | 转发过滤器，**不影响路径** |
| `bind` 留空 | 起不来，报错并跳过 | 合法，等于不限账号：所有机器人的消息都走这一条 |

::: warning `bind` 留空在两种连接上的后果相反
自定义路径 + 空 `bind` 是「不限账号」而不是「不转发」——这条 ws 会把所有机器人的消息都送进这个核心。想只转发某几个号，把它们写进 `bind`；这时它是白名单，但仍然只有一条 ws，核心侧看到的是同一个客户端。
:::

把路径显式写成 `/ws/Yunzai`（或手写的 `/ws/Yunzai-<账号>`）而又没有绑定账号时，日志会提醒你这是条共享路径、多个机器人会互相顶掉，并建议改回只填 `host:port` 加绑定账号。

## 重连

重连采用指数退避（`reconnect_interval` 起步，封顶其 12 倍），默认 5 次约覆盖 2.3 分钟——核心重启够用，而地址写错时不会整夜刷日志。次数用尽后发 `#早柚重连` 即可恢复；想要一直重连把 `max_reconnect_attempts` 写 `0`。

## filter 的其余字段

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

## bot_id_map：为什么 id 和 name 都要查

```yaml
bot_id_map:
  QQ: onebot            # adapter.id 粗粒度，一个键覆盖多家
  QQBot: qqgroup
  ICQQ: onebot          # adapter.name 精确到具体适配器，优先级低于 id
  QQGuild: qqguild      # 频道特判
  default: onebot       # 兜底
```

优先级：`self_id` 精确匹配 > 频道特判 > `adapter.id` > `adapter.name` > **按账号形状推断** > `default`。每个 bind 账号应在 `bot_id_map` 里有自己的一行。

框架填的 `adapter_id` 取自 `adapter.id`，而 ICQQ / OneBotv11 / OPQBot 三家的 `adapter.id` **全是 `QQ`**——只查 id 分不开它们，只查 name 则 `QQ` 这种粗粒度键写了没用。所以两者都查。

**查表全落空之后还有一层**：按账号前缀（`qg_` / `wx_` / `tg_` / `dc_` / `mv_` / `ko_`）与 QQBot appid 的形状再推一次。非 QQ 平台的账号在默认 `bot_id_map` 里根本没有键，QQBot 的 appid 也不在表里，只靠 `default` 会全部兜成 `onebot`，核心侧收到的平台标识就是错的。

`#早柚添加连接` 也用同一套判据：不写 `id=` 时按发指令那个账号推一个平台标识，**按账号写入 `bot_id_map`**，并在回复里说明推断结果。推不出就留空，交给上面这条链在上报时决定。

**频道单独判**：QQBot-Plugin 用同一个 adapter 同时处理 QQ 群和频道（`adapter.id` 恒为 `QQBot`），按适配器查表分不开，而核心侧 `qqgroup` 与 `qqguild` 是两个平台。所以频道按事件形状识别（`group_id` 带 `qg_` 前缀）。

## 大文件外链

超过 `media_max_size` 的图片 / 语音 / 视频没法塞进 base64，需要一个 http 外链让核心来拉。降级顺序按能力探测，不看框架名：

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

## update_check

`enable`（默认 `false`，关掉后 `#早柚检查更新` 仍可手动用）、`interval`（间隔分钟，默认 180，低于 30 按 30 处理）、`delay`（启动后多久做第一次检查，默认 5 分钟，错开启动高峰）、`notify`（发现新版本时私聊通知主人，默认 `true`）。改完即时生效，不用重启。
