# 安装

装完这一页，你的机器人号就能替早柚核心收发消息 —— 核心侧的原神、星铁等插件从此在这个号上可用。

## 先确认两件事

| | 怎么确认 |
| :--- | :--- |
| 云崽已经能正常跑 | Miao-Yunzai 或 TRSS-Yunzai，机器人能收发消息 |
| 早柚核心已经在跑 | 知道它的地址和端口，默认 `8765` |

核心还没装就先去装它：[gsuid_core](https://github.com/Genshin-bots/gsuid_core) · [核心文档](https://docs.sayu-bot.com/)。

## 一、克隆

在 **Yunzai 根目录**（不是 `plugins/`）任选一条运行。两个分支都是编译好的 js，不用自己编译：

```bash
# 稳定版（推荐，发版后更新）
git clone --depth=1 --branch release https://github.com/fanxiaocuo/gscore-adapter.git ./plugins/gscore-adapter

# 预览版（跟 main 每次提交即时更新，没经过发版把关）
git clone --depth=1 --branch preview https://github.com/fanxiaocuo/gscore-adapter.git ./plugins/gscore-adapter
```

## 二、装依赖

```bash
cd plugins/gscore-adapter && pnpm install --prod
```

::: warning 这一步不能省
出图（状态图、帮助图）要用到 `react` / `react-dom` / `lucide-react` / `@karinjs/template-react`，而产物分支不带 `node_modules`。不装会在第一个 import 处报 `Cannot find package 'react'`，插件加载不了。`ws` / `yaml` / `chokidar` 是云崽自带的，不用管。
:::

## 三、重启云崽，然后连上核心

在**要接入核心的那个机器人号**上发指令，不用手改 yaml、也不用再重启一次。

核心跑在本机默认端口（`127.0.0.1:8765`）时，一条就够：

```
#早柚添加连接 127.0.0.1:8765
```

它会自动绑上发指令的这个号、写好配置、立刻连上。出厂配置里那条同地址的示例连接（名叫 `gsuid_core`）会被认出来并复用，顺带从停用状态打开 —— 回执里的「连接状态：已启用」说的就是这件事。

核心在别的地址或端口时把地址换掉即可：

```
#早柚添加连接 192.168.1.5:8765
```

想让别的号也接进同一个核心，就在那个号上再发一次同样的指令。

发 `#早柚状态` 看结果，显示「已连接」就成了。没连上翻[常见问题](./faq.md)。

::: tip 核心那边不用配任何东西
连接由云崽主动发起，核心只管接。地址也只填到 `host:port` —— 后面 `/ws/Yunzai-<账号>` 那段路径由插件按绑定账号自己拼，[配置](./config.md#多个账号接同一个核心)里说明了为什么。
:::

想让别的机器人号也接进同一个核心、想连第二个核心、想改上报范围，都在[配置](./config.md)那页。

## 更新

```bash
git pull && pnpm install --prod
```

也可以直接发 `#早柚更新`（本地改过文件时用 `#早柚强制更新` 覆盖）。

<details>
<summary>在稳定版与预览版之间切换</summary>

不必重新克隆，`--depth=1` 的浅克隆也适用：

```bash
cd plugins/gscore-adapter
git remote set-branches origin '*'
git fetch --depth=1 origin
git checkout -B preview origin/preview   # 换成 release 即切回稳定版
```

</details>

<details>
<summary>我装的是哪个版本</summary>

三个分支的版本号是同一个，光看版本号分不出来，所以 `#早柚版本` 按**本地分支**判定：

| 本地分支 | 判定 |
| :--- | :--- |
| `release` | 正式版 |
| `preview` | 预览版 |
| `main` | 开发版 |

识别不出分支（如下载 zip）时按预览版算，不会误报成正式版。

</details>
