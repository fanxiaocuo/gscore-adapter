# 致谢与参考实现

本项目参考过下列实现。列在这里既是致谢，也是**署名保留** —— GPL-3.0 要求如此，逐条写明参考了什么、
出处在哪，而不是笼统一句「感谢开源」。

> 这一节原先在 README 里。挪出来是因为 README 面向的是使用者，而这份清单面向的是
> 「想知道某个设计从哪来」的人 —— 内容一字未改。

- **[XasYer/ws-plugin](https://github.com/XasYer/ws-plugin)** —— 早柚核心对接的主要对照实现，消息段转换与客户端连接的许多细节参考自它。
- **[KaguyaJs/Yunzai-DF-Plugin](https://github.com/KaguyaJs/Yunzai-DF-Plugin)** —— 目录结构与工程约定的参考来源：`src/` 分层、`@/*` 路径别名、`index.js` 只做 re-export 的薄壳入口、`guoba.support.js` 转调 `lib/modules/guoba/`，以及 `tsc` + `tsc-alias` 逐文件输出、产物镜像 `src/` 的构建链。一处分了道：`modules/loader/` 用静态导入表而非扫目录动态 import——忘了注册在编译期就报错，而扫目录扫空只是静默地一个功能都不注册。
- **[yeyang52/yenai-plugin](https://gitee.com/yeyang52/yenai-plugin)** —— 多 Bot 账号分流模型的参考来源：事件场景以 `e.self_id` 定位账号，汇总场景遍历 `Bot.uin`，再逐个通过 `Bot[i]` 读取对应实例。本插件沿用这一账号隔离语义，并进一步从 TRSS 的 `Bot.bots` 注册表做自有键精确读取，避免全局 Proxy 的兼容重定向导致串号。
- **[xiowo/napcat-plugin-gscore-adapter](https://github.com/xiowo/napcat-plugin-gscore-adapter)**（MIT）—— 早柚核心适配的参考实现。
- **[xiowo/yunzai-gscore-adapter](https://github.com/xiowo/yunzai-gscore-adapter)**（MIT）—— 同作者的云崽版。三处实现参照了它：`bot_id_map` 补上 `QQGuild` / `KOOK` / `Telegram` / `Discord` 四个平台标识（对照其 `ADAPTER_BOT_ID_MAP`）、`filter.report_*` 三个上报开关（对照其 `DEFAULT_CONFIG` 的 `reportPrivate` 等）、以及 QQBot 带原消息 id 回复的思路（对照其 `QQBOT_MESSAGE_ID_TTL` / `QQBOT_MESSAGE_ID_KEY_PREFIX`，单 id 回满 5 次即降级则对照其 `QQBOT_MESSAGE_ID_REPLY_LIMIT`）。落盘换成了 sqlite——本插件已为中转计数开了 sqlite，不必只为几行短命数据再引一个 redis 连接。
- **[xiaoye12123/ws-plugin](https://gitee.com/xiaoye12123/ws-plugin)**（小叶，GPL-3.0）—— 多适配器 bot 查找与发送结果判定的思路来源。`utils/send.ts` 区分「抛错派」与「返回错误对象派」适配器：只 `await` 不看返回值会把 Milky / OneBot 那种「失败也不抛错」的情况误记成一次成功中转。
  > 该思路是从 [smoadrareun 的 fork](https://gitee.com/smoadrareun/ws-plugin) 读到的，但那个 fork 把上游作者信息全部抹除（`package.json`、`guoba.support.js`、CHANGELOG、README 均改为自己），git 历史也是压平重提交。GPL-3.0 要求保留作者署名，故此处按实际来源致谢原作者 **xiaoye12123**。
- **[ikenxuan/karin-plugin-kkk](https://github.com/ikenxuan/karin-plugin-kkk)** —— 图片版式与设计 token 的参考来源。`modules/render/` 的画布结构（弥散光背景、概览统计条、分组卡片、页脚角标）照其 React 组件的思路重写，`#早柚版本` 也是对照它的 `#kkk版本` 做的。样式管线也对齐了：两边都用 Tailwind v4 在构建期扫 JSX 产出一份 CSS，且都是运行时 SSR。
- **[KarinJS/template-react](https://github.com/KarinJS/template-react)** —— 出图的整页 HTML 外壳与 SSR 写盘直接用它的 `createRenderer` / `HtmlWrapper`，即 kkk 那条渲染路径本身。
- **[Genshin-bots/gsuid_core](https://github.com/Genshin-bots/gsuid_core)** —— 协议细节以核心源码为准，包括 `Button.permisson` 的拼写、`excute_*` 的命名、`/ws/{bot_id}` 只收二进制帧等。本插件照其实际行为对齐，而非按字面直觉修正。
- **[TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)** 与 **[Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai)** —— 运行本插件的两个框架。前者的 `Bot.makeLog` / `Bot.Buffer` / `Bot.fileToUrl` 等工具方法是 `utils/compat.ts` 里能力探测的对照物；后者没有那批方法，兼容层与内置文件服务正是为它准备的。
- **各协议适配器** —— 适配器之间的差异是能力探测与降级逻辑的全部依据：[icqq](https://github.com/icqqjs/icqq)（`e.source` 无 `message_id`；`data:` URI 在 `Image` 构造器里不被识别）、[QQBot-Plugin](https://github.com/TimeRainStarSky/Yunzai-QQBot-Plugin)（频道消息 `message_type` 标成 `group`、靠 `qg_` 前缀识别；被动回复所需的四条发送路径）、[Milky](https://milky.ntqqrev.org/)（`OutgoingSegment` 无 button / markdown，失败时返回错误对象而不抛错）。
