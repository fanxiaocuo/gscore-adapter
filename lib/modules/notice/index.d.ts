import { passFilter } from "../../utils/index.js";
export { passFilter };
/**
 * 云崽 notice 事件 -> meta event
 * @returns 无法映射返回 null
 */
export declare function noticeToMeta(e: any): {
    eventName: any;
    data: Record<string, string>;
};
/**
 * meta event -> 完整 MessageReceive
 * @param e     云崽 notice 事件
 * @param meta  noticeToMeta 的产物
 * @param botId 平台标识（resolveBotId 的结果）
 * @param opts  { isMaster }
 */
export declare function metaToGscore(e: any, meta: any, botId: any, opts?: {
    isMaster?: boolean;
}): {
    bot_id: any;
    bot_self_id: string;
    msg_id: string;
    user_type: string;
    group_id: any;
    user_id: any;
    user_pm: number;
    sender: {};
    content: {
        type: string;
        data: any;
    }[];
};
/** 日志用的简短描述 */
export declare function metaLogStr(meta: any): string;
