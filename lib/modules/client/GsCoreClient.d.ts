import { WebSocket } from "ws";
export declare class GsCoreClient {
    conf: any;
    name: string;
    /** 0 未连接/已停止 1 已连接 2 连接中 3 断线待重连 */
    status: 0 | 1 | 2 | 3;
    retry: number;
    stop: boolean;
    ws: WebSocket | null;
    timer?: NodeJS.Timeout;
    hbTimer?: NodeJS.Timeout;
    aliveTimer?: NodeJS.Timeout;
    lastPong: number;
    constructor(conf: any);
    /** 可读状态，供 apps 显示 */
    get statusText(): string;
    /** 早柚核心用 ?token= 查询参数鉴权，不使用请求头 */
    get url(): string;
    log(level: any, msg: any): void;
    connect(): void;
    onOpen(): void;
    notify(msg: any): void;
    startHeartbeat(): void;
    stopHeartbeat(): void;
    onClose(code: any, reason: any): void;
    scheduleReconnect(code: any): void;
    close(): void;
    restart(): void;
    /** 本连接是否接管该 self_id */
    accept(self_id: any): boolean;
    sendReceive(e: any, isMaster: any): Promise<boolean>;
    /**
     * 上行：非消息事件（入群/退群/戳一戳）
     * 单向通知，核心不回执，发出即完成。
     */
    sendMeta(e: any, meta: any, isMaster: any): boolean;
    /**
     * 发一帧到核心。
     * 必须是二进制：核心 core.py 的读循环是 websocket.receive_bytes()，
     * 而 ws 库对 string 发的是文本帧(opcode 1)，Starlette 那边取不到 "bytes" 键会直接报错。
     */
    send(data: any): boolean;
    /**
     * 回执：核心 bot.py 的 target_send 在 wait_recall 时会带 echo 下发，
     * 并在 _recall_waiters 里等一个 recall_message_id 回来（RECALL_WAIT_TIMEOUT=10s）。
     * 连续 3 次拿不到就会把本适配器标记为 _supports_recall=False，永久关掉撤回能力，
     * 所以即使发送失败也要回一帧（id 给 null），让核心的 future 立刻结束。
     */
    sendRecallReceipt(data: any, id: any): void;
    /**
     * 核心下发的控制指令（bot.py 的 _Bot.unsend / _Bot.ban）。
     * 注意拼写是 excute_ 不是 execute_，核心源码即如此。
     * 两者都只在 content 长度为 1 时出现。
     * @returns 是否已作为控制指令处理
     */
    handleControl(data: any, bot: any): Promise<boolean>;
    onMessage(raw: any): Promise<void>;
}
