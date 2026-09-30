/**
 * @description 连接状态数值的可读名
 * 显式标 Record 而非推断：渲染两处拿 `0|1|2|3` 直接索引，「查表必有值」由类型保证，将来加状态码 4 漏配文案会在索引处编译报错（{@link statusRank} 收 number，故不同）
 */
export const STATUS_TEXT = {
    0: "未连接",
    1: "已连接",
    2: "连接中",
    3: "断线重连中",
};
/**
 * @description 聚合状态的取值顺序：已连接 > 连接中 > 断线待重连 > 未连接
 * 一条逻辑连接的多账号各有状态，对外只显示一个（只特判「已连接」、其余取第一条会把握手中的账号说成未连接）
 * 注意：这不是 WebSocket 的 readyState 而是本插件自己的状态码（见 {@link STATUS_TEXT}），别按 readyState 语义「修正」此顺序
 */
export const STATUS_ORDER = [1, 2, 3, 0];
/**
 * @description 状态在 {@link STATUS_ORDER} 里的名次，数字越大越糟
 * 与 {@link pickByStatus} 共用同一张顺序表（那个答对外算什么状态，这个答子行超上限时谁更该被看到）
 * 注意：两处必须共用一张表，否则会出现「代表状态说通了，被折叠掉的偏偏是唯一没通的账号」；表外状态码排最后（最糟），不认识的更该被看见
 */
export function statusRank(status) {
    const at = STATUS_ORDER.indexOf(status);
    return at === -1 ? STATUS_ORDER.length : at;
}
/**
 * @description 按 {@link STATUS_ORDER} 挑出代表整条逻辑连接的那一项
 * 放 constants 共用避免各模块各写一份漂掉；泛型因两边入参不同（面板是序列化后的运行时视图，状态图是 GsCoreClient），共同点只有 status
 * 同名次内保持入参顺序（find 取首个），即展开顺序、亦即 bind 的书写顺序
 */
export function pickByStatus(items) {
    for (const status of STATUS_ORDER) {
        const hit = items.find(item => item.status === status);
        if (hit)
            return hit;
    }
    return undefined;
}
/**
 * @description 默认最大重连次数
 * 无限重连时退避封顶在 interval*12（默认 60s），核心真下线会每分钟刷一次日志；5 次配 5s 起步约覆盖 2.3 分钟够核心重启，停下后 #早柚重连 即可恢复
 * 想要无限重连写 max_reconnect_attempts: 0（<=0 为无限）
 */
export const DEFAULT_MAX_RECONNECT = 5;
/**
 * @description 重连间隔的下限（秒）
 * 注意：0 是紧密循环，负数让退避算出负延时使 setTimeout 立刻回调；两个写入口都拦了，但手改 yaml 是第三条路，故由 {@link reconnectBase} 兜住
 */
export const MIN_RECONNECT_INTERVAL = 1;
/**
 * @description setTimeout 能表达的最大延时（ms）
 * 注意：超过它的延时会被回退成 1ms 并打 TimeoutOverflowWarning —— 大得离谱的间隔（yaml 写 .inf 或 2147484）会从上界掉进热重连循环
 */
export const MAX_TIMER_DELAY = 2 ** 31 - 1;
/**
 * @description 一条连接实际生效的重连间隔（秒）
 * 0、空、非数字、无穷当「没配」走默认 5；低于下限按下限
 * 注意：退避、面板卡片与 #早柚设置 图三处共用，各写一遍 `|| 5` 会漂（yaml 写 -3 时图上念「间隔 -3s 起」而运行时其实等 1 秒）
 */
export function reconnectBase(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0)
        return 5;
    return Math.max(n, MIN_RECONNECT_INTERVAL);
}
/**
 * @description 一条连接实际生效的最大重连次数，<=0 为无限
 * 注意：用 `??` 而非 `||` —— 配 0 是显式要无限重连，不能被兜成默认值；非数字（yaml 写 abc、.inf）当没配走默认，别让 NaN 漏出去：面板那栏拿 NaN 会序列化成 null、输入框变空、保存时提交 0，静默变无限重连
 */
export function reconnectCap(v) {
    const n = Number(v ?? DEFAULT_MAX_RECONNECT);
    return Number.isFinite(n) ? n : DEFAULT_MAX_RECONNECT;
}
/**
 * @description media_max_size / file_max_size 的硬上限（字节），三个写入口共用
 * 这两项是「超过就改用 link:// 外链」的阈值，调爆等于关掉外链兜底、每个附件在内存里 base64 一份
 * 注意：256 MB 远高于任何真实 QQ 附件，它拦的是「把配置里读到的字节数原样敲进按 MB 收的中文指令」
 */
export const MEDIA_SIZE_MAX = 256 * 1024 * 1024;
/** @description 回环防护：记录本插件代发内容的有效期与容量上限 */
export const ECHO_TTL = 10000;
export const ECHO_MAX = 500;
/** @description log_{level} 段，仅出现在 MessageSend 方向 */
export const GS_LOG_RE = /^log_/i;
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "mark"];
/**
 * @description 早柚核心 segment.py 只发四种日志级别（大写）：INFO / WARNING / ERROR / SUCCESS
 * 注意：WARNING / SUCCESS 不是云崽 logger 的方法名，不映射会静默降级成 info、丢掉告警级别
 */
export const LOG_ALIAS = { warning: "warn", success: "mark", critical: "fatal" };
/**
 * @description notice 事件的 sub_type -> 早柚事件名映射
 * 注意：本 fork 把 notice_type 按 _ 拆两段（OneBotv11.js:1330-1333，对齐 ICQQ 原生形状）：group_increase -> notice_type="group" + sub_type="increase"，故匹配主键是 sub_type，写 notice_type === "group_increase" 恒为 false
 * 标 `Record<string, string | undefined>` 而非字面量对象：键是任意 `e.sub_type`，没命中是正常分支（notice/index.ts 靠 `if (!eventName) return null`）
 */
export const SUB_TYPE_MAP = {
    increase: "user_join_group",
    decrease: "user_exit_group",
};
/** @description 早柚核心的会话类型 */
export const USER_TYPES = ["group", "direct", "channel", "sub_channel"];
