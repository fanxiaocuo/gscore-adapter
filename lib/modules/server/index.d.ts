/**
 * 服务端方向：早柚核心主动连接云崽
 *
 * import 本模块即完成注册（push 到 Bot.adapter），
 * 与 plugins/adapter/*.js 同一时机 —— 必须早于 online，
 * 因为 Bot.wsf 的注册在 adapter.load() 里完成。
 */
import { GsCoreServerAdapter } from "./adapter.js";
export { GsCoreServerAdapter };
