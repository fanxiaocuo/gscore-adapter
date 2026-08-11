// 锅巴（Guoba-Plugin）扫描的是 plugins/<name>/guoba.support.js，
// 与 index.js 同理必须是 .js，真实实现在 src/modules/guoba/。
// 产物与 src/ 目录结构一一对应（tsc 逐文件输出），故路径同源码。
export * from "./lib/modules/guoba/index.js"
