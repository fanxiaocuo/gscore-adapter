# 更新日志

本文件由 [release-please](https://github.com/googleapis/release-please) 依据
[Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 提交信息自动维护。

## [3.3.1](https://github.com/fanxiaocuo/gscore-adapter/compare/v3.3.0...v3.3.1) (2026-08-19)


### 🐛 问题修复

* **passive:** 单聊被动回复上限按官方改为 4 次 ([d0c60ed](https://github.com/fanxiaocuo/gscore-adapter/commit/d0c60ed5b3ba077915c8d4f12d3ed677d4f976bf))
* **protocol:** 从 msg_elements 提取 QQBot 引用图 ([b74d68e](https://github.com/fanxiaocuo/gscore-adapter/commit/b74d68e882955e9958415836beeb3b446affb566))

## [3.3.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v3.2.0...v3.3.0) (2026-08-18)


### ✨ 新功能

* **admin:** 连接指令改为核心地址 + 必填绑定账号 ([61dec65](https://github.com/fanxiaocuo/gscore-adapter/commit/61dec6529de2f22fe756aefdffdab89101594d8e))
* **client:** 两阶段启动与按来源停起运行时连接 ([7ed870b](https://github.com/fanxiaocuo/gscore-adapter/commit/7ed870befec39099dc1e729c928aa1dd962414f3))
* **client:** 客户端按账号使用运行时名称与地址 ([1c7ebb1](https://github.com/fanxiaocuo/gscore-adapter/commit/1c7ebb16b15ae88aa8507b45aa2f63a08d7ba441))
* **client:** 逻辑连接按绑定账号展开为运行时连接 ([089dfcf](https://github.com/fanxiaocuo/gscore-adapter/commit/089dfcff16b2e8b1fa0618c283c49e9a8af935ff))
* **panel:** 响应式设置式布局与 Apple 风格绑定开关 ([fa5fe6c](https://github.com/fanxiaocuo/gscore-adapter/commit/fa5fe6ccbbdc3d403db7387ada91dcbbe6ec3d9e))
* **panel:** 运行时连接视图与账号绑定开关接口 ([b751989](https://github.com/fanxiaocuo/gscore-adapter/commit/b75198982e32430fa13a13791cdfe43146790e3b))
* **panel:** 面板按账号绑定，并守住只内联在地址里的凭据 ([442f843](https://github.com/fanxiaocuo/gscore-adapter/commit/442f843c3382c9b3ed3c25501175c1c15e346aa0))
* **render:** 状态图按来源聚合账号级连接 ([098f028](https://github.com/fanxiaocuo/gscore-adapter/commit/098f02825e56febf21595994a28f9f33693fe4df))
* 多 Bot 账号精确解析 ([ec59c6e](https://github.com/fanxiaocuo/gscore-adapter/commit/ec59c6e83a2c0f85365c0aa78b4c4fd9a5a75fd7))


### 🐛 问题修复

* **admin:** 修正 Task 7 评审发现的四处指令层问题 ([8b412ab](https://github.com/fanxiaocuo/gscore-adapter/commit/8b412ab5ef3cf5d7d29621168681c85dfd68e529))
* **admin:** 改地址时把内联凭据搬进 token 字段 ([40a12d7](https://github.com/fanxiaocuo/gscore-adapter/commit/40a12d730f594679623e4b6c5a975f18511679c9))
* **admin:** 文字版连接列表的聚合状态不再藏掉部分失败 ([0d921e1](https://github.com/fanxiaocuo/gscore-adapter/commit/0d921e13d13862814e49a7c1f1316c3f565eb672))
* **admin:** 无名连接的六处回复不再显示「连接 undefined」 ([1754d20](https://github.com/fanxiaocuo/gscore-adapter/commit/1754d20c21fa3b013a262bf3da30127b84dd7f1b))
* **admin:** 未命名连接不再回复「连接 undefined」 ([72fd8c9](https://github.com/fanxiaocuo/gscore-adapter/commit/72fd8c98308cd2b834d32e1b2c525e7cfabfbe17))
* **client:** QQBot 下行图片补目标校验、失败回退与安全摘要日志 ([c5765e4](https://github.com/fanxiaocuo/gscore-adapter/commit/c5765e4e7258cf07d6183e5196d7aca27910f825))
* **client:** QQBot 自愈过的发送不重发，频道被动回复不误降级 ([6c62c60](https://github.com/fanxiaocuo/gscore-adapter/commit/6c62c605b56291593fd6cd46a8cab902ff7ebad2))
* **client:** QQBot 部分投出不再计成一次完整中转 ([0da75c4](https://github.com/fanxiaocuo/gscore-adapter/commit/0da75c4f2b6b1a3adfd7ac105ce267fb152ad71c))
* **client:** 只重启一条连接时不再重打别条的错误日志 ([1dba353](https://github.com/fanxiaocuo/gscore-adapter/commit/1dba353e80929f3983a7c3460d001d7eb5a8a86c))
* **client:** 同名连接不再被静默丢掉，也不再在面板上报假绿 ([5d5b3eb](https://github.com/fanxiaocuo/gscore-adapter/commit/5d5b3eb2f8793d6c38acc73bdaf242f1eda872cb))
* **client:** 按稳定路由收敛运行时连接，不再按显示名停起 ([9fcc086](https://github.com/fanxiaocuo/gscore-adapter/commit/9fcc086f9f3b90eec629cf2dac007a0e535eaa93))
* **client:** 收紧运行时连接敏感信息边界 ([f186beb](https://github.com/fanxiaocuo/gscore-adapter/commit/f186beb09cbcf999f26899f1a9ec90f49ba9a651))
* **client:** 空写的内联 token 不再顶掉配置里的凭据 ([8f8bf2f](https://github.com/fanxiaocuo/gscore-adapter/commit/8f8bf2fd5ebef85c65adb49550390988db754edd))
* **client:** 编辑连接前按仲裁结果判冲突，不再用 origin 误伤 ([4b3d6cb](https://github.com/fanxiaocuo/gscore-adapter/commit/4b3d6cb2c273c35cd5d719356fe45dff1b2e7ea4))
* **config:** bot_id_map 的数字键按存在与原样往返判，不再写串账号 ([def816c](https://github.com/fanxiaocuo/gscore-adapter/commit/def816c7a33f5cc10c0b0840e1013b274789190b))
* **config:** make connection saves transactional ([21b9cb7](https://github.com/fanxiaocuo/gscore-adapter/commit/21b9cb7475c528300b04d177566a245308fc03a4))
* **config:** 内联 token 不再被静默丢弃 ([042b39d](https://github.com/fanxiaocuo/gscore-adapter/commit/042b39d5faa1b356924e75c939ceafd914036fec))
* **config:** 改地址不丢查询参数，连接级 bot_id 按账号迁移 ([aef56dc](https://github.com/fanxiaocuo/gscore-adapter/commit/aef56dc86990e21845e010227e45c0b06dc0e76a))
* **config:** 频道事件的平台判定压过账号级映射 ([7c682dc](https://github.com/fanxiaocuo/gscore-adapter/commit/7c682dcf8ab2b1c1cfe5e0ba20dc99ba594c4ae7))
* **convert:** 空 markdown 不透传，并指向核心图片配置 ([3928c7a](https://github.com/fanxiaocuo/gscore-adapter/commit/3928c7a91d473e34ea856b45b852b5677b5b3568))
* **media:** 上行外链不使用下行 link 包装 ([b1a2c19](https://github.com/fanxiaocuo/gscore-adapter/commit/b1a2c19cfc02546a56106ef59eef7c9b09bb678b))
* **panel:** 正常跑着的连接不再顶着「有连接没能启动」的红框 ([8293014](https://github.com/fanxiaocuo/gscore-adapter/commit/8293014389602015929a2eb066a91d27177bc4cf))
* **panel:** 重连次数不再在同一行里写两遍 ([d31349b](https://github.com/fanxiaocuo/gscore-adapter/commit/d31349b27bf8468e11ea955ae85ab50e94f6ba5f))
* **panel:** 重连次数的措辞与出图统一 ([a69d9b6](https://github.com/fanxiaocuo/gscore-adapter/commit/a69d9b663017947f772bf8abbd8bd081cd0b9425))
* **protocol:** 适配引用正文与 reply_id 字段 ([fa339c9](https://github.com/fanxiaocuo/gscore-adapter/commit/fa339c957342e155a8521a483d041615d251581e))
* **render:** 出图上的四处显示错位 ([93b76b9](https://github.com/fanxiaocuo/gscore-adapter/commit/93b76b9aef0c9c1833ef9336570d2bfc351d1223))
* **render:** 子行按状态排序，详情模式不再截断 ([aad951e](https://github.com/fanxiaocuo/gscore-adapter/commit/aad951eaa024ddb00a93e8233182a2849f8e3f54))
* **url:** 保持端点规范化契约 ([133e4ea](https://github.com/fanxiaocuo/gscore-adapter/commit/133e4ea7569b068b5bfac1160a3be3d0f3ff5913))
* **url:** 根端点带查询串时不补尾斜杠 ([89e0fc6](https://github.com/fanxiaocuo/gscore-adapter/commit/89e0fc6afdc98006d92cd3a7023bf7c18b5165c9))
* **url:** 空写的 ?token= 不再让面板与状态图说「已配 token」 ([00a0c76](https://github.com/fanxiaocuo/gscore-adapter/commit/00a0c76457fc27616616a09c51fa52987abf3f2a))
* **webui:** 修掉绑定开关的错误话术与表单自弹回 ([47d9ee2](https://github.com/fanxiaocuo/gscore-adapter/commit/47d9ee2e32e8a4d3822c3a8127285328fb198f91))
* **webui:** 开关描边按主题分色，边界对比度过 3:1 ([7534817](https://github.com/fanxiaocuo/gscore-adapter/commit/7534817aeedb4ab28dae572e5687ad677c23fb6d))
* **webui:** 收掉面板自查的四处小毛病 ([93b35d7](https://github.com/fanxiaocuo/gscore-adapter/commit/93b35d72de2ec22767e74b5b499f06e03df9de03))
* **webui:** 错误列表的 key 用下标，同名连接不再吞掉一条 ([d72dd11](https://github.com/fanxiaocuo/gscore-adapter/commit/d72dd11b628d9cd27e9716213a01e5e28b790f9c))


### ♻️ 代码重构

* **client:** 新增完整候选校验，尚未接线 ([013dbfc](https://github.com/fanxiaocuo/gscore-adapter/commit/013dbfc1b0545718c4205f2724a6dee3db26658a))
* **client:** 连接名的地址退路也过 redactUrl ([39a7a58](https://github.com/fanxiaocuo/gscore-adapter/commit/39a7a586683619c78cc2c6c2f5aea2ded25a807c))
* **config:** 删除旧配置迁移，不再改写用户的连接地址 ([2ae2fe2](https://github.com/fanxiaocuo/gscore-adapter/commit/2ae2fe25aeffad02d309e11f2952b2c2b7914e7d))
* **constants:** STATUS_TEXT 标 Record，渲染处去掉走不到的兜底 ([b64c0c4](https://github.com/fanxiaocuo/gscore-adapter/commit/b64c0c4f5de3e662745623639b142eca8971c2ee))
* **log:** 移除日志 URL 查询串脱敏 ([37b2794](https://github.com/fanxiaocuo/gscore-adapter/commit/37b279420035bad42dd02810f63669787683ddbb))
* **types:** SendTarget 声明被动发送要读的五个字段 ([5e1797f](https://github.com/fanxiaocuo/gscore-adapter/commit/5e1797fa765f528a5f4f0fa164cee173cd3d0686))
* **url:** 端点存 origin，账号路径改为运行时生成 ([16f8793](https://github.com/fanxiaocuo/gscore-adapter/commit/16f87930295b70796d233ee89090401824e55e94))


### 📝 文档

* **config:** 说清 bind 留空会让整条连接被跳过 ([edd7649](https://github.com/fanxiaocuo/gscore-adapter/commit/edd7649c177a13545c84b783e036d3ac64bfa05c))
* **config:** 默认连接与锅巴文案改为核心 origin ([d789859](https://github.com/fanxiaocuo/gscore-adapter/commit/d789859e59924cfd2447c798a2e4875ae54a5106))
* define PR 10 remediation design ([f2a1867](https://github.com/fanxiaocuo/gscore-adapter/commit/f2a1867801cf67d52fbdb65525fdcc42c0bc25cf))
* design account-scoped core connections ([7c190c4](https://github.com/fanxiaocuo/gscore-adapter/commit/7c190c475311527ab4672b973510ae11a2f1adba))
* design exact multi-bot resolution ([37b569a](https://github.com/fanxiaocuo/gscore-adapter/commit/37b569a7bf722c4b809532c69c8aa37ebdbdb299))
* design inbound media URL direction ([d4e4e52](https://github.com/fanxiaocuo/gscore-adapter/commit/d4e4e52163f87e796800604995c401d12d0d50eb))
* **spec:** PR 10 的测试与 CI 口径改为测试留在本地 ([1318c21](https://github.com/fanxiaocuo/gscore-adapter/commit/1318c216ba7e66013d284e09ef876c8d18457adf))
* **webui:** 写明 status_text 不含重连次数 ([0487831](https://github.com/fanxiaocuo/gscore-adapter/commit/048783180c218e0bb053d9fc1e358a70c628ff85))
* 不再文档化 bind=all，修掉 panel.md 结尾空行 ([b59e016](https://github.com/fanxiaocuo/gscore-adapter/commit/b59e016a2dc631b121344e813045a831a73fe648))
* 内联 token 的说明跟上「两种地址都摘」的实际行为 ([09b02c6](https://github.com/fanxiaocuo/gscore-adapter/commit/09b02c6b0f6289d3200752c16386eb64d1739005))
* 文档与字段注释跟上删掉迁移之后的实际行为 ([737219e](https://github.com/fanxiaocuo/gscore-adapter/commit/737219e9c859e859d6a2f2abc927e2d3ad20de62))
* 更新账号级连接、面板绑定与常见问题 ([1e0dfca](https://github.com/fanxiaocuo/gscore-adapter/commit/1e0dfca8ee4de01b9e15867ffc9af34e2fe065fb))

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
