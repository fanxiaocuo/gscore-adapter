import type { MessageReceive } from "../../types/index.js";
/** 云崽 message 数组 -> 早柚核心 Message[] */
export declare function msgToGscore(msg: any): Promise<any[]>;
/**
 * 完整 MessageReceive
 * @param e     云崽消息事件
 * @param botId 平台标识（resolveBotId 的结果）
 * @param opts  { isMaster }
 */
export declare function yunzaiToGscore(e: any, botId: any, opts?: {
    isMaster?: boolean;
}): Promise<false | MessageReceive>;
