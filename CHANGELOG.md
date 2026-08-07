# 更新日志

本文件由 [release-please](https://github.com/googleapis/release-please) 依据
[Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 提交信息自动维护。

## 1.0.0

首个版本。

### ✨ 新功能

- 早柚核心（gsuid_core）对接：云崽主动连接核心的 `/ws/{bot_id}`，支持多连接与断线重连
- 三层回环防护：适配器自回显、适配器 id 与 `gscore_origin` 标记、内容指纹（10 秒 TTL）
- 消息过滤：`@` 与前缀触发、前缀与关键词屏蔽、群与用户黑白名单
- 管理指令 `#早柚状态` / `#早柚重连` / `#早柚连接列表` 及连接增删改查，断线可选通知主人
- 插件自更新 `#早柚更新` / `#早柚强制更新` / `#早柚更新日志`，转调本体更新逻辑
- 锅巴（Guoba-Plugin）配置面板

### ♻️ 代码重构

- 按 [Yunzai-DF-Plugin](https://github.com/KaguyaJs/Yunzai-DF-Plugin) 约定分层：
  `src/{dir,types,utils,constants,config,modules}`，`@/*` 路径别名 + `tsc-alias`
- 默认配置移至 `resources/config/default_config.yaml`，用户配置路径由
  `config/config/config.yaml` 改为 `config/config.yaml`
- 框架配置与插件路径改为从 `src/dir.ts` 推导绝对路径，不再依赖 `process.cwd()`
  与相对层级，插件改名或调整目录深度都不受影响
