import js from "@eslint/js"
import ts from "typescript-eslint"
import prettier from "eslint-config-prettier"

export default ts.config(
  // temp/ 是本地产物与一次性探针脚本（预览 HTML、几何指纹、调试用的 puppeteer
  // 脚本），不入库也不该被 lint。
  { ignores: ["lib/", "node_modules/", "docs/", "temp/", "webadapter/page.js"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        // 框架注入的全局，见 @types/trss-yunzai
        Bot: "readonly",
        logger: "readonly",
        segment: "readonly",
        plugin: "readonly",
        redis: "readonly",
      },
    },
    rules: {
      // 协议字段大量用 any（早柚核心侧无类型约束），且 tsconfig 已关 noImplicitAny
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // 类型声明文件里的空接口与命名空间是刻意的
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // 测试与开发脚本用 node:assert、顶层 await、console/process，不做类型约束。
    // Node 全局在这里显式列出，而不是引入 globals 包 —— 用到的就这几个。
    //
    // 必须带 .mjs：test/ 下的文件全是 .mjs，早先这里只写了 test/**/*.js，
    // 于是这个 override 从来没匹配上任何文件，console/process 一路报 no-undef
    // （76 个 error）。本地没人跑 lint 所以没暴露，而 CI 的 lint 步骤在 test/
    // 不入库的前提下克隆不到这些文件，也就一直是绿的——改回入库时才会炸。
    //
    // scripts/ 同理：gen-icons.mjs 也是 Node 脚本（在开发期跑，不进产物），
    // 加进来之前它的 console 会报 no-undef，而这个目录是入库的，CI 一定会撞上。
    files: ["test/**/*.{js,mjs}", "scripts/**/*.{js,mjs}", "*.{js,mjs}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        globalThis: "readonly",
        __dirname: "readonly",
        // 在 page.evaluate() 里执行的函数体跑在浏览器上下文，用得到这几个
        document: "readonly",
        getComputedStyle: "readonly",
        window: "readonly",
      },
    },
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
  {
    // src/webui/ 是**浏览器**代码：由 build:panel 用 esbuild 打包成
    // webadapter/page.js，宿主 QQBot-Web-Adapter 用 iframe 加载 page.html 时引入。
    // 它不经过 tsc、不进 lib/，Node 全局一个都没有，反过来 DOM 与 fetch 那批全局都有。
    //
    // 产物 webadapter/page.js 本身在顶部的 ignores 里——那是 minify 过的 React 运行时，
    // 没有可读性也没有 lint 价值。
    files: ["src/webui/**/*.tsx"],
    languageOptions: {
      globals: {
        document: "readonly",
        location: "readonly",
        fetch: "readonly",
        confirm: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
  },
)
