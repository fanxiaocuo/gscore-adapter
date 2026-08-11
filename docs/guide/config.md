# 配置

首次运行自动把 `resources/config/default_config.yaml` 复制成 `config/config.yaml`。**改后者**，前者是出厂默认值、升级会被覆盖。只需写想改的项，其余自动继承默认。

::: tip 升级会自动补新增的配置项
插件更新后多出来的顶层配置，启动时会连同注释一起追加到你的 `config/config.yaml`，已有的项一律不动。补写前会先备份成 `config.yaml.bak`。
:::

## 最小配置

本机已跑着核心（默认 8765），想让云崽连过去：

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

## 全部配置项

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

## 连接项的全部字段

```yaml
client:
  connections:
    - name: gsuid_core                        # 连接名，仅用于日志和 #早柚状态
      url: ws://127.0.0.1:8765/ws/Yunzai      # 路由 /ws/{bot_id}，bot_id 可自定义
      token: ""                               # 核心以 ?token= 查询参数接收
      bot_id: ""                              # 上报的平台标识，留空按 bot_id_map 推断
      enable: true
      reconnect_interval: 5                   # 重连间隔（秒）
      max_reconnect_attempts: 5               # 默认 5 次，<=0 无限重连
      bind: []                                # 只转发这些 self_id，留空为全部
      exclude: []                             # 排除这些 self_id（优先级高于 bind）
```

`bind` / `exclude` 用于多账号场景：让 A 号走核心 1、B 号走核心 2。

重连采用指数退避（`reconnect_interval` 起步，封顶其 12 倍），默认 5 次约覆盖 2.3 分钟——核心重启够用，而地址写错时不会整夜刷日志。次数用尽后发 `#早柚重连` 即可恢复；想要一直重连把 `max_reconnect_attempts` 写 `0`。

::: tip 老配置不会被改写
升级只会补进配置文件里缺失的项，已经存在的值一律不动。所以此前装过的实例仍是自己文件里的那个数（早期默认为 `0` 即无限重连），要用新默认值请手动改成 `5`。
:::

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

优先级：连接自身的 `bot_id` > `self_id` 精确匹配 > 频道特判 > `adapter.id` > `adapter.name` > `default`。

框架填的 `adapter_id` 取自 `adapter.id`，而 ICQQ / OneBotv11 / OPQBot 三家的 `adapter.id` **全是 `QQ`**——只查 id 分不开它们，只查 name 则 `QQ` 这种粗粒度键写了没用。所以两者都查。

::: warning 旧版默认配置的一处失效
把键写成了 `ICQQ` / `OneBotv11` / `OPQBot` / `ComWeChat`，那些是 `name` 不是 `id`，**实际从未命中**，只是恰好都该映射成 `onebot`、被 `default` 掩盖了。
:::

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
