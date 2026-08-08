import { WebSocket } from "ws";
import { config, resolveBotId } from "../../config/index.js";
import { STATUS_TEXT, GS_LOG_RE } from "../../constants/index.js";
import { logStr } from "../../utils/index.js";
import { makeLog } from "../../utils/compat.js";
import { setLocalHint } from "../../utils/fileServer.js";
import { yunzaiToGscore, gscoreToYunzai } from "../../modules/convert/index.js";
import { metaToGscore, metaLogStr } from "../../modules/notice/index.js";
import { count } from "../../modules/stats.js";
import { echoKey, markSent } from "./echo.js";
export class GsCoreClient {
    conf;
    name;
    /** 0 未连接/已停止 1 已连接 2 连接中 3 断线待重连 */
    status;
    retry;
    stop;
    ws;
    // 用 undefined 而非 null 作空值：clear{Timeout,Interval} 接受 undefined，
    // 传 null 在 strict 下会被拒，而运行时两者都是无操作。
    timer;
    hbTimer;
    aliveTimer;
    lastPong;
    constructor(conf) {
        this.conf = conf;
        this.name = conf.name || conf.url;
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
    /** 可读状态，供 apps 显示 */
    get statusText() {
        return (STATUS_TEXT[this.status] || String(this.status)) + (this.retry ? `(重连${this.retry}次)` : "");
    }
    /** 早柚核心用 ?token= 查询参数鉴权，不使用请求头 */
    get url() {
        const url = String(this.conf.url || "");
        if (!this.conf.token)
            return url;
        try {
            const u = new URL(url);
            if (!u.searchParams.has("token"))
                u.searchParams.set("token", this.conf.token);
            return u.toString();
        }
        catch {
            if (/[?&]token=/.test(url))
                return url;
            return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(this.conf.token)}`;
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
            // maxPayload 必须显式给。ws 的默认是 100MiB，而超限不是「丢掉这一帧」——
            // receiver.js:418/514 会抛 RSV 错误并把整条连接拆掉，表现为无缘无故断线重连，
            // 日志里只有一个 code=1009，很难查。
            // 参照 GenshinUID 的 Python 客户端（client.py: max_size=2**26）取 64MiB：
            // 核心下发图片走 base64，base64 会把体积放大 4/3，64MiB 够放约 48MiB 的原图，
            // 远超 media_max_size 的默认值，同时比 100MiB 更早暴露异常大的载荷。
            // handshakeTimeout 同样必须显式给。不给就退化到 OS 的 TCP 超时，
            // 防火墙黑洞掉 SYN 时可以卡在 CONNECTING 好几分钟，期间 status 一直是 2，
            // close 事件不来，scheduleReconnect 也就永远不触发，表现为「连接中」假死。
            // 参照 GenshinUID 的 Python 客户端（client.py: open_timeout=60）取 60s。
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
        // 记下这条连接走的本机地址：内置文件服务用它拼外链 host，
        // 比硬写 127.0.0.1 靠谱（核心常在 Docker 或另一台机器上）
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
        // 超时检测依赖 pong 刷新 lastPong，而 pong 只会因我们发 ping 而来。
        // 故 iv === 0（不发 ping）时必须一并关掉检测，否则 lastPong 永不更新，
        // Date.now() - lastPong 必然超阈值 → 无条件 terminate → 断线重连死循环。
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
    onClose(code, reason) {
        this.stopHeartbeat();
        const wasOnline = this.status === 1;
        this.status = 3;
        // close() 主动关闭时不摘监听器，close 事件仍会走到这里。
        // 通知必须在 stop 判断之后，否则 reloadClients() 逐个 close 会给主人
        // 刷 N 条"已断开"，而实际只是重载配置。
        if (this.stop) {
            this.status = 0;
            return;
        }
        this.log("warn", `连接已关闭 code=${code}${reason?.length ? ` reason=${reason}` : ""}`);
        if (wasOnline && config.notify_master)
            this.notify(`${this.name} 已断开`);
        this.scheduleReconnect(code);
    }
    scheduleReconnect(code) {
        if (this.stop) {
            this.status = 0;
            return;
        }
        const max = Number(this.conf.max_reconnect_attempts ?? 0);
        if (max > 0 && this.retry >= max) {
            this.status = 0;
            return this.log("error", `达到最大重连次数 ${max}，停止重连（可用 #早柚重连 恢复）`);
        }
        // ws-plugin components/Client.js:314 在 code === 1005 时彻底放弃重连。
        // 1005 = No Status Received，只是对端关闭时没带状态码（Python 侧重启很常见），
        // 完全是可恢复状态，这里继续重连，只额外打一条说明日志。
        if (code === 1005)
            this.log("warn", "对端未提供关闭码(1005)，通常是核心重启，继续重连");
        this.retry++;
        // 指数退避：base * 2^(retry-1)，封顶 base 的 12 倍（默认 5s → 最长 60s）。
        // 无上限重试（max_reconnect_attempts: 0）是默认值，核心长期不可达时
        // 固定间隔会一直以同频打日志、占连接，退避后收敛到低频探活。
        const base = Number(this.conf.reconnect_interval) || 5;
        const wait = Math.min(base * 2 ** (this.retry - 1), base * 12) * 1000;
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
    /** 本连接是否接管该 self_id */
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
    async sendReceive(e, isMaster) {
        if (this.status !== 1 || this.ws?.readyState !== WebSocket.OPEN)
            return false;
        const botId = resolveBotId(e, this.conf);
        const data = await yunzaiToGscore(e, botId, { isMaster });
        if (!data)
            return false;
        // 早柚核心 core.py 用 websocket.receive_bytes() 读取，必须发二进制帧
        // 只在真的发出去时计数：send 在 readyState 不是 OPEN 时返回 false，
        // 那种情况下这条消息并没有中转成功，计进去会让「连着但不通」的故障看不出来
        if (!this.send(data))
            return false;
        count("up", this.name);
        makeLog("debug", `上报早柚核心：${logStr(data.content)}`, `${e.self_id} => ${this.name}`, true);
        return true;
    }
    /**
     * 上行：非消息事件（入群/退群/戳一戳）
     * 单向通知，核心不回执，发出即完成。
     */
    sendMeta(e, meta, isMaster) {
        if (this.status !== 1 || this.ws?.readyState !== WebSocket.OPEN)
            return false;
        const data = metaToGscore(e, meta, resolveBotId(e, this.conf), { isMaster });
        if (!data)
            return false;
        if (!this.send(data))
            return false;
        count("event", this.name);
        makeLog("debug", `上报早柚核心事件：${metaLogStr(meta)}`, `${e.self_id} => ${this.name}`, true);
        return true;
    }
    /**
     * 发一帧到核心。
     * 必须是二进制：核心 core.py 的读循环是 websocket.receive_bytes()，
     * 而 ws 库对 string 发的是文本帧(opcode 1)，Starlette 那边取不到 "bytes" 键会直接报错。
     */
    send(data) {
        if (this.ws?.readyState !== WebSocket.OPEN)
            return false;
        this.ws.send(Buffer.from(JSON.stringify(data), "utf8"));
        return true;
    }
    /**
     * 回执：核心 bot.py 的 target_send 在 wait_recall 时会带 echo 下发，
     * 并在 _recall_waiters 里等一个 recall_message_id 回来（RECALL_WAIT_TIMEOUT=10s）。
     * 连续 3 次拿不到就会把本适配器标记为 _supports_recall=False，永久关掉撤回能力，
     * 所以即使发送失败也要回一帧（id 给 null），让核心的 future 立刻结束。
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
     * 核心下发的控制指令（bot.py 的 _Bot.unsend / _Bot.ban）。
     * 注意拼写是 excute_ 不是 execute_，核心源码即如此。
     * 两者都只在 content 长度为 1 时出现。
     * @returns 是否已作为控制指令处理
     */
    async handleControl(data, bot) {
        const list = Array.isArray(data.content) ? data.content : [];
        if (list.length !== 1)
            return false;
        const seg = list[0];
        const d = seg?.data || {};
        if (seg?.type === "excute_delete_message") {
            const id = d.message_id;
            try {
                // 撤回接口在各适配器上位置不一：优先群/好友对象，退化到 bot 级
                const target = data.target_type === "direct"
                    ? bot.pickFriend?.(Number(data.target_id) || data.target_id)
                    : bot.pickGroup?.(Number(data.target_id) || data.target_id);
                const fn = target?.recallMsg || bot.recallMsg;
                if (!fn)
                    return this.log("warn", "当前适配器不支持撤回消息"), true;
                await fn.call(target?.recallMsg ? target : bot, id);
                this.log("info", `已撤回消息 ${id}`);
            }
            catch (err) {
                this.log("error", ["撤回消息失败", err]);
            }
            return true;
        }
        if (seg?.type === "excute_ban_user") {
            const duration = Number(d.duration) || 0;
            try {
                const group = bot.pickGroup?.(Number(d.group_id) || d.group_id);
                if (!group?.muteMember)
                    return this.log("warn", "当前适配器不支持禁言"), true;
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
    /* ---------- 下行：早柚核心 -> 云崽 ---------- */
    async onMessage(raw) {
        let data;
        try {
            data = JSON.parse(raw.toString());
        }
        catch (err) {
            return this.log("error", ["解码数据失败", String(raw).slice(0, 300), err]);
        }
        const bot = Bot.bots[data.bot_self_id] || Bot;
        // 控制指令优先，它们不走消息转换，也不需要回执
        try {
            if (await this.handleControl(data, bot))
                return;
        }
        catch (err) {
            return this.log("error", ["处理控制指令错误", err]);
        }
        // 回执必须在 finally 里发：核心 bot.py 的 target_send 在 wait_recall 时
        // 等一个 recall_message_id（RECALL_WAIT_TIMEOUT=10s），连续 3 次拿不到就会
        // 把本适配器标记为 _supports_recall=False，永久关掉撤回能力。
        // 参照 GenshinUID 的 Python 客户端（client.py 用 try/finally 保证同一件事）：
        // 无论找不到目标、内容为空还是发送抛错，都必须回一帧。
        let recallId = null;
        try {
            // 纯日志帧要在 pick 之前挡掉：核心下发 log 段时 target_id 常是占位值，
            // 走到下面 pick 不到目标就会误报「找不到发送目标」。
            // 这里只判类型不做转换 —— gscoreToYunzai 会写日志、上传转发，跑两遍就重复了。
            const segs = Array.isArray(data.content) ? data.content : [data.content];
            if (segs.length && segs.every(i => i?.type && GS_LOG_RE.test(i.type))) {
                await gscoreToYunzai(data.content);
                return;
            }
            // 先 pick 目标再转换：node 段在 Miao 上必须靠 target 的原生
            // makeForwardMsg 才能制作转发（Bot 上那个继承自 ICQQ，调用即抛）。
            const targetId = String(data.target_id ?? "");
            let target;
            let tag;
            if (data.target_type === "direct") {
                target = bot.pickFriend(Number(targetId) || targetId);
                tag = `好友 ${targetId}`;
            }
            else {
                // 复合 id 先原样传（QQ 频道 id 本身就含 -），拿不到再退化为末段
                let g = bot.pickGroup(Number(targetId) || targetId);
                if (!g?.sendMsg && targetId.includes("-")) {
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
            // 修复 ws-plugin 的 bug：上游算出 quote 却从未使用，引用回复全部失效
            if (quote)
                message.unshift(segment.reply(quote));
            markSent(echoKey(data.bot_self_id, targetId, message));
            makeLog("info", `早柚核心消息：${logStr(message)}`, `${this.name} => ${data.bot_self_id}, ${tag}`, true);
            const ret = await target.sendMsg(message);
            // 计数放在 await 之后：sendMsg 抛错说明没发出去，那不算一次成功中转。
            // 纯日志帧和空消息在上面就 return 了，不会计进来。
            count("down", this.name);
            // 核心用这个 id 实现定时撤回；取不到就回 null，别让它干等 10s
            recallId = ret?.message_id ?? ret?.msg_id ?? ret?.id ?? null;
        }
        catch (err) {
            this.log("error", ["处理下行消息错误", err]);
        }
        finally {
            this.sendRecallReceipt(data, recallId);
        }
    }
}
