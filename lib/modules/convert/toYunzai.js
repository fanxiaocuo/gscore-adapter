/**
 * @description 早柚核心 -> 云崽
 */
import { fromGscoreMedia } from "../../utils/index.js";
import { GS_LOG_RE, LOG_LEVELS, LOG_ALIAS } from "../../constants/index.js";
import { buttonsFromGscore } from "./buttons.js";
import { makeLog, toStr, makeForwardMsg } from "../../utils/compat.js";
/**
 * @description MessageSend.content -> 云崽 message
 * 段一律原样转换，不按适配器能力做降级：发不出 button / markdown 的适配器本来就会把这些段丢掉，再加一层降级
 * 只是用文本噪音替换静默丢弃，并没有让内容真的送达。
 * 注意：log 段要逐段过滤而不是命中就丢整条 —— ws-plugin 的 makeGSUidSendMsg 只检查 content[0] 是不是 log，
 * 命中就丢弃整条消息的其余内容，那是个 bug。
 * @param content 早柚核心消息段。允许单段（非数组）—— 核心多数情况发数组，但 node 段递归时这里自己传的是
 *                单元素数组，两种都收
 * @param target  已 pick 出的 Group/Friend。仅 node 段用得上：Miao 上制作转发必须靠 target 的原生实现
 *                （见 compat.makeForwardMsg），不传则 Miao 上的转发会降级为纯文本
 * @returns { message, quote, logOnly }
 */
export async function gscoreToYunzai(content, target) {
    /**
     * 云崽侧 message
     *
     * 标 any[] 而不是 `(string | YunzaiSegment)[]`：装进去的是 `segment.image()` 等的返回值，那些函数各自返回
     * 不同的具体形状，而 `YunzaiSegment` 是本插件为读入站段定义的宽结构 —— 往里塞精确形状会因 index signature
     * 的兼容规则处处报错，而这个数组造完就直接交给 `target.sendMsg`。
     */
    const message = [];
    let quote = null;
    let sawLog = false;
    for (const i of Array.isArray(content) ? content : [content]) {
        if (!i?.type)
            continue;
        if (GS_LOG_RE.test(i.type)) {
            sawLog = true;
            const raw = i.type.slice(4).toLowerCase();
            const level = LOG_ALIAS[raw] || raw;
            makeLog(LOG_LEVELS.includes(level) ? level : "info", toStr(i.data), "GsCore");
            continue; // 关键：继续处理后续真实内容
        }
        switch (i.type) {
            case "text":
                if (i.data !== "" && i.data != null)
                    message.push(String(i.data));
                break;
            /**
             * 空 markdown 不透传，并把「核心侧可能丢了图」这条线索说出来
             *
             * 核心 to_markdown 取图片 URL 的前提是消息里带 image_size，而 image_size 只有走「转链接」分支才会产出；
             * 一旦「图片发送方式=link」却没启用图床，图片仍是 bytes、没有 image_size，于是既没写进 markdown 文本
             * 也没留在消息里，被静默丢弃、核心那边一句日志都不打。纯图片响应因此只剩一个空 markdown 加一组按钮。
             * 空 markdown 对用户没有信息量，QQ 侧还可能因空内容直接报错、顺带把按钮也拖没，所以跳过它并留一条 warn
             * 指向核心配置 —— 这类问题从现象上看只是「帮助没图了」，不给线索就得去翻核心源码。
             */
            case "markdown":
                if (String(i.data ?? "").trim() === "") {
                    makeLog("warn", "核心下发了空 markdown，已跳过；若本该是图片，检查核心「图片发送方式」与图床配置", "GsCore", true);
                    break;
                }
                message.push(segment.markdown(i.data));
                break;
            case "image":
                message.push(segment.image(fromGscoreMedia(i.data)));
                break;
            case "image_size":
                // 附加到上一个 image 段
                if (Array.isArray(i.data) && message.at(-1)?.type === "image") {
                    message.at(-1).width = Number(i.data[0]);
                    message.at(-1).height = Number(i.data[1]);
                }
                break;
            case "record":
                message.push(segment.record(fromGscoreMedia(i.data)));
                break;
            case "video":
                message.push(segment.video(fromGscoreMedia(i.data)));
                break;
            case "file": {
                // `{文件名}|{base64}`，用 indexOf 而非 split，避免 base64 里的 | 干扰
                const s = String(i.data ?? "");
                const idx = s.indexOf("|");
                const name = idx > -1 ? s.slice(0, idx) : undefined;
                const body = idx > -1 ? s.slice(idx + 1) : s;
                message.push(segment.file(fromGscoreMedia(body), name));
                break;
            }
            case "at":
                message.push(segment.at(Number(i.data) || String(i.data)));
                break;
            case "reply":
            case "reply_id":
                // 由调用方 unshift(segment.reply(quote))
                quote = String(i.data);
                break;
            case "buttons": {
                const b = buttonsFromGscore(i.data);
                if (b)
                    message.push(b);
                break;
            }
            case "node": {
                const nodes = [];
                for (const sub of Array.isArray(i.data) ? i.data : []) {
                    const { message: m } = await gscoreToYunzai([sub], target);
                    if (m.length)
                        // user_id 传数字：ICQQ 的 Forwardable.user_id 声明为 number，且被直接写进 protobuf 数字字段、
                        // 不做转换。Bot.uin 在两个框架上都是数字；取不到时退回 0 而不是 NaN
                        nodes.push({ message: m, nickname: "早柚核心", user_id: Number(Bot.uin) || 0 });
                }
                if (!nodes.length)
                    break;
                const fwd = await makeForwardMsg(nodes, target);
                if (fwd) {
                    message.push(fwd);
                    break;
                }
                // 制作失败（Miao 上没拿到 target、或上传被风控）：拍平成普通消息，宁可少了折叠样式也别把整条转发吞掉
                makeLog("warn", "转发消息制作失败，已降级为普通消息", "GsCore", true);
                for (const n of nodes)
                    for (const seg of n.message)
                        message.push(seg);
                break;
            }
            case "group":
                // 注意：这是定位 ID 不是内容，必须显式吃掉 —— 核心在 group_id 非空时给每一帧都附上这段（供 DoDo 私聊
                // 那类「需要两个 ID 才能定位」的平台取用），而云崽靠 target_id 就能定位。掉进 default 会被 String()
                // 成群号，每条群消息尾巴上都挂一串数字
                break;
            default:
                // 红线：不支持的类型 warning + 跳过，不抛异常。也别 push(String(i.data)) —— 对 template_markdown
                // 这种 data 为 dict 的段会打印 [object Object]，对纯元数据段则是把定位 ID 当正文发出去
                makeLog("warn", `暂不支持的消息段类型 ${i.type}，已跳过`, "GsCore", true);
        }
    }
    return { message, quote, logOnly: sawLog && message.length === 0 };
}
/**
 * @description 把 gscoreToYunzai 的产物归一化成事件 message 数组
 * dealEvent 遍历 e.message 时期望 {type,...} 对象，且读 i.url 取图片。
 */
export function normalizeEventMsg(message) {
    return message.map(i => {
        if (typeof i === "string")
            return { type: "text", text: i };
        if (i?.type === "image" && !i.url)
            return { ...i, url: i.file };
        return i;
    });
}
