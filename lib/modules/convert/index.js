/**
 * 消息段双向转换
 *
 * 媒体与日志工具在 @/utils，本目录只负责消息段结构的映射。
 */
export * from "./buttons.js";
export * from "./toGscore.js";
export * from "./toYunzai.js";
// 兼容旧入口：媒体与日志工具原本从 convert 导出
export { fromGscoreMedia, logStr } from "../../utils/index.js";
