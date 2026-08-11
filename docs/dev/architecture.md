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
├── config/         配置读写、热重载、bot_id 解析
├── utils/          日志 / 媒体 / 会话判定 / 引用 id 反算 / 发送结果判定 / 能力探测
├── modules/
│   ├── convert/    消息段双向转换      ├── client/    连接类、生命周期、回环缓存
│   ├── notice/     meta event 转换     ├── render/    出图
│   ├── stats/      中转计数            ├── update/    检查更新与拉取
│   ├── passive/    QQBot 被动回复窗口  ├── guoba/     锅巴面板
│   ├── conflict/   适配器冲突检测      ├── webadapter/ web 面板
│   └── loader/     apps 静态导入表
└── apps/           status / admin / update 三组指令
```

## 为什么不用打包器

产物由 `tsc` **逐文件**输出到 `lib/`，镜像 `src/` 的层级，不打包（`tsc-alias` 负责把 `@/` 别名与目录 import 补成完整路径）。理由：

- `sqlite3` 是原生模块，打进去会让降级分支永远走失败路径
- `ws` / `yaml` / `chokidar` 复用宿主那一份
- 单文件产物既不导出组件供测试 import，import 它还会触发插件的全部副作用

## 产物必须落在 lib/index.js

框架 loader 只认 `plugins/<name>/index.js`，根目录 `index.js` 只是 `export * from "./lib/index.js"`；`src/dir.ts` 也靠 `import.meta.url` 上跳一级定位插件根。

## build:css 的顺序约束

::: warning build:css 必须排在 tsc 之后
`build:css` 把 `src/modules/render/styles/tailwind.css` 编译到 `resources/template/css/`（不入库）。它扫的是 **`lib/` 下的组件产物**。
:::
