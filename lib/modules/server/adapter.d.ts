export declare class GsCoreServerAdapter {
    id: string;
    name: string;
    path: string;
    /**
     * 下发一条 MessageSend。
     *
     * 不走框架的 conn.sendMsg —— 那条路径对非 Buffer 会转成文本帧，
     * 与 client 方向（显式二进制）不一致。这里统一编码后再发，
     * 并保留框架同款的 debug 日志。
     */
    sendApi(bot: any, data: any): boolean;
    /**
     * 核心下发的控制指令（bot.py 的 _Bot.unsend / _Bot.ban）。
     * 拼写是 excute_ 不是 execute_，核心源码即如此，勿"修正"。
     * 两者都只在 content 长度为 1 时出现。
     *
     * 与 client 侧 GsCoreClient.handleControl 同构。
     * @returns 是否已作为控制指令处理
     */
    handleControl(json: any, bot: any): Promise<boolean>;
    /**
     * 回执：核心 bot.py 的 target_send 在 wait_recall 时带 echo 下发，
     * 并在 _recall_waiters 里等一个 recall_message_id 回来（RECALL_WAIT_TIMEOUT=10s）。
     * 连续 3 次拿不到就会把本适配器标记为 _supports_recall=False，永久关掉撤回能力，
     * 所以即使发送失败也要回一帧（id 给 null），让核心的 future 立刻结束。
     *
     * 与 client 侧 GsCoreClient.sendRecallReceipt 同构，区别是发帧走 bot.ws。
     */
    sendRecallReceipt(bot: any, json: any, id: any): void;
    sendMsg(data: any, target_type: any, target_id: any, msg: any): Promise<{
        message_id: string;
    }>;
    sendFriendMsg(data: any, msg: any): Promise<{
        message_id: string;
    }>;
    sendGroupMsg(data: any, msg: any): Promise<{
        message_id: string;
    }>;
    pickFriend(id: any, user_id: any): {
        sendMsg: (msg: any) => Promise<{
            message_id: string;
        }>;
        getAvatarUrl: () => any;
    };
    pickMember(id: any, group_id: any, user_id: any): {
        self_id: any;
        bot: import("trss-yunzai").Client;
        group_id: any;
        user_id: any;
        nickname: string;
        sex: import("trss-yunzai/icqq").Gender;
        card: string;
        age: number;
        area?: string;
        join_time: number;
        last_sent_time: number;
        level: number;
        rank?: string;
        role: import("trss-yunzai/icqq").GroupRole;
        title: string;
        title_expire_time: number;
        shutup_time: number;
        update_time: number;
        remark: string;
        class_id: number;
        sendMsg: (msg: any) => Promise<{
            message_id: string;
        }>;
        getAvatarUrl: () => any;
    };
    pickGroup(id: any, group_id: any): {
        sendMsg: (msg: any) => Promise<{
            message_id: string;
        }>;
        pickMember: (user_id: any) => {
            self_id: any;
            bot: import("trss-yunzai").Client;
            group_id: any;
            user_id: any;
            nickname: string;
            sex: import("trss-yunzai/icqq").Gender;
            card: string;
            age: number;
            area?: string;
            join_time: number;
            last_sent_time: number;
            level: number;
            rank?: string;
            role: import("trss-yunzai/icqq").GroupRole;
            title: string;
            title_expire_time: number;
            shutup_time: number;
            update_time: number;
            remark: string;
            class_id: number;
            sendMsg: (msg: any) => Promise<{
                message_id: string;
            }>;
            getAvatarUrl: () => any;
        };
        self_id: any;
        bot: import("trss-yunzai").Client;
        group_id: any;
        group_name: string;
        member_count: number;
        max_member_count: number;
        owner_id: number;
        admin_flag: boolean;
        last_join_time: number;
        last_sent_time?: number;
        shutup_time_whole: number;
        shutup_time_me: number;
        create_time?: number;
        grade?: number;
        max_admin_count?: number;
        active_member_count?: number;
        update_time: number;
    };
    makeBot(data: any, ws: any): void;
    message(raw: any, ws: any): Promise<void>;
    load(): void;
}
