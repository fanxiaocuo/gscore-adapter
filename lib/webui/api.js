/**
 * @description 面板接口的数据形状，前后端共用的契约（`payload()` 造它，`webui/main.tsx` 读它）
 * 两端隔着一次 JSON 序列化、编译器看不出关联，故两边都标这里的类型，字段改名才在编译期报而非运行时 undefined。
 * 注意：本文件放在 webui/ 且刻意不 import 任何东西——tsconfig.webui.json 的 types 只有 react，@/types 那个桶会连带拉进 trss-yunzai 与 node 的声明。
 * 注意：不复用 WsConnection——面板视图逐字段挑过、token 换成 has_token，复用会让前端以为能读到 token。
 */
export {};
