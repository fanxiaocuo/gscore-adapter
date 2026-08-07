/** 群/用户黑白名单，消息与 meta 事件路径共用同一份 filter 配置 */
export declare function passFilter(e: any): boolean;
/** 事件来源是否为早柚核心方向的 Bot（回环防护第 2、3 层） */
export declare function isFromGsCore(e: any): boolean;
/** 提取事件中的纯文本，用于前缀/包含匹配 */
export declare function eventText(e: any): any;
/** 转成非空字符串，取不到给 "" */
export declare function str(v: any): string;
