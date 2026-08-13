# 更新日志

本文件由 [release-please](https://github.com/googleapis/release-please) 依据
[Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 提交信息自动维护。

## [3.2.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v3.1.0...v3.2.0) (2026-08-13)


### ✨ 新功能

* 多账号绑定管理与连接改配置指令 ([4a3a65c](https://github.com/fanxiaocuo/gscore-adapter/commit/4a3a65cad7f1b30fffb7e38409cfd0c6926934e0))
* 完善多账号连接与类型 ([f1ec1ab](https://github.com/fanxiaocuo/gscore-adapter/commit/f1ec1ab9a0a259b38f96dd32f94a728be4eadf10))


### 📝 文档

* **help:** 完善帮助图说明 ([cff1d28](https://github.com/fanxiaocuo/gscore-adapter/commit/cff1d287064e98862ba6ef294ae574e03266976d))
* 文档站改为液态毛玻璃主题 ([242de1e](https://github.com/fanxiaocuo/gscore-adapter/commit/242de1ecdca0f8dc1b40308411bb3bd1b7867821))

## [3.1.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v3.0.0...v3.1.0) (2026-08-11)


### ✨ 新功能

* #早柚设置 回复改为渲染图片，面板增加 bind/exclude 账号字段 ([8cb580d](https://github.com/fanxiaocuo/gscore-adapter/commit/8cb580d2c45c96321771ecd9554ec02f5287074d))
* 修复 #早柚设置 空参数、简化添加连接、默认重连 5 次 ([2ab7fac](https://github.com/fanxiaocuo/gscore-adapter/commit/2ab7fac3cf181a1b6f23184674ceaa669fb54daf))
* 平台自动识别、中文设置指令、YAML 块状化、设置图重设计 ([bd8d593](https://github.com/fanxiaocuo/gscore-adapter/commit/bd8d59367059034a44ebdebb6f80a7c8ce90a932))

## [3.0.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v2.3.0...v3.0.0) (2026-08-11)


### ⚠ BREAKING CHANGES

* 移除 mode → enable 的迁移逻辑。v2.2.0（2026-08-08）之前的用户若从未启动过 v2.2.x，需手动将 `mode: off` 改为 `enable: false`。

### ✨ 新功能

* enable 改为热生效，删除 mode 迁移 ([c1ff95b](https://github.com/fanxiaocuo/gscore-adapter/commit/c1ff95ba6bad5df4c0728c5092e41814b5279955))

## [2.3.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v2.2.1...v2.3.0) (2026-08-11)


### ✨ 新功能

* **guoba:** 补全面板的图标、仓库与作者链接 ([c84ff01](https://github.com/fanxiaocuo/gscore-adapter/commit/c84ff01e68e897033da1eaf1437abd0594dfdf52))


### 🐛 问题修复

* #早柚添加连接 默认绑定发指令的那个机器人账号 ([832655d](https://github.com/fanxiaocuo/gscore-adapter/commit/832655dbb0f4c758e05a14a8842362d8c9f7f4dd))
* 面板产物改名 panel.js，不再撞宿主的页面描述符扫描 ([9ffd3a5](https://github.com/fanxiaocuo/gscore-adapter/commit/9ffd3a50c7dc245ef94efdc8f23e3d0803624152))

## [2.2.1](https://github.com/fanxiaocuo/gscore-adapter/compare/v2.2.0...v2.2.1) (2026-08-11)


### 🐛 问题修复

* self_id 缺失时按 bot.uin / 单 Bot 回退，不再整条丢弃 ([1946a1d](https://github.com/fanxiaocuo/gscore-adapter/commit/1946a1d2cafd8f4bfb4d4ae9281df9ad57978fa3))


### 📝 文档

* 文档站并入 main/docs/，修可读性 ([b3d75a2](https://github.com/fanxiaocuo/gscore-adapter/commit/b3d75a2de800d83c8a9f075a61da053816622fa1))

## [2.2.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v2.1.0...v2.2.0) (2026-08-10)


### ✨ 新功能

* 中转计数落盘到 sqlite ([b194ce3](https://github.com/fanxiaocuo/gscore-adapter/commit/b194ce3183b4b4db04faac3fb044faf1802ddad5))
* 内置文件服务，无 Bot.fileToUrl 的框架也能发大文件 ([a2097ea](https://github.com/fanxiaocuo/gscore-adapter/commit/a2097ea00b5781501cb81f3d4ad32bf357641317))
* 出图与定时检查更新 ([e2c2857](https://github.com/fanxiaocuo/gscore-adapter/commit/e2c2857743b037de1a6476fcd29e5695f123e47e))
* 加 web 面板，接 QQBot-Web-Adapter ([7c73635](https://github.com/fanxiaocuo/gscore-adapter/commit/7c73635d94f3b275d16ab65ef939173c25bb0af3))
* 恢复 QQBot 被动回复，补单 id 回数上限 ([ada6022](https://github.com/fanxiaocuo/gscore-adapter/commit/ada6022182027b301680c56a55f530cb6599e7e8))
* 状态页补中转计数与明细，版本页加本版变更 ([68d5037](https://github.com/fanxiaocuo/gscore-adapter/commit/68d50374dc81fc146d7aeee3c7752b067ea0115c))
* 补两页的空白区块 ([ae8fcda](https://github.com/fanxiaocuo/gscore-adapter/commit/ae8fcda7b93424b83b6c4e052bb57cdd286b4a9e))
* 配置升级自动补新增项，mode 换成 enable ([b8ed3c6](https://github.com/fanxiaocuo/gscore-adapter/commit/b8ed3c60013e22e14e6fd64599a40661c3880735))


### 🐛 问题修复

* 修三处适配器兼容 bug，补 QQBot 被动回复与上报开关 ([9883c4d](https://github.com/fanxiaocuo/gscore-adapter/commit/9883c4dc612729b9f736edb55984ea676f798665))
* 补 sqlite3 依赖，修 CI 编译失败 ([70d8f58](https://github.com/fanxiaocuo/gscore-adapter/commit/70d8f58ce63387c6fca984d60dee2d59bee300aa))


### ⚡ 性能优化

* 出图从 3.5s 降到 2.3s，体积减半 ([2b08e25](https://github.com/fanxiaocuo/gscore-adapter/commit/2b08e25f804ee81344e078dad6b3844a3bb0a965))


### ♻️ 代码重构

* web 面板改用 React，esbuild 打包 ([51faca0](https://github.com/fanxiaocuo/gscore-adapter/commit/51faca0d0ee30eeef2ff32f1f5f95537ce09e660))
* 出图外壳换成 template-react，构建从打包改回逐文件编译 ([81fd05d](https://github.com/fanxiaocuo/gscore-adapter/commit/81fd05de33a7bd0a036f75cb4dcdf2f86515629f))
* 出图迁到 Tailwind，改自己拼整页 HTML ([01b4975](https://github.com/fanxiaocuo/gscore-adapter/commit/01b49750229c5a2212ca08113397a8c03aa00c7e))
* 去掉 QQBot 被动回复，主动/被动已无配额差异 ([9364c21](https://github.com/fanxiaocuo/gscore-adapter/commit/9364c216c45dad20ee01578823b987e34b439dd5))
* 样式表按层与页面拆分 ([1a17880](https://github.com/fanxiaocuo/gscore-adapter/commit/1a17880cd844bc84032eb850f0cf0576b53b4cd0))
* 渲染资源按类型归到 template 下 ([27de1d9](https://github.com/fanxiaocuo/gscore-adapter/commit/27de1d9e231edcbdae5110b8aeb815f799035136))
* 面板样式改用 Tailwind，webadapter/ 只剩壳与挂载点 ([c2f8d5a](https://github.com/fanxiaocuo/gscore-adapter/commit/c2f8d5a835e45dceab65007e99292eff0c485338))


### 📝 文档

* README 从 674 行压到 451 行，深层内容收进折叠块 ([c965827](https://github.com/fanxiaocuo/gscore-adapter/commit/c965827da925784d744b877db857e5e6f83e7471))
* 大文件外链改按内置文件服务说明 ([c6522ee](https://github.com/fanxiaocuo/gscore-adapter/commit/c6522ee379260cc2fb9327a4c77211e92f8be2f4))
* 指令小节标题换成插件图标，面板补 favicon ([8f18320](https://github.com/fanxiaocuo/gscore-adapter/commit/8f18320651d345bccb9fd4832908b8db6f551b07))

## [2.1.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v2.0.1...v2.1.0) (2026-08-08)


### ✨ 新功能

* 兼容 Miao-Yunzai ([ec16313](https://github.com/fanxiaocuo/gscore-adapter/commit/ec163137d59aace4d187d807988a61e9258f5b02))

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
