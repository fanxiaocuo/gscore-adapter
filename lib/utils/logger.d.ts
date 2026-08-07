/** 默认日志前缀 */
export declare const LOG_TAG = "GsCore";
/** 打一条插件日志 */
export declare function log(level: string, msg: any, tag?: string, force?: boolean): void;
/**
 * 日志用：截断 base64，避免刷屏
 * config.log_truncate 为 false 时原样输出
 */
export declare function logStr(msg: any): string;
