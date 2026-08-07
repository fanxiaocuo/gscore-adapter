export declare function mediaMaxSize(): number;
export declare function fileMaxSize(): number;
export declare function linkExpire(): number;
/**
 * 云崽文件字段 -> 早柚核心媒体串
 * 小文件走 base64://，http 外链或超限文件走 link://
 */
export declare function toGscoreMedia(file: any, name?: any): Promise<string>;
/**
 * file 段协议规定必须是 `{文件名}|{裸base64}`，没有 URL 形式，
 * 所以只能读全量。加硬上限防止 OOM。
 */
export declare function toGscoreFile(file: any, name?: any): Promise<string>;
/**
 * 早柚核心媒体串 -> 云崽可用的 file 值
 * 注意：不要照抄 ws-plugin 的 /^(http|base64|link)/ ——
 * 该正则未锚定协议分隔符，恰好以 link 开头的裸 base64 会被误判
 */
export declare function fromGscoreMedia(data: any): string | Buffer<ArrayBufferLike>;
