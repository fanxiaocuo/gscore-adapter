/**
 * 模块总出口
 *
 * 只汇总纯函数模块（convert / notice / loader）与客户端方向。
 *
 * 刻意不导出 ./server —— 那个模块是**副作用式**的：import 即向
 * Bot.adapter push 一个实例（见 modules/server/index.ts）。若在这里 re-export，
 * 任何 `import { ... } from "../modules/index.js"` 都会顺带注册服务端，
 * 连 mode: client 也会白白监听一个 ws 路由。
 * 需要服务端时按 src/index.ts 的做法显式 `await import("../modules/server/index.js")`。
 */
export * from "./convert/index.js";
export * from "./notice/index.js";
export * from "./client/index.js";
export * from "./loader/index.js";
