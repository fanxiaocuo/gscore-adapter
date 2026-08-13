/**
 * Web 面板的打包配置（Vite 8，内置 Rolldown）
 *
 * 只管 src/webui/ 这一个前端：真正跑在浏览器里、需要打包的只有它。
 * 出图组件（modules/render/）刻意不走 Vite —— 那是 Node 侧运行时 SSR，
 * 逐文件 tsc 产物的理由见 docs/dev/architecture.md（sqlite3 降级路径、
 * 复用宿主依赖、组件可单独 import），且 build:css 扫的就是 lib/ 产物。
 *
 * 做法参考 karin-plugin-kkk 的 feat-template-react 分支（vite build 出 Node
 * lib + 模板），但取向相反：kkk 是「全部进 bundle、原生模块 external」，
 * 我们是「只有浏览器端进 bundle」。
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
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
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
