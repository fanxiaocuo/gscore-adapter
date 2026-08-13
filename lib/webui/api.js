/**
 * 面板接口的数据形状（前后端共用）
 *
 * 为什么单独一份而不是各写一遍
 * -------------------------
 * `modules/webadapter/index.ts` 的 `payload()` 造这个对象，`webui/main.tsx` 读它，
 * 两边隔着一次 JSON 序列化 —— 编译器看不出关联，字段改了名只会在运行时表现为
 * 面板上一个 `undefined`。所以把契约写在这里，让两端都对着它检查：
 * 后端 `payload()` 的返回值标成 {@link Payload}，前端 state 也标成它。
 *
 * 放在 `webui/` 而不是 `types/` 是因为**浏览器侧只能 import 它**：
 * `tsconfig.webui.json` 的 `types` 只有 react，而 `@/types` 那个桶会连带
 * 拉进 `trss-yunzai` 与 node 的声明（`AdapterEvent.bot` 就是 `Client`），
 * 在浏览器那份配置下解析不了。这个文件刻意不 import 任何东西。
 *
 * 只描述**接口回什么**，不复用 `WsConnection`
 * ----------------------------------------
 * 面板拿到的连接视图与配置里的连接项是两种东西：`connView` 刻意逐字段挑，
 * token 换成 `has_token`，还额外带上运行时状态（status / retry / up / down）。
 * 复用 `WsConnection` 会让前端以为能读到 `token`。
 */
export {};
