import { WebSocket } from "ws";
import { config, resolveBotId } from "../../config/index.js";
import { STATUS_TEXT, GS_LOG_RE, MAX_TIMER_DELAY, reconnectBase, reconnectCap } from "../../constants/index.js";
import { logStr, sendMessageId, classifyDelivery, deliveryComplete, deliveryDelivered, } from "../../utils/index.js";
import { redactUrl, routeKey } from "../../utils/url.js";
import { isICQQ } from "../../utils/platform.js";
import { makeLog, toBuffer, segReply } from "../../utils/compat.js";
import { setLocalHint } from "../../utils/fileServer.js";
import { yunzaiToGscore, gscoreToYunzai } from "../convert/index.js";
import { metaToGscore, metaLogStr } from "../notice/index.js";
import { count } from "../stats/index.js";
import { eventIdOf, isEventId, isQQBot, take } from "../passive/index.js";
import { getBot } from "../../utils/bots.js";
import { echoKey, markSent } from "./echo.js";
/**
 * @description 段类型摘要，例如 "image×1,text×1"
 * 只统计类型与个数，不输出媒体正文或鉴权信息（base64 图片可达几十万字符、外链可能带凭据）。
 */
function segSummary(message) {
    const n = new Map();
    for (const s of message) {
        const t = typeof s === "string" ? "text" : String(s?.type || "unknown");
        n.set(t, (n.get(t) || 0) + 1);
    }
    return [...n].map(([t, c]) => `${t}×${c}`).join(",");
}
/**
 * @description 校验被动发送所需的会话上下文字段是否齐全，缺则 QQBot-Plugin 会内部抛错
 * 各发送函数实际读的字段不同：sendGroupMsg 读 group_id、sendFriendMsg 读 user_id、sendGuildMsg 读 channel_id。
 * 注意：不能笼统查 group_id —— 频道要的是 channel_id，否则频道被动回复会被静默降级成普通发送（日志只写「无被动窗口」）。
 */
function passiveReady(target, type, targetId) {
    // 直接读字段，不用 `as Record<string, unknown>`（等于 any）：这几项现在在 SendTarget 上有声明
    if (!target.self_id || !target.bot)
        return false;
    if (type === "direct")
        return !!target.user_id;
    return targetId.startsWith("qg_") ? !!target.channel_id : !!target.group_id;
}
/*
 * 下行投递判定见 utils/send.ts 的 classifyDelivery。
 * 注意：这里别再放本地的「投出去了」判据。doSend 与 onMessage 共用 classifyDelivery + deliveryDelivered /
 * deliveryComplete，判据只有一份（`data.length > 0` 那种会把半条消息计成一次完整中转）。
 */
export class GsCoreClient {
    conf;
    name;
    /**
     * 稳定身份，见 {@link RuntimeWsConnection.runtimeKey}。reconcileClients 拿它跟目标计划比对，决定
     * 客户端留着、原地改元信息还是停掉重起。name 与 sourceIndex 会随改名/删前一条而变，只有它不变。
     */
    runtimeKey;
    sourceIndex;
    account;
    target;
    /** 0 未连接/已停止 1 已连接 2 连接中 3 断线待重连 */
    status;
    retry;
    stop;
    ws;
    // 用 undefined 而非 null 作空值：clear{Timeout,Interval} 接受 undefined，传 null 在 strict 下会被拒
    timer;
    hbTimer;
    aliveTimer;
    lastPong;
    constructor(conf) {
        this.conf = conf;
        const rt = conf;
        // 运行时连接自带唯一名称与最终地址；直传逻辑连接时退回旧行为。
        // 退路地址过 redactUrl：name 会进日志，逻辑连接的地址可能内联着 ?token=
        this.name = rt.runtimeName || conf.name || redactUrl(conf.url);
        this.target = rt.runtimeUrl || String(conf.url || "");
        // 逻辑连接直传时自算一次：手动重连拿裸 conf 造客户端，缺 key 会在下次 reconcile 被判「不在计划里」而停掉
        this.runtimeKey = rt.runtimeKey || routeKey(this.target);
        this.sourceIndex = typeof rt.sourceIndex === "number" ? rt.sourceIndex : -1;
        this.account = rt.account ?? null;
        /** 0 未连接/已停止 1 已连接 2 连接中 3 断线待重连 */
        this.status = 0;
        this.retry = 0;
        this.stop = false;
        this.ws = null;
        this.timer = undefined;
        this.hbTimer = undefined;
        this.aliveTimer = undefined;
        this.lastPong = 0;
    }
    /**
     * @description 可读状态，供文字指令显示（#早柚状态 / #早柚连接列表 的文本回复）
     * 用「已重连 N 次」而非「重连 N 次」，避免被读成「还要重连 N 次」；这里是已重连过的次数。
     * 注意：面板不用此 getter —— 它另有 retry 字段单独渲标签，用了就是同一个数写两遍。
     */
    get statusText() {
        return STATUS_TEXT[this.status] + (this.retry ? `(已重连${this.retry}次)` : "");
    }
    /** @description 早柚核心用 ?token= 查询参数鉴权，不使用请求头 */
    get url() {
        const url = this.target;
        const inlineToken = this.conf.inlineToken === true;
        const token = String(this.conf.token ?? "");
        if (!inlineToken && !token)
            return url;
        try {
            const u = new URL(url);
            if (inlineToken || !u.searchParams.has("token"))
                u.searchParams.set("token", token);
            return u.toString();
        }
        catch {
            if (/[?&]token=/.test(url))
                return url;
            return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
        }
    }
    log(level, msg) {
        makeLog(level, msg, `GsCore:${this.name}`, true);
    }
    connect() {
        if (this.stop)
            return;
        if (this.ws &&
            (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))
            return;
        this.status = 2;
        try {
            // maxPayload 与 handshakeTimeout 必须显式给，取值参照 GenshinUID 的 client.py（max_size=2**26、open_timeout=60）。
            // ws 默认 maxPayload 100MiB，超限时 receiver.js 抛 RSV 错误拆掉整条连接（表现为无故断线、日志只有 code=1009）。
            // 不给 handshakeTimeout 会退化到 OS 的 TCP 超时，防火墙黑洞 SYN 时卡在 CONNECTING 数分钟（status 恒为 2、
            // 不来 close 事件、scheduleReconnect 不触发，「连接中」假死）。
            // 注意：刻意不给任何 TLS 选项。wss:// + 正经证书直接可连，自签/私有 CA 用 NODE_EXTRA_CA_CERTS 启动云崽；
            // 别塞 rejectUnauthorized: false（关掉中间人防护，且会被复制到公网连接上）。
            this.ws = new WebSocket(this.url, {
                maxPayload: 64 * 1024 * 1024,
                handshakeTimeout: 60000,
            });
        }
        catch (err) {
            this.log("error", ["创建连接失败，请检查地址", err]);
            return this.scheduleReconnect(-1);
        }
        this.ws.on("open", () => this.onOpen());
        this.ws.on("message", data => this.onMessage(data));
        this.ws.on("close", (code, reason) => this.onClose(code, reason));
        this.ws.on("error", err => this.log("error", ["连接错误", err?.message || err]));
        this.ws.on("pong", () => (this.lastPong = Date.now()));
    }
    onOpen() {
        const wasReconnect = this.status === 2 && this.retry > 0;
        this.status = 1;
        this.retry = 0;
        this.lastPong = Date.now();
        // 记下本机地址：内置文件服务用它拼外链 host，比硬写 127.0.0.1 靠谱（核心常在 Docker 或另一台机器）
        setLocalHint(this.ws?._socket?.localAddress);
        this.log("mark", wasReconnect ? "重连成功" : "已连接");
        this.startHeartbeat();
        if (wasReconnect && config.notify_master)
            this.notify(`${this.name} 重连成功`);
    }
    notify(msg) {
        try {
            const ret = Bot.sendMasterMsg?.(`[早柚核心] ${msg}`);
            if (ret?.catch)
                ret.catch(() => { });
        }
        catch { }
    }
    startHeartbeat() {
        this.stopHeartbeat();
        const iv = Number(config.client?.heartbeat) || 0;
        if (iv > 0) {
            this.hbTimer = setInterval(() => {
                if (this.ws?.readyState === WebSocket.OPEN) {
                    try {
                        this.ws.ping();
                    }
                    catch { }
                }
            }, iv * 1000);
        }
        // 注意：超时检测依赖 pong 刷新 lastPong，pong 只因发 ping 而来。iv===0（不发 ping）时必须一并关检测，
        // 否则 lastPong 永不更新 → 必超阈值 → 无条件 terminate → 断线重连死循环
        const to = Number(config.client?.heartbeat_timeout) || 0;
        if (iv > 0 && to > 0) {
            this.aliveTimer = setInterval(() => {
                if (this.status === 1 && Date.now() - this.lastPong > to * 1000) {
                    this.log("warn", `心跳超时 ${to}s，主动断开重连`);
                    try {
                        this.ws.terminate();
                    }
                    catch { }
                }
            }, Math.max(5, to / 3) * 1000);
        }
    }
    stopHeartbeat() {
        clearInterval(this.hbTimer);
        clearInterval(this.aliveTimer);
        this.hbTimer = undefined;
        this.aliveTimer = undefined;
    }
    /**
     * @description 连接关闭：主动停的直接落 status 0，否则打日志、通知主人并排重连
     * @param reason ws 给的是 Buffer，对端可不带原因（空 Buffer），靠 `reason?.length` 判空
     */
    onClose(code, reason) {
        this.stopHeartbeat();
        const wasOnline = this.status === 1;
        this.status = 3;
        // close() 主动关闭不摘监听器，close 事件仍走到这里。注意：通知必须在 stop 判断之后，
        // 否则 reloadClients() 逐个 close 会给主人刷 N 条"已断开"，实际只是重载配置
        if (this.stop) {
            this.status = 0;
            return;
        }
        this.log("warn", `连接已关闭 code=${code}${reason?.length ? ` reason=${reason}` : ""}`);
        if (wasOnline && config.notify_master)
            this.notify(`${this.name} 已断开`);
        this.scheduleReconnect(code);
    }
    /**
     * @description 排一次指数退避重连
     * @param code 关闭码；创建连接就失败时调用方传 -1（没有关闭码可言）
     */
    scheduleReconnect(code) {
        if (this.stop) {
            this.status = 0;
            return;
        }
        // 语义（0 为无限、非数字当没配）在 constants 的 reconnectCap 里，与面板显示同源
        const max = reconnectCap(this.conf.max_reconnect_attempts);
        if (max > 0 && this.retry >= max) {
            this.status = 0;
            return this.log("error", `达到最大重连次数 ${max}，停止重连（可用 #早柚重连 恢复）`);
        }
        // 注意：1005 = No Status Received，对端关闭未带状态码（Python 侧重启常见），可恢复，继续重连。
        // ws-plugin 在此码上彻底放弃重连，别照抄
        if (code === 1005)
            this.log("warn", "对端未提供关闭码(1005)，通常是核心重启，继续重连");
        this.retry++;
        // 指数退避：base * 2^(retry-1)，封顶 base 的 12 倍（默认 5s → 最长 60s），无限重试时收敛到低频探活。
        // 注意：上下界都要夹 —— 手改 yaml 无校验，负数算出负延时、过大值超 setTimeout 上限被回退成 1ms，两头都是热重连循环
        const base = reconnectBase(this.conf.reconnect_interval);
        const wait = Math.min(base * 2 ** (this.retry - 1) * 1000, base * 12000, MAX_TIMER_DELAY);
        this.log("info", `${wait / 1000}s 后进行第 ${this.retry} 次重连`);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.connect(), wait);
    }
    close() {
        this.stop = true;
        this.stopHeartbeat();
        clearTimeout(this.timer);
        try {
            this.ws?.close(1000);
        }
        catch { }
        this.status = 0;
    }
    restart() {
        this.stop = false;
        this.retry = 0;
        clearTimeout(this.timer);
        this.stopHeartbeat();
        try {
            this.ws?.terminate();
        }
        catch { }
        this.ws = null;
        this.connect();
    }
    /** @description 本连接是否接管该 self_id */
    accept(self_id) {
        const id = String(self_id);
        const exclude = this.conf.exclude || [];
        if (exclude.length && exclude.some(i => String(i) === id))
            return false;
        const bind = this.conf.bind || [];
        if (bind.length && !bind.some(i => String(i) === id))
            return false;
        return true;
    }
    /* ---------- 上行：云崽 -> 早柚核心 ---------- */
    /**
     * @description 上行：把云崽的消息事件转成核心帧发出去
     * @param selfId 已由 hooks 的 resolveSelfId 解析过，非空；e.self_id 可能是 null
     */
    async sendReceive(e, isMaster, selfId = String(e.self_id ?? "")) {
        if (this.status !== 1 || this.ws?.readyState !== WebSocket.OPEN)
            return false;
        const botId = resolveBotId(e, this.conf, selfId);
        const data = await yunzaiToGscore(e, botId, { isMaster, selfId });
        if (!data)
            return false;
        // 只在真发出时计数：send 在 readyState 非 OPEN 时返回 false，此时未中转成功，计进去会让「连着但不通」的故障看不出来
        if (!this.send(data))
            return false;
        count("up", this.name);
        makeLog("debug", `上报早柚核心：${logStr(data.content)}`, `${selfId} => ${this.name}`, true);
        return true;
    }
    /**
     * @description 上行：非消息事件（入群/退群/戳一戳）。单向通知，核心不回执，发出即完成
     */
    sendMeta(e, meta, isMaster, selfId = String(e.self_id ?? "")) {
        if (this.status !== 1 || this.ws?.readyState !== WebSocket.OPEN)
            return false;
        const data = metaToGscore(e, meta, resolveBotId(e, this.conf, selfId), { isMaster, selfId });
        if (!data)
            return false;
        if (!this.send(data))
            return false;
        count("event", this.name);
        makeLog("debug", `上报早柚核心事件：${metaLogStr(meta)}`, `${selfId} => ${this.name}`, true);
        return true;
    }
    /**
     * @description 发一帧到核心，必须是二进制帧
     * 核心 core.py 读循环是 receive_bytes()，ws 对 string 发文本帧(opcode 1)，Starlette 取不到 "bytes" 键会报错。
     * @param data 上行帧。标 unknown 而非 `MessageReceive`：撤回回执帧的 content 是 `recall_message_id` 段
     *             （协议独立结构，见 {@link RecallReceipt}），套不进 MessageReceive.content；帧形状由调用点保证
     */
    send(data) {
        if (this.ws?.readyState !== WebSocket.OPEN)
            return false;
        this.ws.send(Buffer.from(JSON.stringify(data), "utf8"));
        return true;
    }
    /**
     * @description 撤回回执：核心 bot.py 的 target_send 在 wait_recall 时带 echo 下发并等 recall_message_id 回来（RECALL_WAIT_TIMEOUT=10s）
     * 注意：即使发送失败也要回一帧（id 给 null）—— 连续 3 次拿不到，核心会把本适配器标记 _supports_recall=False，永久关掉撤回。
     */
    sendRecallReceipt(data, id) {
        if (!data.echo)
            return;
        this.send({
            bot_id: data.bot_id,
            bot_self_id: data.bot_self_id,
            msg_id: "",
            user_type: data.target_type || "group",
            group_id: data.target_type === "group" ? data.target_id : null,
            user_id: data.target_type === "direct" ? String(data.target_id ?? "") : "",
            sender: {},
            user_pm: 6,
            content: [{ type: "recall_message_id", data: { echo: data.echo, id } }],
        });
    }
    /**
     * @description 核心下发的控制指令（bot.py 的 _Bot.unsend / _Bot.ban），仅在 content 长度为 1 时出现
     * 注意：拼写是 excute_ 不是 execute_，核心源码即如此。
     * @returns 是否已作为控制指令处理
     */
    async handleControl(data, bot) {
        const list = Array.isArray(data.content) ? data.content : [];
        if (list.length !== 1)
            return false;
        const seg = list[0];
        if (seg?.type === "excute_delete_message") {
            const id = seg.data?.message_id;
            try {
                // 撤回接口在各适配器上位置不一：优先群/好友对象，退化到 bot 级
                const target = data.target_type === "direct"
                    ? bot.pickFriend?.(Number(data.target_id) || data.target_id)
                    : bot.pickGroup?.(Number(data.target_id) || data.target_id);
                const fn = target?.recallMsg || bot.recallMsg;
                if (!fn)
                    return (this.log("warn", "当前适配器不支持撤回消息"), true);
                await fn.call(target?.recallMsg ? target : bot, id);
                this.log("info", `已撤回消息 ${id}`);
            }
            catch (err) {
                this.log("error", ["撤回消息失败", err]);
            }
            return true;
        }
        if (seg?.type === "excute_ban_user") {
            const d = seg.data || {};
            const duration = Number(d.duration) || 0;
            try {
                const group = bot.pickGroup?.(Number(d.group_id) || d.group_id);
                if (!group?.muteMember)
                    return (this.log("warn", "当前适配器不支持禁言"), true);
                await group.muteMember(Number(d.user_id) || d.user_id, duration);
                this.log("info", `${duration ? `禁言 ${duration}s` : "解除禁言"}：${d.user_id}@${d.group_id}`);
            }
            catch (err) {
                this.log("error", ["禁言操作失败", err]);
            }
            return true;
        }
        return false;
    }
    /**
     * @description 实际发送：QQBot 尽量走被动回复，带该会话最近一条入站消息的 id 让回复显示为引用
     * 核心下发不带原消息 id，该 id 由 modules/passive 记着。失败即回退普通发送（id 可能已被平台判过期，宁可丢引用形态也要发出）。
     * 注意：不能直接用 target.sendMsg —— QQBot-Plugin 的 pick* 返回的 sendMsg 只收一个参数、吃掉第三个 event 参数，
     * 传不了被动回复凭据；所以这条路径直接调 adapter 的 sendGroupMsg(data, msg, event)，把 pick 出来的对象当上下文传进去。
     */
    async doSend(target, message, bot, data, targetId) {
        // 摘要三条路径共用：走了哪条、有没有回退，只看日志就能复盘
        const summary = segSummary(message);
        const type = data.target_type === "direct" ? "direct" : "group";
        const brief = `${this.name} => ${data.bot_self_id}, ${type} ${targetId}, ${summary}`;
        if (!isQQBot(bot)) {
            // icqq 的 file 段不能走 sendMsg：converter 直接抛「暂不支持发送 file 元素」（converter.js:441），
            // 得拆出来调原生 sendFile。其它适配器（OneBot / Milky 等）自己的 makeMsg 认 file 段，照旧透传。
            if (isICQQ(bot) && message.some(m => m?.type === "file")) {
                return await this.sendIcqq(target, message, type, brief);
            }
            this.log("debug", `下行发送：${brief}`);
            return await target.sendMsg(message);
        }
        // 注意：先确认有能收 event 的发送函数、且目标带齐上下文，再去 take —— take 会记一次使用次数
        // （上限按场景分档，群 5 / 单聊 4，见 passive 的 MAX_USES），顺序反了会在路径走不通时白耗额度
        const fn = this.passiveSender(bot.adapter, type, targetId);
        const msgId = fn && passiveReady(target, type, targetId) ? take(data.bot_self_id, type, targetId) : "";
        if (!fn || !msgId) {
            this.log("debug", `下行发送（无被动窗口）：${brief}`);
            return await target.sendMsg(message);
        }
        try {
            // 交互事件走 `event_id`、消息走 `id`，不能混。QQBot-Plugin 发送函数第三参同时认这两键（index.js:1386），
            // 官方接口对按钮回调这类交互只收 event_id，填进 id 平台不认。前缀由 modules/passive 存着，剥前缀在 eventIdOf
            const event = isEventId(msgId) ? { event_id: eventIdOf(msgId) } : { id: msgId };
            const ret = await fn(target, message, event);
            // 只在「一条都没投出去」时才回退：QQBot 内部自愈过的发送带陈旧 error 回来，照 sendError 判会重发整条；
            // 部分成功的也不能重发，会复制已投出的分组 —— 见 utils/send.ts 的 classifyDelivery
            if (deliveryDelivered(classifyDelivery(ret))) {
                this.log("debug", `下行发送（被动回复）：${brief}`);
                return ret;
            }
            this.log("debug", `被动回复未投出，改为不带 id 发送：${brief}`);
        }
        catch (err) {
            this.log("debug", [`被动回复异常，改为不带 id 发送：${brief}`, err]);
        }
        // 回退复用同一个 message 引用安全：QQBot-Plugin 的 makeMsg / makeRawMarkdownMsg / makeGuildMsg 都先浅拷贝段再改、
        // 往新数组 push，不回写入参。唯一按引用透传的是 raw 段，而本插件下行从不产出 raw
        return await target.sendMsg(message);
    }
    /**
     * @description icqq 专用：file 段走原生 sendFile，其余段照常 sendMsg
     * 为什么不能靠 sendMsg 兜底：icqq 的 Converter 收到 file 元素直接抛（converter.js:441），
     * 而 ICQQ-Plugin 的 makeMsg 虽拦了 file 段却调 `pick.sendFile(i.file, i.name)`——对群这是错的：
     * group.sendFile 是 `(file, pid, name)`，name 落到了 pid 位（index.js:322 / group.js:304）。两条路都发不出，故这里绕开自己发。
     * sendFile 入参：icqq 只认 Buffer/Uint8Array 当字节流，字符串一律当本地路径（gfs.js:315-329 / friend.js:466-482），
     * 所以 file 段载荷（`base64://…`）先经 toBuffer 解成 Buffer 再交出去。
     * @param type direct 走 friend.sendFile(file, name)，group 走 group.sendFile(file, pid="/", name)
     */
    async sendIcqq(target, message, type, brief) {
        // TRSS 的 pick 是 Proxy，raw 拿得到底层 Group/Friend；裸 icqq（Miao）target 本身就是，无 raw
        const pick = target.raw || target;
        if (typeof pick.sendFile !== "function") {
            this.log("debug", `icqq 目标无 sendFile，回退 sendMsg：${brief}`);
            return await target.sendMsg(message);
        }
        const rets = [];
        const rest = [];
        for (const seg of message) {
            if (seg?.type !== "file") {
                rest.push(seg);
                continue;
            }
            // 注意：toBuffer 解不出时**原样返回入参**（compat.ts:126-128 的 catch），不抛。
            // 不判类型就交给 sendFile，等于把那串东西当本地路径去 stat —— 正是本方法要修的那个 bug。
            const buf = await toBuffer(seg.file);
            if (!Buffer.isBuffer(buf)) {
                this.log("warn", `file 段取不到内容，已跳过：${seg.name || "(无名)"}`);
                continue;
            }
            // 失败只记不抛：一个文件发不出去不该连累同一条消息里的文字段（抽卡导出就是「文件 + 成功提示」）。
            // 错误按 sendError 认得的形状塞进 rets，由 classifyDelivery 归并成 partial / failed
            try {
                // 群：sendFile(file, pid, name)，pid 传默认根目录 "/"；好友：sendFile(file, name)
                rets.push(await (type === "group"
                    ? pick.sendFile(buf, "/", seg.name)
                    : pick.sendFile(buf, seg.name)));
            }
            catch (err) {
                this.log("error", [`icqq 发送文件失败：${seg.name || "(无名)"}`, err]);
                rets.push({ error: err });
            }
        }
        this.log("debug", `下行发送（icqq 文件）：${brief}`);
        // 文件先发、其余段随后：抽卡记录这类响应通常是「文件 + 一句成功提示」，顺序对用户更自然
        if (rest.length)
            rets.push(await target.sendMsg(rest));
        // 全跳过（文件都解不出、又没别的段）时回 null，与「没东西可发」对齐，别回空数组：
        // classifyDelivery 对空数组判 unknown，会被 deliveryComplete 当成功计进下行计数
        if (!rets.length)
            return null;
        // 单发时摊平，与 sendMsg 的返回形状对齐，交给 classifyDelivery / sendMessageId 按数组归并
        return rets.length === 1 ? rets[0] : rets;
    }
    /**
     * @description 取能接收 event 参数的发送函数，按目标形状分派到 sendGroupMsg / sendFriendMsg / sendGuildMsg
     * 频道靠 group_id 的 qg_ 前缀识别，同 QQBot-Plugin 的 pickGroup/pickFriend 判断。
     * 注意：频道私聊（sendDirectMsg）有意排除 —— 它缺 guild_id 时会先 createDirectSession 建会话并改写 data，
     * 塞进这条路径要连带处理那段副作用，收益不值；它照常走 target.sendMsg。
     * @returns 找不到对应函数返回 null，调用方回退
     */
    passiveSender(adapter, type, targetId) {
        if (!adapter)
            return null;
        const isGuild = targetId.startsWith("qg_");
        // 频道私聊：不接
        if (type === "direct" && isGuild)
            return null;
        const name = type === "direct" ? "sendFriendMsg" : isGuild ? "sendGuildMsg" : "sendGroupMsg";
        const fn = adapter[name];
        if (typeof fn !== "function")
            return null;
        // 第三参是两种凭据之一：消息走 `id`、交互事件走 `event_id`（QQBot-Plugin 发送函数 index.js:1386 同时认两键）。
        // 标联合类型而非 `{ id: string }`：后者会把交互事件那支挡在编译期外，而它正是按钮回调唯一能用的形式
        return (t, msg, event) => fn.call(adapter, t, msg, event);
    }
    /* ---------- 下行：早柚核心 -> 云崽 ---------- */
    /**
     * @description 下行：核心下发的一帧，转成云崽消息发给目标，并回一帧撤回回执
     * @param raw ws 的 message 载荷。核心发二进制帧（Buffer），但 ws 类型把碎片帧的 Buffer[] 与 ArrayBuffer 也算进来，故统一 toString
     */
    async onMessage(raw) {
        let data;
        try {
            data = JSON.parse(raw.toString());
        }
        catch (err) {
            return this.log("error", ["解码数据失败", String(raw).slice(0, 300), err]);
        }
        const bot = getBot(data.bot_self_id);
        // 控制指令优先，它们不走消息转换，也不需要回执
        try {
            if (bot && (await this.handleControl(data, bot)))
                return;
        }
        catch (err) {
            return this.log("error", ["处理控制指令错误", err]);
        }
        // 注意：回执必须在 finally 里发 —— 找不到目标、内容为空、发送抛错都要回一帧，漏回会被核心 latch 成「不支持撤回」（见 sendRecallReceipt）
        let recallId = null;
        try {
            if (!bot) {
                const account = String(data.bot_self_id ?? "").trim() || "(空)";
                this.log("error", `找不到机器人账号 ${account}`);
                return;
            }
            // 纯日志帧要在 pick 之前挡掉：核心下发 log 段时 target_id 常是占位值，走到 pick 不到目标会误报「找不到发送目标」。
            // 这里只判类型不做转换 —— gscoreToYunzai 会写日志、上传转发，跑两遍就重复了
            const segs = Array.isArray(data.content) ? data.content : [data.content];
            if (segs.length && segs.every(i => i?.type && GS_LOG_RE.test(i.type))) {
                await gscoreToYunzai(data.content);
                return;
            }
            // 先 pick 目标再转换：node 段在 Miao 上必须靠 target 原生的 makeForwardMsg 才能制作转发（Bot 上那个继承自 ICQQ，调用即抛）
            const targetId = String(data.target_id ?? "");
            let target;
            let tag;
            if (data.target_type === "direct") {
                target = bot.pickFriend(Number(targetId) || targetId);
                tag = `好友 ${targetId}`;
            }
            else {
                // 复合 id 先原样传：QQ 频道的 group_id 是 `qg_{guild}-{channel}`，QQBot-Plugin 靠 qg_ 前缀分派到 pickGuild，拆开就找不到了
                let g = bot.pickGroup(Number(targetId) || targetId);
                // 注意：退化取末段只对「用 - 连接两段数字」的复合 id 有意义，qg_ 开头的绝不能拆 —— 拆出的 channel_id 会在 pickGroup 走进普通群分支，pick 到不存在的群
                if (!g?.sendMsg && targetId.includes("-") && !targetId.startsWith("qg_")) {
                    const last = targetId.split("-").at(-1);
                    g = bot.pickGroup(Number(last) || last);
                }
                target = g;
                tag = `群 ${targetId}`;
            }
            if (!target?.sendMsg) {
                return this.log("error", `找不到发送目标 ${data.target_type}:${targetId}`);
            }
            const { message, quote, logOnly } = await gscoreToYunzai(data.content, target);
            if (logOnly || !message.length)
                return;
            // 修 ws-plugin 的 bug：上游算出 quote 却从未使用，引用回复全部失效
            if (quote)
                message.unshift(segReply(quote));
            markSent(echoKey(data.bot_self_id, targetId, message));
            makeLog("info", `早柚核心消息：${logStr(message)}`, `${this.name} => ${data.bot_self_id}, ${tag}`, true);
            const ret = await this.doSend(target, message, bot, data, targetId);
            // 计数放在 await 之后：sendMsg 抛错说明没发出去，不算成功中转。
            // 注意：「没抛错」也不等于成功 —— Milky 的 callApi 失败时返回 { retcode: -1, ... } 从不抛，OneBot 系同理，
            // 只 await 不看返回值会把失败记成成功中转，而「连着但不通」恰是这个计数该抓的
            const delivery = classifyDelivery(ret);
            // 部分投出：不计完整成功，也不当整条失败。QQBot 把一条下行拆成多组逐个发，`data` 与 `error` 同时非空时
            // 分不清「自己重试成功」还是「有一组永久失败」。取交集：撤回 id 照回（消息确实出去了，漏回会让核心侧定时撤回失效），
            // 但不计一次完整中转（宁可少计，不能把半条当整条）。
            if (delivery.kind === "partial") {
                const n = delivery.delivered == null ? "" : `已投出 ${delivery.delivered} 组，`;
                this.log("error", `发送部分失败：${delivery.error}（${n}${segSummary(message)}）`);
                recallId = sendMessageId(ret);
                return;
            }
            if (!deliveryComplete(delivery)) {
                // 带段类型摘要：发送失败最常见成因是某类段被平台拒收（图片尤甚），有摘要才分得清整条没发还是某种段不被接受
                this.log("error", `发送失败：${delivery.error}（${segSummary(message)}）`);
                // 不计数，但仍走 finally 里的回执 —— 漏回会被核心 latch 成「不支持撤回」
                return;
            }
            count("down", this.name);
            // 核心用这个 id 实现定时撤回；取不到就回 null，别让它干等 10s。
            // 可能是数组（ICQQ-Plugin 风控重试会拆多组），协议允许，原样透传
            recallId = sendMessageId(ret);
        }
        catch (err) {
            this.log("error", ["处理下行消息错误", err]);
        }
        finally {
            this.sendRecallReceipt(data, recallId);
        }
    }
}
