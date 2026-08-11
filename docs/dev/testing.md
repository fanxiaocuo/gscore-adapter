# 测试

测试分两块：跑编译产物的端到端脚本，和直读 `src/` 的渲染层测试。

::: info test/ 与 docs/ 都在 .gitignore 里
克隆下来的仓库没有它们。CI 因此没有测试步骤，把关的是 `typecheck` / `lint` / `build` 三道加产物完整性自检。
:::

## 命令

```bash
node test/modules/client.js       # 连接端到端（含 1005 重连）
node test/modules/notice.js       # 非消息事件
node test/apps/admin.js           # 管理指令（yaml 注释保留）
node test/integration/e2e.js      # 协议与消息段转换、回环防护
pnpm test                         # 渲染层，node:test，直读 src/ 需 --import tsx
```

前四套跑的是 `lib/` 编译产物，先 `pnpm build`。它们起本地 mock ws 服务端，不连真实核心；`admin.js` 用 `GSCORE_CONFIG` 把配置指向临时文件，不会动你的 `config/config.yaml`。

## 版式怎么验

改版式不靠肉眼验，靠逐元素比对 computed style：`pnpm preview` 出静态 HTML，`test/geom.mjs` 抓每个元素的 boundingBox + computed style，`test/geomdiff.mjs` 逐项比对（忽略 `cls` 字段，类名本来就该变）。Tailwind 迁移与 ktr 迁移都是这么验的，零差异。

## 验证边界

测试证明发出的包符合已核实的协议规格，但不覆盖真实核心插件对 meta 事件名的接受情况——核心用事件名匹配插件注册的触发器、自身不做校验，认不认那三个名字取决于装了哪些核心插件。这部分只能连真实核心验证。
