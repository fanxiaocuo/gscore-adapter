# 上行媒体 URL 方向修复设计

日期：2026-08-14

## 背景

OneBot 账号发送“上传角色面板图”命令并附带图片后，消息能够到达 gsuid_core，命令也能正常匹配，但核心下载图片失败。

脱敏后的日志证据表明：适配器把一个正常的 HTTP(S) 图片地址编码成了 `link://` 包装形式；核心入站处理把图片段原样写入 `event.image`，下游插件再把它直接交给 HTTP 下载器，因此下载器拒绝不受支持的 `link` 协议。

根因不是账号路由、命令匹配或原始图片链接失效，而是适配器混淆了媒体协议方向：

- `link://` 属于 gsuid_core 构造下行 MessageSegment 时使用的外链标记；核心的 `segment.py` 会生成它，Bot 侧适配器收到后负责解包。
- 核心 → 适配器的下行媒体因此继续支持 `link://`。
- 适配器 → 核心的上行媒体应使用裸 HTTP(S) URL、`base64://` 或二进制语义；核心入站 handler 把段数据原样写进事件/资源管理器，不会统一解包 `link://`。

## 目标

1. 所有云崽 → 核心的上行图片、语音和视频外链均使用裸 HTTP(S) URL。
2. 小媒体继续使用 `base64://`，不增加额外下载或重复编码。
3. 核心 → 云崽的下行 `link://` 兼容行为保持不变。
4. 文件段协议保持不变。
5. 日志、测试报告和提交信息不包含实际媒体 URL、媒体正文或请求凭据。

## 非目标

- 不修改 gsuid_core 仓库。
- 不改变 WebSocket 连接、账号绑定或 bot_id 解析。
- 不重构文件段协议。
- 不新增媒体缓存、图床或下载重试机制。

## 方案

### 上行编码

`src/utils/media.ts` 中的 `toGscoreMedia()` 明确只负责云崽 → 核心方向：

- 输入被解析为 Buffer 且不超过限制：返回 `base64://<内容>`。
- 输入或转换结果为 HTTP(S) URL：直接返回裸 URL。
- 本地文件或超限媒体通过框架文件服务、内置文件服务或自定义图床获得 HTTP(S) URL：直接返回裸 URL。
- 无法获得合法媒体内容时继续返回空字符串并沿用现有错误处理。

`src/modules/convert/toGscore.ts` 中的 image、record、video 三个分支继续复用 `toGscoreMedia()`，无需各自增加协议修补。

### 下行解码

`fromGscoreMedia()` 不变，继续接受：

- `link://`：剥离后返回 HTTP(S) URL；
- `base64://`：原样返回；
- data URI：转换为 `base64://`；
- 裸 HTTP(S) URL：原样返回。

这保留核心下行协议兼容性，同时把上行和下行职责分开。

## 数据流

上行：

1. OneBot/其他适配器产生图片、语音或视频消息段。
2. `msgToGscore()` 读取段里的 `url` 或 `file`。
3. `toGscoreMedia()` 将小媒体编码为 `base64://`，或将可访问外链保留为裸 HTTP(S)。
4. `GsCoreClient` 发送 MessageReceive。
5. gsuid_core 把媒体段原样写入事件/资源管理器，下游可直接下载或解析。

下行：

1. gsuid_core 发送 `link://`、`base64://` 或裸 URL。
2. `fromGscoreMedia()` 转成云崽适配器可消费的 URL/Buffer 表示。
3. 现有发送逻辑保持不变。

## 错误与安全边界

- 只接受现有转换链产生的 HTTP(S) URL；不把其他自定义 scheme 改写成可下载地址。
- 不在日志中输出完整外链、媒体正文或 base64。
- 测试使用本地构造的无敏感示例，并断言日志摘要不含媒体正文。
- 原始日志中可能出现的请求元数据不进入文档、测试、提交信息或用户可见输出。

## 测试

新增或扩展本地媒体测试，覆盖：

1. HTTP(S) 图片上行得到裸 URL，不含 `link://`。
2. HTTP(S) 语音和视频上行遵循同一规则。
3. Buffer/小文件仍得到 `base64://`。
4. 文件服务或 fallback 返回的 HTTP(S) URL不被二次包装。
5. `fromGscoreMedia("link://...")` 的现有下行兼容不回退。
6. 全量测试、TypeScript 类型检查和 ESLint 通过。

真机验证使用原始 OneBot 命令加一张图片：核心下载器应接收 HTTP(S) URL并成功保存面板图，不再产生 UnsupportedProtocol。
