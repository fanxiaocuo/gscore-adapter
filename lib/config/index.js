import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import chokidar from "chokidar";
import { PluginPath, ConfigPath } from "../dir.js";
import { isChannel } from "../utils/session.js";
import { upgradeUserConfig } from "./upgrade.js";
/**
 * 默认值与用户配置分属两个目录：
 * 默认值随插件发布（resources/config/），用户配置整个目录被 .gitignore 忽略，
 * 升级时不会覆盖用户改动。
 *
 * 路径由 dir.ts 从 import.meta.url 推导，不再依赖 process.cwd() 与
 * 硬编码的 "plugins/gscore-adapter"，插件改名或换目录都不受影响。
 */
const defFile = path.join(ConfigPath, "default_config.yaml");
const userDir = path.join(PluginPath, "config");
// 测试用：指向临时文件，避免动用户的真实配置
const userFile = process.env.GSCORE_CONFIG || path.join(userDir, "config.yaml");
/** 深合并：数组整体覆盖，对象递归 */
function merge(def, user) {
    if (user === undefined)
        return def;
    if (Array.isArray(def) || Array.isArray(user))
        return user ?? def;
    if (typeof def !== "object" || def === null)
        return user ?? def;
    if (typeof user !== "object" || user === null)
        return user ?? def;
    const ret = { ...def };
    for (const k of Object.keys(user))
        ret[k] = merge(def[k], user[k]);
    return ret;
}
function read(file, optional = false) {
    try {
        return YAML.parse(fs.readFileSync(file, "utf8")) || {};
    }
    catch (err) {
        if (optional && err?.code === "ENOENT")
            return {};
        globalThis.Bot?.makeLog?.("error", ["读取配置失败", file, err], "GsCore");
        return {};
    }
}
function load() {
    // 首次运行自动生成用户配置（仅此一次写盘）
    if (!fs.existsSync(userFile)) {
        try {
            // config/ 被 .gitignore 忽略，全新 clone 里整个目录都不存在，
            // 直接 copyFileSync 会 ENOENT，所以先建目录
            fs.mkdirSync(path.dirname(userFile), { recursive: true });
            fs.copyFileSync(defFile, userFile);
            globalThis.Bot?.makeLog?.("mark", `已生成配置 ${userFile}`, "GsCore");
        }
        catch (err) {
            globalThis.Bot?.makeLog?.("error", ["生成配置失败", err], "GsCore");
        }
    }
    else {
        // 已有配置：把默认里后加的顶层项连注释补进去，并把旧的 mode 迁成 enable。
        // 运行时 merge 本就能兜住值，补写是为了让用户在**文件里看得到**这些项。
        // 只在这里做（模块首次求值），热重载走的是 reload()，不会反复改用户文件。
        try {
            const changes = upgradeUserConfig(userFile);
            if (changes.length)
                globalThis.Bot?.makeLog?.("mark", `配置已升级（原文件备份为 config.yaml.bak）：${changes.join("、")}`, "GsCore");
        }
        catch (err) {
            globalThis.Bot?.makeLog?.("error", ["升级配置失败，按原配置运行", err], "GsCore");
        }
    }
    return merge(read(defFile), read(userFile, true));
}
/**
 * 配置对象。热重载时原地更新（delete + assign），
 * 保证其它模块已 import 的引用同步生效。
 */
export const config = load();
/** 用户配置文件路径，供报错信息与管理指令使用 */
export const configFile = userFile;
/** 自己写盘时抑制一次 watcher 回调，避免重复重载 */
let selfWrite = false;
/**
 * 配置重载时要清掉的缓存。
 * 用回调注册而不是直接 import——utils/media.ts 依赖 @/config，
 * 反向 import 会成环。
 */
const invalidators = [];
/** 注册一个"配置变了就清缓存"的回调 */
export function onConfigReload(fn) {
    invalidators.push(fn);
}
function reload() {
    const next = load();
    for (const k of Object.keys(config))
        delete config[k];
    Object.assign(config, next);
    for (const fn of invalidators)
        try {
            fn();
        }
        catch {
            // 清缓存失败不该影响重载本身
        }
}
// cfg.bot.file_watch 为 false 时框架已全局 stub 掉 chokidar.watch，此处自动尊重
const watcher = chokidar.watch(userFile).on("change", () => {
    if (selfWrite) {
        selfWrite = false;
        return;
    }
    reload();
    globalThis.Bot?.makeLog?.("mark", "配置已重载（连接变更需 #早柚重连）", "GsCore");
});
/**
 * 停掉配置监听
 *
 * chokidar v4 的 FSWatcher **没有 unref()**（只有 close()），所以它会一直持有
 * 事件循环 —— 表现是任何 import 过本模块的 node 进程都不会自己退出。
 * 插件跑在常驻的云崽里时这不是问题，但测试进程会挂住直到超时被杀，
 * 且失败信息只有一句 'test failed'，看不出原因。
 *
 * 所以提供一个显式的收尾入口。返回 promise 是因为 close() 是异步的。
 */
export function stopConfigWatch() {
    return watcher.close();
}
/**
 * 修改用户配置并写盘，保留原有注释
 * @param fn 直接操作 yaml Document
 */
export function saveConfig(fn) {
    let doc;
    try {
        doc = YAML.parseDocument(fs.readFileSync(userFile, "utf8"));
    }
    catch (err) {
        if (err?.code === "ENOENT")
            doc = YAML.parseDocument(fs.readFileSync(defFile, "utf8"));
        else
            throw err;
    }
    fn(doc);
    selfWrite = true;
    fs.writeFileSync(userFile, doc.toString({ lineWidth: 0 }));
    reload();
    return config;
}
/** 读取连接列表（保证是数组） */
export function getConnections() {
    const list = config.client?.connections;
    return Array.isArray(list) ? list : [];
}
/**
 * 适配器是否启用
 *
 * 只认 `enable`。老配置里的 `mode: client/off` 由 config/upgrade.ts 在启动时
 * 一次性迁成 enable 并从文件里删掉，所以这里不做双读 —— 两个键同时可用会留下
 * 「以谁为准」的长期歧义，而迁移是看得见的一次性改动。
 *
 * 缺省为 true：配置里没写过这项时按启用算，与「装了插件就想用」一致。
 */
export function enabled() {
    return config.enable !== false;
}
/**
 * 解析上报用的平台 bot_id
 *
 * 优先级：连接自身配置 > self_id 精确匹配 > 频道特判 > 适配器 id > 适配器 name > 兜底
 *
 * 为什么要查 name
 * --------------
 * 框架填的 e.adapter_id 取自 adapter.**id**（lib/bot.js:346），而实测本机各适配器
 * 的 id 与 name 大量不一致，且 id 严重撞车：
 *
 *   插件          adapter.id   adapter.name
 *   ICQQ-Plugin   QQ           ICQQ
 *   OneBotv11     QQ           OneBotv11
 *   OPQBot        QQ           OPQBot
 *   ComWeChat     WeChat       ComWeChat
 *   QQBot-Plugin  QQBot        QQBot
 *   Milky         Milky        Milky
 *
 * 老配置把键写成了 ICQQ / OneBotv11 / OPQBot / ComWeChat —— 那些是 name，
 * 用 id 查永远命中不了，只是恰好都该映射成 onebot，靠 default 兜底掩盖了。
 * 反过来只查 id 也不行：ICQQ / OneBot / OPQBot 三家 id 同为 "QQ"，
 * 想给其中一家单独指定平台标识就做不到。
 *
 * 所以两者都查、id 优先 name 兜底：既保持「精确到具体适配器」的能力
 * （写 name 命中唯一一家），又让 "QQ" 这种粗粒度键可用。
 *
 * 频道单独判
 * ---------
 * QQBot-Plugin 用**同一个** adapter（id 恒为 QQBot）同时处理 QQ 群与 QQ 频道，
 * 所以按适配器查表分不开这两者 —— 而核心侧 qqgroup 与 qqguild 是两个平台。
 * 判据只能来自事件形状，见 utils/message.ts 的 isChannel。
 * 键名 QQGuild 与 xiowo/yunzai-gscore-adapter 的 ADAPTER_BOT_ID_MAP 对齐。
 */
/**
 * @param selfId 调用方解析过的账号。不传则退回 e.self_id ——
 *               但它可能为 null，那时 `String(null)` 会拿字符串 "null" 去查表，
 *               既查不中又可能撞上用户真写了 "null" 键的极端情况，故一律先过滤。
 */
export function resolveBotId(e, conf, selfId) {
    if (conf?.bot_id)
        return conf.bot_id;
    const map = config.bot_id_map || {};
    // self_id 精确覆盖优先级最高（同一适配器下的不同账号可各指其一）
    const sid = selfId ?? (e.self_id != null ? String(e.self_id) : "");
    const bySelf = sid ? map[sid] : undefined;
    if (bySelf)
        return bySelf;
    // 频道要在适配器之前：QQBot 的群与频道共用 adapter.id
    if (isChannel(e) && map.QQGuild)
        return map.QQGuild;
    return (map[e.bot?.adapter?.id] ||
        map[e.adapter_id] ||
        map[e.bot?.adapter?.name] ||
        map[e.adapter_name] ||
        map.default ||
        "onebot");
}
