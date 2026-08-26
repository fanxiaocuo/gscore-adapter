/**
 * Web 面板的打包配置（Vite 8，内置 Rolldown）
 *
 * 只管 src/webui/ 这一个前端：真正跑在浏览器里、需要打包的只有它。
 * 出图组件（modules/render/）刻意不走 Vite —— 那是 Node 侧运行时 SSR，
 * 逐文件 tsc 产物的理由见 docs/dev/architecture.md（sqlite3 降级路径、
 * 复用宿主依赖、组件可单独 import）。
 *
 * 做法参考 karin-plugin-kkk 的 feat-template-react 分支（vite build 出 Node
 * lib + 模板），但取向相反：kkk 是「全部进 bundle、原生模块 external」，
 * 我们是「只有浏览器端进 bundle」。
 *
 * 注意：build:css 扫的是**源码** src/modules/render/components/*.tsx，不是 lib/ 产物
 * （这里原先写着「扫的就是 lib/ 产物」，是过时的说法，理由与实测见
 * modules/render/styles/tailwind.css 的「@source 指向 tsx 源码」一段）。差别有后果：
 * 扫源码时 build:css 与 tsc **谁先谁后都行**，扫产物才必须排在 tsc 之后。
 *
 * 注意：别把 @karinjs/template-react 的 ktrBuildPlugin() 挂进来收 build:css。
 * 实测（挂上 cssEntry 指向出图那份样式，跑 vite build）三条都不行：
 *   1. 它的 tailwindSourceScopePlugin 会盖掉我们的 source(none) + @source 作用域，
 *      产物从 14.9 KB 涨到 479.5 KB —— 而这份 CSS 是要内联进每张图的 HTML 的
 *   2. 输出名恒为 style.css、目录跟随打包器 outDir，于是落进下面那个宿主白名单目录
 *   3. 它同时跑「注册表同步」，会生成 0 个模板的 .ktr/ 与 ktr/template/ 死脚手架
 * 出图那半只借它的 HtmlWrapper / createRenderer（见 modules/render/index.ts 文件头），
 * 「目录即路由」那套约定是刻意不接的。
 *
 * 产物契约（QQBot-Web-Adapter 的静态白名单按文件名放行，一个都不能改）：
 *   webadapter/panel.js  —— IIFE，page.html 用普通 <script> 引
 *   webadapter/page.css  —— main.tsx import 的 styles.css 抽出来的
 * page.html 不由 Vite 生成（它带着宿主契约的注释与 favicon 逻辑，手维护）。
 *
 * 替换掉的两条命令：esbuild（只出 js）+ @tailwindcss/cli（只出 css）。
 * Tailwind 走 @tailwindcss/vite 插件，styles.css 里的 @source 扫描不变，
 * 深浅配色仍由 prefers-color-scheme 决定，与打包器无关。
 */
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // lib 模式下 Vite 不替换 process.env.NODE_ENV（按「库由使用方定义」的约定留给
  // 下游），但这是浏览器 IIFE，没有下游：不定义的话 react-dom 的开发版会整个
  // 打进来（591KB vs 183KB），运行时还会因 process 未定义直接抛错
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    /*
     * 构建戳，面板页脚显示它。
     *
     * 用途是**分辨手上这一份是不是新包**：panel.js 的文件名被宿主的静态白名单钉死，
     * 换不了名字；page.html 是入库文件，给它加 `?v=` 等于让构建去改一个已跟踪文件；
     * 而从脚本注入样式表会引入一次无样式闪烁。三条路都不划算，所以不做 URL 层的防缓存，
     * 改成把戳显示出来 —— 页脚的时间与你刚构建的时间对不上，就是浏览器还拿着旧包，
     * 硬刷新（Ctrl+F5）即可。
     * 注意：取值在配置求值时算一次，所以同一次 build 里的戳是一致的
     */
    __BUILD__: JSON.stringify(
      new Date().toLocaleString("zh-CN", { hour12: false, timeZoneName: "short" }),
    ),
  },
  build: {
    // 与原 esbuild 配置对齐：es2020、压缩、无 sourcemap
    target: "es2020",
    outDir: "webadapter",
    // webadapter/ 里有手维护的 page.html 与宿主入口 index.js，绝不能清空
    emptyOutDir: false,
    lib: {
      entry: "src/webui/main.tsx",
      // IIFE：page.html 用的是普通 <script src="panel.js">，不是 module。
      // name 是 IIFE 必填的全局变量名，入口没有导出，写进去也只是个空对象
      formats: ["iife"],
      name: "GsCorePanel",
      fileName: () => "panel.js",
      cssFileName: "page",
    },
  },
})
