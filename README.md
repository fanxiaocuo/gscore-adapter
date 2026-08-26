# gscore-adapter

把云崽接到 **早柚核心（[gsuid_core](https://github.com/Genshin-bots/gsuid_core)）**，让核心侧的原神、星铁等插件用你现有的机器人账号收发消息。

支持 Miao-Yunzai 与 TRSS-Yunzai，装好后**一条指令**就能连上。

📖 **[完整文档](https://fanxiaocuo.github.io/gscore-adapter/)** · 🙏 [致谢与参考实现](CREDITS.md)

## 装

在 **Yunzai 根目录**（不是 `plugins/`）运行。两个分支都是编译好的 js，不用自己编译：

```bash
# 稳定版（推荐）
git clone --depth=1 --branch release https://github.com/fanxiaocuo/gscore-adapter.git ./plugins/gscore-adapter

# 预览版（跟 main 即时更新，没经过发版把关）
git clone --depth=1 --branch preview https://github.com/fanxiaocuo/gscore-adapter.git ./plugins/gscore-adapter
```

然后装依赖并重启云崽：

```bash
cd plugins/gscore-adapter && pnpm install --prod
```

> ⚠️ **这一步不能省。** 出图要用到 `react` 等几个包，而产物分支不带 `node_modules`。不装会在启动时报 `Cannot find package 'react'`。

更新：`git pull && pnpm install --prod`

## 连上核心

核心跑在本机默认端口时，**给机器人发一条指令就行**：

```
#早柚添加连接 127.0.0.1:8765
```

它会自动把发指令的这个账号绑进去、写好配置、立刻连上，不用手改 yaml、不用重启。

想让别的号也接进同一个核心，就在那个号上再发一次同样的指令。

发 `#早柚状态` 看连上没有。

## 之后想改什么

三个入口，改哪个都一样生效，**yaml 里的注释不会丢**：

| 入口 | 怎么用 | 适合 |
| --- | --- | --- |
| **指令** | `#早柚设置` 出图列出全部可改项与改法 | 手机上随手改 |
| **网页面板** | 装了[锅巴](https://github.com/guoba-yunzai/guoba-plugin)或 QQBot-Web-Adapter 后，控制台里多一页「早柚核心适配器」 | 项目多、要看实时状态 |
| **配置文件** | 改 `config/config.yaml`（只写想改的项，其余继承默认） | 批量改、写注释 |

插件升级时新增的配置项会自动补进你的 `config.yaml`（连注释一起，已有的项不动，补写前先备份）。

配置项逐条说明见 **[配置文档](https://fanxiaocuo.github.io/gscore-adapter/guide/config)**，面板的用法见 **[面板文档](https://fanxiaocuo.github.io/gscore-adapter/guide/panel)**。

## 常用指令

全部限主人使用，`#` 可省略。

| 指令 | 说明 |
| :--- | :--- |
| `#早柚状态` | 各连接状态与中转计数（出图） |
| `#早柚添加连接 <地址>` | 添加并立即启动，只填 `host:port` 即可 |
| `#早柚删除连接 <名字或序号>` | 也可 `开启` / `关闭` 连接 |
| `#早柚重连` | 重连全部连接 |
| `#早柚设置` | 列出当前所有配置及各自的改法（出图） |
| `#早柚帮助` | 指令一览（出图） |
| `#早柚更新` | 拉取更新 |

出图需要框架的 puppeteer 可用，拉不起浏览器时自动降级成文本。

完整指令表（含 `bind+=` 这类批量改法）见 **[指令文档](https://fanxiaocuo.github.io/gscore-adapter/guide/commands)**。

## 出问题了

最常见的两个：

**连不上，日志刷「连接错误」** —— 检查核心在不在跑、地址端口对不对、`token` 配没配对。容器部署时别把地址写成容器内的 `127.0.0.1`。

**另一个机器人连上后，这个号就收不到回复了** —— 两条连接的地址路径撞了，核心会用后连上的顶掉前一条。同一个核心只留一条连接，用绑定账号挂多个号即可（`#早柚添加连接` 默认就是这么做的）。

其余情况（消息被处理两次、图片发不出去、按钮丢失、撤回失效……）见 **[常见问题](https://fanxiaocuo.github.io/gscore-adapter/guide/faq)**。

## 能做什么

- **多连接**：同时连多个核心，各自独立重连、独立账号绑定
- **消息双向转换**：文本 / 图片 / 语音 / 视频 / 文件 / @ / 引用 / 按钮 / 合并转发 / markdown
- **大文件外链**：框架没有文件服务时自带一个，零配置，大图不再发不出去
- **QQBot 引用回复**：官方 Bot 上回复能挂到用户那条消息下
- **双框架兼容**：TRSS / Miao 都能跑，按能力探测自动适配，改过名的 fork 也认得
- **出图**：状态 / 帮助 / 版本 / 更新日志四页，深浅主题按时段切

## 更多

- [完整文档站](https://fanxiaocuo.github.io/gscore-adapter/) —— 安装、配置、指令、面板、常见问题
- [协议与兼容](https://fanxiaocuo.github.io/gscore-adapter/protocol/segments) —— 消息段映射、非消息事件、回环防护、双框架差异
- [参与开发](https://fanxiaocuo.github.io/gscore-adapter/dev/architecture) —— 架构、出图管线、测试
- [致谢与参考实现](CREDITS.md) —— 本项目参考过的实现与出处

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

## 📄 许可证

[GPL-3.0-only](LICENSE)。仅供学习交流使用，禁止用于任何违法用途；项目内资源来源于网络，如有侵权请联系删除。

> 相关：[早柚核心 gsuid_core](https://github.com/Genshin-bots/gsuid_core) · [适配器列表文档](https://docs.sayu-bot.com/LinkBots/AdapterList.html)
