# 架构

`main` 分支放 TypeScript 源码，跑之前必须自己编译。

## 上手

```bash
git clone https://github.com/fanxiaocuo/gscore-adapter.git ./plugins/gscore-adapter
cd plugins/gscore-adapter
pnpm install
pnpm build       # src/*.ts -> lib/*.js，再出 Tailwind CSS
```

运行时加载的是 `lib/`（不入库），**改完 `src/` 必须重新 build**，或用 `pnpm build:watch` 增量编译。`pnpm dev` 起长驻服务器，改完存盘自动重建并刷新浏览器。

## 目录结构

```
src/
├── index.ts        真正的入口：按 enable 拉起连接，并加载 apps
├── dir.ts          路径常量（全部由 import.meta.url 推出）
├── types/          协议与配置的类型声明（无运行时代码）
├── constants/      状态文案、回环缓存上限、日志正则
├── config/         配置读写、热重载、bot_id 解析、连接增删改的写盘封装
├── utils/          日志 / 媒体 / 地址规范化 / 会话判定 / 引用 id 反算 / 发送结果判定 / 能力探测 / 机器人档案
├── modules/
│   ├── convert/    消息段双向转换      ├── client/    连接类、展开、生命周期、回环缓存
│   ├── notice/     meta event 转换     ├── render/    出图
│   ├── stats/      中转计数            ├── update/    检查更新与拉取
│   ├── passive/    QQBot 被动回复窗口  ├── guoba/     锅巴面板
│   ├── conflict/   适配器冲突检测      ├── webadapter/ web 面板
│   └── loader/     apps 静态导入表
└── apps/           status / admin / update 三组指令
```

## 连接的两段式启动

配置里的一条连接不是一条 ws。中间隔着一次**展开**：

```
逻辑连接                展开                运行时连接              客户端
WsConnection    →   expandConnections   →   RuntimeWsConnection  →  GsCoreClient
（配置的一项）      （client/expand.ts）    （+ 账号、名字、地址）   （client/lifecycle.ts）

url:  ws://host:8765                        /ws/Yunzai-账号A        连接名 [账号A]
bind: [账号A, 账号B]                         /ws/Yunzai-账号B        连接名 [账号B]
```

| 阶段 | 谁产出 | 关键点 |
| :--- | :--- | :--- |
| 逻辑连接 | `config/` 读 yaml | 只有核心地址与 `bind` / `exclude`，不含路径 |
| 展开 | `expandConnections(list)` | 纯函数，回 `{ runtime, errors }`，不打日志 |
| 运行时连接 | 同上 | 多出 `account` / `runtimeKey` / `runtimeName` / `runtimeUrl` / `sourceIndex` / `automatic` |
| 客户端 | `startClient(conf)` | **唯一**的 `new GsCoreClient` 处，按 `runtimeKey` 去重 |

展开这一步做的事：

- 停用的（`enable === false`）直接跳过
- 有效账号 = `bind` 减 `exclude`，去重保序；两边都写了的账号按 `exclude` 处理并记一条 error
- 地址 pathname 为空或根 → **自动端点**，按每个有效账号派生一条，地址由 `materializeAccountUrl` 拼成 `/ws/Yunzai-<账号>`（账号只当一个 path segment，`/`、`?`、`#` 都被编码掉），运行时 `bind` 收窄成该单账号；一个有效账号都没有则整条跳过并记 error
- 非根路径 → **兼容连接**，路径原样不动、只派生一条，`bind` 在它上头是转发过滤器（最终由 `GsCoreClient.accept` 判）
- 两种地址里内联的 `?token=` 都在这里被摘回 token 字段，运行时地址本身不带凭据
- 全局按 `routeKey`（协议 + host + pathname）判重，撞上了先到先得，被跳过的那条记一条 error

`errors` 由调用方决定怎么用：收敛那条路径打日志（`lifecycle.ts` 的 `logErrors`，按 `skipped` 分 error / warn），面板整包带回前端（`Payload.errors`），出图那条路径刻意不打——同一批错误在收敛时已经报过一次。也因此**展开必须整表做**：路由冲突是全局裁决，逐条展开既拿不到上下文，又会把同一批错误算 n 遍。

### 两个键：`runtimeKey` 认身份，`sourceIndex` 做聚合

`runtimeKey` 是规范化后的运行时路由（协议 + host + pathname；query 不参与，协议与 host 归一到小写，**路径保留大小写**）。它是「这条客户端是谁」的唯一判据。

为什么不用显示名：名字会变，路由不会。改个名字、或者删掉前面一条让 `连接 #N` 整体前移，按名字比对就会把一条没动过的连接判成「旧的不见了、多了个新的」，于是把一条正在正常收发的连接断掉重连一次——退避 5 秒起步，期间的消息是真的丢。反过来路径大小写必须保留：核心侧把 `/ws/<bot_id>` 整段当客户端标识，而 HTTP 路径大小写敏感，账号 `BotA` 与 `bota` 在核心眼里是两个客户端，两条连接都该起来。

`sourceIndex` 是这条运行时连接在 `client.connections` 里的下标，管的是「归属」而不是「身份」：

| 用处 | 位置 | 用哪个键 |
| :--- | :--- | :--- |
| 面板把 N 条 ws 归到一张卡片 | `webadapter` 的 `connView` | `sourceIndex` |
| `#早柚状态` / `#早柚连接列表` 按来源聚合、逐账号列子行 | `render/pages.ts` 的 `collect` | `sourceIndex` |
| 把展开诊断收窄到本次改动的那一条 | `lifecycle.ts` 的 `logErrors` | `sourceIndex` |
| 停起、复用、路由冲突仲裁 | `lifecycle.ts` 的 `reconcileClients` | `runtimeKey` |
| 面板与状态图认活客户端 | `connView` / `collect` | `runtimeKey` |
| 收发计数分桶 | `stats` 的 `byName` | `runtimeName` |

最后两行相邻却用两个键，是有意的：认人按路由（改名不该让面板把一条连着的连接印成「未启动」），取数按名字（分桶键**就是**运行时名字，换成路由取不到桶、计数恒为 0 且不报错）。

删掉一条配置会让后面各条的下标整体 -1，但**不需要**谁去手工推算位移：收敛按新计划整批重算每条客户端的 `sourceIndex` 与显示名。早先是 `removeConnection` 之后手工调 `shiftSourceIndex`，那套还漏了更要紧的一半——被删的那条可能正占着别条要用的路由，释放之后被顶掉的那条本该起来，而位移压根不会去起它，用户只看到「删掉了冲突的那条，被顶掉的还是不连」。不经展开直传逻辑连接造出来的客户端 `sourceIndex` 是 `-1`（现在只有测试与直接调 `startClient` 会这样），各处聚合都会把它排除在外。

面板的绑定开关也不再是例外。它只表达一个账号的意图，过去要靠「按 `accountRuntimeName` 拼出名字精确停那一条」来避免连带断线，而拼得与展开器不一致就停不掉、`stopClient` 找不到人还只回 `false` 不报错。现在它同样走整批收敛：别的账号的 `runtimeKey` 在新计划里原封不动，被原地留着；被拨的那个账号是计划里多出来或少掉的一个键，只有它被起或停。

## 配置写盘的分层

改配置一律走 `config/index.ts`，按抽象程度分三层，上层入口（指令 / 锅巴 / Web 面板）只挑合适的一层调：

| 层 | 函数 | 用途 |
| :--- | :--- | :--- |
| 通用 | `saveConfig(fn)` | 拿到 yaml `Document` 任意改，保留注释、写盘、热重载一步完成 |
| 连接 | `appendConnection` / `updateConnection` / `removeConnection` | 连接的增 / 改 / 删。内部自带「文件里没有 `connections` 键时把运行时列表物化进文件」的兜底 |
| 补全 | `upgrade.ts` | 仅模块首次加载时跑：补缺失顶层键、把 `ws_connections` 键名换成 `connections`、给每个绑定账号补一行 `bot_id_map`。**不动已有的项** —— 尤其不改写用户写的连接地址 |

两条约定：

- **校验留在调用方**。指令要回中文短句、面板要回 400 JSON，错误的措辞与时机不同；连接层只负责「条目存在」这一个不变量（`连接序号 X 不存在`）。
- **写盘出口统一过 `unflow`**（`config/yaml.ts`）：`createNode` 产出的 flow 风格集合在这里拍回块状，新加写入点不必各自记这件事。

`updateConnection` 的 patch 语义：`undefined` 跳过、`null` 删除该键、数组自动 `createNode`。每个 bind 账号的平台标识写在 `bot_id_map`。

## 只有面板走打包器

两侧的取向是相反的，别把其中一边的做法套到另一边。

**Node 侧（`src/` 除 `webui/`）不打包**：由 `tsc` **逐文件**输出到 `lib/`，镜像 `src/` 的层级（`tsc-alias` 负责把 `@/` 别名与目录 import 补成完整路径）。理由：

- `sqlite3` 是原生模块，打进去会让降级分支永远走失败路径
- `ws` / `yaml` / `chokidar` 复用宿主那一份
- 单文件产物既不导出组件供测试 import，import 它还会触发插件的全部副作用

出图组件（`modules/render/`）也在这一侧：它是 Node 里跑的 SSR，只把 JSX 拼成 HTML 字符串，不进浏览器。

### 出图借了 template-react 的哪半

`modules/render/index.ts` 用 `@karinjs/template-react` 的 `HtmlWrapper`（DOCTYPE / meta / `#container` 外壳）与 `createRenderer`（SSR + 写盘），**但刻意只借这两个**。搜代码时注意包名是 `template-react`，不是 `react-template`。

刻意不接的那半，以及为什么：

| 它的约定 | 我们的做法 | 不接的理由 |
| :--- | :--- | :--- |
| 目录即路由（`ktr/template/<板块>/<模板>/index.tsx` + `ktr sync` 生成 `.ktr/`） | `createRenderer` 收一张普通「路由 → 组件」映射表，在 `render()` 里现构 | 迁过去要动 10+ 个 `test/probe` 的引用路径与 tailwind 的 `@source`，而 `Layout.tsx` / `Icons.tsx` 这类跨模板共享组件在它的约定里没有位置。省下的是那张表的一行 |
| 样式基座 `@import '@karinjs/template-react/styles'` | 自己的 `styles/tailwind.css` + `base.ts` | 它带整套 HeroUI v3，三条直接对撞：① HeroUI 的重置与 `base.ts` 那条 `*,*::before,*::after` 叠加会改像素，而本模块的验收标准是「像素不变」；② 它要求 `dark:` 走类选择器、框架挂 `dark` 类，本模块靠 `cssVars` 换 `:root` 变量、不挂主题类；③ 它明文禁止再写普通 `@theme` 映射块（会盖掉 HeroUI 的 `@theme inline`），而那正是本模块 token 体系的地基 |
| `ktrBuildPlugin()` 收 `build:css` | 独立一条 `build:css` | 实测三条都不行，见下 |

::: danger 别把 ktrBuildPlugin() 挂进 vite.config.mts
挂上去（`cssEntry` 指向出图那份样式）跑一次真实 `vite build` 的结果：

1. CSS **14.9 KB → 479.5 KB** —— 它的基座把整套 HeroUI 拉进来，而这份 CSS 是要**内联进每张图的 HTML** 的
2. 输出名恒为 `style.css`、目录跟随打包器 `outDir`，于是落进 `webadapter/` —— 那是宿主白名单目录
3. 它同时跑注册表同步，生成 0 个模板的 `.ktr/` 与 `ktr/template/style.css` 死脚手架

重验的话记得删 `webadapter/style.css`、`.ktr/`、`ktr/`（它会自己建）。
:::

**面板（`src/webui/`）打包**：`build:panel` 走 `vite build`（Vite 8 内置 Rolldown），配置见 `vite.config.mts`。这份代码真的跑在浏览器里，React 运行时必须进 bundle。产物两个，文件名是 QQBot-Web-Adapter 的静态白名单写死的，改名就 403：

| 产物 | 说明 |
| :--- | :--- |
| `webadapter/panel.js` | IIFE 格式 —— `page.html` 用的是普通 `<script src>`，不是 module |
| `webadapter/page.css` | `main.tsx` 里 `import "./styles.css"` 被 Vite 抽出来的 |

`page.html` 不由 Vite 生成，手维护（它带着宿主契约的注释与 favicon 逻辑）。`emptyOutDir` 必须保持 `false`：`webadapter/` 里还有手维护的 `page.html` 和宿主入口 `index.js`。

::: tip 面板的 NODE_ENV 要显式 define
lib 模式下 Vite 按「库由使用方定义」的约定不替换 `process.env.NODE_ENV`，但这是浏览器 IIFE，没有下游使用方。不 define 的话 react-dom 开发版会整个打进来（591KB vs 183KB），运行时还会因 `process` 未定义直接抛错。
:::

## 产物必须落在 lib/index.js

框架 loader 只认 `plugins/<name>/index.js`，根目录 `index.js` 只是 `export * from "./lib/index.js"`；`src/dir.ts` 也靠 `import.meta.url` 上跳一级定位插件根。

## build:css 扫源码，与 tsc 顺序无关

`build:css` 把 `src/modules/render/styles/tailwind.css` 编译到 `resources/template/css/`（不入库）。它扫的是**源码** `src/modules/render/components/*.tsx`。

::: tip 这里原先写着相反的话
旧文档断言「它扫的是 `lib/` 下的组件产物」，因此「`build:css` 必须排在 `tsc` 之后」。两句都是错的：`tailwind.css` 里那行是 `@source "../components/*.tsx"`，相对该文件解析到 `src/`，与 `lib/` 无关。

实测（删掉整个 `lib/` 后单独跑 `pnpm run build:css`）：产物 14903 字节，与有 `lib/` 时**逐字节相同**。所以两步谁先谁后都行。

历史上确实扫过 `lib/*.js`，理由是「产物一定与实际渲染同步」；中途改用打包器时那个目录消失过一阵才改成扫源码，之后没再改回去 —— 扫源码正是为了摆脱这条顺序约束。详见 `styles/tailwind.css` 的「@source 指向 tsx 源码」一段。
:::
