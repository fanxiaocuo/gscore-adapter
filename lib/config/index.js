import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import chokidar from "chokidar";
import { PluginPath, ConfigPath } from "../dir.js";
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
function reload() {
    const next = load();
    for (const k of Object.keys(config))
        delete config[k];
    Object.assign(config, next);
}
// cfg.bot.file_watch 为 false 时框架已全局 stub 掉 chokidar.watch，此处自动尊重
chokidar.watch(userFile).on("change", () => {
    if (selfWrite) {
        selfWrite = false;
        return;
    }
    reload();
    globalThis.Bot?.makeLog?.("mark", "配置已重载（连接变更需 #早柚重连）", "GsCore");
});
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
 * 解析上报用的平台 bot_id
 * 优先级：连接自身配置 > self_id 精确匹配 > 适配器 id > 兜底
 */
export function resolveBotId(e, conf) {
    if (conf?.bot_id)
        return conf.bot_id;
    const map = config.bot_id_map || {};
    return (map[String(e.self_id)] ||
        map[e.bot?.adapter?.id] ||
        map[e.adapter_id] ||
        map.default ||
        "onebot");
}
