# 更新日志

本文件由 [release-please](https://github.com/googleapis/release-please) 依据
[Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 提交信息自动维护。

## [4.5.2](https://github.com/fanxiaocuo/gscore-adapter/compare/v4.5.1...v4.5.2) (2026-08-29)


### 🐛 问题修复

* **admin:** bind/exclude 读取统一走 readIds，不再漏 trim 与去重 ([1bd8f64](https://github.com/fanxiaocuo/gscore-adapter/commit/1bd8f64dad746d6872c03ded1553cd06a39e7212))
* **config:** 配置备份跟随 userFile，不再写进真实配置目录 ([3bc4fa9](https://github.com/fanxiaocuo/gscore-adapter/commit/3bc4fa955509b1f37295be61308a480654bc7178))
* **constants:** 重连次数也走共用取值，NaN 不再漏进面板 ([e503706](https://github.com/fanxiaocuo/gscore-adapter/commit/e5037067bf2069188f1022fc7f52de7754259503))
* **webadapter:** toggle / bind 的开关值也走严格解析，并给退避补下限 ([f35e0bf](https://github.com/fanxiaocuo/gscore-adapter/commit/f35e0bf80b0c48d03ac840d4c6b8be5126cda92f))
* **webadapter:** 全局布尔项也走严格解析，不再静默关功能 ([65c6e71](https://github.com/fanxiaocuo/gscore-adapter/commit/65c6e71821ca9a200ac9dfc578f8407beca7111e))
* **webadapter:** 合并进已有连接时顺手启用它，与指令层一致 ([1df8f82](https://github.com/fanxiaocuo/gscore-adapter/commit/1df8f821cbf301ef5e1b828c820b3f9f8dd1928b))
* **webadapter:** 非数组的 bind / exclude 恢复报错，别当成「没提交这一栏」 ([2048a58](https://github.com/fanxiaocuo/gscore-adapter/commit/2048a5871487f6fdeb6956700710860839b5fd26))


### ♻️ 代码重构

* **commands:** rule 正则与帮助条目改由声明表统一生成 ([e296e6a](https://github.com/fanxiaocuo/gscore-adapter/commit/e296e6a70f7d83720299889518d4f766d62d1073))
* **commands:** 前缀剥离改由声明表派生，消掉第二个漂移面 ([09dc8c2](https://github.com/fanxiaocuo/gscore-adapter/commit/09dc8c207c18fe3fca8cc0575064ea4ef24c13ad))
* **commands:** 收窄命令面，砍掉无文档的别名并补齐缺失条目 ([eabbf67](https://github.com/fanxiaocuo/gscore-adapter/commit/eabbf67e3e7eb5e2a1f0c989972a237549672549))
* **connections:** 修改连接也接入共用核心，两层校验合一 ([8dfe1c1](https://github.com/fanxiaocuo/gscore-adapter/commit/8dfe1c19efab9a86906af23921c7b06c2caae266))
* **connections:** 添加连接的校验与算 patch 抽成共用核心，两层同一套规则 ([3c20b51](https://github.com/fanxiaocuo/gscore-adapter/commit/3c20b51e4599ad84d2a7f7db5bad2283b9ad0da1))
* 收敛注释，并修审查带出的重连间隔三处漂移 ([a1884de](https://github.com/fanxiaocuo/gscore-adapter/commit/a1884de422dab680549dc59a1fc46696b12ecc9d))

## [4.5.1](https://github.com/fanxiaocuo/gscore-adapter/compare/v4.5.0...v4.5.1) (2026-08-26)


### 🐛 问题修复

* **convert:** 空串的 link/callback/input 不再产出点不动的按钮 ([349e0ea](https://github.com/fanxiaocuo/gscore-adapter/commit/349e0eabe912b6a837ced0e594d412c96628c12e))
* **webadapter:** 去掉宿主接口的索引签名，拼错的成员名现在真会报 ([6df246e](https://github.com/fanxiaocuo/gscore-adapter/commit/6df246e0d6ccdeed5e517186460312ab8f1d73fe))


### 📝 文档

* 更正构建戳的用途，宿主静态路由本就每次回源校验 ([36fcd6d](https://github.com/fanxiaocuo/gscore-adapter/commit/36fcd6d2cdbf046f73583d6820eedf1da7d098bc))

## [4.5.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v4.4.0...v4.5.0) (2026-08-26)


### ✨ 新功能

* **panel:** 三 tab 重排、配置项对齐锅巴、大小单位统一为 MB ([3a9b4d7](https://github.com/fanxiaocuo/gscore-adapter/commit/3a9b4d7bce95ba705265fcf04651ee6f1805f7f2))
* **panel:** 账号行改整行折叠、配色换赤陶暖调 ([7a8e316](https://github.com/fanxiaocuo/gscore-adapter/commit/7a8e316da98ef4213e1106ef81cf1a33fedd419e))
* **panel:** 连接卡账号行去重、tab 改分段控件、锅巴改真分组 ([4c1bfc9](https://github.com/fanxiaocuo/gscore-adapter/commit/4c1bfc9b68881f1cfb780863d529a3c045e4bbdb))


### 🐛 问题修复

* **admin:** 添加连接命中停用的示例连接时顺手启用 ([31e4278](https://github.com/fanxiaocuo/gscore-adapter/commit/31e4278b5d95ce578b10c375f598ffaa36c926c2))
* **config:** 手改配置文件不再被自身写盘的抑制闩吞掉 ([5e947fe](https://github.com/fanxiaocuo/gscore-adapter/commit/5e947fe307b3db6d27eff40a3326457ea44c986b))
* **convert:** 回调按钮「所有人」权限被当成用户白名单 ([1f5daaf](https://github.com/fanxiaocuo/gscore-adapter/commit/1f5daaf6fe194743186b680006a29777651462ac))
* **passive:** 按钮回调的 event_id 可用于被动回复 ([fce7f5e](https://github.com/fanxiaocuo/gscore-adapter/commit/fce7f5ec67c2f02e388b5f4943b4ba967250057d))
* **reply:** 引用 id 补 raw/raw_event 与 CQ 码来路 ([d5ca776](https://github.com/fanxiaocuo/gscore-adapter/commit/d5ca77672b65ceeaa8b542fd6881171db16e096d))


### 📝 文档

* README 精简为面向用户，致谢移入 CREDITS.md ([f556014](https://github.com/fanxiaocuo/gscore-adapter/commit/f556014702fc72513bf54b438cdb8c3789a8ea3a))
* README 补一句复用出厂示例连接 ([e9b5db0](https://github.com/fanxiaocuo/gscore-adapter/commit/e9b5db015ae1a4897c1771878d3dfd566174fcc9))
* **spec:** 面板那轮设计文档入库，附落地偏离 ([3c3ab49](https://github.com/fanxiaocuo/gscore-adapter/commit/3c3ab4904e5f0d47e37fc0e6ade930d775317948))
* 五页指南改写为任务导向 ([e1b142b](https://github.com/fanxiaocuo/gscore-adapter/commit/e1b142bfb6e51cfb6ad709173ca99d42ee99301e))
* 标题「装」改回「安装」 ([601e484](https://github.com/fanxiaocuo/gscore-adapter/commit/601e4842db9d6d04f90b8f25e135c68d2b623043))
* 补回标题 emoji ([b6ee728](https://github.com/fanxiaocuo/gscore-adapter/commit/b6ee728a66f84acbf47a15656232aa5838accc47))

## [4.4.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v4.3.0...v4.4.0) (2026-08-25)


### ✨ 新功能

* **render:** 背景改纯弥散渐变、连接卡账号去重，并修掉三处失效文档 ([#17](https://github.com/fanxiaocuo/gscore-adapter/issues/17)) ([ef1bbb4](https://github.com/fanxiaocuo/gscore-adapter/commit/ef1bbb4632f8c8ac1d0fa179e346e8d612f1de9d))

## [4.3.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v4.2.0...v4.3.0) (2026-08-24)


### ✨ 新功能

* **imagebed:** 挂一个转接口，让核心的 markdown 图走 ImageBed 插件 ([7b49592](https://github.com/fanxiaocuo/gscore-adapter/commit/7b495921881393066f67af8b5dd206b379da1a67))
* **render:** 四处卡面统一迁到液态玻璃，取值收成一处 ([1b4f454](https://github.com/fanxiaocuo/gscore-adapter/commit/1b4f454eebeee649b900ff795ca31f307c27dc56))

## [4.2.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v4.1.0...v4.2.0) (2026-08-23)


### ✨ 新功能

* **guoba:** 面板换上账号/群/好友选择器，三个数值栏按 MiB 与秒填 ([bbd5281](https://github.com/fanxiaocuo/gscore-adapter/commit/bbd5281d72ae34911438e970b0aa0c3254d3433a))


### 🐛 问题修复

* **client:** 回环防护的 Map 超上限时兜底删最旧的一批 ([b215087](https://github.com/fanxiaocuo/gscore-adapter/commit/b2150874d8b1de2a27d65b6f4a2a7bde4aab89d7))
* **config:** 三个写入口共用 media_max_size 上限，单位话术统一成 MiB ([1b76b05](https://github.com/fanxiaocuo/gscore-adapter/commit/1b76b050564d190b913918b627aa61189f120cad))
* **passive:** 用满的 msg_id 留在内存里当凭据，别删 ([ff6f712](https://github.com/fanxiaocuo/gscore-adapter/commit/ff6f7126a05db661f4f443802e266e49e9c29adf))
* **render:** 挡掉 rounded-full / grid-cols-4 两条凭空多出的死规则 ([e553fbb](https://github.com/fanxiaocuo/gscore-adapter/commit/e553fbb830272452e99e29a49b60efe5f07c7533))


### ⚡ 性能优化

* **client:** 过滤器的正文只在真要用时才拼 ([60300c8](https://github.com/fanxiaocuo/gscore-adapter/commit/60300c893db2bbb74bec08d78c2a23b6a89f4ed5))
* **render:** CHANGELOG 解析结果按 mtime 缓存 ([cecc220](https://github.com/fanxiaocuo/gscore-adapter/commit/cecc2205365aeb0678a3811a195549097026ac99))


### ♻️ 代码重构

* **db:** 抽出 utils/sqlite.ts 当落盘底座，两处库共用 ([64f0120](https://github.com/fanxiaocuo/gscore-adapter/commit/64f01207703f1434aaeaeb9a42f9de4e4eba9e0c))
* 删掉没人调的 stopFileServer，LOG_TAG 收回文件内 ([1851e0b](https://github.com/fanxiaocuo/gscore-adapter/commit/1851e0bc92b188868ba0c30d5eadc3a5c34b907b))


### 📝 文档

* 全项目注释压缩，长篇说明收成一句话加「注意：」 ([432d32f](https://github.com/fanxiaocuo/gscore-adapter/commit/432d32f40c1c424d0b7e6260f4f08629b9e78333))

## [4.1.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v4.0.0...v4.1.0) (2026-08-21)


### ✨ 新功能

* **render:** 统计卡换成液态玻璃，去掉深色发丝边 ([ffdc95e](https://github.com/fanxiaocuo/gscore-adapter/commit/ffdc95ec4a6895b8b2104c70af954b22af5f6b4e))


### ⚡ 性能优化

* **render:** 去掉色斑层的 CSS 模糊，帮助图出图 5815ms → 1950ms ([902b4c7](https://github.com/fanxiaocuo/gscore-adapter/commit/902b4c796951f2ea074197ab0e16b81fd83f9ed0))


### 📝 文档

* **render:** 记下 --disable-gpu 那个旋钮的决定：先不动 ([bfbc843](https://github.com/fanxiaocuo/gscore-adapter/commit/bfbc843aadc85f9cbfece8f46af0a7b9f4d9117c))

## [4.0.0](https://github.com/fanxiaocuo/gscore-adapter/compare/v3.3.1...v4.0.0) (2026-08-20)


### ⚠ BREAKING CHANGES

* **render:** 夜间那套从深色改成银灰玻璃，DARK 更名 COOL

### ✨ 新功能

* **docs:** 文档站换盐系双档配色，状态指示改用线不用面 ([872cac6](https://github.com/fanxiaocuo/gscore-adapter/commit/872cac6681e699d6192f17600715f3e09a46413c))
* **render:** 出图换压花玻璃质感，正文配色按实测像素重配 ([0e3b238](https://github.com/fanxiaocuo/gscore-adapter/commit/0e3b2385cac20ba259abdfdc76e4658e23cf3ad1))
* **render:** 夜间那套从深色改成银灰玻璃，DARK 更名 COOL ([3dfbe62](https://github.com/fanxiaocuo/gscore-adapter/commit/3dfbe6263a7288e095e04aedc70a90e1fe4b3d17))
* **render:** 指令清单改无框侧线版式，背景换五团弥散渐变 ([9d86e8c](https://github.com/fanxiaocuo/gscore-adapter/commit/9d86e8c5a8965b5feb0c712d6e9d54497c2093ef))
* **render:** 收紧统计卡比例，分组计数改渐变数字，加渐变点缀档 ([8591b32](https://github.com/fanxiaocuo/gscore-adapter/commit/8591b32b4f148d241690ca77f24255111041842f))


### 🐛 问题修复

* **docs:** 修移动端浮层透明与搜索按钮椭圆 ([74284b5](https://github.com/fanxiaocuo/gscore-adapter/commit/74284b552167ac9ec7588ac8089e8b0c71de239b))
* **protocol:** 回查合并转发内容，不再把 forward 段序列化进 raw_text ([8da50aa](https://github.com/fanxiaocuo/gscore-adapter/commit/8da50aad29f7c38ca045b774ae55b845f47b7ba4))
* **render:** 子分组改上下结构两列，长参数名不再溢出压住说明 ([85f2af1](https://github.com/fanxiaocuo/gscore-adapter/commit/85f2af1bbb7b6ac8814aa3d648c4a8d2fad549c7))


### ⚡ 性能优化

* **render:** jpeg 质量 88→82，出图体积降 22% ([dc3a526](https://github.com/fanxiaocuo/gscore-adapter/commit/dc3a52690674d2697470e17753bb886f878453f9))
* **render:** 帮助图条目改多列流式排版，页高 3140→2852px ([4b0688a](https://github.com/fanxiaocuo/gscore-adapter/commit/4b0688a0c15b9159536559a6b5beab016e8d3841))


### 📝 文档

* **render:** 修正 DESIGN.md 与注释里的实测数字和脚本路径 ([38502ea](https://github.com/fanxiaocuo/gscore-adapter/commit/38502ea6da3a0df5c0d5b71f86b9670d8e60482a))

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
