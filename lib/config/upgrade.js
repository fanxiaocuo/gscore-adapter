/**
 * @description 用户配置的增量升级：启动时比顶层键，缺的从默认文件里连注释一起搬到用户文件末尾
 * 首次运行是整份复制默认配置，之后默认里新加的项在用户文件里看不到（值由 merge 兜住，但开关与解释他读不到）。
 * 已有的键一律不碰；只比顶层，子项缺失由 merge 兜住、语义无歧义。
 * 注意：保留注释必须走 yaml 的 Document API 逐节点搬（注释挂在节点的 comment / commentBefore 上），YAML.stringify(值) 会把注释全丢掉
 * 注意：连接项里唯一允许写的动作是删掉已完成迁移的连接级 `bot_id`，理由见 {@link seedAccountBotIds}，别当违规改动删掉
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ConfigPath } from "../dir.js";
import { unflow } from "./yaml.js";
import { readIdList, writeAccountBotId } from "./botmap.js";
// compat 只 import 了一个 type，不会与本文件成环
import { makeLog } from "../utils/compat.js";
const defFile = path.join(ConfigPath, "default_config.yaml");
/**
 * @description 补齐用户配置里缺失的顶层键
 * @returns 变更说明，没有任何改动时返回空数组
 */
export function upgradeUserConfig(userFile) {
    const changes = [];
    let userSrc;
    let defSrc;
    try {
        userSrc = fs.readFileSync(userFile, "utf8");
        defSrc = fs.readFileSync(defFile, "utf8");
    }
    catch {
        // 用户文件还不存在（首次运行会整份复制，没有可补的），或默认文件读不到
        return changes;
    }
    let userDoc;
    let defDoc;
    try {
        userDoc = YAML.parseDocument(userSrc);
        defDoc = YAML.parseDocument(defSrc);
    }
    catch {
        // 注意：用户把 yaml 写坏了这里不该抛 —— 配置读取那边会报错并退回默认值，由那条路径去提示
        return changes;
    }
    if (userDoc.errors.length || defDoc.errors.length || !YAML.isMap(defDoc.contents))
        return changes;
    // 3.2 曾把连接列表改名为 client.ws_connections，现已改回 client.connections。
    // 只在新键不存在时改名，直接搬 Pair 节点以保留连接项与用户注释；
    // 注意：不迁回来的话保存时对不存在的键做索引操作会抛 YAML collection 错误；两套键并存时不擅自合并（lifecycle 启动时告警）
    const client = userDoc.getIn(["client"], true);
    if (YAML.isMap(client) && client.has("ws_connections") && !client.has("connections")) {
        const legacy = client.items.find(item => YAML.isScalar(item.key) && String(item.key.value ?? "") === "ws_connections");
        if (legacy && YAML.isScalar(legacy.key)) {
            legacy.key.value = "connections";
            changes.push("~ client.ws_connections -> client.connections");
        }
    }
    for (const item of defDoc.contents.items) {
        const key = YAML.isScalar(item.key) ? String(item.key.value ?? "") : "";
        if (!key || userDoc.has(key))
            continue;
        // 整节点搬（含 commentBefore / comment），值与注释一起过去
        userDoc.add(item);
        changes.push(`+ ${key}`);
    }
    // 绑定的账号在 bot_id_map 里各自有一行；顺带把连接级旧 bot_id 迁成账号级并删掉它
    seedAccountBotIds(userDoc, changes);
    if (!changes.length)
        return changes;
    // 写盘前先自查一遍：解析不回来就别写，宁可保持原样。
    // 注意：flow 标记记在节点上，toString 的选项管不着，不过 unflow 就会写出一行两百字符的连接列表
    const out = unflow(userDoc).toString({ lineWidth: 0 });
    try {
        const check = YAML.parse(out);
        if (!check || typeof check !== "object")
            return [];
    }
    catch {
        return [];
    }
    // 备份一份再写：这是唯一一处「插件主动改用户已有配置」的地方，出了问题要能原样找回来。
    // 注意：路径跟随 userFile，不硬锚 PluginPath —— 硬锚会让 GSCORE_CONFIG 指向临时文件时仍把备份写进真实配置目录（.bak 只剩 13 字节就是这么来的：测试 fixture 占掉了备份位）
    // 注意：只在 .bak 不存在时写 —— 每次覆盖会让它只记「上一次升级前」，而要记的是「插件第一次动我的文件之前」
    // 备份失败不阻断升级：出错的风险已由上面那次解析自查兜过一层，而下面这句是就地 writeFileSync，不是原子替换
    try {
        const bak = `${userFile}.bak`;
        if (!fs.existsSync(bak))
            fs.copyFileSync(userFile, bak);
    }
    catch {
        // 备份失败不阻断升级
    }
    fs.writeFileSync(userFile, out);
    return changes;
}
/**
 * @description 给每个绑定账号补一条 bot_id_map，并把连接级旧 `bot_id` 迁成账号级
 * 不是一次性迁移：账号随时会加（指令 / 面板 / 手改），那一栏空着时平台标识只能落到 default 上，
 * 核心侧就会按错的平台回消息；已有记录不覆盖由 {@link writeAccountBotId} 把守，配全的文件是空操作。
 * 注意：这是本文件唯一往连接项里写的动作，且只删 `bot_id` 这一个键 —— 运行时早就只读 bot_id_map，留着它就是一份「配置里写着一个平台、实际按另一个上报」的死声明
 * 注意：按 bind 减 exclude 迁 —— 被 exclude 的账号从这条连接派生不出运行时连接，照搬等于拿这条连接的平台去写别条连接负责的账号，而写入不带 force、源字段又同批删掉
 * 注意：关联不到账号（bind 为空或全被 exclude）时保留字段并 warn，不静默丢；这句 warn 不进 changes，否则每次启动都会重写文件并谎报「配置已升级」
 */
function seedAccountBotIds(userDoc, changes) {
    const client = userDoc.getIn(["client"], true);
    if (!YAML.isMap(client))
        return;
    const seq = client.get("connections", true);
    if (!YAML.isSeq(seq))
        return;
    for (const [i, item] of seq.items.entries()) {
        if (!YAML.isMap(item))
            continue;
        const bind = readIdList(item, "bind");
        const legacy = item.get("bot_id", true);
        const platform = YAML.isScalar(legacy) ? String(legacy.value ?? "").trim() : "";
        if (platform) {
            const excluded = new Set(readIdList(item, "exclude"));
            const targets = bind.filter(id => !excluded.has(id));
            if (targets.length) {
                // 不带 force：账号级已有的值是用户显式记过的，优先级高于这条连接级断言
                for (const id of targets)
                    if (writeAccountBotId(userDoc, id, platform))
                        changes.push(`+ bot_id_map.${id}`);
                // 删除无条件执行：即便所有目标账号都已有显式值，这个字段承载的信息也已在账号级表达完了。
                // 注意：删掉同时是幂等的保证 —— 下次启动这里读不到 bot_id，整段不再执行
                item.delete("bot_id");
                // 注意：序号用 1 起，这句会原样出现在「配置已升级：…」里，而面向用户的连接序号都是 1 起
                changes.push(`- 连接 #${i + 1} 的 bot_id`);
            }
            else {
                const name = YAML.isScalar(item.get("name", true))
                    ? String(item.get("name") ?? "").trim()
                    : "";
                // 注意：走 compat 的 makeLog，升级发生在启动最早一段，`Bot?.makeLog?.()` 那时可能静默什么也不做，
                // 而这一条恰恰是要求「不能静默丢弃」的分支；compat 会退到此刻已就绪的 globalThis.logger
                makeLog("warn", `连接 ${name || `#${i + 1}`} 的旧字段 bot_id: ${platform} 没有可迁移的账号` +
                    `（bind 为空或全在 exclude 里），已原样保留。` +
                    `运行时只读 bot_id_map，这一行当前不生效 —— ` +
                    `请把它填进 bot_id_map 的对应账号行，或给这条连接补上 bind。`, "GsCore");
            }
        }
        // 迁移之后再跑形状推断：刚写进去的值让这一轮对同一批账号成为空操作，
        // 而被 exclude 的账号仍按自己的形状补上（这一轮的值来自账号形状，与哪条连接无关）
        for (const id of bind) {
            if (writeAccountBotId(userDoc, id))
                changes.push(`+ bot_id_map.${id}`);
        }
    }
}
