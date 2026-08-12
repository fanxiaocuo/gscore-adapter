# 安装

云崽作为 ws 客户端主动连接早柚核心，即 [AdapterList](https://docs.sayu-bot.com/LinkBots/AdapterList.html) 描述的连接器形态。

::: info 只有 client 一个方向，且只走 WebSocket
核心 `core.py` 只有入站路由 `@app.websocket("/ws/{bot_id}")`，全仓库没有任何出站连接——核心不会主动来连云崽。
:::

## 克隆

在 **Yunzai 根目录**（不是 `plugins/`）任选一条运行。两个分支都是编译好的 js，不用自己编译：

```bash
# 稳定版（推荐，发版后更新）
git clone --depth=1 --branch release https://github.com/fanxiaocuo/gscore-adapter.git ./plugins/gscore-adapter

# 预览版（跟 main 每次提交即时更新，没经过发版把关）
git clone --depth=1 --branch preview https://github.com/fanxiaocuo/gscore-adapter.git ./plugins/gscore-adapter
```

## 装依赖

克隆完装一次运行时依赖，然后重启云崽：

```bash
cd plugins/gscore-adapter && pnpm install --prod
```

出图用 JSX 写版式，运行时要 `react` / `react-dom` / `lucide-react` / `@karinjs/template-react`，而产物分支不带 `node_modules`。不装会在第一个 import 处报 `Cannot find package 'react'`。`ws` / `yaml` / `chokidar` 是云崽自带的，不用管。

后续更新：

```bash
git pull && pnpm install --prod
```

## 两版之间切换

不必重新克隆，`--depth=1` 的浅克隆也适用：

```bash
cd plugins/gscore-adapter
git remote set-branches origin '*'
git fetch --depth=1 origin
git checkout -B preview origin/preview   # 换成 release 即切回稳定版
```

## 我装的是哪个版本

三个分支的版本号是同一个，光看版本号分不出来，所以 `#早柚版本` 按**本地分支**判定：

| 本地分支 | 判定 |
| :--- | :--- |
| `release` | 正式版 |
| `preview` | 预览版 |
| `main` | 开发版 |

识别不出分支（如下载 zip）时按预览版算，不会误报成正式版。
