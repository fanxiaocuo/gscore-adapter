# 更新日志

本文件由 [release-please](https://github.com/googleapis/release-please) 依据
[Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 提交信息自动维护。

## [2.0.1](https://github.com/fanxiaocuo/gscore-adapter/compare/v2.0.0...v2.0.1) (2026-08-07)


### 📝 文档

* 安装改成一条命令搞定 ([d697318](https://github.com/fanxiaocuo/gscore-adapter/commit/d69731804dc1902c6acacaea7808d2fd9edc059d))
* 稳定版与预览版分别给出安装步骤 ([287fda7](https://github.com/fanxiaocuo/gscore-adapter/commit/287fda7007e57e4f05bffd25ea20f5d24a1115e5))
* 精简 README 并添加使用范围声明 ([6a7d9c7](https://github.com/fanxiaocuo/gscore-adapter/commit/6a7d9c7c5a098e5a7d95d8bcb92d17619076f4ea))

## [2.0.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v1.0.0...v2.0.0) (2026-08-07)


### ⚠ BREAKING CHANGES

* 移除 server 方向，仅保留 client

### ✨ 新功能

* 早柚核心适配器首个版本 ([2dbddb9](https://github.com/fanxiaocuo/gscore-adapter/commit/2dbddb900b6ba45d70f7b24daa65e91e9a565913))
* 添加插件自更新 ([415c9fc](https://github.com/fanxiaocuo/gscore-adapter/commit/415c9fc1ac580f480c887ae585d08ab4a179d2db))
* 移除 server 方向，仅保留 client ([a41eecc](https://github.com/fanxiaocuo/gscore-adapter/commit/a41eecc54c1e26c9a966aedc6b0fc721e4bcffa7))


### 🐛 问题修复

* **admin:** #早柚设置 对连接级字段给出指向性提示 ([39e1f9b](https://github.com/fanxiaocuo/gscore-adapter/commit/39e1f9b32c4077b0a6ed1003f96da7f7fab216f6))
* **ci:** 修复产物分支丢失 resources 并加入完整性自检 ([d4bf81a](https://github.com/fanxiaocuo/gscore-adapter/commit/d4bf81afd79c9ae6f31022ddf75c7ee0e88074b7))
* **ci:** 构建排到测试之前 ([c963132](https://github.com/fanxiaocuo/gscore-adapter/commit/c963132df61b3b0b60251469a16e5a54d6d2ed8c))
* **convert:** 群消息尾部混入群号，未知段打印 [object Object] ([56a19c5](https://github.com/fanxiaocuo/gscore-adapter/commit/56a19c580e74b51e0240caea75306e750608a337))
* 不再把 @全体成员 上报给核心 ([3480977](https://github.com/fanxiaocuo/gscore-adapter/commit/34809773eb72088a989f87dc6d1e552a3a1a22be))
* 修正 .gitignore 漏掉 src/config 与 resources ([3803250](https://github.com/fanxiaocuo/gscore-adapter/commit/38032505075e67b27611cc33fbf2c2d73bdf6e2c))
* 声明 chokidar / ws / yaml 依赖 ([fe3b70f](https://github.com/fanxiaocuo/gscore-adapter/commit/fe3b70f3f547c0146e380824358d67e8a1dcc25a))
* 改用 YunzaiPath 绝对路径 import 本体更新插件 ([7e98e83](https://github.com/fanxiaocuo/gscore-adapter/commit/7e98e835c709ca300be264e7312bc3daa5285341))

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
