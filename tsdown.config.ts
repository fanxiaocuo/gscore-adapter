/**
 * 打包配置
 *
 * 产物是单个 lib/index.js（ESM）。框架的加载方式见 Miao-Yunzai 的
 * lib/plugins/loader.js：插件目录下有 index.js 就只 import 那一个文件，
 * 因此单文件产物与它天然兼容，不需要保留 lib/ 下的目录结构。
 *
 * 为什么要打包
 * -----------
 * 原先 tsc 逐文件输出，lib/ 下是几十个 .js，运行时靠 loadApps() 扫目录 +
 * 动态 import 串起来。收益在启动路径上：Node 只解析一个文件，省掉几十次模块
 * 解析与 fs stat；顺带把「扫目录」这条运行时反射换成了 apps/index.ts 里的静态
 * 导入表——少一处「新增文件忘了会静默不生效」的坑。
 *
 * 依赖一律不打进产物
 * ----------------
 * 这是 tsdown 对 dependencies 的默认行为，这里顺着它，没有配 deps.onlyBundle。
 * 于是 react / react-dom / lucide-react 在产物里仍是 import 语句，运行时从
 * node_modules 解析。理由：
 *   - react 打进来就有两份的风险（宿主自己也可能加载 react），而 react 的
 *     内部状态是模块级单例，双副本的症状很隐蔽
 *   - 发布体积小，用户 pnpm install 本来就是现状（README 已写）
 * 代价是 lucide 的图标没有 tree-shaking——但 Icons.tsx 只从它 import 了 14 个
 * 具名图标，未引用的部分根本不会被 Node 求值，运行时开销与摇掉基本无差。
 *
 * ws / yaml / chokidar 也留给宿主：它们是 peerDependencies，宿主
 * （Miao-Yunzai 根 package.json）已经装了，插件的本意就是复用那一份。打进产物
 * 等于夹带第二份 ws——真正的坑不是体积，而是 instanceof 与单例会跨副本失效。
 *
 * sqlite3 同理，而且更硬：它是 `"sqlite3": "npm:@karinjs/sqlite3"` 指过去的
 * **原生模块**（带 .node 二进制），打包器只能把 JS 那层塞进产物，require 二进制
 * 的路径当场失效。db.ts 那处是 `await import("sqlite3")` 加 try/catch 降级到
 * 内存计数——打进来会让这条降级路径变成「永远走失败分支」。
 *
 * 对宿主的三处依赖（lib/puppeteer、lib/config、plugins/other/update）不用列：
 * 它们是 `import(pathToFileURL(join(YunzaiPath, ...)).href)` 这种运行时拼出来的
 * 动态 import，打包器看不见字符串常量，本来就不会去解析——写进 external 是条
 * 永不命中的规则，反而让人以为静态引用过宿主。同理 logger / plugin / Bot 这些
 * 框架全局是宿主挂在 global 上的（类型声明在 src/types/），不是 import 进来的。
 */
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  // 必须是 lib/index.js：框架 loader 只认 plugins/<name>/index.js，而根目录的
  // index.js 是 `export * from "./lib/index.js"`。tsdown 默认输出 .mjs，
  // 这里显式改回 .js —— package.json 有 "type": "module"，.js 本身就是 ESM。
  outDir: "lib",
  format: "esm",
  outExtensions: () => ({ js: ".js" }),
  platform: "node",
  target: "node18",
  // 单文件：dir.ts 靠 import.meta.url 上跳一级定位插件根，分块会多出一层目录
  // 假设（也会让那几个 hash 命名的 chunk 散在 lib/ 里）。
  unbundle: false,
  // 类型声明对「被框架 import 的插件入口」没有消费者，省掉这步构建时间
  dts: false,
  // 出图是 puppeteer 跑 Chromium，产物体积不在瓶颈上；
  // 保留可读性，线上出问题时栈里还能看出是哪个函数
  minify: false,
  sourcemap: true,
  // 每次全量重建，避免残留上一版的文件（原来 build 脚本里的 rimraf 干这事）
  clean: true,
  deps: {
    neverBundle: [/^node:/, "ws", "yaml", "chokidar", "sqlite3"],
  },
})
