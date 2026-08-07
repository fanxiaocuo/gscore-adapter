import js from "@eslint/js"
import ts from "typescript-eslint"
import prettier from "eslint-config-prettier"

export default ts.config(
  { ignores: ["lib/", "node_modules/", "docs/"] },
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
    // 测试用 node:assert 与顶层 await，不做类型约束。
    // Node 全局在这里显式列出，而不是引入 globals 包 —— 用到的就这几个。
    files: ["test/**/*.js", "*.js"],
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
      },
    },
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
)
