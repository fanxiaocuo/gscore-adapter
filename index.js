// 入口保持为 .js —— 框架 loader 只认 plugins/<name>/index.js（lib/plugins/loader.js:55）。
// 真实逻辑在 TypeScript 源码 src/ 里，编译产物在 lib/。
// 首次使用或改动 src/ 后需执行：pnpm build
export * from "./lib/index.js"
