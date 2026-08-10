// QQBot-Web-Adapter 扫描的是 plugins/<name>/webadapter/index.js（index.js:307），
// 按文件 URL 直接 import 且只认 .js，与根目录 index.js / guoba.support.js 同理。
// 真实实现在 src/modules/webadapter/，页面静态文件（page.html / .css / .js）
// 就在本目录 —— 宿主按插件根的相对路径取它们，不经过 lib/。
export * from "../lib/modules/webadapter/index.js"
