/**
 * MessageSend.content -> 云崽 message
 * @returns { message, quote, logOnly }
 *
 * 修复 ws-plugin 的 bug：上游 makeGSUidSendMsg 只检查 content[0] 是否为 log 段，
 * 命中就丢弃整条消息的其余内容。这里逐段过滤，log 之后的正文照常发送。
 */
export declare function gscoreToYunzai(content: any): Promise<{
    message: any[];
    quote: any;
    logOnly: boolean;
}>;
/**
 * 把 gscoreToYunzai 的产物归一化成事件 message 数组
 * dealEvent 遍历 e.message 时期望 {type,...} 对象，且读 i.url 取图片
 */
export declare function normalizeEventMsg(message: any): any;
