# 双框架兼容

TRSS / Miao 均可运行。适配方式是**按能力探测，不按框架名分支**，所以改过名的 fork 也能正确识别。

## 两个框架差在哪

两个框架的 `Bot` 对象差异不小：Miao 的 `lib/bot.js` 是 `class Yunzai extends Client`（ICQQ 的 Client），只有协议方法，TRSS 额外挂的那批工具函数它一个都没有。插件通过 `src/utils/compat.ts` 逐个探测、缺谁补谁。

## 能力对照

| 能力 | TRSS | Miao | 处理 |
| :--- | :-: | :-: | :--- |
| `Bot.makeLog` | ✅ | ❌ | 垫片转 `global.logger` |
| `Bot.String` | ✅ | ❌ | 垫片（含循环引用处理） |
| `Bot.Buffer` | ✅ | ❌ | 垫片（保持三路返回语义） |
| `Bot.makeForwardMsg` | ✅ 标记对象 | ⚠️ 语义不同 | 按返回值形状判定，转走 Group/Friend 原生实现 |
| 主人配置 | `master` 分账号 + `masterQQ` | 仅 `masterQQ` | 按字段形状探测，两种结构都认 |
| `Bot.fileToUrl` | ✅ | ❌ | 无法垫片，改用内置文件服务顶上 |
