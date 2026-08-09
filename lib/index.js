import fs from "node:fs";
import path, { basename, dirname, isAbsolute, join } from "node:path";
import YAML from "yaml";
import chokidar from "chokidar";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { Activity, ArrowUp, ChevronsUp, CircleDot, CircleMinus, CirclePlay, CirclePlus, CircleStop, Info, List, RefreshCw, ScrollText, Search, Settings } from "lucide-react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import os from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { renderToStaticMarkup } from "react-dom/server";

//#region src/dir.ts
/**
* 插件根目录
*
* 打包产物是 lib/index.js，上跳一级即插件根。
*
* 这条依赖「产物就在 lib/ 一层里」——tsdown.config.ts 的 outDir 必须保持
* lib/、且不能开子目录分块，否则 ResPath / YunzaiPath 会整体偏一层，
* 表现是读不到 resources/ 和框架配置。改 outDir 前先看这里。
*/
const PluginPath = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
* 云崽根目录
*
* 由 PluginPath 上跳两级（plugins/<name>/ -> 根）得到，不用 process.cwd() ——
* cwd 取决于**从哪儿启动进程**，在插件目录里跑脚本时它就是插件目录，
* 于框架配置会被拼成 plugins/<name>/lib/config/config.js 而找不到。
* 插件必须放在 plugins/ 下才会被框架 loader 扫到，所以这个层级关系是稳定的。
*/
const YunzaiPath = join(PluginPath, "../..");
/** 插件名 */
const PluginName = basename(PluginPath);
/** resources 目录 */
const ResPath = join(PluginPath, "resources");
/** 配置目录 */
const ConfigPath = join(ResPath, "config");

//#endregion
//#region src/config/index.ts
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
const userFile = process.env.GSCORE_CONFIG || path.join(userDir, "config.yaml");
/** 深合并：数组整体覆盖，对象递归 */
function merge(def, user) {
	if (user === void 0) return def;
	if (Array.isArray(def) || Array.isArray(user)) return user ?? def;
	if (typeof def !== "object" || def === null) return user ?? def;
	if (typeof user !== "object" || user === null) return user ?? def;
	const ret = { ...def };
	for (const k of Object.keys(user)) ret[k] = merge(def[k], user[k]);
	return ret;
}
function read$1(file, optional = false) {
	try {
		return YAML.parse(fs.readFileSync(file, "utf8")) || {};
	} catch (err) {
		if (optional && err?.code === "ENOENT") return {};
		globalThis.Bot?.makeLog?.("error", [
			"读取配置失败",
			file,
			err
		], "GsCore");
		return {};
	}
}
function load$1() {
	if (!fs.existsSync(userFile)) try {
		fs.mkdirSync(path.dirname(userFile), { recursive: true });
		fs.copyFileSync(defFile, userFile);
		globalThis.Bot?.makeLog?.("mark", `已生成配置 ${userFile}`, "GsCore");
	} catch (err) {
		globalThis.Bot?.makeLog?.("error", ["生成配置失败", err], "GsCore");
	}
	return merge(read$1(defFile), read$1(userFile, true));
}
/**
* 配置对象。热重载时原地更新（delete + assign），
* 保证其它模块已 import 的引用同步生效。
*/
const config = load$1();
/** 用户配置文件路径，供报错信息与管理指令使用 */
const configFile = userFile;
/** 自己写盘时抑制一次 watcher 回调，避免重复重载 */
let selfWrite = false;
/**
* 配置重载时要清掉的缓存。
* 用回调注册而不是直接 import——utils/media.ts 依赖 @/config，
* 反向 import 会成环。
*/
const invalidators = [];
/** 注册一个"配置变了就清缓存"的回调 */
function onConfigReload(fn) {
	invalidators.push(fn);
}
function reload() {
	const next = load$1();
	for (const k of Object.keys(config)) delete config[k];
	Object.assign(config, next);
	for (const fn of invalidators) try {
		fn();
	} catch {}
}
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
function saveConfig(fn) {
	let doc;
	try {
		doc = YAML.parseDocument(fs.readFileSync(userFile, "utf8"));
	} catch (err) {
		if (err?.code === "ENOENT") doc = YAML.parseDocument(fs.readFileSync(defFile, "utf8"));
		else throw err;
	}
	fn(doc);
	selfWrite = true;
	fs.writeFileSync(userFile, doc.toString({ lineWidth: 0 }));
	reload();
	return config;
}
/** 读取连接列表（保证是数组） */
function getConnections() {
	const list = config.client?.connections;
	return Array.isArray(list) ? list : [];
}
/**
* 解析上报用的平台 bot_id
* 优先级：连接自身配置 > self_id 精确匹配 > 适配器 id > 兜底
*/
function resolveBotId(e, conf) {
	if (conf?.bot_id) return conf.bot_id;
	const map = config.bot_id_map || {};
	return map[String(e.self_id)] || map[e.bot?.adapter?.id] || map[e.adapter_id] || map.default || "onebot";
}

//#endregion
//#region src/constants/index.ts
/** 连接状态数值的可读名 */
const STATUS_TEXT = {
	0: "未连接",
	1: "已连接",
	2: "连接中",
	3: "断线重连中"
};
/** 回环防护：记录本插件代发内容的有效期与容量上限 */
const ECHO_TTL = 1e4;
/** log_{level} 段，仅出现在 MessageSend 方向 */
const GS_LOG_RE = /^log_/i;
const LOG_LEVELS = [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"mark"
];
/**
* 早柚核心 segment.py 的 MessageSegment.log 只发这四种（大写）：
*   Literal["INFO", "WARNING", "ERROR", "SUCCESS"]
* 其中 WARNING / SUCCESS 不是云崽 logger 的方法名，需要映射，
* 否则会静默降级成 info、丢掉告警级别。
*/
const LOG_ALIAS = {
	warning: "warn",
	success: "mark",
	critical: "fatal"
};
/**
* 本 fork 的 notice 事件形状与 OneBot 原生不同。
* plugins/adapter/OneBotv11.js:1330-1333 把 notice_type 按 _ 拆成两段：
*   group_increase -> notice_type="group", sub_type="increase"
* ICQQ 原生即是这个形状，OneBotv11 的拆分正是为了对齐它。
* 故匹配主键是 sub_type；写成 notice_type === "group_increase" 恒为 false。
*/
const SUB_TYPE_MAP = {
	increase: "user_join_group",
	decrease: "user_exit_group"
};

//#endregion
//#region src/utils/compat.ts
/**
* 框架兼容层
*
* TRSS-Yunzai 在 `Bot` 上挂了一批工具方法，Miao-Yunzai **完全没有**——
* Miao 的 lib/bot.js 是 `class Yunzai extends Client`（ICQQ 的 Client），
* 只有协议方法，没有这些便利函数。实测缺失清单：
*
*   Bot.makeLog / Bot.String / Bot.Buffer / Bot.fileToUrl   —— Miao 全部为 0 处
*
* 直接调用会在 Miao 上抛 TypeError，且第一条日志就在插件加载时打出，
* 等于插件一装即崩。故本模块统一提供垫片。
*
* 原则：**按能力探测，不按框架名分支。**
* 不学 `package.json.name.includes("trss")` 那种判法——同步读盘、依赖 cwd，
* 且 fork 改名即失效（本仓库目录名就叫 Miao-Yunzai，实际却是 TRSS，正是反例）。
* 每个方法各自探测，谁缺补谁；将来 Miao 补齐了任何一个，这里自动改用原生实现。
*/
/** TRSS 的 makeLog 支持 mark，Miao 的 logger 没有，退到 info */
const LEVEL_FALLBACK = {
	mark: "info",
	success: "info",
	fatal: "error"
};
/**
* Bot.makeLog 垫片
*
* TRSS 签名：makeLog(level, msg, tag, force)
* Miao 只有全局 logger，且无 tag 概念——把 tag 拼进消息里保持可读性。
*/
function makeLog(level, msg, tag, force = false) {
	const B = globalThis.Bot;
	if (typeof B?.makeLog === "function") return B.makeLog(level, msg, tag, force);
	const lg = globalThis.logger;
	if (!lg) return;
	const lv = typeof lg[level] === "function" ? level : LEVEL_FALLBACK[level] || "info";
	const prefix = tag ? `[${tag}]` : "";
	if (Array.isArray(msg)) return lg[lv](prefix, ...msg);
	return lg[lv](prefix, msg);
}
/**
* Bot.String 垫片
*
* TRSS 的 Bot.String 能把 Error / Buffer / 循环引用对象都转成可读字符串。
* 垫片行为对齐要点：字符串原样返回（不要加引号），Error 带 stack，
* 对象走 JSON 且**必须处理循环引用**——事件对象上挂着 e.bot，
* 不处理会直接抛 TypeError: Converting circular structure to JSON。
*/
function toStr(data) {
	const B = globalThis.Bot;
	if (typeof B?.String === "function") return B.String(data);
	if (typeof data === "string") return data;
	if (data instanceof Error) return data.stack || data.message;
	if (Buffer.isBuffer(data)) return `<Buffer ${data.length} bytes>`;
	if (data === null || data === void 0) return String(data);
	if (typeof data !== "object") return String(data);
	try {
		const seen = /* @__PURE__ */ new WeakSet();
		return JSON.stringify(data, (_k, v) => {
			if (typeof v === "object" && v !== null) {
				if (seen.has(v)) return "[Circular]";
				seen.add(v);
			}
			if (Buffer.isBuffer(v)) return `<Buffer ${v.length} bytes>`;
			return v;
		});
	} catch {
		return String(data);
	}
}
/**
* Bot.Buffer 垫片
*
* TRSS 的 Bot.Buffer(file, {http, size}) 三路返回：
*   - Buffer                      —— 读到内容
*   - http URL 原样               —— opts.http 为真且入参是网址时不下载
*   - file:// 路径                —— 超过 opts.size 时不读进内存
*
* 垫片必须保持这三路语义，否则 media.ts 的分支会走错。
* 支持的入参形式对齐云崽的 file 字段：Buffer / base64:// / data: /
* http(s):// / file:// / 裸路径。
*/
async function toBuffer(file, opts = {}) {
	const B = globalThis.Bot;
	if (typeof B?.Buffer === "function") return B.Buffer(file, opts);
	if (Buffer.isBuffer(file)) return file;
	if (file == null) return file;
	const s = String(file);
	if (s.startsWith("base64://")) return Buffer.from(s.slice(9), "base64");
	if (s.startsWith("data:")) {
		const i = s.indexOf("base64,");
		if (i !== -1) return Buffer.from(s.slice(i + 7), "base64");
		return file;
	}
	if (/^https?:\/\//.test(s)) {
		if (opts.http) return s;
		try {
			const res = await fetch(s);
			if (!res.ok) return file;
			const buf = Buffer.from(await res.arrayBuffer());
			if (opts.size && buf.length > opts.size) return s;
			return buf;
		} catch {
			return file;
		}
	}
	try {
		const { readFile, stat } = await import("node:fs/promises");
		const { fileURLToPath } = await import("node:url");
		const path = s.startsWith("file://") ? fileURLToPath(s) : s;
		if (opts.size) {
			if ((await stat(path)).size > opts.size) {
				const { pathToFileURL } = await import("node:url");
				return pathToFileURL(path).href;
			}
		}
		return await readFile(path);
	} catch {
		return file;
	}
}
/**
* Bot.fileToUrl 垫片
*
* TRSS 用自带的文件服务把本地文件转成 http 外链。Miao 没有这个服务，
* **无法用垫片模拟**——没有 HTTP 服务就没有外链可给。
*
* 故此处不伪造，直接抛错，由调用方 catch 后降级（media.ts 会打日志并跳过该段）。
* 后果：Miao 上超过 media_max_size 的大图/大文件发不出去，小文件走 base64 正常。
* 这是能力缺失，不是 bug——伪造一个假 URL 只会让核心侧拿到打不开的链接。
*
* @types/trss-yunzai 把 fileToUrl 拼成了 fileToUrll（多一个 l），
* 框架实际方法名见 lib/bot.js:274 —— 以框架源码为准，不迁就上游错拼。
*/
function fileToUrl(file, opts) {
	const B = globalThis.Bot;
	if (typeof B?.fileToUrl === "function") return B.fileToUrl(file, opts);
	return Promise.reject(/* @__PURE__ */ new Error("当前框架不支持 Bot.fileToUrl（文件外链服务），无法生成外链"));
}
/**
* Bot.makeForwardMsg 垫片
*
* 这是**唯一一个不能按"方法是否存在"探测**的能力——两个框架都有同名方法，
* 但语义完全相反，直接调用会在 Miao 上同步抛 TypeError：
*
*   TRSS  lib/bot.js:554  makeForwardMsg(msg) { return { type:"node", data:msg } }
*         纯标记，同步返回，由各适配器在 sendMsg 时自行处理
*
*   Miao  **Bot 上没有**（lib/bot.js 里 0 处）。但 `class Yunzai extends Client`，
*         于是继承到 ICQQ 的 Client.prototype.makeForwardMsg（client.d.ts:227）：
*           makeForwardMsg(fake, dm=false, nt) {
*             return (dm ? this.pickFriend : this.pickGroup)(this.uin).makeForwardMsg(fake, nt)
*           }
*         —— async、要真的走协议上传、且**从 Bot 上调必然失败**：
*         `(this.pickGroup)(this.uin)` 丢了 this 绑定，实测同步抛
*         `TypeError: (intermediate value)(...) is not a function`（icqq client.js:397）。
*
* 所以 `typeof Bot.makeForwardMsg === "function"` 在两边都为真，探测不出差别。
* 这里改按**返回值形状**判定：TRSS 同步返回带 type:"node" 的普通对象，
* 拿到即用；否则走 target 上的原生 makeForwardMsg（ICQQ 的 Group/Friend 实现）。
*
* @param nodes  [{ message, nickname, user_id }]
* @param target 已 pick 出的 Group/Friend，Miao 路径必须有它才能上传
*/
async function makeForwardMsg(nodes, target) {
	const B = globalThis.Bot;
	try {
		const r = B?.makeForwardMsg?.(nodes);
		if (r && typeof r === "object" && !(r instanceof Promise) && r.type === "node") return r;
		if (r instanceof Promise) {
			const v = await r;
			if (v) return v;
		}
	} catch {}
	if (typeof target?.makeForwardMsg === "function") return await target.makeForwardMsg(nodes);
	return null;
}
/**
* 当前框架能否制作转发消息。
* 供自检使用——两边都"有方法"，得按上面的形状规则实际判定。
*/
function forwardMode() {
	const B = globalThis.Bot;
	try {
		const r = B?.makeForwardMsg?.([]);
		if (r && typeof r === "object" && !(r instanceof Promise) && r.type === "node") return "native";
	} catch {
		return "target";
	}
	return "target";
}
/** 本插件依赖、但框架可能没有的 Bot 方法 */
const REQUIRED = [
	"makeLog",
	"String",
	"Buffer",
	"fileToUrl"
];
/**
* 返回缺失的 Bot 方法名。空数组表示框架能力齐全。
* 供启动自检使用——静默降级最难排查，缺什么要明说。
*/
function missingBotApis() {
	const B = globalThis.Bot;
	return REQUIRED.filter((m) => typeof B?.[m] !== "function");
}
/**
* 启动自检。在 online 之后调用（此时 Bot 已完成扩展，早于此刻检测会误报）。
*
* makeLog / String / Buffer 缺失都由本文件垫片补齐，属于"已处理"，
* 只在 debug 里留痕，免得正常用户看见一堆无需处理的告警。
*
* fileToUrl 是唯一无法垫片的能力，会真实影响大文件发送，故单独 warn。
*/
function checkFrameworkApis() {
	const missing = missingBotApis();
	if (!missing.length) return;
	const shimmed = missing.filter((m) => m !== "fileToUrl");
	if (shimmed.length) makeLog("debug", `框架缺少 ${shimmed.join("、")}，已由兼容层接管`, "GsCore", true);
	if (missing.includes("fileToUrl")) makeLog("warn", "当前框架不提供 Bot.fileToUrl（文件外链服务）：超过 media_max_size 的大图/大文件将无法上报，小文件走 base64 不受影响。", "GsCore");
}

//#endregion
//#region src/utils/logger.ts
/**
* 日志工具
*
* 统一插件的日志前缀，避免各处硬编码 "GsCore" 字符串。
*/
/** 默认日志前缀 */
const LOG_TAG = "GsCore";
/** 打一条插件日志 */
function log$1(level, msg, tag = LOG_TAG, force = false) {
	return makeLog(level, msg, tag, force);
}
/**
* 日志用：截断 base64，避免刷屏
* config.log_truncate 为 false 时原样输出
*/
function logStr(msg) {
	const s = toStr(msg);
	return config.log_truncate === false ? s : s.replace(/base64:\/\/[^"'\],]{32,}/g, "base64://...");
}

//#endregion
//#region src/utils/fileServer.ts
/**
* 内置文件服务
*
* 框架没有 Bot.fileToUrl 时（Miao-Yunzai）自己起一个 HTTP 服务把大文件挂出去，
* 让早柚核心能用 link:// 拉取。这样开箱即用，不必强迫用户去弄图床。
*
* 为什么不用 express：Miao 根本没装。lib/tools/web.js 里那句 `import express`
* 是孤儿脚本（全仓库无人 import，express 也不在 package.json / node_modules 里），
* 照着它写会在真机上 ERR_MODULE_NOT_FOUND。node:http 零依赖，同样够用。
*
* 设计要点：
* - **懒启动**：只有真的需要外链（超过 media_max_size 且没有 Bot.fileToUrl）
*   才监听端口。TRSS 用户、以及从不发大图的 Miao 用户，端口始终不开。
* - **内存暂存 + 到期自动清**：文件只在 link_expire 窗口内可取，过期即释放，
*   不落盘、不留垃圾。
* - **随机 token 路径**：路径不可枚举，避免把本机文件变成公开目录。
* - **一次性**：核心取走即删（可配），降低外链被重放的窗口。
*/
const files = /* @__PURE__ */ new Map();
let server = null;
let starting = null;
function fsConf() {
	return config.file_server || {};
}
/** 内置文件服务是否可用（未显式关闭） */
function fileServerEnabled() {
	return fsConf().enable !== false;
}
/**
* 猜 Content-Type
*
* 核心侧（PIL / 浏览器）主要靠它决定怎么解码，给错了会拿不到图。
* 只覆盖早柚核心实际会走的几类媒体，其余给 octet-stream。
*/
const MIME = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	amr: "audio/amr",
	silk: "audio/silk",
	mp4: "video/mp4",
	mov: "video/quicktime"
};
function guessType(name) {
	const ext = String(name || "").split(".").pop()?.toLowerCase();
	return ext && MIME[ext] || "application/octet-stream";
}
/**
* 起服务。失败不抛错——调用方会降级到 upload_hook / 跳过该段，
* 一个端口占不到不该让消息发送整体崩掉。
*/
function start() {
	if (server?.listening) return Promise.resolve(server);
	if (starting) return starting;
	starting = new Promise((resolve) => {
		const srv = http.createServer(handle);
		let settled = false;
		srv.on("error", (err) => {
			if (settled) {
				makeLog("warn", ["内置文件服务运行时错误", err], "GsCore");
				return;
			}
			settled = true;
			makeLog("error", ["内置文件服务启动失败，大文件将无法生成外链", err], "GsCore");
			srv.close();
			server = null;
			starting = null;
			resolve(null);
		});
		const port = Number(fsConf().port) || 0;
		const host = String(fsConf().host || "0.0.0.0");
		srv.listen(port, host, () => {
			settled = true;
			server = srv;
			starting = null;
			srv.unref?.();
			const p = srv.address()?.port;
			makeLog("info", `内置文件服务已启动 ${host}:${p}（仅用于大文件外链）`, "GsCore");
			resolve(srv);
		});
	});
	return starting;
}
function handle(req, res) {
	const id = String(req.url || "").split("?")[0].replace(/^\/+/, "");
	const item = files.get(id);
	if (!item || item.expire < Date.now()) {
		res.writeHead(404).end("404");
		return;
	}
	res.writeHead(200, {
		"Content-Type": item.type,
		"Content-Length": String(item.buf.length),
		"Cache-Control": "no-store"
	});
	if (req.method === "HEAD") res.end();
	else res.end(item.buf);
	if (fsConf().once !== false) drop(id);
}
function drop(id) {
	const item = files.get(id);
	if (!item) return;
	clearTimeout(item.timer);
	files.delete(id);
}
/**
* 对外地址的 host
*
* 优先用配置里的 public_host；没配就用已连上的 ws 的本地地址——
* 那正是能路由到核心的那张网卡，比硬写 127.0.0.1 靠谱：
* 核心在 Docker 或另一台机器上时，127.0.0.1 指向的是它自己。
*/
function publicHost() {
	const conf = String(fsConf().public_host || "").trim();
	if (conf) return conf;
	const v4 = localHint.replace(/^::ffff:/, "");
	if (v4 && v4 !== "::" && v4 !== "0.0.0.0" && !v4.startsWith("127.")) return v4.includes(":") ? `[${v4}]` : v4;
	return "127.0.0.1";
}
/**
* ws 连接的本地地址
*
* 由客户端在连上时写入。放在模块级而不是一路透传参数：
* 「外链该用哪个 host」是传输层的事，消息转换层（toGscore.ts 四处调用点）
* 不该为此改签名。多条连接时后连上的覆盖前者——它们通常在同一网段，
* 真需要区分的场景配 public_host 显式指定。
*/
let localHint = "";
/** 记录 ws 本地地址，用于推断外链 host */
function setLocalHint(addr) {
	const s = String(addr || "").trim();
	if (s) localHint = s;
}
/**
* 把内容挂上去，返回 http 外链。
*
* @param buf  文件内容
* @param name 原文件名，用于猜 Content-Type
* @returns http 链接；服务起不来时返回空串
*/
async function serveFile(buf, name) {
	const srv = await start();
	if (!srv) return "";
	const ttl = Number(config.link_expire) || 3e5;
	const id = `${randomBytes(16).toString("hex")}${name ? `/${encodeURIComponent(name)}` : ""}`;
	const timer = setTimeout(() => files.delete(id), ttl);
	timer.unref?.();
	files.set(id, {
		buf,
		name,
		type: guessType(name),
		expire: Date.now() + ttl,
		timer
	});
	const port = srv.address()?.port;
	return `http://${publicHost()}:${port}/${id}`;
}
/** 当前暂存文件数，供 #早柚状态 显示 */
function pendingFiles() {
	return files.size;
}

//#endregion
//#region src/utils/media.ts
/**
* 媒体转换工具
*
* 云崽文件字段 <-> 早柚核心媒体串（base64:// 与 link:// 两种形式）
*/
function mediaMaxSize() {
	return Number(config.media_max_size) || 10485760;
}
function fileMaxSize() {
	return Number(config.file_max_size) || 52428800;
}
function linkExpire() {
	return Number(config.link_expire) || 3e5;
}
/**
* 自定义图床上传钩子
*
* 框架没有 Bot.fileToUrl（如 Miao-Yunzai）时的补救路径。没有 HTTP 文件服务
* 就没有外链可给，但**用户自己有图床**时可以补上这一环。
*
* 配置 `upload_hook` 指向一个 js/ts 模块，默认导出一个函数：
*   export default async (buf, name) => "https://图床/xxx.png"
* 返回 http(s) 链接即视为成功；返回空/抛错则视为失败，走原降级逻辑。
*
* 只在真正需要外链时才加载（超过 media_max_size 且框架没有 fileToUrl），
* 加载后缓存，避免每张图都读盘。
*/
let uploadHook;
async function getUploadHook() {
	if (uploadHook !== void 0) return uploadHook;
	const p = String(config.upload_hook || "").trim();
	if (!p) return uploadHook = null;
	try {
		const abs = isAbsolute(p) ? p : join(YunzaiPath, p);
		const mod = await import(pathToFileURL(abs).href);
		const fn = mod.default || mod.upload;
		if (typeof fn !== "function") {
			makeLog("error", `upload_hook ${p} 没有默认导出函数，已忽略`, "GsCore");
			return uploadHook = null;
		}
		makeLog("info", `已加载自定义图床 ${p}`, "GsCore");
		return uploadHook = fn;
	} catch (err) {
		makeLog("error", [
			"加载 upload_hook 失败，已忽略",
			p,
			err
		], "GsCore");
		return uploadHook = null;
	}
}
/** 重载配置时清掉缓存，让新的 upload_hook 生效 */
function resetUploadHook() {
	uploadHook = void 0;
}
onConfigReload(resetUploadHook);
/**
* 云崽文件字段 -> 早柚核心媒体串
* 小文件走 base64://，http 外链或超限文件走 link://
*/
async function toGscoreMedia(file, name) {
	if (file == null || file === "") return "";
	const data = await toBuffer(file, {
		http: true,
		size: mediaMaxSize()
	});
	if (Buffer.isBuffer(data)) return `base64://${data.toString("base64")}`;
	const s = toStr(data);
	if (/^https?:\/\//.test(s)) return `link://${s}`;
	try {
		return `link://${await fileToUrl(s, {
			name,
			time: linkExpire()
		})}`;
	} catch (err) {
		const url = await viaFallback(s, name);
		if (url) return `link://${url}`;
		makeLog("error", [
			"生成外链失败",
			s,
			err
		], "GsCore");
		return "";
	}
}
/**
* 没有 Bot.fileToUrl 时的降级链
*
* 1. 内置文件服务（默认开，零配置即可用）
* 2. 用户自己的图床 upload_hook（内置服务被关掉或起不来时）
*
* 顺序理由：内置服务不需要用户做任何事，先试它；图床要用户自己搭，
* 但它给的是公网地址，内网穿透场景下更可靠，所以保留为显式后备。
*/
async function viaFallback(pathOrUrl, name) {
	if (fileServerEnabled()) try {
		const buf = await toBuffer(pathOrUrl);
		if (Buffer.isBuffer(buf)) {
			const url = await serveFile(buf, name);
			if (url) return url;
		}
	} catch (err) {
		makeLog("warn", ["内置文件服务挂载失败，尝试图床", err], "GsCore");
	}
	return viaUploadHook(pathOrUrl, name);
}
/**
* 走自定义图床。返回空字符串表示没配或失败。
* 到这一步说明内置文件服务不可用（被关掉或端口起不来），
* 提示里要把两条路都说清楚，用户才知道该修哪个。
*/
async function viaUploadHook(pathOrUrl, name) {
	const fn = await getUploadHook();
	if (!fn) {
		makeLog("warn", "当前框架没有 Bot.fileToUrl（文件服务），且内置文件服务不可用，大文件无法生成外链。\n可开启 file_server（默认开启，检查是否被关闭或端口被占用），或设置 upload_hook 指向自己的图床模块，或调大 media_max_size 让其走 base64（占内存）。", "GsCore");
		return "";
	}
	try {
		const buf = await toBuffer(pathOrUrl);
		if (!Buffer.isBuffer(buf)) return "";
		const url = String(await fn(buf, name) || "");
		if (/^https?:\/\//.test(url)) return url;
		makeLog("error", ["图床未返回 http 链接，已跳过该段", url], "GsCore");
		return "";
	} catch (err) {
		makeLog("error", ["图床上传失败", err], "GsCore");
		return "";
	}
}
/**
* file 段协议规定必须是 `{文件名}|{裸base64}`，没有 URL 形式，
* 所以只能读全量。加硬上限防止 OOM。
*/
async function toGscoreFile(file, name) {
	if (file == null || file === "") return "";
	const buf = await toBuffer(file);
	if (!Buffer.isBuffer(buf)) {
		makeLog("warn", ["file 段读取失败，已跳过", logStr(file)], "GsCore");
		return "";
	}
	if (buf.length > fileMaxSize()) {
		makeLog("warn", `file 段 ${(buf.length / 1048576).toFixed(1)}MB 超过上限 ${(fileMaxSize() / 1048576).toFixed(1)}MB，已跳过`, "GsCore");
		return "";
	}
	return `${name || `${Date.now().toString(36)}.dat`}|${buf.toString("base64")}`;
}
/**
* 早柚核心媒体串 -> 云崽可用的 file 值
* 注意：不要照抄 ws-plugin 的 /^(http|base64|link)/ ——
* 该正则未锚定协议分隔符，恰好以 link 开头的裸 base64 会被误判
*/
function fromGscoreMedia(data) {
	if (Buffer.isBuffer(data)) return data;
	let s = toStr(data ?? "");
	if (s.startsWith("link://")) {
		s = s.slice(7);
		if (!/^https?:\/\//.test(s)) s = `http://${s}`;
		return s;
	}
	if (/^(base64:\/\/|https?:\/\/|file:\/\/|data:)/.test(s)) return s;
	return `base64://${s}`;
}

//#endregion
//#region src/utils/message.ts
/**
* 消息过滤与回环防护的共享工具
*/
/** 群/用户黑白名单，消息与 meta 事件路径共用同一份 filter 配置 */
function passFilter(e) {
	const f = config.filter || {};
	const gid = e.group_id != null ? String(e.group_id) : null;
	if (gid) {
		if (f.white_group?.length && !f.white_group.some((i) => String(i) === gid)) return false;
		if (f.black_group?.length && f.black_group.some((i) => String(i) === gid)) return false;
	}
	if (f.black_user?.length && f.black_user.some((i) => String(i) === String(e.user_id))) return false;
	return true;
}
/** 事件来源是否为早柚核心方向的 Bot（回环防护第 2、3 层） */
function isFromGsCore(e) {
	const adapterId = e.bot?.adapter?.id || e.adapter_id;
	if (adapterId === "GSUIDCore" || adapterId === "GsCore") return true;
	return !!e.gscore_origin;
}
/** 提取事件中的纯文本，用于前缀/包含匹配 */
function eventText(e) {
	return (e.message || []).filter((i) => i?.type === "text").map((i) => i.text).join("").trim();
}
/** 转成非空字符串，取不到给 "" */
function str(v) {
	return v == null ? "" : String(v);
}

//#endregion
//#region src/modules/convert/buttons.ts
/**
* 云崽按钮 -> 早柚核心 Button
* 字段拼写 permisson 为协议原文（非标准拼法），勿改
*/
function buttonToGscore(b) {
	if (!b || typeof b !== "object") return false;
	const btn = {
		text: b.text ?? "",
		pressed_text: b.clicked_text ?? b.pressed_text ?? null,
		style: typeof b.style === "number" ? b.style : 1,
		permisson: 2,
		specify_role_ids: [],
		specify_user_ids: [],
		unsupport_tips: b.unsupport_tips ?? "您的客户端暂不支持该功能, 请升级后适配",
		...b.GsCore,
		...b.GSUIDCore
	};
	if (b.input != null) {
		btn.data = String(b.input);
		btn.action = 2;
	} else if (b.callback != null) {
		btn.data = String(b.callback);
		btn.action = 1;
	} else if (b.link != null) {
		btn.data = String(b.link);
		btn.action = 0;
	} else if (b.data != null) {
		btn.data = String(b.data);
		btn.action = typeof b.action === "number" ? b.action : 2;
	} else return false;
	const p = b.permission;
	if (p === "admin") btn.permisson = 1;
	else if (p != null && p !== "all") {
		btn.permisson = 0;
		btn.specify_user_ids = (Array.isArray(p) ? p : [p]).map(String);
	}
	if (Array.isArray(b.role_ids) && b.role_ids.length) {
		btn.permisson = 3;
		btn.specify_role_ids = b.role_ids.map(String);
	}
	return btn;
}
/** segment.button(...rows).data -> Button[][] */
function buttonsToGscore(square) {
	const rows = [];
	for (const row of Array.isArray(square) ? square : [square]) {
		const out = [];
		for (const b of Array.isArray(row) ? row : [row]) {
			const btn = buttonToGscore(b);
			if (btn) out.push(btn);
		}
		if (out.length) rows.push(out);
	}
	return rows;
}
/** 早柚核心 buttons -> segment.button(...rows)；扁平列表按每行 2 个切分 */
function buttonsFromGscore(raw) {
	let square = Array.isArray(raw) ? raw : [raw];
	if (!square.every((i) => Array.isArray(i))) {
		const chunked = [];
		for (let i = 0; i < square.length; i += 2) chunked.push(square.slice(i, i + 2));
		square = chunked;
	}
	const rows = [];
	for (const row of square) {
		const out = [];
		for (const i of Array.isArray(row) ? row : [row]) {
			if (!i || typeof i !== "object") continue;
			const key = {
				0: "link",
				1: "callback",
				2: "input"
			}[i.action] ?? "input";
			const btn = {
				text: i.text,
				[key]: i.data
			};
			if (i.pressed_text) btn.clicked_text = i.pressed_text;
			if (typeof i.style === "number") btn.style = i.style;
			if (i.unsupport_tips) btn.unsupport_tips = i.unsupport_tips;
			switch (i.permisson) {
				case 0:
					btn.permission = (i.specify_user_ids || []).map(String);
					break;
				case 1:
					btn.permission = "admin";
					break;
				case 3:
					btn.role_ids = (i.specify_role_ids || []).map(String);
					break;
				default: btn.permission = "all";
			}
			out.push(btn);
		}
		if (out.length) rows.push(out);
	}
	return rows.length ? segment.button(...rows) : null;
}

//#endregion
//#region src/modules/convert/toGscore.ts
/**
* 云崽 -> 早柚核心
*/
/** 云崽 message 数组 -> 早柚核心 Message[] */
async function msgToGscore(msg) {
	if (!Array.isArray(msg)) msg = [msg];
	const out = [];
	for (const i of msg) {
		if (i == null) continue;
		if (typeof i !== "object") {
			const s = String(i);
			if (s) out.push({
				type: "text",
				data: s
			});
			continue;
		}
		switch (i.type) {
			case "text":
				if (i.text) out.push({
					type: "text",
					data: String(i.text)
				});
				break;
			case "markdown":
				out.push({
					type: "markdown",
					data: typeof i.data === "string" ? i.data : toStr(i.data)
				});
				break;
			case "image": {
				const data = await toGscoreMedia(i.url ?? i.file, i.name);
				if (!data) break;
				out.push({
					type: "image",
					data
				});
				if (i.width && i.height) out.push({
					type: "image_size",
					data: [Number(i.width), Number(i.height)]
				});
				break;
			}
			case "record": {
				const data = await toGscoreMedia(i.url ?? i.file, i.name);
				if (data) out.push({
					type: "record",
					data
				});
				break;
			}
			case "video": {
				const data = await toGscoreMedia(i.url ?? i.file, i.name);
				if (data) out.push({
					type: "video",
					data
				});
				break;
			}
			case "file": {
				const data = await toGscoreFile(i.url ?? i.file ?? i.fid, i.name);
				if (data) out.push({
					type: "file",
					data
				});
				break;
			}
			case "at": {
				const at = String(i.qq ?? i.id ?? i.user_id);
				if (at === "all") break;
				out.push({
					type: "at",
					data: at
				});
				break;
			}
			case "reply":
				out.push({
					type: "reply",
					data: String(i.id ?? i.message_id)
				});
				break;
			case "button":
				out.push({
					type: "buttons",
					data: buttonsToGscore(i.data)
				});
				break;
			case "node": {
				const arr = [];
				for (const n of Array.isArray(i.data) ? i.data : []) for (const s of await msgToGscore(n?.message ?? n)) if (s.type !== "node") arr.push(s);
				out.push({
					type: "node",
					data: arr
				});
				break;
			}
			case "raw":
				if (i.data?.type) out.push(i.data);
				break;
			default: out.push({
				type: "text",
				data: toStr(i)
			});
		}
	}
	return out;
}
/**
* 完整 MessageReceive
* @param e     云崽消息事件
* @param botId 平台标识（resolveBotId 的结果）
* @param opts  { isMaster }
*/
async function yunzaiToGscore(e, botId, opts = {}) {
	const content = [];
	if (e.source?.message_id != null) content.push({
		type: "reply",
		data: String(e.source.message_id)
	});
	else if (e.reply_id != null && !e.message?.some?.((i) => i?.type === "reply")) content.push({
		type: "reply",
		data: String(e.reply_id)
	});
	content.push(...await msgToGscore(e.message || []));
	if (!content.length) return false;
	let user_pm = 6;
	if (opts.isMaster) user_pm = 1;
	else if (e.message_type === "group" || e.isGroup) {
		const role = e.sender?.role;
		if (role === "owner") user_pm = 2;
		else if (role === "admin") user_pm = 3;
	}
	const sender = {
		...e.sender,
		user_id: String(e.user_id)
	};
	sender.nickname ||= e.sender?.card || String(e.user_id);
	const avatar = e.avatar || e.sender?.avatar || e.member?.getAvatarUrl?.() || e.friend?.getAvatarUrl?.();
	if (avatar) sender.avatar = avatar;
	const data = {
		bot_id: botId,
		bot_self_id: String(e.self_id),
		msg_id: String(e.message_id ?? Date.now().toString(36)),
		user_id: String(e.user_id),
		user_pm,
		content,
		sender,
		group_id: null,
		user_type: "direct"
	};
	if (e.isGuild || e.message_type === "guild") {
		data.user_type = "channel";
		data.group_id = String(e.group_id ?? e.channel_id);
	} else if (e.message_type === "group" || e.isGroup) {
		data.user_type = "group";
		data.group_id = String(e.group_id);
	} else data.user_type = "direct";
	return data;
}

//#endregion
//#region src/modules/convert/toYunzai.ts
/**
* 早柚核心 -> 云崽
*/
/**
* MessageSend.content -> 云崽 message
* @param content 早柚核心消息段
* @param target  已 pick 出的 Group/Friend。仅 node 段用得上：
*                Miao 上制作转发必须靠 target 的原生实现（见 compat.makeForwardMsg）。
*                不传则 Miao 上的转发会降级为纯文本。
* @returns { message, quote, logOnly }
*
* 修复 ws-plugin 的 bug：上游 makeGSUidSendMsg 只检查 content[0] 是否为 log 段，
* 命中就丢弃整条消息的其余内容。这里逐段过滤，log 之后的正文照常发送。
*/
async function gscoreToYunzai(content, target) {
	const message = [];
	let quote = null;
	let sawLog = false;
	for (const i of Array.isArray(content) ? content : [content]) {
		if (!i?.type) continue;
		if (GS_LOG_RE.test(i.type)) {
			sawLog = true;
			const raw = i.type.slice(4).toLowerCase();
			const level = LOG_ALIAS[raw] || raw;
			makeLog(LOG_LEVELS.includes(level) ? level : "info", toStr(i.data), "GsCore");
			continue;
		}
		switch (i.type) {
			case "text":
				if (i.data !== "" && i.data != null) message.push(String(i.data));
				break;
			case "markdown":
				message.push(segment.markdown(i.data));
				break;
			case "image":
				message.push(segment.image(fromGscoreMedia(i.data)));
				break;
			case "image_size":
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
				const s = String(i.data ?? "");
				const idx = s.indexOf("|");
				const name = idx > -1 ? s.slice(0, idx) : void 0;
				const body = idx > -1 ? s.slice(idx + 1) : s;
				message.push(segment.file(fromGscoreMedia(body), name));
				break;
			}
			case "at":
				message.push(segment.at(Number(i.data) || String(i.data)));
				break;
			case "reply":
				quote = String(i.data);
				break;
			case "buttons": {
				const b = buttonsFromGscore(i.data);
				if (b) message.push(b);
				break;
			}
			case "node": {
				const nodes = [];
				for (const sub of Array.isArray(i.data) ? i.data : []) {
					const { message: m } = await gscoreToYunzai([sub], target);
					if (m.length) nodes.push({
						message: m,
						nickname: "早柚核心",
						user_id: Number(Bot.uin) || 0
					});
				}
				if (!nodes.length) break;
				const fwd = await makeForwardMsg(nodes, target);
				if (fwd) {
					message.push(fwd);
					break;
				}
				makeLog("warn", "转发消息制作失败，已降级为普通消息", "GsCore", true);
				for (const n of nodes) for (const seg of n.message) message.push(seg);
				break;
			}
			case "group": break;
			default: makeLog("warn", `暂不支持的消息段类型 ${i.type}，已跳过`, "GsCore", true);
		}
	}
	return {
		message,
		quote,
		logOnly: sawLog && message.length === 0
	};
}

//#endregion
//#region src/modules/notice/index.ts
/**
* 非消息事件（meta event）转换
*
* 核心 handler.py 的消费方式（已对源码核对）：
*   _extract_meta_segment: if seg.type and seg.type.startswith("meta-")
*   msg_process:           event.meta_event_type = _msg.type[len("meta-"):]
* data 为 dict 时整体存入 event.meta_event_data，且核心会用其中的
* user_id / group_id 回填顶层缺失字段，供权限与黑白名单使用——
* 所以必需字段缺失时宁可整包丢弃，不发残包。
*/
/**
* 云崽 notice 事件 -> meta event
* @returns 无法映射返回 null
*/
function noticeToMeta(e) {
	if (!e || e.post_type !== "notice") return null;
	if (e.sub_type === "poke") {
		const user_id = str(e.operator_id ?? e.user_id);
		if (!user_id) return null;
		const data = { user_id };
		data.target_id = str(e.target_id) || str(e.self_id);
		const group_id = str(e.group_id);
		if (group_id) data.group_id = group_id;
		return {
			eventName: "poke",
			data
		};
	}
	if (e.notice_type !== "group") return null;
	const eventName = SUB_TYPE_MAP[e.sub_type];
	if (!eventName) return null;
	const user_id = str(e.user_id);
	const group_id = str(e.group_id);
	if (!user_id || !group_id) return null;
	const data = {
		user_id,
		group_id
	};
	const operator_id = str(e.operator_id);
	if (operator_id) data.operator_id = operator_id;
	return {
		eventName,
		data
	};
}
/**
* meta event -> 完整 MessageReceive
* @param e     云崽 notice 事件
* @param meta  noticeToMeta 的产物
* @param botId 平台标识（resolveBotId 的结果）
* @param opts  { isMaster }
*/
function metaToGscore(e, meta, botId, opts = {}) {
	if (!meta) return null;
	const group_id = meta.data.group_id || str(e.group_id);
	return {
		bot_id: botId,
		bot_self_id: str(e.self_id),
		msg_id: "",
		user_type: group_id ? "group" : "direct",
		group_id: group_id || null,
		user_id: meta.data.user_id,
		user_pm: opts.isMaster ? 1 : 6,
		sender: {},
		content: [{
			type: `meta-${meta.eventName}`,
			data: meta.data
		}]
	};
}
/** 日志用的简短描述 */
function metaLogStr(meta) {
	return `${meta.eventName} ${toStr(meta.data)}`;
}

//#endregion
//#region src/modules/stats/counters.ts
const zero = () => ({
	up: 0,
	event: 0,
	down: 0
});
/** 把 b 累加进 a（原地） */
function add(a, b) {
	a.up += b.up;
	a.event += b.event;
	a.down += b.down;
}
/** 本地日期 YYYY-MM-DD，用于按天分行 */
function today() {
	const d = /* @__PURE__ */ new Date();
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

//#endregion
//#region src/modules/stats/db.ts
/**
* 中转计数的 sqlite 落盘层
*
* 为什么是 sqlite 而不是 redis
* ----------------------------
* 两者宿主都有（TRSS-Yunzai 依赖里 redis 4 与 sqlite3 都在）。选 sqlite 是因为
* 这份数据要的是**长期留存**：按天一行，累计值靠 SUM 出来，历史天数天然留着。
* redis 存计数得靠 TTL 自清，想留历史就要自己滚键名 + 扫键清理，
* 而且 redis 默认是缓存语义（宿主可能配了 maxmemory 淘汰策略），
* 一份「累计中转多少条」的账被淘汰掉是说不通的。
*
* 用的是宿主的 sqlite3（package.json 里 `"sqlite3": "npm:@karinjs/sqlite3"`），
* 不进插件自己的 dependencies——插件跑在宿主 node_modules 里，重复装一份没意义。
* 因此它按可选依赖对待：require 不到就退化成纯内存（见 cache.ts 的 ready 处理）。
*
* 为什么不用 sequelize
* -------------------
* 宿主也带 sequelize，genshin / meme-plugin 都用它。但那是为了 ORM 的模型层，
* 这里只有一张三列表、两条语句（UPSERT 和几个聚合 SELECT），
* 引 ORM 要付一个 sync()、一套模型定义和方言层的启动开销，换不到东西。
*
* 表结构
* ------
* relay(day, name, up, event, down)，主键 (day, name)。
*   day  本地日期 YYYY-MM-DD
*   name 连接名；空串表示「没有归属连接」（count 不带 name 时）
*
* 所有派生值都从这张表聚合：
*   今日 = WHERE day = 今天 的 SUM
*   累计 = 全表 SUM
*   某连接累计 = WHERE name = ? 的 SUM
* 不额外存汇总行，省掉「明细和汇总不一致」这类要对账的问题。
*/
/** 数据库文件位置：插件自己的 data/ 下，与 meme-plugin 的约定一致 */
const dbDir = path.join(PluginPath, "data");
const dbFile = process.env.GSCORE_STATS_DB || path.join(dbDir, "stats.db");
/** sqlite3 的 Database 实例，拿不到依赖时为 null */
let db = null;
/**
* 写操作串行队列
*
* save() 自带 BEGIN/COMMIT，而它有两个并发来源：定时回写与跨日翻页
* （翻页发生在 count() 里，同步函数没法 await，只能 fire-and-forget）。
* 同一条连接上两个事务嵌套，第二个 BEGIN 直接报
* "cannot start a transaction within a transaction"，随后的 close()
* 还会把没提交的那个一起回滚——两批计数一起丢。
*
* 所以所有写操作排成一条链。失败也要继续排下去，否则一次报错会把队列卡死。
*/
let chain = Promise.resolve();
function queue(fn) {
	const next = chain.then(fn, fn);
	chain = next.catch(() => {});
	return next;
}
/** run/all 的 Promise 包装。sqlite3 是 callback API，没有原生 Promise 接口 */
function run(sql, params = []) {
	return new Promise((resolve, reject) => {
		db.run(sql, params, (err) => err ? reject(err) : resolve());
	});
}
function all(sql, params = []) {
	return new Promise((resolve, reject) => {
		db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
	});
}
/**
* 打开数据库并建表
*
* @returns 打开成功与否。失败不抛——计数是展示用的辅助信息，
*          不该因为落盘不可用就拖垮插件加载
*/
async function open() {
	if (db) return true;
	let sqlite3;
	try {
		sqlite3 = (await import("sqlite3")).default;
	} catch (err) {
		makeLog("debug", `中转计数：sqlite3 不可用（${err?.message}），改用内存计数`, "GsCore");
		return false;
	}
	try {
		fs.mkdirSync(dbDir, { recursive: true });
		db = await new Promise((resolve, reject) => {
			const d = new sqlite3.Database(dbFile, (err) => err ? reject(err) : resolve(d));
		});
		await run("PRAGMA journal_mode = WAL");
		await run("PRAGMA synchronous = NORMAL");
		await run(`CREATE TABLE IF NOT EXISTS relay (
      day   TEXT    NOT NULL,
      name  TEXT    NOT NULL,
      up    INTEGER NOT NULL DEFAULT 0,
      event INTEGER NOT NULL DEFAULT 0,
      down  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, name)
    )`);
		await run("CREATE INDEX IF NOT EXISTS idx_relay_name ON relay (name)");
		await run(`CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
		return true;
	} catch (err) {
		makeLog("error", ["中转计数：打开数据库失败，改用内存计数", err], "GsCore");
		db = null;
		return false;
	}
}
/**
* 关闭数据库（进程退出时调，让 WAL 正常合并）
*
* 先等写队列排空：关在未提交的事务中间，那批计数会被回滚掉。
*/
async function close() {
	await chain.catch(() => {});
	const d = db;
	db = null;
	if (!d) return;
	await new Promise((resolve) => d.close(() => resolve()));
}
/** 读 meta，没有则写入 fallback 并返回它 */
function metaSince(fallback) {
	if (!db) return Promise.resolve(fallback);
	return queue(async () => {
		if (!db) return fallback;
		const rows = await all("SELECT value FROM meta WHERE key = 'since'");
		const got = Number(rows[0]?.value);
		if (got > 0) return got;
		await run("INSERT OR REPLACE INTO meta (key, value) VALUES ('since', ?)", [String(fallback)]);
		return fallback;
	});
}
/** 读全部明细，用于启动时灌入内存 */
function load() {
	if (!db) return Promise.resolve([]);
	return all("SELECT day, name, up, event, down FROM relay");
}
/**
* 回写若干 (day, name) 的**绝对值**
*
* 写绝对值而不是 `up = up + ?` 的增量：内存里存的就是权威值，
* 绝对值写入是幂等的——回写失败下个周期重试一次，结果一样；
* 增量写失败后重试会重复累加，而这个错误没法从结果上察觉。
*/
function save(rows) {
	if (!db || !rows.length) return Promise.resolve();
	const sql = `INSERT INTO relay (day, name, up, event, down) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (day, name) DO UPDATE SET
      up = excluded.up, event = excluded.event, down = excluded.down`;
	return queue(async () => {
		if (!db) return;
		await run("BEGIN");
		try {
			for (const r of rows) await run(sql, [
				r.day,
				r.name,
				r.up,
				r.event,
				r.down
			]);
			await run("COMMIT");
		} catch (err) {
			await run("ROLLBACK").catch(() => {});
			throw err;
		}
	});
}
/** 清空所有计数。同样入队，免得和正在进行的回写抢事务 */
function clear() {
	if (!db) return Promise.resolve();
	return queue(async () => {
		if (!db) return;
		await run("DELETE FROM relay");
		await run("DELETE FROM meta WHERE key = 'since'");
	});
}
/** 数据库是否可用 */
function available() {
	return !!db;
}

//#endregion
//#region src/modules/stats/index.ts
/**
* 中转计数
*
* 为什么要有
* ----------
* #早柚状态 原来只答「连上了没有」，而这个插件的本职是**中转消息**。
* 连接显示「已连接」但一条消息都没过去，是个很常见的故障（过滤器配错、
* bind/exclude 写反、only_reply_at 开着但群里没人 @），光看连接状态发现不了。
* 有了上行/下行计数，「连着但不通」一眼就能看出来。
*
* 为什么放模块级而不是挂在 GsCoreClient 上
* ----------------------------------------
* #早柚重载 会把 clients 整个重建（lifecycle.ts reloadClients），挂在实例上的
* 计数会跟着归零。累计值放模块级才能跨重载存活。按连接名分桶的那份也放这里，
* 同名连接重建后计数能接上——连接名就是它的身份（lifecycle 用它去重）。
*
* 落盘：内存是权威值，sqlite 是副本
* --------------------------------
* 原来不落盘，理由是「进程重启归零与运行时长的语义一致」。但那让「累计中转」
* 实际等于「本次运行中转」，两行数字（今日 / 累计）在刚启动时永远相等，
* 而它想回答的恰恰是「这个适配器到底转了多少东西」这种跨重启的问题。
*
* 关键约束是 count() 在**每条消息的热路径**上（GsCoreClient 三处），
* snapshot() / forName() 又在出图和文本回退里同步调用。所以不能把它们改成
* async——那样三个调用点连同整条渲染链路都要改成异步，还会把一次数据库往返
* 塞进消息转发的关键路径里。
*
* 因此分两层：
*   - 内存：唯一权威值，读写都是同步的，签名和以前一样
*   - sqlite：启动时灌进内存，之后按脏标记定时回写（见 db.ts）
*
* 代价是掉电可能丢最后几秒的计数。对一个展示用的数字，这个代价换来的是
* 热路径零开销，值得。
*/
/** 累计（跨重启，= 全部明细之和） */
const total = zero();
/** 今日 */
let daily = zero();
/** daily 属于哪一天 */
let dailyDay = today();
/** 按连接名分桶的累计值 */
const byName = /* @__PURE__ */ new Map();
/**
* 今日按连接名分桶的值，也就是要回写的那些行
*
* 只有「今天」的行会变——过去的天数已经定死了，灌进 total / byName 之后
* 不必留在内存里。key 是连接名，空串表示无归属。
*/
const todayRows = /* @__PURE__ */ new Map();
/** 有变化待回写的连接名 */
const dirty = /* @__PURE__ */ new Set();
/** 计数起点，用于「统计自 X 起」。落盘后是首次记账时刻，不是本次启动时刻 */
let since = Date.now();
/** 回写定时器 */
let timer = null;
/** 回写间隔：10 秒。热路径只改内存，攒一批再写 */
const FLUSH_MS = 1e4;
/**
* 跨日则把今日计数翻页
*
* 用惰性判断而不是定时器：没有消息经过时不需要翻页，读取时再判一次就够，
* 也省掉一个常驻 setInterval。
*
* 翻页时 todayRows 也要清空，且**先把待写的刷掉**——否则昨天的行会被
* 当成今天的 day 值写进去。
*/
function rollover() {
	const d = today();
	if (d === dailyDay) return;
	const pending = pendingRows();
	dailyDay = d;
	daily = zero();
	todayRows.clear();
	dirty.clear();
	if (pending.length) lastRollover = save(pending).catch((err) => makeLog("debug", ["中转计数回写失败", err], "GsCore"));
}
/** 最近一次跨日回写，供退出时等待 */
let lastRollover = Promise.resolve();
/** 取当前脏行的快照（带 day），供回写用 */
function pendingRows() {
	const rows = [];
	for (const name of dirty) {
		const c = todayRows.get(name);
		if (c) rows.push({
			day: dailyDay,
			name,
			...c
		});
	}
	return rows;
}
/** 记一次收发。同步，热路径 */
function count(kind, name) {
	rollover();
	total[kind]++;
	daily[kind]++;
	const key = name || "";
	const row = todayRows.get(key) || zero();
	row[kind]++;
	todayRows.set(key, row);
	dirty.add(key);
	if (name) {
		const c = byName.get(name) || zero();
		c[kind]++;
		byName.set(name, c);
	}
}
/** 读取快照。返回副本，调用方拿去排版不会改到内部状态 */
function snapshot() {
	rollover();
	return {
		total: { ...total },
		today: { ...daily },
		since,
		/** 计数是否在落盘（关掉时前端可以不显示「累计」的跨重启含义） */
		persisted: available()
	};
}
/** 某条连接的累计计数 */
function forName(name) {
	return { ...byName.get(name) || zero() };
}
/** 把脏行回写。失败只记 debug——计数丢一轮不值得打扰用户 */
async function flush() {
	if (!dirty.size) return;
	const rows = pendingRows();
	dirty.clear();
	try {
		await save(rows);
	} catch (err) {
		makeLog("debug", ["中转计数回写失败", err], "GsCore");
		for (const r of rows) dirty.add(r.name);
	}
}
/**
* 初始化：打开数据库、把历史灌进内存、起回写定时器
*
* 在 src/index.ts 里 await 掉。灌入必须在客户端连上之前完成，
* 否则先到的几条消息会被随后的 load 覆盖掉。
*/
async function initStats() {
	if (!await open()) return;
	try {
		const rows = await load();
		const d = today();
		for (const r of rows) {
			const c = {
				up: r.up,
				event: r.event,
				down: r.down
			};
			add(total, c);
			if (r.name) {
				const b = byName.get(r.name) || zero();
				add(b, c);
				byName.set(r.name, b);
			}
			if (r.day === d) {
				add(daily, c);
				todayRows.set(r.name, c);
			}
		}
		since = await metaSince(since);
		dailyDay = d;
		if (rows.length) makeLog("debug", `中转计数已载入：${rows.length} 行，累计上行 ${total.up + total.event}、下行 ${total.down}`, "GsCore");
	} catch (err) {
		makeLog("error", ["中转计数：载入历史失败", err], "GsCore");
	}
	timer = setInterval(flush, FLUSH_MS);
	timer.unref?.();
	process.once("beforeExit", () => {
		stopStats().catch(() => {});
	});
}
/** 清空计数（内存与数据库）。供 #早柚清空统计 用 */
async function resetStats() {
	for (const k of [
		"up",
		"event",
		"down"
	]) {
		total[k] = 0;
		daily[k] = 0;
	}
	byName.clear();
	todayRows.clear();
	dirty.clear();
	since = Date.now();
	dailyDay = today();
	await clear();
	await metaSince(since);
}
/** 停掉回写定时器并刷盘。测试用，也是退出钩子的实现 */
async function stopStats() {
	if (timer) clearInterval(timer);
	timer = null;
	await lastRollover;
	await flush();
	await close();
}

//#endregion
//#region src/modules/client/echo.ts
/**
* 回环防护
*
* 记录本插件刚代发出去的内容，防止被适配器回显后再次上报，
* 构成 核心 -> 云崽 -> 核心 死循环。
*/
const recentSent = /* @__PURE__ */ new Map();
function echoKey(self_id, target, message) {
	return `${self_id}:${target}:${message.map((i) => typeof i === "string" ? i : i?.type === "text" ? i.text : `[${i?.type}]`).join("").slice(0, 200)}`;
}
function markSent(key) {
	recentSent.set(key, Date.now() + ECHO_TTL);
	if (recentSent.size > 500) {
		const now = Date.now();
		for (const [k, exp] of recentSent) if (exp < now) recentSent.delete(k);
	}
}
function isEcho(key) {
	const exp = recentSent.get(key);
	if (!exp) return false;
	if (exp < Date.now()) {
		recentSent.delete(key);
		return false;
	}
	return true;
}

//#endregion
//#region src/modules/client/GsCoreClient.ts
var GsCoreClient = class {
	conf;
	name;
	/** 0 未连接/已停止 1 已连接 2 连接中 3 断线待重连 */
	status;
	retry;
	stop;
	ws;
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
		this.timer = void 0;
		this.hbTimer = void 0;
		this.aliveTimer = void 0;
		this.lastPong = 0;
	}
	/** 可读状态，供 apps 显示 */
	get statusText() {
		return (STATUS_TEXT[this.status] || String(this.status)) + (this.retry ? `(重连${this.retry}次)` : "");
	}
	/** 早柚核心用 ?token= 查询参数鉴权，不使用请求头 */
	get url() {
		const url = String(this.conf.url || "");
		if (!this.conf.token) return url;
		try {
			const u = new URL(url);
			if (!u.searchParams.has("token")) u.searchParams.set("token", this.conf.token);
			return u.toString();
		} catch {
			if (/[?&]token=/.test(url)) return url;
			return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(this.conf.token)}`;
		}
	}
	log(level, msg) {
		makeLog(level, msg, `GsCore:${this.name}`, true);
	}
	connect() {
		if (this.stop) return;
		if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
		this.status = 2;
		try {
			this.ws = new WebSocket(this.url, {
				maxPayload: 67108864,
				handshakeTimeout: 6e4
			});
		} catch (err) {
			this.log("error", ["创建连接失败，请检查地址", err]);
			return this.scheduleReconnect(-1);
		}
		this.ws.on("open", () => this.onOpen());
		this.ws.on("message", (data) => this.onMessage(data));
		this.ws.on("close", (code, reason) => this.onClose(code, reason));
		this.ws.on("error", (err) => this.log("error", ["连接错误", err?.message || err]));
		this.ws.on("pong", () => this.lastPong = Date.now());
	}
	onOpen() {
		const wasReconnect = this.status === 2 && this.retry > 0;
		this.status = 1;
		this.retry = 0;
		this.lastPong = Date.now();
		setLocalHint(this.ws?._socket?.localAddress);
		this.log("mark", wasReconnect ? "重连成功" : "已连接");
		this.startHeartbeat();
		if (wasReconnect && config.notify_master) this.notify(`${this.name} 重连成功`);
	}
	notify(msg) {
		try {
			const ret = Bot.sendMasterMsg?.(`[早柚核心] ${msg}`);
			if (ret?.catch) ret.catch(() => {});
		} catch {}
	}
	startHeartbeat() {
		this.stopHeartbeat();
		const iv = Number(config.client?.heartbeat) || 0;
		if (iv > 0) this.hbTimer = setInterval(() => {
			if (this.ws?.readyState === WebSocket.OPEN) try {
				this.ws.ping();
			} catch {}
		}, iv * 1e3);
		const to = Number(config.client?.heartbeat_timeout) || 0;
		if (iv > 0 && to > 0) this.aliveTimer = setInterval(() => {
			if (this.status === 1 && Date.now() - this.lastPong > to * 1e3) {
				this.log("warn", `心跳超时 ${to}s，主动断开重连`);
				try {
					this.ws.terminate();
				} catch {}
			}
		}, Math.max(5, to / 3) * 1e3);
	}
	stopHeartbeat() {
		clearInterval(this.hbTimer);
		clearInterval(this.aliveTimer);
		this.hbTimer = void 0;
		this.aliveTimer = void 0;
	}
	onClose(code, reason) {
		this.stopHeartbeat();
		const wasOnline = this.status === 1;
		this.status = 3;
		if (this.stop) {
			this.status = 0;
			return;
		}
		this.log("warn", `连接已关闭 code=${code}${reason?.length ? ` reason=${reason}` : ""}`);
		if (wasOnline && config.notify_master) this.notify(`${this.name} 已断开`);
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
		if (code === 1005) this.log("warn", "对端未提供关闭码(1005)，通常是核心重启，继续重连");
		this.retry++;
		const base = Number(this.conf.reconnect_interval) || 5;
		const wait = Math.min(base * 2 ** (this.retry - 1), base * 12) * 1e3;
		this.log("info", `${wait / 1e3}s 后进行第 ${this.retry} 次重连`);
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.connect(), wait);
	}
	close() {
		this.stop = true;
		this.stopHeartbeat();
		clearTimeout(this.timer);
		try {
			this.ws?.close(1e3);
		} catch {}
		this.status = 0;
	}
	restart() {
		this.stop = false;
		this.retry = 0;
		clearTimeout(this.timer);
		this.stopHeartbeat();
		try {
			this.ws?.terminate();
		} catch {}
		this.ws = null;
		this.connect();
	}
	/** 本连接是否接管该 self_id */
	accept(self_id) {
		const id = String(self_id);
		const exclude = this.conf.exclude || [];
		if (exclude.length && exclude.some((i) => String(i) === id)) return false;
		const bind = this.conf.bind || [];
		if (bind.length && !bind.some((i) => String(i) === id)) return false;
		return true;
	}
	async sendReceive(e, isMaster) {
		if (this.status !== 1 || this.ws?.readyState !== WebSocket.OPEN) return false;
		const botId = resolveBotId(e, this.conf);
		const data = await yunzaiToGscore(e, botId, { isMaster });
		if (!data) return false;
		if (!this.send(data)) return false;
		count("up", this.name);
		makeLog("debug", `上报早柚核心：${logStr(data.content)}`, `${e.self_id} => ${this.name}`, true);
		return true;
	}
	/**
	* 上行：非消息事件（入群/退群/戳一戳）
	* 单向通知，核心不回执，发出即完成。
	*/
	sendMeta(e, meta, isMaster) {
		if (this.status !== 1 || this.ws?.readyState !== WebSocket.OPEN) return false;
		const data = metaToGscore(e, meta, resolveBotId(e, this.conf), { isMaster });
		if (!data) return false;
		if (!this.send(data)) return false;
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
		if (this.ws?.readyState !== WebSocket.OPEN) return false;
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
		if (!data.echo) return;
		this.send({
			bot_id: data.bot_id,
			bot_self_id: data.bot_self_id,
			msg_id: "",
			user_type: data.target_type || "group",
			group_id: data.target_type === "group" ? data.target_id : null,
			user_id: data.target_type === "direct" ? String(data.target_id ?? "") : "",
			sender: {},
			user_pm: 6,
			content: [{
				type: "recall_message_id",
				data: {
					echo: data.echo,
					id
				}
			}]
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
		if (list.length !== 1) return false;
		const seg = list[0];
		const d = seg?.data || {};
		if (seg?.type === "excute_delete_message") {
			const id = d.message_id;
			try {
				const target = data.target_type === "direct" ? bot.pickFriend?.(Number(data.target_id) || data.target_id) : bot.pickGroup?.(Number(data.target_id) || data.target_id);
				const fn = target?.recallMsg || bot.recallMsg;
				if (!fn) return this.log("warn", "当前适配器不支持撤回消息"), true;
				await fn.call(target?.recallMsg ? target : bot, id);
				this.log("info", `已撤回消息 ${id}`);
			} catch (err) {
				this.log("error", ["撤回消息失败", err]);
			}
			return true;
		}
		if (seg?.type === "excute_ban_user") {
			const duration = Number(d.duration) || 0;
			try {
				const group = bot.pickGroup?.(Number(d.group_id) || d.group_id);
				if (!group?.muteMember) return this.log("warn", "当前适配器不支持禁言"), true;
				await group.muteMember(Number(d.user_id) || d.user_id, duration);
				this.log("info", `${duration ? `禁言 ${duration}s` : "解除禁言"}：${d.user_id}@${d.group_id}`);
			} catch (err) {
				this.log("error", ["禁言操作失败", err]);
			}
			return true;
		}
		return false;
	}
	async onMessage(raw) {
		let data;
		try {
			data = JSON.parse(raw.toString());
		} catch (err) {
			return this.log("error", [
				"解码数据失败",
				String(raw).slice(0, 300),
				err
			]);
		}
		const bot = Bot.bots[data.bot_self_id] || Bot;
		try {
			if (await this.handleControl(data, bot)) return;
		} catch (err) {
			return this.log("error", ["处理控制指令错误", err]);
		}
		let recallId = null;
		try {
			const segs = Array.isArray(data.content) ? data.content : [data.content];
			if (segs.length && segs.every((i) => i?.type && GS_LOG_RE.test(i.type))) {
				await gscoreToYunzai(data.content);
				return;
			}
			const targetId = String(data.target_id ?? "");
			let target;
			let tag;
			if (data.target_type === "direct") {
				target = bot.pickFriend(Number(targetId) || targetId);
				tag = `好友 ${targetId}`;
			} else {
				let g = bot.pickGroup(Number(targetId) || targetId);
				if (!g?.sendMsg && targetId.includes("-")) {
					const last = targetId.split("-").at(-1);
					g = bot.pickGroup(Number(last) || last);
				}
				target = g;
				tag = `群 ${targetId}`;
			}
			if (!target?.sendMsg) return this.log("error", `找不到发送目标 ${data.target_type}:${targetId}`);
			const { message, quote, logOnly } = await gscoreToYunzai(data.content, target);
			if (logOnly || !message.length) return;
			if (quote) message.unshift(segment.reply(quote));
			markSent(echoKey(data.bot_self_id, targetId, message));
			makeLog("info", `早柚核心消息：${logStr(message)}`, `${this.name} => ${data.bot_self_id}, ${tag}`, true);
			const ret = await target.sendMsg(message);
			count("down", this.name);
			recallId = ret?.message_id ?? ret?.msg_id ?? ret?.id ?? null;
		} catch (err) {
			this.log("error", ["处理下行消息错误", err]);
		} finally {
			this.sendRecallReceipt(data, recallId);
		}
	}
};

//#endregion
//#region src/modules/client/state.ts
const clients = [];

//#endregion
//#region src/modules/client/framework.ts
/**
* 框架配置读取 / 主人判定
*
* 路径由 YunzaiPath 拼出绝对地址后动态 import，不再用
* ../../../lib/config/config.js 这类相对路径 —— 那种写法依赖编译产物与
* 源码同层深度，一改目录层级或 outDir 就断（旧实现即如此）。
*
* 两个框架的主人配置**结构不同**，均已读源码实测：
*
*   TRSS  lib/config/config.js:75  get master()   -> { bot_id: [user_id] }  分账号
*         lib/config/config.js:64  get masterQQ() -> [qq]                   扁平
*   Miao  lib/config/config.js:76  get masterQQ() -> [qq]                   扁平
*         **没有 master getter**
*
* 比较方式也不同：
*   TRSS  lib/plugins/loader.js:406  cfg.master[e.self_id]?.includes(String(e.user_id))
*   Miao  lib/plugins/loader.js:451  cfg.masterQQ.includes(Number(e.user_id) || String(e.user_id))
*
* 所以照抄任何一边的写法都会在另一边静默失效（isMaster 恒为 false，
* 主人命令在早柚核心侧不可用，且不报错）。这里按**字段形状**探测，不按框架名分支。
*
* 仍保留 try/catch：换 fork 或框架挪走 lib/config/ 时降级而不是崩。
*/
let cfg = {};
/** 框架配置是否读取成功 —— 供启动自检报告降级 */
let cfgLoaded = false;
try {
	cfg = (await import(pathToFileURL(join(YunzaiPath, "lib/config/config.js")).href)).default;
	cfgLoaded = true;
} catch (err) {
	makeLog("error", ["读取框架配置失败，主人识别将失效（早柚核心侧主人命令不可用）", err], "GsCore");
}
/**
* 判断某用户是否为主人。
*
* 优先用框架自己算好的 e.isMaster —— 但**只读不写**：
* TRSS loader.js:404 用 defineProperty 挂了 getter，setter 会拦截并打告警加调用栈；
* Miao loader.js:452 则是普通赋值 `e.isMaster = true`，无保护。
* 两边语义相反，所以一律不写，只在框架已算过时读取。
*
* 本插件的监听器可能早于框架的 dealEvent 执行，此时 e.isMaster 尚未挂上，
* 故需自行按配置判定，兼容两种结构。
*
* @param self_id  机器人账号（TRSS 分账号映射要用）
* @param user_id  待判定的用户
* @param e        原始事件，可选；有则优先采信框架结论
*/
function isMasterUser(self_id, user_id, e) {
	if (user_id == null) return false;
	if (e && typeof e.isMaster === "boolean") return e.isMaster;
	const uid = String(user_id);
	const m = cfg.master;
	if (m && !Array.isArray(m) && typeof m === "object") {
		if (m[self_id]?.map(String).includes(uid)) return true;
	}
	const flat = cfg.masterQQ;
	if (Array.isArray(flat) && flat.map(String).includes(uid)) return true;
	return false;
}

//#endregion
//#region src/modules/client/hooks.ts
/**
* 消息与事件钩子
*
* 回环防护共三层，详见 README「回环防护」一节。
*/
function shouldForward(e) {
	if (e.post_type !== "message") return false;
	if (!e.user_id || !e.self_id) return false;
	if (String(e.user_id) === String(e.self_id)) return false;
	if (e.message_sent || e.sub_type === "self") return false;
	if (isFromGsCore(e)) return false;
	if (isEcho(echoKey(e.self_id, e.group_id ?? e.user_id, e.message || []))) return false;
	if (!passFilter(e)) return false;
	const f = config.filter || {};
	const text = eventText(e);
	if (f.block_prefix?.length && f.block_prefix.some((i) => text.startsWith(i))) return false;
	if (f.block_include?.length && f.block_include.some((i) => text.includes(i))) return false;
	if (f.only_reply_at && (e.message_type === "group" || e.isGroup)) {
		const atBot = (e.message || []).some((i) => i?.type === "at" && String(i.qq) === String(e.self_id));
		const hasPrefix = (f.prefix || []).some((i) => text.startsWith(i));
		if (!atBot && !hasPrefix) return false;
	}
	return true;
}
async function onYunzaiMessage(e) {
	try {
		if (!clients.length) return;
		if (!shouldForward(e)) return;
		const isMaster = isMasterUser(e.self_id, e.user_id, e);
		for (const c of clients) {
			if (c.status !== 1) continue;
			if (!c.accept(e.self_id)) continue;
			await c.sendReceive(e, isMaster);
		}
	} catch (err) {
		makeLog("error", ["上报早柚核心错误", err], "GsCore");
	}
}
/**
* notice 专用守卫。
* 不复用 shouldForward：其中的回显检测、文本前缀、only_reply_at
* 都建立在 e.message 上，notice 没有 message 数组。
*/
function shouldForwardNotice(e) {
	if (e.post_type !== "notice") return false;
	if (!e.self_id) return false;
	if (isFromGsCore(e)) return false;
	return passFilter(e);
}
async function onYunzaiNotice(e) {
	try {
		if (!clients.length) return;
		if (!shouldForwardNotice(e)) return;
		const meta = noticeToMeta(e);
		if (!meta) return makeLog("debug", `未映射的事件：${e.notice_type}.${e.sub_type}`, "GsCore", true);
		const isMaster = isMasterUser(e.self_id, meta.data.user_id);
		for (const c of clients) {
			if (c.status !== 1) continue;
			if (!c.accept(e.self_id)) continue;
			try {
				c.sendMeta(e, meta, isMaster);
			} catch (err) {
				makeLog("error", ["上报事件错误", err], `GsCore:${c.name}`);
			}
		}
	} catch (err) {
		makeLog("error", ["上报早柚核心事件错误", err], "GsCore");
	}
}

//#endregion
//#region src/modules/client/lifecycle.ts
/**
* 客户端生命周期
*/
let hooked = false;
/** 注册事件钩子（只注册一次） */
function hook() {
	if (hooked) return;
	Bot.on("message", onYunzaiMessage);
	Bot.on("notice", onYunzaiNotice);
	hooked = true;
}
/** 启动单个连接（已存在同名则跳过） */
function startClient(conf) {
	if (conf.enable === false) return null;
	if (!conf.url) {
		makeLog("error", `连接 ${conf.name || "(未命名)"} 缺少 url，已跳过`, "GsCore");
		return null;
	}
	if (clients.some((c) => c.name === (conf.name || conf.url))) return null;
	hook();
	const c = new GsCoreClient(conf);
	clients.push(c);
	c.connect();
	return c;
}
/** 停止并移除单个连接 */
function stopClient(name) {
	const idx = clients.findIndex((c) => c.name === name);
	if (idx === -1) return false;
	clients[idx].close();
	clients.splice(idx, 1);
	return true;
}
function startClients() {
	hook();
	for (const conf of config.client?.connections || []) startClient(conf);
	if (clients.length) makeLog("mark", `早柚核心客户端启动 ${clients.length} 个连接`, "GsCore");
	else makeLog("warn", "早柚核心客户端没有可用连接", "GsCore");
}

//#endregion
//#region src/modules/render/components/Icons.tsx
/**
* 图标集
*
* 直接用 lucide-react 组件。它在 dependencies 里，但 tsdown 打包时会把用到的
* 那十几个图标内联进产物 —— 详见 tsdown.config.ts 顶部关于 external 的说明。
*
* 为什么不用字符标记
* -----------------
* 原先用 ◉ ≡ ↻ ⚙ ☰ 这类字符当图标，看着总是没垂直居中。原因不在 CSS：
* flex/grid 居中的是「行盒」，字形墨迹在行盒里的位置由字体基线决定。这些几何
* 符号在 Latin 字体里普遍缺字，Chromium 回落到中文字体后，墨迹在 em 方框中
* 整体偏下，于是无论怎么居中都偏。字符还有一层不确定性——换台机器、少装一个
* 字体，字形宽窄和位置就变了，截图不可复现。
*
* SVG 没有这些问题：viewBox 定死几何，路径在 24×24 里就是画正的，
* 容器只要把 <svg> 居中即可，结果与字体无关。
*
* 这层薄封装的意义
* ---------------
* commands.ts 按 IconName 这种语义名引用（"status" / "changelog"），而不是直接
* 写 lucide 的组件名。换图标只动下面这张表，二十多处调用点不用碰。
*/
/**
* 语义名 -> lucide 组件
*
* plus/minus/play/stop 用的是 Circle* 变体而不是裸的加减号：帮助页里这四个图标
* 各自待在一个 48/60px 的圆角色块中央，裸符号（一横一竖）在那么大的底上显得空，
* 有外轮廓的变体视觉重量才与同排的 Activity / Settings / ScrollText 配得上。
*/
const ICONS = {
	status: Activity,
	list: List,
	refresh: RefreshCw,
	plus: CirclePlus,
	minus: CircleMinus,
	play: CirclePlay,
	stop: CircleStop,
	settings: Settings,
	arrowUp: ArrowUp,
	arrowUpDouble: ChevronsUp,
	changelog: ScrollText,
	search: Search,
	info: Info,
	dot: CircleDot
};
/**
* 一个图标
*
* 尺寸交给外层 CSS（Help.tsx 用 [&>svg]:size-[30px] 这类），所以要显式压掉
* lucide 默认写在 <svg> 上的 width/height —— 传 undefined 即可让 React 不输出
* 这两个属性（注意光传 size={undefined} 没用，lucide 会回落到默认值 24，
* 照样渲染出 width="24" height="24"）。viewBox 保留，几何不受影响。
*
* lucide 还会无条件挂上 `class="lucide lucide-circle-dot"`，传 className 也覆盖
* 不掉（它是合并而非替换）。这两个类不参与样式，但 classes.test.mjs 会把「HTML
* 里有、CSS 里无」的类名报成漏写，所以在 base.ts 的 reset 层给了一条空规则认领
* 它们 —— 那边有对应注释。
*/
function Icon({ name }) {
	const C = ICONS[name];
	return /* @__PURE__ */ jsx(C, {
		width: void 0,
		height: void 0,
		"aria-hidden": "true"
	});
}

//#endregion
//#region src/modules/render/assets.ts
/**
* 图片资源 -> data URI
*
* 为什么不直接写 <img src="file:///.../logo.png">：
* 本体把渲染用的 HTML 写到 temp/html/{name}/ 下再让 puppeteer 打开
* （lib/renderer/Renderer.js），相对路径的基准是那个临时目录而不是插件目录，
* 绝对 file:// 路径又要处理 Windows 盘符与中文路径的转义。内联成 data URI
* 之后页面完全自包含，和 styles/ 内联 CSS 是同一个理由。
*
* MIME 按魔数嗅探而不是按扩展名：resources/template/image/frame-logo.png 实际是 JPEG
* （开头 ff d8），扩展名是错的。写死 image/png 的话 Chromium 仍能靠嗅探显示出来，
* 但 data URI 的声明与内容不一致，属于埋着的坑，这里一次性判对。
*/
/** 按魔数判 MIME，认不出返回空串 */
function sniff(buf) {
	if (buf.length >= 3 && buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return "image/jpeg";
	if (buf.length >= 8 && buf.readUInt32BE(0) === 2303741511) return "image/png";
	if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF") return "image/webp";
	if (buf.length >= 6 && buf.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
	return "";
}
/** 已读过的资源。图片在进程生命周期里不会变，读一次就够 */
const cache = /* @__PURE__ */ new Map();
/**
* 读 resources/template/image/<name> 并转成 data URI
* @returns data URI；文件不存在或格式认不出返回空串（调用方据此不渲染 <img>）
*/
function imageDataUri(name) {
	const hit = cache.get(name);
	if (hit !== void 0) return hit;
	let uri = "";
	try {
		const buf = fs.readFileSync(join(ResPath, "template", "image", name));
		const mime = sniff(buf);
		if (mime) uri = `data:${mime};base64,${buf.toString("base64")}`;
		else makeLog("warn", `资源 ${name} 不是可识别的图片格式，已跳过`, "GsCore");
	} catch {}
	cache.set(name, uri);
	return uri;
}
/** 插件图标（早柚），用于 #早柚版本 的主视觉 */
const PLUGIN_LOGO = "logo.png";
/** 框架图标，用于页脚角标 */
const FRAME_LOGO = "frame-logo.png";

//#endregion
//#region src/modules/render/version.ts
/**
* 插件版本号与构建标识
*
* 为什么不能只看 package.json
* ---------------------------
* 三个分支的 package.json 全是同一个版本号（release-please 只在发版时改它），
* 所以 `2.1.0` 既可能是 release 上的正式版，也可能是 main 上多跑了十几个提交的
* 开发版。只凭这个字符串区分不了，正式版角标会挂在开发版上。
*
* 判据：分支名 + git describe
* ---------------------------
* - main    源码分支，带 tag，开发主干
* - preview 每次提交自动编译产出，历史与 tag 断开
* - release 每个发布一个提交，历史与 tag 断开
*
* 注意 preview / release 是编译产物分支，它们的历史与 main 不连通，
* `git describe` 在那里直接报 "No tags can describe"（实测），所以
* describe 只有 main 能用，另外两条必须靠分支名判定。
*
* 运行时读 package.json 而不是 import 它：tsconfig 开了 resolveJsonModule，
* import 能过编译，但 rootDir 是 src/，JSON 不会被复制到 lib/，
* 产物里那个 require 会指向不存在的路径。
*/
function read() {
	try {
		return JSON.parse(fs.readFileSync(join(PluginPath, "package.json"), "utf8")).version || "0.0.0";
	} catch {
		return "0.0.0";
	}
}
/**
* 同步跑一条 git 子命令，失败返回空串
*
* 这里必须同步：下面几个常量是模块加载时求值的，页脚、状态图到处在读，
* 改成异步就得把调用方全改成 await。git 本地查询是毫秒级，且只在加载时跑一次。
*
* 压缩包安装（没有 .git）、机器上没装 git、目录不是仓库——都会落到 catch，
* 返回空串由调用方降级，不能让它把插件加载搞崩。
*/
function git$1(args) {
	try {
		return String(execFileSync("git", args, {
			cwd: PluginPath,
			timeout: 3e3,
			windowsHide: true,
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			],
			encoding: "utf8"
		})).trim();
	} catch {
		return "";
	}
}
/** 安装所在的分支名；压缩包安装或游离 HEAD 时为空串 */
const branch = git$1(["branch", "--show-current"]);
/**
* git describe 结果，如 v2.1.0 或 v2.1.0-2-gc6522ee
*
* --tags 允许用轻量 tag；--always 兜底成裸 hash，省得整个串变空。
* 只有 main 能算出带 tag 的结果，preview / release 会退化成 hash。
*/
const describe = git$1([
	"describe",
	"--tags",
	"--always",
	"--dirty"
]);
/** 本地 HEAD 短 hash */
const commit = git$1([
	"rev-parse",
	"--short",
	"HEAD"
]);
const version$1 = read();
/**
* 展示用版本串，git describe 风格
*
* main 上 describe 带得出 tag，直接用它——`v2.1.0-2-gc6522ee` 这种一眼能看出
* 「比 2.1.0 多两个提交」。preview / release 因为历史断开，describe 只剩 hash，
* 拼成 `v2.1.0+40f2dd4`：加号是 semver 的构建元数据分隔符，语义上正好——
* 同一个版本的不同构建。
*
* 没有 git 信息时退回裸版本号。
*/
function versionLabel() {
	if (!describe) return `v${version$1}`;
	if (/^v?\d+\.\d+\.\d+/.test(describe)) return describe.startsWith("v") ? describe : `v${describe}`;
	return `v${version$1}+${describe}`;
}

//#endregion
//#region src/modules/render/env.ts
/**
* 运行环境探测
*
* 供页脚角标与 #早柚版本 共用：跑在哪个框架上、框架什么版本、Node 什么版本。
*
* 框架判定沿用 karin-plugin-kkk 的做法（module/utils/Version.js 的 getBotName）：
* 看 `Bot.uin` 是不是数组。TRSS 支持多账号，把 uin 存成数组；Miao 的
* `class Yunzai extends Client` 继承 ICQQ，uin 是单个数字。
*
* 为什么不看目录名或 package.json 的 name：
* 目录名完全不可靠——本仓库所在的框架目录就叫 Miao-Yunzai、实际却是 TRSS，
* 这正是 utils/compat.ts 开头记的那个反例。package.json 的 name 稍好，
* 但 fork 改名即失效，而 uin 的形状是两个框架的架构差异，改名改不掉。
*
* 注意这里只用于**显示**。功能上该走哪条兼容路径，仍由 utils/compat.ts
* 逐个方法探测决定——那才是不会被 fork 骗到的判据。
*/
/** 跑在哪个框架上 */
function frameName() {
	try {
		const bot = globalThis.Bot;
		if (Array.isArray(bot?.uin)) return "TRSS-Yunzai";
	} catch {}
	return "Miao-Yunzai";
}
/** 框架版本，读框架根目录的 package.json；读不到返回空串 */
function frameVersion() {
	try {
		const pkg = JSON.parse(fs.readFileSync(join(YunzaiPath, "package.json"), "utf8"));
		return String(pkg.version || "");
	} catch {
		return "";
	}
}
/** Node 版本，去掉前缀 v */
function nodeVersion() {
	return process.versions.node;
}
/** 框架名 + 版本，拼成角标那一行；没版本号时只给名字 */
function frameLabel() {
	const v = frameVersion();
	return v ? `${frameName()} v${v}` : frameName();
}
const RELEASE_BRANCH = {
	release: "Stable",
	preview: "Preview",
	main: "Dev",
	master: "Dev"
};
function releaseType(_version) {
	return RELEASE_BRANCH[branch] || "Preview";
}
/** 角标上那两个字 */
function releaseLabel(t = releaseType()) {
	return t === "Stable" ? "正式版" : t === "Dev" ? "开发版" : "预览版";
}
/** 字节数转可读单位，保留一位小数 */
function formatBytes(n) {
	if (!Number.isFinite(n) || n <= 0) return "0 B";
	const u = [
		"B",
		"KB",
		"MB",
		"GB",
		"TB"
	];
	const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
	return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
/** 秒数转 3天4小时 这样的时长 */
function formatDuration(sec) {
	const s = Math.max(0, Math.floor(sec));
	const d = Math.floor(s / 86400);
	const h = Math.floor(s % 86400 / 3600);
	const m = Math.floor(s % 3600 / 60);
	if (d) return `${d} 天 ${h} 小时`;
	if (h) return `${h} 小时 ${m} 分`;
	if (m) return `${m} 分 ${s % 60} 秒`;
	return `${s} 秒`;
}
/**
* 采集本机运行信息
*
* 隐私边界照 kkk 的 collectRuntimeReport：这张图会发到群里，所以只取
* 「机器性能」类信息，不取任何能定位到这台机器或这个人的东西——
* 不读 hostname、不读 os.userInfo()（家目录、用户名）、不读网卡地址、
* 不读环境变量内容、不读启动参数，也不读任何连接的 token。
* 加字段前先想一遍：这条信息发到群里会不会暴露机主。
*/
function sysInfo() {
	const cpus = os.cpus() || [];
	const total = os.totalmem();
	const used = Math.max(0, total - os.freemem());
	return {
		os: `${os.type()} ${os.release()}`,
		platform: os.platform(),
		arch: os.arch(),
		cpuModel: cpus[0]?.model?.trim() || "未知处理器",
		cpuCores: cpus.length,
		totalMemory: formatBytes(total),
		usedMemory: formatBytes(used),
		memoryPercent: total > 0 ? Number((used / total * 100).toFixed(1)) : 0,
		processRss: formatBytes(process.memoryUsage().rss),
		systemUptime: formatDuration(os.uptime()),
		processUptime: formatDuration(process.uptime())
	};
}

//#endregion
//#region src/modules/render/metrics.ts
/**
* 文本宽度估算
*
* 为什么需要它
* ------------
* 画布是固定的 1440px（theme.ts CANVAS_WIDTH），版本号却是运行时才知道的：
* release 分支上是 `v2.1.0`，main 上 git describe 会给出
* `v2.1.0-2-gc6522ee-dirty` —— 23 个字符，是前者的近四倍。写死字号的结果就是
* 短版本号留一大片空白、长版本号直接换行（实测 130px 下折成两行，页脚同理）。
*
* 浏览器里这类问题通常交给 JS 量完再调，但这里量不了：组件是 renderToStaticMarkup
* 出的静态 HTML，页面里没有脚本，puppeteer 也只截图不执行我们的逻辑。所以宽度
* 必须在 SSR 阶段估出来，字号写进 style 属性。
*
* 精度要求
* --------
* 只用来决定"要不要缩、缩多少"，不需要像素级准确：估宽了字号偏小（浪费一点空白），
* 估窄了才会换行。所以宁可高估——SAFETY 就是这个用途。
*/
/**
* 各类字符相对字号的宽度系数（em）
*
* 按 900 字重的无衬线中文字体栈实测量级取值，比常规字重宽约 5%。
* 分档而不是逐字查表：字形表要跟着字体栈变，而这里只需要量级正确。
*/
const EM = {
	/** 数字与大写字母，等宽数字下就是这个值 */
	wide: .6,
	/** 小写字母 */
	lower: .55,
	/** 全角：中日韩、全角标点 */
	cjk: 1,
	/** 窄字符：. , : ; ! | ' ` i l I j f t r ( ) [ ] - + 空格 */
	narrow: .3
};
/** 单个字符占多少 em */
function charEm(ch) {
	const c = ch.codePointAt(0) || 0;
	if (c >= 11904 && c <= 42191 || c >= 44032 && c <= 55203 || c >= 63744 && c <= 64255 || c >= 65072 && c <= 65103 || c >= 65280 && c <= 65376 || c >= 65504 && c <= 65510) return EM.cjk;
	if (c >= 8192 && c <= 11263) return EM.cjk;
	if (/[.,:;!|'`ilIjftr()[\]\-+ ]/.test(ch)) return EM.narrow;
	if (/[a-z]/.test(ch)) return EM.lower;
	return EM.wide;
}
/**
* 估算一段文字的宽度
*
* @param text     文本
* @param fontSize 字号（px）
* @param tracking 字距（em），CSS 的 letter-spacing。负值会让整体变窄
*/
function textWidth(text, fontSize, tracking = 0) {
	let em = 0;
	for (const ch of text) em += charEm(ch) + tracking;
	return em * fontSize;
}
/**
* 高估余量
*
* 字体栈里各字体宽度不同（HarmonyOS Sans SC 比 Microsoft YaHei 略窄），
* 上面的分档也只是量级正确。留 8% 余量，让估算偏保守——宁可字号小一点，
* 也不要换行，因为换行是用户看得见的毛病，小一号不是。
*/
const SAFETY = 1.08;
/**
* 求「让文本刚好放进 budget 宽度」的字号
*
* @param text     要放的文本
* @param budget   可用宽度（px）
* @param max      理想字号，放得下就用它
* @param min      最小字号，再放不下也不缩了（宁可轻微溢出也要保持可读）
* @param tracking 字距（em）
*
* @returns 取整后的字号
*/
function fitFontSize(text, budget, max, min, tracking = 0) {
	const need = textWidth(text, max, tracking) * SAFETY;
	if (need <= budget) return max;
	const scaled = max * budget / need;
	return Math.max(min, Math.floor(scaled));
}

//#endregion
//#region src/modules/render/components/Layout.tsx
/** 背景装饰层：光斑、噪点、气氛大字、角落点缀 */
function Backdrop({ word, ghostTop }) {
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsxs("div", {
			className: "pointer-events-none absolute inset-0 z-0 overflow-hidden",
			children: [
				/* @__PURE__ */ jsx("div", { className: "absolute top-[-270px] left-[-180px] h-[1440px] w-[1260px] rounded-[9999px] blur-[128px] [transform:rotate(-20deg)] [background:radial-gradient(ellipse_at_40%_40%,var(--glow-1)_0%,transparent_70%)]" }),
				/* @__PURE__ */ jsx("div", { className: "absolute top-[450px] right-[-90px] h-[1080px] w-[900px] rounded-[9999px] blur-[108px] [transform:rotate(15deg)] [background:radial-gradient(ellipse_at_50%_50%,var(--glow-2)_0%,transparent_70%)]" }),
				/* @__PURE__ */ jsx("div", { className: "absolute bottom-[-180px] left-[180px] h-[900px] w-[1080px] rounded-[9999px] blur-[128px] [transform:rotate(-10deg)] [background:radial-gradient(ellipse_at_50%_60%,var(--glow-3)_0%,transparent_70%)]" })
			]
		}),
		/* @__PURE__ */ jsx("div", {
			className: "pointer-events-none absolute inset-0 z-0 opacity-[.04]",
			children: /* @__PURE__ */ jsxs("svg", {
				className: "size-full",
				xmlns: "http://www.w3.org/2000/svg",
				children: [/* @__PURE__ */ jsxs("filter", {
					id: "n",
					x: "0%",
					y: "0%",
					width: "100%",
					height: "100%",
					children: [/* @__PURE__ */ jsx("feTurbulence", {
						type: "fractalNoise",
						baseFrequency: "0.3",
						numOctaves: 1,
						stitchTiles: "stitch"
					}), /* @__PURE__ */ jsx("feColorMatrix", {
						type: "saturate",
						values: "0"
					})]
				}), /* @__PURE__ */ jsx("rect", {
					width: "100%",
					height: "100%",
					filter: "url(#n)"
				})]
			})
		}),
		/* @__PURE__ */ jsx("div", {
			className: "pointer-events-none absolute top-[560px] right-[56px] z-0 text-[200px] font-black leading-none tracking-[-.04em] opacity-[.028] [writing-mode:vertical-rl] [text-orientation:mixed]",
			style: ghostTop ? { top: ghostTop } : void 0,
			children: word
		}),
		/* @__PURE__ */ jsx("div", {
			className: "absolute top-[40px] left-[40px] z-0 grid [grid-template-columns:repeat(3,1fr)] gap-[7px] opacity-[.16]",
			children: Array.from({ length: 9 }, (_, i) => /* @__PURE__ */ jsx("i", { className: "size-[5px] rounded-[9999px] bg-fg" }, i))
		}),
		/* @__PURE__ */ jsx("div", {
			className: "absolute top-[40px] right-[40px] z-0 flex flex-col items-end gap-[4px] opacity-[.16]",
			children: [
				72,
				52,
				32
			].map((w) => /* @__PURE__ */ jsx("i", {
				className: "h-[4px] bg-fg",
				style: { width: w }
			}, w))
		}),
		/* @__PURE__ */ jsx("div", { className: "absolute bottom-0 left-0 z-0 h-[400px] w-[520px] opacity-[.04] [background:repeating-linear-gradient(45deg,var(--fg),var(--fg)_5px,transparent_2px,transparent_10px)]" })
	] });
}
/**
* 概览统计条：四张等宽大数字卡
*
* 帮助页、状态页、更新日志页三处的写法一字不差（含取色规则 rotate[i % len]），
* 迁移前是 shared.ts 的 .stats/.stat。utility 化之后如果三页各写一遍，那串
* 二十来个类就要重复三份——改一处漏两处，而 classes.test.mjs 查的是「类有没有
* 定义」，查不出「三处不一致」。所以这里换成组件：类名只有一份，页面传数据。
*
* .k/.v/.s 这种块内元素名也随之消失，不必再靠祖先限定防跨页撞车。
*/
function Stats({ items, palette }) {
	return /* @__PURE__ */ jsx("div", {
		className: "mb-[72px] grid [grid-template-columns:repeat(4,1fr)] gap-[24px]",
		children: items.map((s, i) => /* @__PURE__ */ jsxs("div", {
			className: "flex flex-col gap-[6px] rounded-[28px] border border-border bg-surface p-[30px]",
			children: [
				/* @__PURE__ */ jsx("div", {
					className: "font-mono text-[19px] font-extrabold uppercase leading-[1.3] tracking-[.16em] text-muted",
					children: s.key
				}),
				/* @__PURE__ */ jsx("div", {
					className: "text-[60px] font-black leading-[1.05] tracking-[-.02em] [font-variant-numeric:tabular-nums]",
					style: { color: palette.rotate[i % palette.rotate.length] },
					children: s.value
				}),
				s.sub && /* @__PURE__ */ jsx("div", {
					className: "mt-auto text-[21px] leading-[1.4] text-muted",
					children: s.sub
				})
			]
		}, i))
	});
}
/**
* 分节标题：圆点 + 文字 + 一条向右淡出的渐变线
*
* 关于页的「环境摘要 / 本版变更」与状态页的分组明细都用它。原是 shared.ts 的 .sec
* （更早叫 .rt-sec，是关于页私有类被状态页借用——改哪边都会波及对方，见 index.ts
* 顶部记的那三条拆分理由）。做成组件后「借用」这件事在类型上就不成立了。
*
* 渐变线与圆点的颜色都来自运行时轮换色，走内联 style；组件只定形。
*/
function Section({ title, color, right }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "mb-[36px] flex items-center gap-[16px]",
		children: [
			/* @__PURE__ */ jsx("span", {
				className: "size-[11px] flex-none rounded-[9999px]",
				style: { background: color }
			}),
			/* @__PURE__ */ jsx("span", {
				className: "text-[26px] font-extrabold leading-none tracking-[.16em] text-muted",
				children: title
			}),
			right && /* @__PURE__ */ jsx("span", {
				className: "flex-none font-mono text-[22px] font-bold leading-none opacity-80 text-muted",
				children: right
			}),
			/* @__PURE__ */ jsx("span", {
				className: "h-[3px] max-w-[220px] flex-1 rounded-[9999px] opacity-[.55]",
				style: { background: `linear-gradient(90deg,${color},transparent)` }
			})
		]
	});
}
/**
* 空态卡：状态页「暂无连接」、更新日志页「已是最新」
*
* 虚线描边而不是实线——与两页的实线内容卡区分开，一眼能看出「这里本该有东西」。
* whitespace-pre-line 保留说明里的换行（提示文案带 \n 分段）。
*/
function Empty({ title, tip }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col items-center justify-center gap-[16px] rounded-[32px] border border-dashed border-border bg-surface px-[80px] py-[96px] text-center",
		children: [/* @__PURE__ */ jsx("div", {
			className: "text-[44px] font-black leading-[1.2]",
			children: title
		}), /* @__PURE__ */ jsx("div", {
			className: "text-[26px] leading-[1.7] whitespace-pre-line text-muted",
			children: tip
		})]
	});
}
/**
* 提示条：fetch 失败等非致命情况用它说明，不占用空态位置
*
* 左侧粗边当色标，颜色由调用方按语义色内联给（border-l-[6px] 只定宽，
* 四边的颜色仍走内联的 borderColor）。
*/
function Notice({ text, color }) {
	return /* @__PURE__ */ jsx("div", {
		className: "mb-[44px] rounded-[24px] border border-l-[6px] px-[32px] py-[26px] text-[25px] leading-[1.65] break-words",
		style: {
			color,
			background: `${color}14`,
			borderColor: `${color}3d`
		},
		children: text
	});
}
/** 顶部标题区 */
function Header({ title, status, led = "on", rightKey, rightValue }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "mb-[72px] flex items-end justify-between border-b-4 border-b-border pb-[32px]",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "flex flex-col gap-[22px]",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-[14px] pl-[4px] opacity-70",
				children: [/* @__PURE__ */ jsx("span", { className: `size-[10px] flex-none rounded-[9999px] text-[20px] font-bold uppercase leading-none tracking-[.22em] text-muted ${led === "off" ? "bg-muted" : led === "warn" ? "bg-warning [box-shadow:0_0_12px_var(--warning)]" : "bg-success [box-shadow:0_0_12px_var(--success)]"}` }), /* @__PURE__ */ jsx("span", {
					className: "font-mono text-[20px] font-bold uppercase leading-none tracking-[.22em] text-muted",
					children: status
				})]
			}), /* @__PURE__ */ jsx("h1", {
				className: "text-[104px] font-black leading-[.95] tracking-[-.045em]",
				children: title
			})]
		}), /* @__PURE__ */ jsxs("div", {
			className: "flex flex-col gap-[8px] pb-[8px] text-right",
			children: [/* @__PURE__ */ jsx("div", {
				className: "text-[19px] font-extrabold uppercase leading-none tracking-[.2em] text-muted",
				children: rightKey
			}), /* @__PURE__ */ jsx("div", {
				className: "text-[34px] font-extrabold leading-[1.1]",
				children: rightValue
			})]
		})]
	});
}
/**
* 页脚水印布局常量
*
* 用于反推「整条水印能不能放进一行」，几何与 styles/frame.ts 的 .foot 规则一一对应，
* 改那边的尺寸要同步改这里。
*/
const FOOT = {
	/** 画布内容宽 = 1440 - .foot 的左右 padding 72×2 */
	width: 1296,
	/** 图标边长，两侧各一个 */
	icon: 80,
	/** 图标与文字块的间距（.foot .side 的 gap） */
	iconGap: 20,
	/** 水印内各块之间的间距（.foot .wm 的 gap） */
	blockGap: 32,
	/** 分隔竖线宽度 */
	sep: 3,
	/** 上排小字字号与字距 */
	capSize: 19,
	capTrack: .2,
	/** 下排大字字号与字距 */
	nameSize: 38,
	nameTrack: -.01,
	/** 框架版本小字字号 */
	smallSize: 24,
	/**
	* 最小缩放比
	*
	* 0.62 下大字是 23.6px、小字 11.8px —— 已经很小，但仍比换行好看。
	* 触发它需要极长的版本串（40 字符以上），正常的 git describe 到不了。
	*/
	minScale: .62
};
/**
* 页脚水印：插件图标 + 插件名/版本 ｜ 框架图标 + POWER BY 框架名/版本
*
* 版式照 karin-plugin-kkk 的 DefaultLayout：居中一排，左半是插件、右半是框架，
* 中间一根竖线分隔，两侧各自「图标 + 上小字 + 下大字」。它那边左边用一个内联
* SVG 当插件标、右边用 /image/frame-logo.png 当框架标，本插件两边都有位图
* （logo.png 与 frame-logo.png），所以统一走 <img>。
*
* 为什么要自己算字号
* ------------------
* 这一排必须是一行。原来靠 flex-wrap 兜底，结果 main 分支上版本号是
* `v2.1.0-2-gc6522ee-dirty`（23 字符），整条水印宽度超出画布，框架半边被挤到
* 第二行，「插件 ｜ 框架」的并列关系断掉了。
*
* 改成 nowrap 之后不能只是禁止换行——那样会溢出被 #container 的 overflow:hidden
* 裁掉，比换行更糟。所以在 SSR 阶段估一遍总宽（metrics.ts），超了就整体等比缩小，
* 由 CSS 变量 --fs 统一作用到所有字号，各块的比例关系不变。
*
* 与 kkk 的差异
* -------------
* 1. 不做隐写。kkk 还往像素里埋了一串 Restore ID（@ikenxuan/watermark + sharp），
*    本插件不引这两个依赖：sharp 带原生二进制，为一行署名装它不划算，而且
*    隐写信息用户看不见，起不到「这张图是谁生成的」的作用。
* 2. 不显示构建工具（Vite/Rolldown）标。那是 kkk 构建期打包的产物，本插件是
*    运行时 SSR，没有对应的东西可署。
*
* 版本号旁的 Stable/Preview 取自 env.ts 的 releaseType：预览版用 warning 色，
* 让「这不是发布版本」在图上一眼可见。
*/
function Footer({ name, version, lines, palette, frame = frameLabel(), frameLogo = imageDataUri(FRAME_LOGO), logo = imageDataUri(PLUGIN_LOGO) }) {
	const p = palette;
	const rt = releaseType();
	const verColor = rt === "Stable" ? p.foreground : p.warning;
	const rtCap = rt === "Stable" ? "✓ STABLE" : rt === "Dev" ? "⚙ DEV" : "⚠ PREVIEW";
	const m = /^(.*?)\s+v([\d.].*)$/.exec(frame);
	const frameNm = m ? m[1] : frame;
	const frameVer = m ? m[2] : "";
	const cap = (t) => textWidth(t, FOOT.capSize, FOOT.capTrack);
	const nm = (t) => textWidth(t, FOOT.nameSize, FOOT.nameTrack);
	const wPlugin = Math.max(cap("PLUGIN"), nm(name));
	const wVer = Math.max(cap(rtCap), nm(version));
	const wFrame = Math.max(cap("POWER BY"), nm(frameNm) + (frameVer ? textWidth(` v${frameVer}`, FOOT.smallSize) : 0));
	const fixed = (FOOT.icon + FOOT.iconGap) * 2 + FOOT.sep + FOOT.blockGap * 3;
	const need = fixed + wPlugin + wVer + wFrame;
	const scale = need <= FOOT.width ? 1 : Math.max(FOOT.minScale, (FOOT.width - fixed) / (need - fixed));
	return /* @__PURE__ */ jsxs("div", {
		className: "relative z-10 flex flex-col items-center gap-[26px] px-[72px] pt-0 pb-[64px]",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "flex max-w-full flex-nowrap items-center justify-center gap-[32px] whitespace-nowrap [--fs:1]",
			style: scale < 1 ? { "--fs": scale } : void 0,
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "flex min-w-0 items-center gap-[20px]",
					children: [logo && /* @__PURE__ */ jsx("span", {
						className: "flex size-[80px] flex-none items-center justify-center overflow-hidden rounded-[20px]",
						children: /* @__PURE__ */ jsx("img", {
							className: "block size-[112%] object-contain",
							src: logo,
							alt: ""
						})
					}), /* @__PURE__ */ jsxs("div", {
						className: "flex min-w-0 flex-col gap-[7px]",
						children: [/* @__PURE__ */ jsx("div", {
							className: "font-mono text-[calc(19px*var(--fs))] font-extrabold uppercase leading-none tracking-[.2em] text-muted",
							children: "PLUGIN"
						}), /* @__PURE__ */ jsx("div", {
							className: "text-[calc(38px*var(--fs))] font-black leading-none tracking-[-.01em]",
							children: name
						})]
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "flex min-w-0 flex-col gap-[7px]",
					children: [/* @__PURE__ */ jsx("div", {
						className: "font-mono text-[calc(19px*var(--fs))] font-extrabold uppercase leading-none tracking-[.2em]",
						style: { color: verColor },
						children: rtCap
					}), /* @__PURE__ */ jsx("div", {
						className: "text-[calc(38px*var(--fs))] font-black leading-none tracking-[-.01em] [font-variant-numeric:tabular-nums]",
						style: { color: verColor },
						children: version
					})]
				}),
				/* @__PURE__ */ jsx("div", { className: "h-[56px] w-[3px] flex-none rounded-[9999px] bg-border" }),
				/* @__PURE__ */ jsxs("div", {
					className: "flex min-w-0 items-center gap-[20px]",
					children: [frameLogo && /* @__PURE__ */ jsx("span", {
						className: "flex size-[80px] flex-none items-center justify-center overflow-hidden rounded-[20px]",
						children: /* @__PURE__ */ jsx("img", {
							className: "block size-full p-[8px] object-contain",
							src: frameLogo,
							alt: ""
						})
					}), /* @__PURE__ */ jsxs("div", {
						className: "flex min-w-0 flex-col gap-[7px]",
						children: [/* @__PURE__ */ jsx("div", {
							className: "font-mono text-[calc(19px*var(--fs))] font-extrabold uppercase leading-none tracking-[.2em] text-muted",
							children: "POWER BY"
						}), /* @__PURE__ */ jsxs("div", {
							className: "text-[calc(38px*var(--fs))] font-black leading-none tracking-[-.01em]",
							children: [frameNm, frameVer && /* @__PURE__ */ jsxs("small", {
								className: "font-mono text-[calc(24px*var(--fs))] font-bold tracking-normal text-muted",
								children: [
									" ",
									"v",
									frameVer
								]
							})]
						})]
					})]
				})
			]
		}), lines.length > 0 && /* @__PURE__ */ jsx("div", {
			className: "flex flex-wrap items-center justify-center gap-[28px] font-mono text-[20px] leading-[1.5] opacity-75 text-muted",
			children: lines.map((t, i) => /* @__PURE__ */ jsx("span", { children: t }, i))
		})]
	});
}
/** 一整页 */
function Page({ palette: _palette, word, ghostTop, children }) {
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Backdrop, {
		word,
		ghostTop
	}), /* @__PURE__ */ jsx("div", {
		className: "relative z-10 p-[72px]",
		children
	})] });
}

//#endregion
//#region src/modules/render/components/Help.tsx
/**
* 一张指令卡
*
* sub 为真时整体降一档（子分组用）
* ------------------------------
* 迁移前这是 CSS 的 `.hp-sub .hp-item{padding:22px 26px}` 一族后代选择器：卡片自己
* 不知道处境，由祖先改写尺寸。utility 表达不了「祖先是谁」，所以处境改成显式入参。
*
* 这样反而更贴合它本来的意思——子分组的条目与主指令卡是不同的东西：cmd 是
* name / token 这类短标识，dsc 恒为一行，没有 eg 也没有 MASTER 标签。沿用主卡尺寸
* 有两个具体毛病：60px 的图标框在只有两行内容的卡里显得卡在最上沿（用户反馈过
* 「子菜单图标还是在最上面」）；36px 的 cmd 配一行 24px 说明，块头与主卡一样大，
* 读起来分不出主次。
*/
/**
* 把 <占位符> 包成不可断开的整块
*
* 指令标题里的 <地址> / <编号> 是一个语义单元，劈成两行读起来像坏了。break-keep
* 管不了这种情况：它只禁掉 CJK 的逐字断点，而这里的断点来自「连接」与「<地址>」
* 之间那个空格（首行被右侧 MASTER 标签挤窄后就会折在那儿）。
*
* 所以按 <...> 切分，占位符那段套一层 whitespace-nowrap，其余文本原样返回。
* 只在这里做而不是整条 nowrap：整条禁折会让长标题直接溢出卡片。
*
* 返回 string 而非数组的快路径：绝大多数指令没有占位符，避免无谓的 <span> 包裹。
*/
function keepAtoms(cmd) {
	if (!cmd.includes("<")) return cmd;
	return cmd.split(/(<[^<>]*>)/g).map((part, i) => part.startsWith("<") && part.endsWith(">") ? /* @__PURE__ */ jsx("span", {
		className: "whitespace-nowrap",
		children: part
	}, i) : part);
}
function Item({ item, color, sub }) {
	return /* @__PURE__ */ jsx("div", {
		className: sub ? "rounded-[26px] border border-border bg-surface px-[26px] py-[22px]" : "rounded-[26px] border border-border bg-surface px-[30px] py-[28px]",
		children: /* @__PURE__ */ jsxs("div", {
			className: sub ? "flex items-start gap-[20px]" : "flex items-start gap-[24px]",
			children: [/* @__PURE__ */ jsx("div", {
				className: sub ? "grid size-[48px] flex-none place-items-center self-center rounded-[14px] [&>svg]:block [&>svg]:size-[23px]" : "grid size-[60px] flex-none place-items-center self-center rounded-[18px] [&>svg]:block [&>svg]:size-[30px]",
				style: {
					background: `${color}1f`,
					color,
					border: `1px solid ${color}3d`
				},
				children: /* @__PURE__ */ jsx(Icon, { name: item.icon })
			}), /* @__PURE__ */ jsxs("div", {
				className: sub ? "flex min-w-0 flex-1 flex-col gap-[6px]" : "flex min-w-0 flex-1 flex-col gap-[10px] pt-[2px]",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: sub ? "flex items-start gap-[12px] text-[30px] font-black leading-[1.25] tracking-[-.01em]" : "flex items-start gap-[12px] text-[36px] font-black leading-[1.2] tracking-[-.01em]",
						children: [/* @__PURE__ */ jsx("span", {
							className: "min-w-0 break-words break-keep",
							children: keepAtoms(item.cmd)
						}), item.master && /* @__PURE__ */ jsx("span", {
							className: "mt-[7.6px] flex-none self-start rounded-[9999px] px-[13px] py-[4px] text-[18px] font-extrabold leading-none tracking-[.08em]",
							style: {
								color,
								background: `${color}1f`,
								border: `1px solid ${color}3d`
							},
							children: "MASTER"
						})]
					}),
					/* @__PURE__ */ jsx("div", {
						className: sub ? "text-[21px] leading-[1.5] whitespace-pre-line text-muted" : "text-[24px] leading-[1.6] whitespace-pre-line text-muted",
						children: item.dsc
					}),
					item.eg && /* @__PURE__ */ jsx("div", {
						className: "mt-[2px] max-w-full self-start rounded-[12px] border border-border bg-inset px-[16px] py-[8px] font-mono text-[21px] leading-[1.5] break-words break-keep text-muted",
						children: item.eg
					})
				]
			})]
		})
	});
}
function Group({ group, color }) {
	const total = group.items.length + (group.subGroups?.reduce((n, s) => n + s.items.length, 0) || 0);
	return /* @__PURE__ */ jsxs("div", {
		className: "mb-[88px] last:mb-0",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "mb-[44px] flex items-center gap-[24px]",
				children: [
					/* @__PURE__ */ jsx("div", {
						className: "h-[56px] w-[12px] flex-none rounded-[9999px]",
						style: { background: color }
					}),
					/* @__PURE__ */ jsx("h2", {
						className: "text-[64px] font-black leading-none tracking-[-.03em]",
						children: group.title
					}),
					/* @__PURE__ */ jsx("div", {
						className: "ml-auto flex-none rounded-[9999px] border border-border bg-inset px-[18px] py-[9px] font-mono text-[22px] font-extrabold leading-none tracking-[.14em] text-muted",
						children: String(total).padStart(2, "0")
					})
				]
			}),
			group.items.length > 0 && /* @__PURE__ */ jsx("div", {
				className: "grid grid-cols-2 [align-items:start] gap-x-[48px] gap-y-[32px]",
				children: group.items.map((it, i) => /* @__PURE__ */ jsx(Item, {
					item: it,
					color
				}, i))
			}),
			group.subGroups?.map((sub, i) => /* @__PURE__ */ jsxs("div", {
				className: "mt-[56px]",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "mb-[32px] flex items-center gap-[14px] text-[28px] font-extrabold leading-[1.3] tracking-[.06em] opacity-[.62]",
					children: [/* @__PURE__ */ jsx("span", { className: "size-[10px] flex-none rounded-[9999px] bg-fg" }), sub.title]
				}), /* @__PURE__ */ jsx("div", {
					className: "grid grid-cols-2 [align-items:start] gap-x-[48px] gap-y-[32px]",
					children: sub.items.map((it, j) => /* @__PURE__ */ jsx(Item, {
						item: it,
						color,
						sub: true
					}, j))
				})]
			}, i))
		]
	});
}
function Help(data) {
	const { rotate } = data.palette;
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs(Page, {
		palette: data.palette,
		word: "COMMANDS",
		children: [
			/* @__PURE__ */ jsx(Header, {
				title: "COMMANDS",
				status: "GSCORE_ADAPTER",
				led: data.mode === "client" ? "on" : "off",
				rightKey: "RUNNING MODE",
				rightValue: data.mode
			}),
			/* @__PURE__ */ jsx(Stats, {
				items: data.summary,
				palette: data.palette
			}),
			data.groups.map((g, i) => /* @__PURE__ */ jsx(Group, {
				group: g,
				color: rotate[i % rotate.length]
			}, i))
		]
	}), /* @__PURE__ */ jsx(Footer, {
		name: data.title,
		version: data.version,
		palette: data.palette,
		lines: [data.time, "MASTER ONLY 标记的指令仅主人可用"]
	})] });
}

//#endregion
//#region src/modules/render/components/Status.tsx
/** 状态色：语义色只用于状态，不参与主情绪（见 kkk tokens.md 颜色角色） */
function toneColor(p, tone) {
	if (tone === "on") return p.success;
	if (tone === "warn") return p.warning;
	if (tone === "err") return p.danger;
	return p.muted;
}
function Status(data) {
	const p = data.palette;
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs(Page, {
		palette: p,
		word: data.ghost,
		children: [
			/* @__PURE__ */ jsx(Header, {
				title: data.heading,
				status: "GSCORE_ADAPTER",
				led: data.mode === "client" ? "on" : "off",
				rightKey: "RUNNING MODE",
				rightValue: data.mode
			}),
			/* @__PURE__ */ jsx(Stats, {
				items: data.summary,
				palette: p
			}),
			data.rows.length === 0 ? /* @__PURE__ */ jsx(Empty, {
				title: "暂无连接",
				tip: data.emptyTip || "用 #早柚添加连接 <地址> 添加"
			}) : /* @__PURE__ */ jsx("div", {
				className: "flex flex-col gap-[22px]",
				children: data.rows.map((row) => {
					const c = toneColor(p, row.tone);
					return /* @__PURE__ */ jsxs("div", {
						className: "flex gap-[26px] rounded-[28px] border border-border bg-surface px-[32px] py-[28px]",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "w-[60px] flex-none self-center rounded-[14px] border border-border bg-inset py-[16px] text-center font-mono text-[26px] font-extrabold leading-none text-muted",
								children: String(row.index).padStart(2, "0")
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "flex min-w-0 flex-1 flex-col gap-[8px]",
								children: [
									/* @__PURE__ */ jsx("div", {
										className: "text-[38px] font-black leading-[1.2]",
										children: row.name
									}),
									/* @__PURE__ */ jsx("div", {
										className: "break-all font-mono text-[23px] leading-[1.45] text-muted",
										children: row.url
									}),
									row.meta.length > 0 && /* @__PURE__ */ jsx("div", {
										className: "mt-[4px] flex flex-wrap gap-[10px]",
										children: row.meta.map((m, i) => /* @__PURE__ */ jsx("em", {
											className: "rounded-[10px] border border-border bg-inset px-[13px] py-[5px] font-mono text-[20px] not-italic leading-[1.4] text-muted",
											children: m
										}, i))
									})
								]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "flex flex-none items-center gap-[11px] self-center rounded-[9999px] px-[22px] py-[14px] text-[24px] font-extrabold leading-none",
								style: {
									color: c,
									background: `${c}1f`,
									border: `1px solid ${c}3d`
								},
								children: [/* @__PURE__ */ jsx("span", {
									className: "size-[12px] flex-none rounded-[9999px]",
									style: {
										background: c,
										boxShadow: `0 0 10px ${c}`
									}
								}), row.state]
							})
						]
					}, row.index);
				})
			}),
			data.panels && data.panels.length > 0 && /* @__PURE__ */ jsx("div", {
				className: "mt-[72px] grid [grid-template-columns:repeat(2,1fr)] gap-[56px_64px]",
				children: data.panels.map((panel, pi) => /* @__PURE__ */ jsxs("div", {
					className: "min-w-0",
					children: [/* @__PURE__ */ jsx(Section, {
						title: panel.title,
						color: p.rotate[pi % p.rotate.length],
						right: panel.key
					}), /* @__PURE__ */ jsx("div", {
						className: "flex flex-col gap-[14px]",
						children: panel.items.map((it, ii) => /* @__PURE__ */ jsxs("div", {
							className: "flex items-baseline gap-[14px] text-[23px] leading-[1.5]",
							children: [/* @__PURE__ */ jsx("span", {
								className: "flex-none text-muted",
								children: it.k
							}), /* @__PURE__ */ jsx("span", {
								className: "min-w-0 flex-1 break-words text-right font-mono font-bold",
								children: it.v
							})]
						}, ii))
					})]
				}, pi))
			})
		]
	}), /* @__PURE__ */ jsx(Footer, {
		name: data.title,
		version: data.version,
		palette: p,
		lines: [data.time, "#早柚帮助 查看全部指令"]
	})] });
}

//#endregion
//#region src/modules/render/components/Changelog.tsx
function Changelog(data) {
	const p = data.palette;
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs(Page, {
		palette: p,
		word: data.ghost,
		children: [
			/* @__PURE__ */ jsx(Header, {
				title: data.heading,
				status: "GSCORE_ADAPTER",
				led: data.led,
				rightKey: data.rightKey,
				rightValue: data.rightValue
			}),
			/* @__PURE__ */ jsx(Stats, {
				items: data.summary,
				palette: p
			}),
			data.notice && /* @__PURE__ */ jsx(Notice, {
				text: data.notice,
				color: p.warning
			}),
			data.commits.length === 0 ? /* @__PURE__ */ jsx(Empty, {
				title: data.emptyTitle,
				tip: data.emptyTip
			}) : /* @__PURE__ */ jsx("div", {
				className: "flex flex-col gap-[18px]",
				children: data.commits.map((c, i) => /* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-[28px] rounded-[24px] border border-border bg-surface px-[32px] py-[26px]",
					children: [/* @__PURE__ */ jsx("div", {
						className: "w-[132px] flex-none rounded-[12px] border border-border bg-inset py-[11px] text-center font-mono text-[25px] font-extrabold leading-none",
						style: { color: p.rotate[i % p.rotate.length] },
						children: c.hash
					}), /* @__PURE__ */ jsxs("div", {
						className: "flex min-w-0 flex-1 flex-col gap-[8px]",
						children: [/* @__PURE__ */ jsx("div", {
							className: "text-[30px] font-bold leading-[1.45] break-words",
							children: c.subject
						}), /* @__PURE__ */ jsx("div", {
							className: "font-mono text-[21px] text-muted",
							children: c.date
						})]
					})]
				}, c.hash + i))
			})
		]
	}), /* @__PURE__ */ jsx(Footer, {
		name: data.title,
		version: data.version,
		palette: p,
		lines: [data.time, "#早柚更新 拉取最新代码"]
	})] });
}

//#endregion
//#region src/modules/render/components/About.tsx
/**
* 版本号可用宽度
*
* 1440 画布 - .page 左右 padding 72×2 = 1296，再减去 hero 图标 200px 与 44px 间距。
* 几何对应下面 hero 那一块的 size-[200px] 与 gap-[44px]，改那边要同步改这里。
*/
const HERO_BUDGET = 1052;
function About(data) {
	const p = data.palette;
	const verColor = data.release === "Stable" ? p.rotate[0] : p.warning;
	/**
	* 版本号字号：按串长反推，保证一行放得下
	*
	* 130px 是给 `v2.1.0` 这类短串的理想值，但 main 分支上 git describe 会给出
	* `v2.1.0-2-gc6522ee-dirty`（23 字符），130px 下宽约 1790px，远超可用的 1052px，
	* 于是折成两行——右侧那块「小字 / 巨大数字 / 插件名」的层次被破坏，
	* 而且第二行会压到下面的插件名上。
	*
	* 下限 56px：仍比正文的 38px 大一档，主视觉地位保得住。
	* 字距 -.05em 与 CSS 一致，长串下这一项能省下约 4% 宽度，不能漏算。
	*/
	const verSize = fitFontSize(data.version, HERO_BUDGET, 130, 56, -.05);
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsx(Backdrop, {
			word: "RUNTIME",
			ghostTop: 1e3
		}),
		/* @__PURE__ */ jsxs("div", {
			className: "relative z-10 p-[72px]",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "mb-[40px] flex items-center justify-between gap-[24px]",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-[14px] text-[24px] font-extrabold leading-none tracking-[.18em] text-muted",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "size-[11px] flex-none rounded-[9999px]",
								style: { background: p.rotate[0] }
							}),
							/* @__PURE__ */ jsx("span", { children: "运行诊断" }),
							/* @__PURE__ */ jsx("span", {
								className: "opacity-50",
								children: "·"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "font-mono",
								children: "RUNTIME REPORT"
							})
						]
					}), /* @__PURE__ */ jsx("div", {
						className: "flex-none rounded-[9999px] px-[26px] py-[12px] font-mono text-[22px] font-extrabold leading-none tracking-[.1em]",
						style: {
							color: verColor,
							background: `${verColor}1f`,
							border: `1px solid ${verColor}3d`
						},
						children: data.release === "Stable" ? "正式版" : data.release === "Dev" ? "开发版" : "预览版"
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mb-[64px] flex items-end justify-between gap-[56px]",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "min-w-0",
						children: [/* @__PURE__ */ jsx("h1", {
							className: "mb-[18px] text-[88px] font-black leading-[1.05] tracking-[-.04em]",
							children: "运行环境"
						}), /* @__PURE__ */ jsx("div", {
							className: "text-[27px] leading-[1.6] text-muted",
							children: data.desc
						})]
					}), data.glance && data.glance.length > 0 && /* @__PURE__ */ jsx("div", {
						className: "flex flex-none flex-col items-end gap-[22px]",
						children: data.glance.map((g, i) => /* @__PURE__ */ jsxs("div", {
							className: "flex flex-col items-end gap-[7px] leading-none",
							children: [/* @__PURE__ */ jsx("span", {
								className: "font-mono text-[19px] font-extrabold tracking-[.18em] text-muted",
								children: g.key
							}), /* @__PURE__ */ jsx("span", {
								className: "text-[44px] font-black tracking-[-.02em] whitespace-nowrap [font-variant-numeric:tabular-nums]",
								style: { color: p.rotate[i % p.rotate.length] },
								children: g.value
							})]
						}, i))
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mb-[80px] flex items-center gap-[44px]",
					children: [data.logo && /* @__PURE__ */ jsx("img", {
						className: "size-[200px] flex-none rounded-[44px] border border-border bg-inset object-contain",
						src: data.logo,
						alt: ""
					}), /* @__PURE__ */ jsxs("div", {
						className: "flex min-w-0 flex-1 flex-col gap-[8px]",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "font-mono text-[22px] font-extrabold leading-none tracking-[.2em] text-muted",
								children: "插件版本"
							}),
							/* @__PURE__ */ jsx("div", {
								className: "text-[130px] font-black leading-none tracking-[-.05em] whitespace-nowrap [font-variant-numeric:tabular-nums]",
								style: {
									color: verColor,
									fontSize: verSize
								},
								children: data.version
							}),
							/* @__PURE__ */ jsx("div", {
								className: "font-mono text-[26px] leading-[1.4] tracking-[.06em] text-muted",
								children: data.title
							})
						]
					})]
				}),
				/* @__PURE__ */ jsx(Section, {
					title: "环境摘要",
					color: p.rotate[0]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mb-[72px] grid grid-cols-2 gap-x-[64px] gap-y-[52px]",
					children: [data.rows.map((r, i) => /* @__PURE__ */ jsxs("div", {
						className: "flex min-w-0 flex-col gap-[10px]",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "text-[23px] font-extrabold leading-[1.2] tracking-[.12em] text-muted",
								children: r.key
							}),
							/* @__PURE__ */ jsx("div", {
								className: `text-[38px] font-extrabold leading-[1.25] tracking-[-.01em] break-words${r.mono ? " font-mono" : ""}`,
								style: { color: p.rotate[i % p.rotate.length] },
								children: r.value
							}),
							r.sub && /* @__PURE__ */ jsx("div", {
								className: "text-[21px] leading-[1.5] break-words text-muted",
								children: r.sub
							})
						]
					}, i)), data.memory && /* @__PURE__ */ jsxs("div", {
						className: "flex min-w-0 flex-col gap-[10px]",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "text-[23px] font-extrabold leading-[1.2] tracking-[.12em] text-muted",
								children: "内存占用"
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "flex flex-wrap items-baseline gap-[16px] text-[38px] font-extrabold leading-[1.25] tracking-[-.01em] break-words",
								children: [/* @__PURE__ */ jsxs("span", {
									className: "text-[46px] font-black tracking-[-.02em] [font-variant-numeric:tabular-nums]",
									style: { color: p.rotate[2] },
									children: [data.memory.percent, "%"]
								}), /* @__PURE__ */ jsxs("small", {
									className: "font-mono text-[22px] font-semibold text-muted",
									children: [
										data.memory.used,
										" / ",
										data.memory.total
									]
								})]
							}),
							/* @__PURE__ */ jsx("div", {
								className: "mt-[6px] h-[10px] overflow-hidden rounded-[9999px] border border-border bg-inset",
								children: /* @__PURE__ */ jsx("i", {
									className: "block h-full rounded-[9999px]",
									style: {
										width: `${Math.min(100, Math.max(0, data.memory.percent))}%`,
										background: `linear-gradient(90deg,${p.rotate[0]},${p.rotate[2]})`
									}
								})
							})
						]
					})]
				}),
				data.changes && data.changes.groups.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Section, {
					title: "本版变更",
					color: p.rotate[1],
					right: /* @__PURE__ */ jsxs(Fragment, { children: [
						"v",
						data.changes.version,
						data.changes.date && /* @__PURE__ */ jsxs("em", {
							className: "not-italic opacity-75",
							children: [" · ", data.changes.date]
						})
					] })
				}), /* @__PURE__ */ jsx("div", {
					className: "mb-[72px] flex flex-col gap-[40px]",
					children: data.changes.groups.map((g, gi) => /* @__PURE__ */ jsxs("div", {
						className: "min-w-0",
						children: [/* @__PURE__ */ jsx("div", {
							className: "mb-[18px] text-[27px] font-extrabold leading-[1.3] tracking-[.02em]",
							style: { color: p.rotate[gi % p.rotate.length] },
							children: g.title
						}), /* @__PURE__ */ jsx("ul", {
							className: "flex list-none flex-col gap-[14px]",
							children: g.items.map((it, ii) => /* @__PURE__ */ jsxs("li", {
								className: "flex items-start gap-[16px] text-[25px] leading-[1.5]",
								children: [/* @__PURE__ */ jsx("i", {
									className: "mt-[14px] size-[9px] flex-none rounded-[9999px] opacity-[.85]",
									style: { background: p.rotate[gi % p.rotate.length] }
								}), /* @__PURE__ */ jsx("span", {
									className: "min-w-0 flex-1 break-words",
									children: it
								})]
							}, ii))
						})]
					}, gi))
				})] }),
				/* @__PURE__ */ jsx("div", {
					className: "grid grid-cols-2 gap-x-[64px] gap-y-[26px] border-t border-t-border pt-[44px]",
					children: data.links.map((l, i) => /* @__PURE__ */ jsxs("div", {
						className: "flex min-w-0 flex-col gap-[8px] text-[22px]",
						children: [/* @__PURE__ */ jsx("span", {
							className: "font-mono text-[19px] font-extrabold uppercase leading-none tracking-[.14em] text-muted",
							children: l.key
						}), /* @__PURE__ */ jsx("span", {
							className: "min-w-0 font-mono leading-[1.5] break-all text-muted",
							children: l.value
						})]
					}, i))
				}),
				/* @__PURE__ */ jsx("div", {
					className: "mt-[32px] text-[21px] leading-[1.6] opacity-70 text-muted",
					children: "仅包含经过脱敏的本地运行信息"
				})
			]
		}),
		/* @__PURE__ */ jsx(Footer, {
			name: data.title,
			version: data.version,
			palette: p,
			lines: [data.time, "#早柚帮助 查看全部指令"]
		})
	] });
}

//#endregion
//#region src/modules/render/commands.ts
const HELP_GROUPS = [
	{
		title: "状态与连接",
		items: [
			{
				cmd: "#早柚状态",
				dsc: "查看适配器运行模式与各连接的实时状态",
				icon: "status",
				master: true
			},
			{
				cmd: "#早柚连接列表",
				dsc: "列出全部已配置的连接，含地址、鉴权与重连次数",
				icon: "list",
				master: true
			},
			{
				cmd: "#早柚重连",
				dsc: "立即重连全部连接，不改动任何配置",
				icon: "refresh",
				master: true
			},
			{
				cmd: "#早柚版本",
				dsc: "插件版本与运行环境：框架、Node、运行模式、框架能力探测结果",
				icon: "info",
				master: true
			}
		]
	},
	{
		title: "连接管理",
		items: [
			{
				cmd: "#早柚添加连接",
				dsc: "新增一个早柚核心连接。\n地址只填 host:port 时自动补全为 /ws/Yunzai",
				eg: "#早柚添加连接 127.0.0.1:8765 name=主核心 token=abc",
				icon: "plus",
				master: true
			},
			{
				cmd: "#早柚删除连接",
				dsc: "按连接名或列表序号删除",
				eg: "#早柚删除连接 主核心    或    #早柚删除连接 1",
				icon: "minus",
				master: true
			},
			{
				cmd: "#早柚开启连接",
				dsc: "启用某个连接并立即发起连接",
				eg: "#早柚开启连接 1",
				icon: "play",
				master: true
			},
			{
				cmd: "#早柚关闭连接",
				dsc: "停用某个连接，配置保留",
				eg: "#早柚关闭连接 1",
				icon: "stop",
				master: true
			}
		],
		subGroups: [{
			title: "可选参数，以 key=value 追加，中英文冒号等号均可",
			items: [
				{
					cmd: "name",
					dsc: "连接名，用于日志与各处指令定位",
					icon: "dot"
				},
				{
					cmd: "token",
					dsc: "鉴权 token，以 ?token= 附在地址上",
					icon: "dot"
				},
				{
					cmd: "bot_id",
					dsc: "上报时填入 MessageReceive.bot_id 的平台标识",
					icon: "dot"
				},
				{
					cmd: "reconnect_interval",
					dsc: "重连间隔（秒），默认 5",
					icon: "dot"
				},
				{
					cmd: "max_reconnect_attempts",
					dsc: "最大重连次数，0 为无限重连",
					icon: "dot"
				}
			]
		}]
	},
	{
		title: "全局设置",
		items: [
			{
				cmd: "#早柚设置 mode=client|off",
				dsc: "切换运行模式，需重启生效",
				icon: "settings",
				master: true
			},
			{
				cmd: "#早柚设置 only_reply_at=true",
				dsc: "仅在被 @ 或带前缀时才上报群消息",
				icon: "settings",
				master: true
			},
			{
				cmd: "#早柚设置 notify_master=true",
				dsc: "连接断开与重连成功时私聊通知主人",
				icon: "settings",
				master: true
			},
			{
				cmd: "#早柚设置 media_max_size=10485760",
				dsc: "媒体转 base64 的大小上限（字节），超过改用外链",
				icon: "settings",
				master: true
			},
			{
				cmd: "#早柚设置 update_check=true",
				dsc: "开启定时更新检查，发现新提交时私聊推送更新日志",
				icon: "settings",
				master: true
			}
		]
	},
	{
		title: "更新",
		items: [
			{
				cmd: "#早柚更新",
				dsc: "拉取插件最新代码，有依赖变动会自动重装并重启",
				icon: "arrowUp",
				master: true
			},
			{
				cmd: "#早柚强制更新",
				dsc: "丢弃本地改动后强制更新，改过插件源码时才需要",
				icon: "arrowUpDouble",
				master: true
			},
			{
				cmd: "#早柚更新日志",
				dsc: "查看本地最近的提交记录",
				icon: "changelog",
				master: true
			},
			{
				cmd: "#早柚检查更新",
				dsc: "拉取远端信息，看有没有新提交。\n只检查不更新，可在配置里开启定时检查",
				icon: "search",
				master: true
			}
		]
	}
];
/** 纯文本帮助：渲染失败时的回退，内容与图保持同源 */
function helpText() {
	const out = ["早柚核心适配器 指令："];
	for (const g of HELP_GROUPS) {
		out.push("", `【${g.title}】`);
		for (const it of g.items) {
			out.push(`${it.cmd} —— ${it.dsc.replace(/\n/g, " ")}`);
			if (it.eg) out.push(`  例：${it.eg}`);
		}
		for (const sub of g.subGroups || []) {
			out.push(`  · ${sub.title}`);
			for (const it of sub.items) out.push(`    ${it.cmd}：${it.dsc}`);
		}
	}
	return out.join("\n");
}

//#endregion
//#region src/modules/render/theme.ts
/**
* 视觉 token
*
* 取值参照 karin-plugin-kkk 的「弥散信息海报」体系：1440px 固定画布、
* 巨型标题、多层光斑 + 噪点、冷色主情绪。
*
* 与它的实现差异：kkk 的语义 token 来自 @heroui/styles（那些 --heroui-* 变量在它
* 仓库里只被读、没有定义），这里自己定义一套。下面的 Palette 是给组件用的字面量，
* cssVars / V 是给样式表用的自定义属性，由 styles/ 拼进 <style>。
*
* Tailwind 只认这一处真源：render/styles/tailwind.css 的 @theme 把 --color-* 指到下面
* cssVars 下发的 --* 上（两跳），所以 `text-muted` 这类 utility 会随调色板走，
* 不需要 dark: 变体，也不需要在根节点挂主题类。
*
* 产物必须内联进 <style> 而不是 <link>：puppeteer 用 file:// 打开 HTML，
* 没有 dev server 能提供外部资源（详见 styles/index.ts）。
*/
/** 固定画布宽度，与 kkk 一致 */
const CANVAS_WIDTH = 1440;
const DARK = {
	bg: "#0a0d14",
	surface: "rgba(255,255,255,0.035)",
	border: "rgba(255,255,255,0.10)",
	foreground: "#e8ecf4",
	muted: "#8b95a8",
	inset: "rgba(255,255,255,0.06)",
	primary: "#60a5fa",
	secondary: "#a78bfa",
	accent: "#2dd4bf",
	success: "#4ade80",
	warning: "#fbbf24",
	danger: "#f87171",
	glow: [
		"rgba(59,130,246,0.40)",
		"rgba(139,92,246,0.30)",
		"rgba(6,182,212,0.25)"
	],
	rotate: [
		"#60a5fa",
		"#a78bfa",
		"#2dd4bf"
	]
};
/**
* 浅色一套
*
* 不是把 DARK 的值反过来：这套海报的深色靠「暗底 + 亮光斑」建立层次，
* 浅色下光斑几乎不可见，所以 surface 改成接近白的半透明（在浅底上仍能
* 与背景分开），border 与 inset 换成低透明度的深色（浅底上要压暗才看得见），
* 前景/辅助色则整体加深一档以保住对比度。
*
* 已知的观感差异（不是 bug，不必去追）
* ----------------------------------
* backdrop 层的三处装饰用的是固定 opacity（.028/.04/.16），量过合成后的对比度
* 两套几乎一样（ghost 1.048:1 vs 1.057:1），所以竖排大字本身没有变淡。真正的
* 差别在光斑：深色下三层 glow 会在大字背后积出一片亮区，把它衬出来；浅色底
* 上光斑本就接近白，衬不出东西，于是整页看着比深色"平"。
*
* 这是弥散海报体系在浅色下的固有代价，要补得改 backdrop 的整体构成（例如浅色
* 单独一套 opacity），不是调 Palette 能解决的。当前取舍：可读性指标（见
* test/contrast.mjs）全部达标，气氛差一点可以接受。
*/
const LIGHT = {
	bg: "#f4f6fb",
	surface: "rgba(255,255,255,0.72)",
	border: "rgba(15,23,42,0.10)",
	foreground: "#101828",
	muted: "#5b6577",
	inset: "rgba(15,23,42,0.05)",
	primary: "#2563eb",
	secondary: "#7c3aed",
	accent: "#0f766e",
	success: "#15803d",
	warning: "#b45309",
	danger: "#dc2626",
	glow: [
		"rgba(56,189,248,0.50)",
		"rgba(167,139,250,0.40)",
		"rgba(45,212,191,0.30)"
	],
	rotate: [
		"#2563eb",
		"#7c3aed",
		"#0f766e"
	]
};
/**
* 按时段选调色板
*
* 白天（6:00-17:59）浅色，夜间深色。边界取 6 与 18 而不是日出日落：算真实
* 日照需要经纬度，而这是个 QQ 机器人的出图插件，拿不到也不该问用户要位置。
*
* 用本机时区的小时数（宿主机通常就在使用者所在时区）。hour 参数留出注入口，
* 测试要覆盖两条分支时不必去改系统时间。
*/
function pickPalette(hour = (/* @__PURE__ */ new Date()).getHours()) {
	return hour >= 6 && hour < 18 ? LIGHT : DARK;
}
/**
* 调色板 -> CSS 自定义属性
*
* 为什么加这一层间接
* ------------------
* 原先每个 styles/ 层都是 `(p: Palette) => string`，颜色被字符串插值烘进选择器里。
* 后果是「换主题」等于把整张样式表重新生成一遍，而样式表里有 149 个块——真正变的
* 只有十几个颜色值。改成变量之后，各层退化成不带参数的静态字符串（常量，可以被
* 引擎缓存），主题差异集中在 #container 上的一个变量块里。
*
* 定义在 :root 而不是 #container
* ------------------------------
* base 层有一条 `html,body{background:...}` 在 #container 之外，若变量定义在
* #container 上，那条规则读不到（自定义属性只向后代继承）。:root 是 html，
* 覆盖得到全部节点。
*
* 组件里的内联 style 不走这套：它们要做 `${c}1f` 这类拼接（给颜色补 hex alpha）
* 和 `p.rotate[i % 3]` 这类按下标取色，都需要拿到字面量，var() 表达不了。
* 所以 Palette 本身保留，组件继续按值取用。
*/
const cssVars = (p) => [
	`--bg:${p.bg}`,
	`--surface:${p.surface}`,
	`--border:${p.border}`,
	`--fg:${p.foreground}`,
	`--muted:${p.muted}`,
	`--inset:${p.inset}`,
	`--primary:${p.primary}`,
	`--secondary:${p.secondary}`,
	`--accent:${p.accent}`,
	`--success:${p.success}`,
	`--warning:${p.warning}`,
	`--danger:${p.danger}`,
	`--glow-1:${p.glow[0]}`,
	`--glow-2:${p.glow[1]}`,
	`--glow-3:${p.glow[2]}`,
	`--rot-1:${p.rotate[0]}`,
	`--rot-2:${p.rotate[1]}`,
	`--rot-3:${p.rotate[2]}`
].join(";");
/**
* 各层引用颜色时用的 var() 串
*
* 写成常量而不是每处手打 `var(--muted)`：拼错变量名不会报错，只会静默拿到
* 空值（该处样式失效），而 V.muted 拼错了 tsc 立刻报。名字与 Palette 的键
* 一一对应，glow / rotate 保持数组形态，调用处的 [0]/[1]/[2] 不用改。
*/
const V = {
	bg: "var(--bg)",
	surface: "var(--surface)",
	border: "var(--border)",
	foreground: "var(--fg)",
	muted: "var(--muted)",
	inset: "var(--inset)",
	primary: "var(--primary)",
	secondary: "var(--secondary)",
	accent: "var(--accent)",
	success: "var(--success)",
	warning: "var(--warning)",
	danger: "var(--danger)",
	glow: [
		"var(--glow-1)",
		"var(--glow-2)",
		"var(--glow-3)"
	],
	rotate: [
		"var(--rot-1)",
		"var(--rot-2)",
		"var(--rot-3)"
	]
};
/**
* 字体栈
*
* 不打包字体文件：仓库 resources/ 下没有任何 ttf/woff（已确认），
* 硬指一个不存在的 @font-face 会让 Chromium 回落到默认衬线字体，
* 中文标题会变得很难看。这里直接列系统字体，Windows/macOS/Linux 各有命中项。
*
* 这两个栈在 render/styles/tailwind.css 的 @theme 里各有一份拷贝（--font-sans / --font-mono）。
* 颜色能靠 var() 只留一处真源，字体不行：@theme 的值要在编译期就确定，而这里是运行时
* 常量，Tailwind 读不到。改了记得两边一起改——不一致的表现是「用 font-mono 的元素
* 和用 MONO_STACK 的元素字体不一样」，只在少数几个地方看得出来。
*/
const FONT_STACK = "\"HarmonyOS Sans SC\",\"MiSans\",\"PingFang SC\",\"Microsoft YaHei\",\"Noto Sans CJK SC\",\"Source Han Sans SC\",-apple-system,\"Segoe UI\",Roboto,sans-serif";

//#endregion
//#region src/modules/render/styles/base.ts
/**
* 基础层：reset、画布、字体
*
* 迁到 Tailwind 之后这是唯一剩下的手写 CSS，因为这三件 utility 都表达不了：
*   1. :root 上的调色板变量 —— 是 utility 的取值来源，得先落地
*   2. `*,*::before,*::after` 的 reset —— 通用选择器，没有类可挂
*   3. #container 上的画布尺寸与 zoom —— 那个节点由 buildHtml() 生成，不经组件
*
* 别往这儿加东西。任何「某个元素长什么样」的规则都写在组件的 className 上；
* 这里再长下去就会重新变成从前那份四页混住的单文件（当时 488 行，
* 拆分与最终迁移的理由记在 ./index.ts 顶部）。
*
* 下面整段 CSS 是一个模板字符串，里面的 CSS 注释只是文本，JS 仍然会解析插值。
* 所以 CSS 注释里也不能出现美元号紧跟花括号的写法——它会被当成插值求值。
* 踩过一次：注释里写了一个反引号包住的点号加中文词，恰好紧跟在前一处插值之后，
* 于是被解析成对 cssVars(p) 取属性再调用，报 「... is not a function」，
* 而错误信息里既没有行号也没有那段注释，排查时完全想不到是注释的问题。
*/
/**
* 这一层是唯一还需要 Palette 的：它负责把调色板落成 :root 上的自定义属性，
* 其余各层只引用 V.* 里的 var()。
*
* @param p 调色板
* @param scale 高清倍率，用 zoom 实现（理由见 render/index.ts 的 SCALE 注释）
*/
const base = (p, scale) => `
:root{${cssVars(p)}}
@layer reset{*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}}
/* lucide-react 无条件在 <svg> 上挂 class="lucide lucide-图标名"，传 className
   覆盖不掉（它是合并而非替换）。这两类 class 不参与样式，但 classes.test.mjs 两个
   方向都对账，「HTML 里有、CSS 里无」会被报成漏写样式。这里空规则认领一下，
   比在测试里加白名单好：白名单会把「真的漏写了 lucide 相关样式」也一起放过。

   逐个列出而不是用 [class*="lucide-"]：那条对账只把选择器里以点开头的类名抽出来
   比对，属性选择器它看不见，认领不到具体类名。名单跟着 Icons.tsx 的 ICONS 表走，
   换图标要一起改——漏改会被那条测试当场报出来，不会静默。 */
@layer reset{
  .lucide,
  .lucide-activity,.lucide-list,.lucide-refresh-cw,
  .lucide-circle-plus,.lucide-circle-minus,.lucide-circle-play,.lucide-circle-stop,
  .lucide-settings,.lucide-arrow-up,.lucide-chevrons-up,
  .lucide-scroll-text,.lucide-search,.lucide-info,.lucide-circle-dot{}
}
html,body{background:${V.bg}}
#container{
  width:${CANVAS_WIDTH}px;min-width:${CANVAS_WIDTH}px;
  position:relative;overflow:hidden;
  background:${V.bg};color:${V.foreground};
  font-family:${FONT_STACK};
  -webkit-font-smoothing:antialiased;
  zoom:${scale};
}
`;

//#endregion
//#region src/modules/render/styles/index.ts
/**
* 样式表：拼装入口
*
* 两个来源拼成一份，由 render/index.ts 的 buildHtml() 内联进 <style>：
*   1. Tailwind 产物 —— 编译期由 @tailwindcss/cli 扫 lib/ 下的组件生成
*      （入口 ./tailwind.css，那边注释说明了为什么不引 preflight、
*      为什么扫编译产物而不是 src/*.tsx）
*   2. base 层 —— 见 base.ts，只剩 :root 变量、reset 与 #container 三件
*
* 为什么产物要读回来内联而不是 <link>
* ----------------------------------
* 本体把 HTML 写到 temp/html/{name}/ 再让 puppeteer 用 file:// 打开，相对路径的
* 基准是那个临时目录而不是插件目录（同 assets.ts 把图片转 data URI 的理由）。
* kkk 能用 <link> 引外部 CSS，是因为它有 HtmlWrapper + ResourcePathManager 负责
* 算相对路径，这边没有那一层。
*
* 手写的语义类去哪了
* ------------------
* 全没了。原先是 base / backdrop / frame / shared / pages/* 五层、四套页面前缀
* （hp- st- cl- rt-），共约 490 行；现在版式一律写在组件的 className 上，
* 那几层连同 pages/ 目录一起删掉了，只留 base。
*
* 促成迁移的是拆分时期就记着的三条毛病，它们都出自「语义类名 + 后代选择器」
* 本身，分文件只能缓解：
*   1. 通用类名跨页撞车。.k / .v / .s / .row / .items / .ver 各有两到四套定义，
*      靠祖先选择器区分；想改「关于页的标签」得先确认另外三页没在用同一个名字。
*   2. 跨页复用形成隐式依赖。状态页借了关于页私有的 .rt-sec，改关于页会静默
*      改掉状态页。
*   3. 漏定义看不出来。About.tsx 用了 .grp，而 CSS 里从来没有这条规则，
*      靠父级 gap 恰好达到效果。
* utility 让前两条在语法上不成立（没有名字可撞、没有东西可借），第三条交给
* classes.test.mjs 的两条断言：类没定义、或规则没人用，都会报。
*
* 真正共用的东西改由组件承担而不是类名：Stats / Section / Empty / Notice /
* Header / Footer / Backdrop 都在 components/Layout.tsx。这比复制一串 utility
* 更稳——三处复制走样，classes.test.mjs 查不出来（它只查「有没有定义」）。
*
* 剩下的内联 style 不迁：组件里那二十来处几乎都是运行时才算得出的值（状态灯
* toneColor、分组标题轮换色 p.rotate[i%…]、渐变分隔线、页脚的 --fs 缩放比），
* 值不在编译期确定，utility 表达不了。
*
* 颜色怎么进来
* ------------
* base 层把调色板落成 :root 上的自定义属性（theme.ts 的 cssVars），Tailwind 的
* @theme 再把 --color-* 指过去，于是 utility 侧写 text-muted、CSS 侧写 V.muted，
* 两边同一个真源。深浅两套主题的产物只差 :root 那一行。
*/
/** 编译好的 Tailwind 产物。文件在进程生命周期里不会变，读一次就够（同 assets.ts 的缓存理由） */
let twCache;
/**
* 读 Tailwind 编译产物
*
* 产物由 `pnpm build` 的 build:css 步骤生成（扫 lib/ 下的组件），不入库。
* 只在源码树里跑而没 build 过时会读不到，此时降级成空串并告警——
* 让页面掉样式也好过整张图渲染失败，行为与 assets.ts 读不到图片时一致。
*
* 迁移之后这条降级路径的后果比从前重：版式全在 utility 里，读不到产物不再是
* 「掉点样式」，而是整页回落成无样式的文档流。告警措辞照旧，因为处置方式没变
* ——跑一次 pnpm build。
*/
function tailwind() {
	if (twCache !== void 0) return twCache;
	try {
		twCache = fs.readFileSync(join(ResPath, "template", "css", "tailwind.css"), "utf8");
	} catch {
		twCache = "";
		makeLog("warn", "未找到 Tailwind 产物（resources/template/css/tailwind.css），请先 pnpm build", "GsCore");
	}
	return twCache;
}
/**
* 生成整张画布的 CSS
*
* 四个页面共用同一份：按页裁剪要多维护一张「页面 → 需要哪些规则」的映射表，
* 而整份也就十几 KB，不划算。
*
* 顺序在这里不起作用：Tailwind 产物整份包在 @layer theme, utilities 里，base 的
* reset 显式包在 @layer reset 里（层序由 tailwind.css 第一行声明，reset 在最前），
* 而 base 剩下的 :root 与 #container 是无层的——无层样式在层叠里永远压过任何
* @layer，与源码先后无关。产物排在前面只是读起来顺。
*
* 只有 base 是函数：调色板与 scale 都只在它那儿用得上（scale 落在 #container 的 zoom）。
*
* @param p 调色板，只用于生成 :root 上的变量块
* @param scale 高清倍率，用 zoom 实现（理由见 render/index.ts 的 SCALE 注释）
*/
function buildCss(p, scale = 1) {
	return [tailwind(), base(p, scale)].map((css) => css.trim()).filter(Boolean).join("\n\n");
}

//#endregion
//#region src/modules/render/index.ts
/**
* 渲染入口：React SSR -> 自己拼出整页 HTML -> 本体 puppeteer 截图
*
* 与 karin-plugin-kkk 的差异
* ---------------------------
* 版式思路参考 kkk 的 packages/template。相同的部分比想象的多：kkk 也是运行时
* SSR，同样不 hydrate、不产出 client bundle。页面是拿去截图的静态图，两边都没有
* 交互需求。样式管线现在也对齐：都用 Tailwind v4 在构建期扫 JSX 产出一份 CSS。
*
* 剩下的差异只有两处：
*   1. 语义 token 自己定义在 theme.ts，不依赖 @heroui/styles
*      （kkk 那些 --heroui-* 变量在它仓库里只被读、没有定义）
*   2. CSS 内联进 <style> 而不是 <link>：kkk 有 HtmlWrapper + ResourcePathManager
*      负责算相对路径，这边没有那一层，而 puppeteer 用 file:// 打开临时目录下的
*      HTML，相对路径的基准是那个目录，链不到插件里的 css
*
* 整页 HTML 自己拼，不再走 art-template
* ------------------------------------
* 对齐 kkk 的 reactServerRender：它的 HtmlWrapper.wrapContent 就是把 DOCTYPE、
* meta、样式和 body 拼成一个自包含的 HTML 文件写盘，交给截图方打开。这边同理，
* 见 buildHtml()，原先那份 resources/template/html/shell.html 已删。
*
* 好处不在性能（art-template 渲一次 0.19ms，相对一两秒的截图可以忽略），而在于
* 少一层「模板语法」的中间态：外壳是 TS 里的一个函数，改它有类型检查、有 diff，
* 不必再遵守「模板内容必须恒定」这条只有读过本体 Renderer 源码才知道的约束。
*
* 但 screenshot() 仍然要用
* ----------------------
* 本体 screenshot() 里除了套模板，还有浏览器生命周期、超时强制重启、每 N 次渲染
* 主动重启（防止越跑越慢）、分片截图的 viewport 计算、buffer 归一化——套模板只占
* 其中很小一块。所以不自己驱动 puppeteer，而是把「已经拼好的整页 HTML」当模板喂
* 给它：art-template 对不含 {{ }} 的文本是逐字节原样返回（实测过），于是那一步
* 退化成一次无副作用的拷贝。
*
* 代价是要绕开 dealTpl 的模板缓存，见 render() 里 evictTplCache() 那段。
*
* 关于最后一步的接法：本体那个模块的 screenshot() 已经用 segment.image 包好了
* （puppeteer.js:9-12），返回值可直接 e.reply，所以不必自己碰 renderer/loader。
*/
/**
* 自己生成的整页 HTML 放哪
*
* 每个页面一个固定文件名（temp/html/gscore-adapter-html/{name}.html），不带时间戳。
* 理由见 render() 里 evictTplCache 那段：本体按路径缓存模板、并为每个新路径注册一个
* chokidar watcher，路径每次都变的话两者都会无上限增长。
*/
const HTML_DIR = join(YunzaiPath, "temp", "html", `${PluginName}-html`);
/**
* 高清倍率：1440px 画布出 2160px 宽的图，缩放到聊天窗口后文字边缘仍清晰。
*
* 取 1.5 而不是 2：帮助页本身就有 3900px 高，2 倍出图接近 7800px、5.8MB，
* 不少 QQ 适配器会直接拒发或压成马赛克。1.5 倍文字依旧锐利，体积小一个量级。
*
* 用 CSS zoom 而不是 screenshot 的 deviceScaleFactor —— 本体的渲染后端
* （renderers/puppeteer/lib/puppeteer.js）从没读过 data.deviceScaleFactor，
* 传了是静默失效，只会拿到 1 倍图；它也只在分片截图时调 setViewport。
* 而 zoom 会放大 #container 的实际布局盒，body.screenshot() 截的就是放大后的尺寸。
*
* 不用 transform:scale：transform 不改变元素的布局尺寸，boundingBox 仍是 1440，
* 截出来会把画面裁掉一大半。kkk 用的是 transform:scale(3)（DefaultLayout 里
* 配 transformOrigin:'top left'），那条路要求截图方按放大后的尺寸显式设 viewport，
* 它自己的渲染服务能做到；本体的 screenshot() 只按 #container 的 boundingBox 截，
* 所以这里必须用会改布局盒的 zoom。
*/
const SCALE = 1.5;
/** 本体 puppeteer 模块，首次渲染时惰性加载 */
let puppeteer;
/**
* 取本体截图器
*
* 与 apps/update.ts 同一套做法：由 YunzaiPath 拼绝对路径后动态 import。
* 不写 ../../../../lib/puppeteer/puppeteer.js —— 那样既依赖编译产物的目录深度，
* 又会让 tsc 去静态解析一个不在本插件仓库里的文件（CI 单独 checkout 时必然 TS2307）。
*/
async function getPuppeteer() {
	if (puppeteer) return puppeteer;
	try {
		puppeteer = (await import(pathToFileURL(join(YunzaiPath, "lib/puppeteer/puppeteer.js")).href)).default;
	} catch (err) {
		makeLog("error", ["加载本体 puppeteer 失败", err], "GsCore");
		return null;
	}
	return puppeteer;
}
/**
* 拼出一张自包含的整页 HTML
*
* 对齐 kkk 的 HtmlWrapper.wrapContent：DOCTYPE、charset、title、内联样式、
* 一个 #container 包住 body。就这么多——原先的 shell.html 除了 art-template
* 的占位符语法，实质内容也只有这些。
*
* #container 是必需的：本体截图取 #container，取不到才回落 body
* （renderers/puppeteer/lib/puppeteer.js:189）。回落到 body 会连页面外边距一起截。
*
* title 要转义：它来自调用方的字面量（"早柚核心适配器 帮助"），当前没有特殊字符，
* 但这里是模板的位置，将来若有人把用户输入拼进标题，不转义就是注入。body 不转义
* ——它是 renderToStaticMarkup 的产物，React 已经把文本节点转义过了。
*
* 导出是为了给 test/preview.mjs 用：预览页与真正出的图必须是同一个骨架，
* 否则「预览里对、出图错」这类问题会没人发现。
*/
function buildHtml(title, css, body) {
	const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
${css}
</style>
</head>
<body><div id="container">${body}</div></body>
</html>
`;
}
/**
* 清掉本体对我们这份 HTML 的模板缓存
*
* 本体 Renderer.dealTpl 会把模板文本按路径缓存在 this.html[tplFile] 里，永不失效
* （lib/renderer/Renderer.js:44）。我们每次渲染都会重写同一个文件，若不清缓存，
* 第二次开始读到的还是首次那份——页面数据变了，出的图却纹丝不动，而且不报任何错。
*
* 反过来「每次换一个新文件名」也不行：那条路径分支里还会 this.watch(tplFile) 注册
* 一个 chokidar watcher（第 54 行），路径无限增长时缓存和 watcher 一起泄漏。
*
* 所以取「固定路径 + 渲染前删缓存」：watcher 恒定只有页面数那么几个，缓存每次失效。
* 删的是我们自己写进去的键，不动本体其它插件的条目。
*
* 拿不到 puppeteer.html 时静默跳过：本体换实现的话，最坏结果是图不刷新，
* 不该因此让整个渲染失败。
*/
function evictTplCache(tplFile) {
	try {
		const cache = puppeteer?.html;
		if (cache && typeof cache === "object") delete cache[tplFile];
	} catch {}
}
/**
* 渲染成图片消息段
* @returns 可直接 e.reply 的消息段（multiPage 时为数组）；失败返回 false
*/
async function render(opts) {
	const pp = await getPuppeteer();
	const shot = opts.multiPage ? pp?.screenshots : pp?.screenshot;
	if (!shot) return false;
	const palette = pickPalette();
	let body;
	try {
		body = renderToStaticMarkup(opts.view(palette));
	} catch (err) {
		makeLog("error", ["组件渲染失败", err], "GsCore");
		return false;
	}
	fs.mkdirSync(HTML_DIR, { recursive: true });
	const tplFile = join(HTML_DIR, `${opts.name}.html`);
	fs.writeFileSync(tplFile, buildHtml(opts.title, buildCss(palette, SCALE), body));
	evictTplCache(tplFile);
	const data = {
		tplFile,
		saveId: opts.name,
		imgType: "jpeg",
		quality: 92,
		pageGotoParams: { waitUntil: "load" },
		multiPage: opts.multiPage
	};
	const shotName = `${PluginName}-${opts.name}`;
	fs.mkdirSync(join(YunzaiPath, "temp", "html", shotName), { recursive: true });
	const img = await shot.call(pp, shotName, data);
	if (!img) makeLog("error", `渲染 ${opts.name} 失败`, "GsCore");
	return img;
}

//#endregion
//#region src/modules/render/changelog.ts
/**
* CHANGELOG.md 解析
*
* 取材照 kkk 的 getLocalChangelog（module/utils/runtime-report.ts）：读插件目录里的
* CHANGELOG.md，按版本切出最新一节，给 #早柚版本 的「本版变更」用。
*
* 与 kkk 的差别：它把整段 markdown 原样丢给模板，由 <ReactMarkdown> 渲染。
* 本插件不引 markdown 运行时（多一个依赖，而且要渲染的只是「### 分类 + * 条目」
* 两层固定结构，release-please 生成的格式非常规整），所以这里直接解析成结构化数据，
* 由 About.tsx 用普通 JSX 排版。
*
* 与 #早柚更新日志 的分工：那条命令读 git（modules/update/git.ts），答「代码更新
* 到哪了」；这里读 CHANGELOG.md，答「当前这个版本改了什么」。两者数据源不同，
* 前者按提交、后者按发布，互不重复。
*/
/**
* 把一条 markdown 列表项清成纯文本
*
* release-please 的条目形如：
*   * **admin:** 支持批量设置 ([39e1f9b](https://github.com/.../commit/39e1f9b...))
* 要去掉的三样：
*   1. 末尾的 commit 链接——图上放不下 40 位 hash，也没有点击价值
*   2. **粗体** 标记——纯文本渲染里星号会直接显出来
*   3. 其余 [文本](链接) 形式的行内链接，只留文本
*/
function clean(line) {
	return line.replace(/\s*\(\[[0-9a-f]+\]\([^)]*\)\)\s*$/i, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").trim();
}
/**
* 解析 CHANGELOG.md
*
* @param limit 最多取几个版本
*
* 解析用逐行状态机而不是正则整段切分：整段切分要写一个跨行的 (?=^## |\z) 模式，
* 在 CHANGELOG 里出现代码块或引用时很容易吃错边界。逐行只认三种行首，简单且可预期。
*/
function parseChangelog(text, limit = 1) {
	const out = [];
	let cur = null;
	let group = null;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trimEnd();
		const ver = /^##\s+(?:\[([^\]]+)\]\([^)]*\)|(\S+))\s*(?:\((\d{4}-\d{2}-\d{2})\))?/.exec(line);
		if (ver) {
			if (out.length >= limit) break;
			cur = {
				version: (ver[1] || ver[2] || "").replace(/^v/, ""),
				date: ver[3] || "",
				groups: []
			};
			out.push(cur);
			group = null;
			continue;
		}
		if (!cur) continue;
		const sec = /^###\s+(.+)$/.exec(line);
		if (sec) {
			group = {
				title: clean(sec[1]),
				items: []
			};
			cur.groups.push(group);
			continue;
		}
		const item = /^[*-]\s+(.+)$/.exec(line);
		if (item) {
			if (!group) {
				group = {
					title: "变更",
					items: []
				};
				cur.groups.push(group);
			}
			const t = clean(item[1]);
			if (t) group.items.push(t);
		}
	}
	for (const r of out) r.groups = r.groups.filter((g) => g.items.length > 0);
	return out;
}
/**
* 读取本插件当前版本的变更
*
* @param version 期望的版本号。CHANGELOG 最新一节与它不一致时仍返回最新一节——
*   开发中的版本（package.json 已提前 bump，release-please 还没写入 CHANGELOG）
*   属于正常状态，此时展示上一个已发布版本比什么都不显示有用。
*
* 与 kkk 一样：任何失败都静默退化成 null，绝不抛错——一张图不该因为读不到
* 变更日志就整个渲染失败。
*/
function currentRelease(version) {
	try {
		const r = parseChangelog(fs.readFileSync(join(PluginPath, "CHANGELOG.md"), "utf8"), 1)[0];
		if (!r || !r.groups.length) return null;
		if (version && r.version && r.version !== version) r.date = r.date || "";
		return r;
	} catch {
		return null;
	}
}

//#endregion
//#region src/modules/render/pages.ts
/**
* 页面装配
*
* 把配置与运行时状态整理成组件要的形状，再交给 render()。
* 单独一层是为了让 apps/*.ts 只写一行调用，也方便未来加新页面。
*/
const version = versionLabel();
/** 本地时间戳，页脚用 */
function stamp() {
	const d = /* @__PURE__ */ new Date();
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** 按状态码给出色调 */
function tone(status, enabled) {
	if (!enabled) return "off";
	if (status === 1) return "on";
	if (status === 2 || status === 3) return "warn";
	return "err";
}
/**
* 汇总连接的运行状态
*
* @param detail 是否往 meta 里加运行时明细（收发计数、心跳年龄）。
*   只有 #早柚状态 要；#早柚连接列表 与 #早柚帮助 问的是「配了哪些连接」，
*   加进去反而把配置信息挤没了。
*/
function collect(detail = false) {
	const rows = getConnections().map((c, i) => {
		const live = clients.find((x) => x.name === c.name);
		const enabled = c.enable !== false;
		const status = live?.status ?? 0;
		const state = !enabled ? "已停用" : live ? STATUS_TEXT[status] || String(status) : "未启动";
		const meta = [];
		if (c.token) meta.push("token 已设置");
		if (c.bot_id) meta.push(`bot_id: ${c.bot_id}`);
		if (live?.retry) meta.push(`已重连 ${live.retry} 次`);
		if (c.bind?.length) meta.push(`bind: ${c.bind.length}`);
		if (c.exclude?.length) meta.push(`exclude: ${c.exclude.length}`);
		if (meta.length === 0) {
			if (!enabled) meta.push(`用 #早柚启用连接 ${c.name || i + 1} 恢复`);
			else if (!live) meta.push("尚未建立连接，可用 #早柚重载 重试");
			else meta.push("未配置 token / bind / exclude，按默认规则中转");
		}
		if (detail) {
			const n = forName(c.name || String(c.url || ""));
			meta.push(`↑${n.up + n.event} ↓${n.down}`);
			if (live?.status === 1 && live.lastPong && Number(config.client?.heartbeat) > 0) meta.push(`心跳 ${Math.round((Date.now() - live.lastPong) / 1e3)}s 前`);
		}
		return {
			index: i + 1,
			name: c.name || c.url,
			url: String(c.url || ""),
			state,
			tone: tone(status, enabled),
			meta
		};
	});
	return {
		rows,
		online: rows.filter((r) => r.tone === "on").length,
		off: rows.filter((r) => r.tone === "off").length,
		total: rows.length
	};
}
/** 渲染帮助图 */
async function renderHelp() {
	const { total, online } = collect();
	return render({
		name: "help",
		title: "早柚核心适配器 帮助",
		view: (palette) => Help({
			title: PluginName,
			version,
			mode: config.mode || "off",
			palette,
			time: stamp(),
			summary: [
				{
					key: "CONNECTIONS",
					value: String(total),
					sub: "已配置连接"
				},
				{
					key: "ONLINE",
					value: String(online),
					sub: "当前在线"
				},
				{
					key: "COMMANDS",
					value: String(HELP_GROUPS.reduce((n, g) => n + g.items.length, 0)),
					sub: "可用指令"
				},
				{
					key: "REPLY AT",
					value: config.filter?.only_reply_at ? "ON" : "OFF",
					sub: "仅响应 @"
				}
			],
			groups: HELP_GROUPS
		})
	});
}
/** 渲染连接列表图 */
async function renderList() {
	const { rows, total, online, off } = collect();
	return render({
		name: "list",
		title: "早柚核心 连接列表",
		view: (palette) => Status({
			title: PluginName,
			version,
			mode: config.mode || "off",
			heading: "CONNECTIONS",
			ghost: "LINKS",
			palette,
			time: stamp(),
			rows,
			summary: [
				{
					key: "TOTAL",
					value: String(total),
					sub: "连接总数"
				},
				{
					key: "ONLINE",
					value: String(online),
					sub: "已连接"
				},
				{
					key: "DISABLED",
					value: String(off),
					sub: "已停用"
				},
				{
					key: "HEARTBEAT",
					value: `${config.client?.heartbeat ?? 0}s`,
					sub: "ping 间隔"
				}
			]
		})
	});
}
/** 条目数摘要：空数组说「全部」而不是「0」，避免读成「一个都不转」 */
function countOf(list, all = "全部") {
	const n = list?.length || 0;
	return n ? `${n} 项` : all;
}
/** 开关类配置统一显示 */
const onOff = (v) => v ? "开" : "关";
/**
* 状态页的分组明细
*
* 为什么状态页要有这些
* ------------------
* 原来这页只有 4 个统计卡 + 连接卡片，信息量比 #早柚版本 还少，而它本该是
* 排障的第一站。这里补的三块对应三类最常见的「连着但不对」：
*   中转情况 —— 连接绿了但一条消息都没过去（计数为 0 一眼可见）
*   消息过滤 —— 过滤规则把消息挡了（只在群里不响应时最容易忘掉 only_reply_at）
*   媒体与运行 —— 图片发不出、大文件失败（media/file 上限、文件服务是否在跑）
*
* 隐私边界与 env.ts sysInfo 一致：这张图会发到群里。所以过滤规则只报**条数**，
* 不报具体的群号、用户号、前缀内容；token 只在连接卡片上标「已设置」，不出现值。
*
* 第四块「运行环境」
* ----------------
* .st-panels 是两列网格（styles/pages/status.ts），三块明细排下来第四格是空的，
* 右下角一大片留白。
* 补的是宿主环境——它和前三块是一类问题的两面：前三块答「适配器自己配成什么样」，
* 这块答「它跑在什么上面」。排障时「转发慢/发不出」经常是内存吃满或 Node 版本太旧，
* 而不是适配器配错。
*
* 与 #早柚版本 的重复是有意的：那页是「插件的身份证」，一次看清楚就不用再看；
* 这页是随手一敲的运行快照，不该为了去重逼用户再发一条命令。取值同源
* （env.ts sysInfo），措辞压到一行以适配 kv 两列的窄栏。
*/
function statusPanels() {
	const s = snapshot();
	const f = config.filter || {};
	const sys = sysInfo();
	const hb = Number(config.client?.heartbeat) || 0;
	const to = Number(config.client?.heartbeat_timeout) || 0;
	return [
		{
			title: "中转情况",
			key: "RELAY",
			items: [
				{
					k: "上行消息",
					v: `${s.today.up} 今日 / ${s.total.up} 累计`
				},
				{
					k: "上行事件",
					v: `${s.today.event} 今日 / ${s.total.event} 累计`
				},
				{
					k: "下行消息",
					v: `${s.today.down} 今日 / ${s.total.down} 累计`
				},
				{
					k: "统计自",
					v: formatDuration((Date.now() - s.since) / 1e3) + "前"
				}
			]
		},
		{
			title: "消息过滤",
			key: "FILTER",
			items: [
				{
					k: "仅响应 @",
					v: onOff(f.only_reply_at)
				},
				{
					k: "触发前缀",
					v: countOf(f.prefix, "无")
				},
				{
					k: "屏蔽前缀 / 关键词",
					v: `${f.block_prefix?.length || 0} / ${f.block_include?.length || 0}`
				},
				{
					k: "群白名单 / 黑名单",
					v: `${countOf(f.white_group)} / ${f.black_group?.length || 0} 项`
				},
				{
					k: "用户黑名单",
					v: countOf(f.black_user, "无")
				}
			]
		},
		{
			title: "媒体与文件",
			key: "MEDIA",
			items: [
				{
					k: "媒体内联上限",
					v: formatBytes(Number(config.media_max_size) || 0)
				},
				{
					k: "文件大小上限",
					v: formatBytes(Number(config.file_max_size) || 0)
				},
				{
					k: "内置文件服务",
					v: fileServerEnabled() ? `开 · 暂存 ${pendingFiles()} 个` : "关"
				},
				{
					k: "心跳 / 超时",
					v: hb ? `${hb}s / ${to ? `${to}s` : "关"}` : "关"
				},
				{
					k: "合并转发",
					v: fwdLabel()
				}
			]
		},
		{
			title: "运行环境",
			key: "RUNTIME",
			items: [
				{
					k: "运行框架",
					v: frameVersion() ? `${frameName()} v${frameVersion()}` : frameName()
				},
				{
					k: "Node.js",
					v: `v${nodeVersion()}`
				},
				{
					k: "操作系统",
					v: `${sys.platform} · ${sys.arch}`
				},
				{
					k: "处理器",
					v: `${sys.cpuCores} 核心`
				},
				{
					k: "内存占用",
					v: `${sys.memoryPercent}% · ${sys.usedMemory}/${sys.totalMemory}`
				},
				{
					k: "本进程",
					v: `${sys.processUptime} · ${sys.processRss}`
				}
			]
		}
	];
}
/** 合并转发走哪条路径，与 #早柚版本 同一套判定 */
function fwdLabel() {
	const fwd = forwardMode();
	return fwd === "native" ? "框架原生" : fwd === "target" ? "群/好友接口" : "不可用";
}
/** 渲染状态图 */
async function renderStatus() {
	const { rows, total, online } = collect(true);
	const s = snapshot();
	return render({
		name: "status",
		title: "早柚核心 适配器状态",
		view: (palette) => Status({
			title: PluginName,
			version,
			mode: config.mode || "off",
			heading: "STATUS",
			ghost: "STATUS",
			palette,
			time: stamp(),
			rows,
			emptyTip: config.mode === "off" ? "当前模式为 off，适配器未启用\n用 #早柚设置 mode=client 开启" : "用 #早柚添加连接 <地址> 添加",
			summary: [
				{
					key: "MODE",
					value: (config.mode || "off").toUpperCase(),
					sub: "运行模式"
				},
				{
					key: "ONLINE",
					value: `${online}/${total}`,
					sub: "在线 / 总数"
				},
				{
					key: "UPLINK",
					value: String(s.today.up + s.today.event),
					sub: "今日上报核心"
				},
				{
					key: "DOWNLINK",
					value: String(s.today.down),
					sub: "今日核心下发"
				}
			],
			panels: statusPanels()
		})
	});
}
/**
* 本版变更最多显示几条
*
* 这页走单图（没开 multiPage），所以不会被分片，但也就没人替它兜底：不设限的话
* 一个大版本二十几条能把图拉到近 6000px，而 index.ts 的 SCALE 注释里记着，
* 过高的图不少 QQ 适配器会拒发或压成马赛克。12 条时出图 4135px，仍在能发的量级，
* 也覆盖了目前所有已发布版本的实际条目数（最多的 2.0.0 是 11 条）。
*/
const CHANGE_LIMIT = 12;
/** 按 CHANGE_LIMIT 裁剪变更条目，超出的在末尾留一句说明 */
function trimChanges(r) {
	if (!r) return null;
	let left = CHANGE_LIMIT;
	const groups = [];
	let dropped = 0;
	for (const g of r.groups) {
		if (left <= 0) {
			dropped += g.items.length;
			continue;
		}
		const items = g.items.slice(0, left);
		dropped += g.items.length - items.length;
		left -= items.length;
		groups.push({
			...g,
			items
		});
	}
	if (dropped > 0 && groups.length) groups[groups.length - 1].items.push(`…另有 ${dropped} 条，详见 CHANGELOG.md`);
	return {
		...r,
		groups
	};
}
/**
* 渲染关于页（#早柚版本）
*
* 与 #早柚更新日志 的分工：那条命令答「代码更新到哪了」（git 提交列表，按提交），
* 这条答「我是谁、跑在什么环境上、这版改了什么」（CHANGELOG.md，按发布）。
* 两者数据源不同，所以这里不列任何 git 提交信息。
*/
async function renderAbout() {
	const { total, online } = collect();
	const fv = frameVersion();
	const sys = sysInfo();
	const missing = missingBotApis();
	const fwd = forwardMode();
	return render({
		name: "about",
		title: "早柚核心适配器 版本信息",
		view: (palette) => About({
			title: PluginName,
			version,
			palette,
			time: stamp(),
			logo: imageDataUri(PLUGIN_LOGO),
			desc: "插件、框架与本地宿主的精简诊断快照",
			release: releaseType(),
			rows: [
				{
					key: "操作系统",
					value: sys.os,
					sub: `${sys.platform} · ${sys.arch}`
				},
				{
					key: "运行框架",
					value: fv ? `${frameName()} v${fv}` : frameName(),
					sub: "按 Bot.uin 的形状判定：TRSS 存数组，喵崽继承 ICQQ 存单个数字"
				},
				{
					key: "Node.js 版本",
					value: `v${nodeVersion()}`,
					mono: true,
					sub: `V8 ${process.versions.v8}`
				},
				{
					key: "运行模式",
					value: config.mode || "off",
					mono: true,
					sub: config.mode === "off" ? "适配器未启用，用 #早柚设置 mode=client 开启" : "云崽作为 ws 客户端主动连接核心"
				},
				{
					key: "处理器",
					value: sys.cpuModel,
					sub: `${sys.cpuCores} 核心`
				},
				{
					key: "运行时长",
					value: sys.processUptime,
					sub: `系统已运行 ${sys.systemUptime}`
				},
				{
					key: "合并转发",
					value: fwd === "native" ? "框架原生" : fwd === "target" ? "群/好友接口" : "不可用",
					sub: "核心下发合并转发时走哪条路径"
				},
				{
					key: "框架能力",
					value: missing.length ? `缺少 ${missing.join("、")}` : "齐全",
					sub: missing.includes("fileToUrl") ? "无文件外链服务，超过 media_max_size 的大文件由插件内置服务代发" : "Bot 上所需的工具方法均可用"
				},
				{
					key: "已配置连接",
					value: `${total} 个`,
					sub: `${online} 个在线 · 详情见 #早柚连接列表`
				}
			],
			memory: {
				percent: sys.memoryPercent,
				used: sys.usedMemory,
				total: sys.totalMemory
			},
			glance: [
				{
					key: "LINKS",
					value: `${online}/${total}`
				},
				{
					key: "MEMORY",
					value: `${sys.memoryPercent}%`
				},
				{
					key: "UPTIME",
					value: sys.processUptime
				}
			],
			changes: trimChanges(currentRelease(version$1)),
			links: [
				{
					key: "License",
					value: "GPL-3.0-only"
				},
				{
					key: "Repo",
					value: "github.com/fanxiaocuo/gscore-adapter"
				},
				{
					key: "Core",
					value: "github.com/Genshin-bots/gsuid_core"
				},
				{
					key: "Docs",
					value: "docs.sayu-bot.com/LinkBots/AdapterList.html"
				}
			]
		})
	});
}
/**
* 渲染更新日志图
*
* 两种语境共用一张版式：
*   - 有新提交（info.hasUpdate）：列远端比本地多的那些，语气是「可以更新了」
*   - 已最新：列本地最近的提交，等价于本体 #更新日志 的内容
* 判定哪种由调用方给的 info 决定，本函数只负责排版。
*
* @param info checkUpdate() 的结果
* @param local 已最新时用来填充列表的本地提交
*/
async function renderChangelog(info, local = []) {
	const has = info.hasUpdate;
	const commits = has ? info.commits : local;
	return render({
		name: "changelog",
		title: has ? "早柚核心适配器 有新版本" : "早柚核心适配器 更新日志",
		multiPage: true,
		view: (palette) => Changelog({
			title: PluginName,
			version,
			heading: has ? "UPDATE" : "CHANGELOG",
			ghost: has ? "UPDATE" : "CHANGES",
			led: has ? "warn" : "on",
			rightKey: has ? "BEHIND" : "LOCAL",
			rightValue: has ? `${info.behind} commits` : info.local || "unknown",
			palette,
			time: stamp(),
			commits,
			summary: [
				{
					key: "STATUS",
					value: has ? "OUTDATED" : "LATEST",
					sub: has ? "有新提交" : "已是最新"
				},
				{
					key: "BEHIND",
					value: String(info.behind),
					sub: "落后提交数"
				},
				{
					key: "LOCAL",
					value: info.local || "-",
					sub: "本地 HEAD"
				},
				{
					key: "TRACKING",
					value: info.ref || "-",
					sub: "跟踪分支"
				}
			],
			emptyTitle: has ? "有新提交" : "暂无提交记录",
			emptyTip: has ? `本地落后 ${info.behind} 个提交，但读取日志失败\n用 #早柚更新 直接拉取` : "插件目录可能不是 git 仓库，或仓库还没有任何提交",
			notice: info.error || void 0
		})
	});
}

//#endregion
//#region src/apps/admin.ts
/** 关闭状态下不热启动连接 */
function clientMode() {
	return config.mode !== "off";
}
/** 单条连接的字段，由 #早柚添加连接 / #早柚修改连接 消费 */
const CONNECTION_KEYS = [
	"name",
	"url",
	"token",
	"bot_id",
	"enable",
	"reconnect_interval",
	"max_reconnect_attempts"
];
/** 全局字段，由 #早柚设置 消费 */
const GLOBAL_KEYS = [
	"mode",
	"only_reply_at",
	"notify_master",
	"media_max_size",
	"update_check"
];
/**
* 可用的 key=value 选项名。限定白名单，否则 ws://host 里的 "ws:" 会被当成 key。
* 两类合在一起解析，各命令再挑自己认的那部分——这样用错命令时能给出
* 指向性提示，而不是笼统的"未知项"。
*/
const KV_KEYS = [...CONNECTION_KEYS, ...GLOBAL_KEYS];
const KV_RE = new RegExp(`^(${KV_KEYS.join("|")})[=:：](.*)$`, "i");
/** 从命令里解析 key=value，支持中英文冒号/等号 */
function parseKV(text) {
	const out = {};
	for (const seg of text.split(/[\s,，]+/)) {
		if (!seg) continue;
		const m = seg.match(KV_RE);
		if (m) out[m[1].toLowerCase()] = m[2];
	}
	return out;
}
/** 是否为 key=value 片段（用于把剩下的那个片段认作地址） */
function isKV(seg) {
	return KV_RE.test(seg);
}
function normalizeUrl(url) {
	if (!url) return "";
	url = url.trim();
	if (!/^wss?:\/\//i.test(url)) url = `ws://${url}`;
	try {
		const u = new URL(url);
		if (u.pathname === "/" || u.pathname === "") u.pathname = "/ws/Yunzai";
		return u.toString();
	} catch {
		return url;
	}
}
var GsCoreAdmin = class extends plugin {
	constructor() {
		super({
			name: "早柚核心连接管理",
			dsc: "命令式增删改查早柚核心 ws 连接",
			event: "message",
			priority: 500,
			rule: [
				{
					reg: "^#?早柚(核心)?(添加|新增)连接\\s*(.+)$",
					fnc: "add",
					permission: "master"
				},
				{
					reg: "^#?早柚(核心)?(删除|移除)连接\\s*(.+)$",
					fnc: "del",
					permission: "master"
				},
				{
					reg: "^#?早柚(核心)?连接列表$",
					fnc: "list",
					permission: "master"
				},
				{
					reg: "^#?早柚(核心)?(开启|启用)连接\\s*(.+)$",
					fnc: "enable",
					permission: "master"
				},
				{
					reg: "^#?早柚(核心)?(关闭|停用)连接\\s*(.+)$",
					fnc: "disable",
					permission: "master"
				},
				{
					reg: "^#?早柚(核心)?设置\\s*(.+)$",
					fnc: "set",
					permission: "master"
				},
				{
					reg: "^#?早柚(核心)?帮助$",
					fnc: "help",
					permission: "master"
				}
			]
		});
	}
	/**
	* 帮助
	*
	* 优先出图；渲染失败（没装 Chromium、截图超时等）回落纯文本。
	* 两者同源于 render/commands.ts 的 HELP_GROUPS，不会出现图文不一致。
	*/
	async help(e) {
		const img = await renderHelp();
		return e.reply(img || helpText());
	}
	/** 按名字或 1 起的序号定位连接 */
	find(key) {
		const list = getConnections();
		key = String(key).trim();
		const idx = Number(key);
		if (Number.isInteger(idx) && idx >= 1 && idx <= list.length) return {
			index: idx - 1,
			conf: list[idx - 1]
		};
		const i = list.findIndex((c) => c.name === key);
		return i > -1 ? {
			index: i,
			conf: list[i]
		} : null;
	}
	async add(e) {
		const raw = e.msg.replace(/^#?早柚(核心)?(添加|新增)连接\s*/, "").trim();
		if (!raw) return e.reply("用法：#早柚添加连接 <地址> [name=x] [token=x]\n详见 #早柚帮助");
		const kv = parseKV(raw);
		const urlPart = raw.split(/[\s,，]+/).find((s) => s && !isKV(s));
		const url = normalizeUrl(kv.url || urlPart);
		if (!url) return e.reply("没解析出地址，用法：#早柚添加连接 ws://127.0.0.1:8765/ws/Yunzai");
		const list = getConnections();
		if (list.some((c) => c.url === url)) return e.reply(`该地址已存在：${url}`);
		let name = kv.name || `core${list.length + 1}`;
		if (list.some((c) => c.name === name)) name = `${name}-${Date.now().toString(36).slice(-4)}`;
		const conf = {
			name,
			url,
			token: kv.token || null,
			bot_id: kv.bot_id || null,
			enable: true,
			reconnect_interval: Number(kv.reconnect_interval) || 5,
			max_reconnect_attempts: Number(kv.max_reconnect_attempts) || 0,
			bind: [],
			exclude: []
		};
		try {
			saveConfig((doc) => {
				if (!doc.hasIn(["client", "connections"])) doc.setIn(["client", "connections"], []);
				doc.getIn(["client", "connections"]).add(doc.createNode(conf));
			});
		} catch (err) {
			makeLog("error", ["写入配置失败", err], "GsCore");
			return e.reply(`保存失败：${err.message}`);
		}
		const started = clientMode() ? startClient(conf) : null;
		return e.reply(`已添加连接 ${name}\n地址：${url}\n` + (started ? "已开始连接，稍后可用 #早柚状态 查看" : clientMode() ? "配置已保存，可用 #早柚重连 启动" : `当前模式为 ${config.mode}，未启用客户端。改 #早柚设置 mode=client 后重启生效`));
	}
	async del(e) {
		const key = e.msg.replace(/^#?早柚(核心)?(删除|移除)连接\s*/, "").trim();
		const hit = this.find(key);
		if (!hit) return e.reply(`找不到连接「${key}」，用 #早柚连接列表 查看`);
		try {
			saveConfig((doc) => doc.deleteIn([
				"client",
				"connections",
				hit.index
			]));
		} catch (err) {
			return e.reply(`保存失败：${err.message}`);
		}
		stopClient(hit.conf.name);
		return e.reply(`已删除连接 ${hit.conf.name}（${hit.conf.url}）`);
	}
	async list(e) {
		const img = await renderList();
		if (img) return e.reply(img);
		const list = getConnections();
		if (!list.length) return e.reply("还没有配置任何连接\n用 #早柚添加连接 <地址> 添加");
		const msg = [`早柚核心连接（共 ${list.length} 个）  模式：${config.mode}`];
		list.forEach((c, i) => {
			const live = clients.find((x) => x.name === c.name);
			const state = c.enable === false ? "已停用" : STATUS_TEXT[live?.status ?? 0] || "未启动";
			msg.push(`\n\n${i + 1}. ${c.name}  [${state}]\n   ${c.url}` + (c.token ? "\n   token: 已设置" : "") + (c.bot_id ? `\n   bot_id: ${c.bot_id}` : "") + (live?.retry ? `\n   已重连 ${live.retry} 次` : ""));
		});
		return e.reply(msg.join(""));
	}
	async enable(e) {
		return this.toggle(e, true);
	}
	async disable(e) {
		return this.toggle(e, false);
	}
	async toggle(e, on) {
		const key = e.msg.replace(/^#?早柚(核心)?(开启|启用|关闭|停用)连接\s*/, "").trim();
		const hit = this.find(key);
		if (!hit) return e.reply(`找不到连接「${key}」，用 #早柚连接列表 查看`);
		try {
			saveConfig((doc) => doc.setIn([
				"client",
				"connections",
				hit.index,
				"enable"
			], on));
		} catch (err) {
			return e.reply(`保存失败：${err.message}`);
		}
		if (on) {
			if (!clientMode()) return e.reply(`已启用连接 ${hit.conf.name}\n但当前模式为 ${config.mode}，客户端未运行`);
			startClient({
				...hit.conf,
				enable: true
			});
			return e.reply(`已启用连接 ${hit.conf.name}，正在连接`);
		}
		stopClient(hit.conf.name);
		return e.reply(`已停用连接 ${hit.conf.name}`);
	}
	async set(e) {
		const kv = parseKV(e.msg.replace(/^#?早柚(核心)?设置\s*/, "").trim());
		if (!Object.keys(kv).length) return e.reply(`用法：#早柚设置 mode=client\n可设：${GLOBAL_KEYS.join(" / ")}`);
		const done = [];
		const errs = [];
		try {
			saveConfig((doc) => {
				for (const [k, v] of Object.entries(kv)) switch (k) {
					case "mode":
						if (!["client", "off"].includes(v)) {
							errs.push(`mode 只能是 client/off，收到 ${v}`);
							break;
						}
						doc.setIn(["mode"], v);
						done.push(`mode = ${v}（需重启生效）`);
						break;
					case "only_reply_at":
						doc.setIn(["filter", "only_reply_at"], v === "true");
						done.push(`only_reply_at = ${v === "true"}`);
						break;
					case "notify_master":
						doc.setIn(["notify_master"], v === "true");
						done.push(`notify_master = ${v === "true"}`);
						break;
					case "update_check":
						doc.setIn(["update_check", "enable"], v === "true");
						done.push(`update_check = ${v === "true"}`);
						break;
					case "media_max_size": {
						const n = Number(v);
						if (!n || n < 1024) {
							errs.push(`media_max_size 需为大于 1024 的数字，收到 ${v}`);
							break;
						}
						doc.setIn(["media_max_size"], n);
						done.push(`media_max_size = ${n}`);
						break;
					}
					default: if (CONNECTION_KEYS.includes(k)) errs.push(`${k} 是连接级配置，请用 #早柚添加连接 或 #早柚修改连接`);
					else errs.push(`未知项 ${k}，可设置：${GLOBAL_KEYS.join(" / ")}`);
				}
			});
		} catch (err) {
			return e.reply(`保存失败：${err.message}`);
		}
		return e.reply([done.length ? `已设置：\n${done.join("\n")}` : "", errs.length ? `\n失败：\n${errs.join("\n")}` : ""].join("").trim() || "没有任何改动");
	}
};

//#endregion
//#region src/apps/status.ts
var GsCoreStatus = class extends plugin {
	constructor() {
		super({
			name: "早柚核心适配器",
			dsc: "gscore-adapter 状态与重连",
			event: "message",
			priority: 500,
			rule: [
				{
					reg: "^#?早柚(核心)?状态$",
					fnc: "status",
					permission: "master"
				},
				{
					reg: "^#?早柚(核心)?重连$",
					fnc: "reconnect",
					permission: "master"
				},
				{
					reg: "^#?早柚(核心)?清空统计$",
					fnc: "resetStats",
					permission: "master"
				},
				{
					reg: "^#?早柚(核心)?(适配器)?版本(信息)?$",
					fnc: "about",
					permission: "master"
				}
			]
		});
	}
	async about(e) {
		const img = await renderAbout();
		if (img) return e.reply(img);
		const sys = sysInfo();
		await e.reply([
			`早柚核心适配器 ${versionLabel()}（${releaseLabel()}${branch ? ` @${branch}` : ""}）`,
			`操作系统：${sys.os}（${sys.platform} ${sys.arch}）`,
			`运行框架：${frameLabel()}`,
			`Node 版本：v${nodeVersion()}`,
			`运行模式：${config.mode || "off"}`,
			`处理器：${sys.cpuModel}（${sys.cpuCores} 核心）`,
			`内存占用：${sys.memoryPercent}%（${sys.usedMemory} / ${sys.totalMemory}）`,
			`运行时长：${sys.processUptime}`,
			`已配置连接：${clients.length} 个`
		].join("\n"));
	}
	async status(e) {
		const img = await renderStatus();
		if (img) return e.reply(img);
		const s = snapshot();
		const msg = [`早柚核心适配器\n运行模式：${config.mode}`];
		if (config.mode !== "off") {
			if (!clients.length) msg.push("\n连接：无");
			else {
				msg.push("\n连接：");
				for (const c of clients) {
					const n = forName(c.name);
					msg.push(`\n  ${c.name}：${c.statusText}（↑${n.up + n.event} ↓${n.down}）`);
				}
			}
			msg.push(`\n今日中转：上行 ${s.today.up + s.today.event}，下行 ${s.today.down}`, `\n累计中转：上行 ${s.total.up + s.total.event}，下行 ${s.total.down}${s.persisted ? "" : "（本次运行）"}`);
		}
		await e.reply(msg.join(""));
	}
	async reconnect(e) {
		if (!clients.length) return e.reply("没有可重连的客户端连接");
		for (const c of clients) c.restart();
		await e.reply(`已触发 ${clients.length} 个连接重连`);
	}
	async resetStats(e) {
		const s = snapshot();
		try {
			await resetStats();
		} catch (err) {
			makeLog("error", ["清空中转计数失败", err], "GsCore");
			return e.reply("清空统计失败，详见日志");
		}
		await e.reply(`已清空中转统计（原累计：上行 ${s.total.up + s.total.event}，下行 ${s.total.down}）`);
	}
};

//#endregion
//#region src/modules/update/git.ts
/**
* git 查询
*
* 为什么不用本体的 Update.exec
* ----------------------------
* plugins/other/update.js 的 exec() 调的是 Bot.exec（update.js:37-39），
* 而 Bot.exec 只有 TRSS 有——本 fork 的 lib/bot.js 里没有这个方法
* （只有内部的 util.exec）。utils/compat.ts 定的规矩是「按能力探测，不按框架名
* 分支」，但这里连探测都不必：child_process 是 Node 内置，两边都在，
* 直接用它比垫一层再退回来简单。
*
* 为什么不复用本体的 getLog()
* ---------------------------
* 本体那个（update.js:226-251）末尾直接 Bot.makeForwardArray()，返回的是
* 拼好的转发消息而不是数据，拿不到 hash / 时间 / 标题分开的字段，没法排版成图。
* 所以这里自己跑一遍同样的 git log，但保留结构化结果。
* 取数命令与本体保持一致（同样的 --pretty/--date），行为不会分叉。
*/
/** git 子命令超时。拉远端要走网络，给宽一点；本地查询很快，用不满 */
const TIMEOUT = 6e4;
/**
* 在插件目录执行 git
*
* 用 execFile 而不是 exec：exec 会把整条命令交给 shell 拼接，
* 参数里只要有空格或引号就可能被重新解析（提交标题里这两样都很常见）。
* execFile 直接传 argv，不经过 shell。
*/
function git(args) {
	return new Promise((resolve) => {
		execFile("git", args, {
			cwd: PluginPath,
			timeout: TIMEOUT,
			maxBuffer: 10485760,
			windowsHide: true
		}, (error, stdout, stderr) => {
			resolve({
				ok: !error,
				out: String(stdout || "").trim(),
				err: String(stderr || error?.message || "").trim()
			});
		});
	});
}
/** 插件目录是不是一个 git 仓库（压缩包安装的没有 .git，所有更新功能都该跳过） */
async function isRepo() {
	return (await git(["rev-parse", "--is-inside-work-tree"])).out === "true";
}
/** 当前分支名 */
async function currentBranch() {
	return (await git(["branch", "--show-current"])).out;
}
/**
* 当前分支跟踪的远端引用，如 origin/main
*
* 与本体 getRemoteBranch() 同样的思路：从 git config 读实际配置，
* 而不是假定 origin/<当前分支>——改过 remote 名或跟踪分支的仓库会算错。
*/
async function upstream() {
	const branch = await currentBranch();
	if (!branch) return "";
	const remote = (await git(["config", `branch.${branch}.remote`])).out;
	if (!remote) return "";
	return `${remote}/${branch}`;
}
/** 本地 HEAD 短 hash */
async function localCommit() {
	return (await git([
		"rev-parse",
		"--short",
		"HEAD"
	])).out;
}
/**
* 拉取远端信息但不改工作区
*
* 只有 fetch 过，远端引用才是新的；否则下面的比较永远是「已最新」。
* 用 fetch 而不是 pull：检查更新不该动用户的工作区。
*/
async function fetch$1() {
	const r = await git(["fetch", "--quiet"]);
	return {
		ok: r.ok,
		err: r.err
	};
}
/**
* 本地落后远端多少个提交
*
* rev-list --count A..B = B 有而 A 没有的提交数，
* 即「远端比本地多几个」。0 就是已最新。
*/
async function behind(ref) {
	const r = await git([
		"rev-list",
		"--count",
		`HEAD..${ref}`
	]);
	const n = Number(r.out);
	return Number.isFinite(n) ? n : 0;
}
/**
* 读提交记录
*
* @param range 传 "HEAD..origin/main" 取未拉取的新提交；留空取本地已有的
* @param limit 最多几条
*
* 分隔符用 \x1f（ASCII 单元分隔符）而不是本体的 "||"：提交标题里出现
* 「||」虽然少见但完全合法，真出现就会把标题截断。\x1f 不可能出现在标题里。
*/
async function log(range, limit = 30) {
	const args = [
		"log",
		`-${limit}`,
		"--pretty=%h%cd%s",
		"--date=format:%F %T"
	];
	if (range) args.push(range);
	const r = await git(args);
	if (!r.ok || !r.out) return [];
	const list = [];
	for (const line of r.out.split("\n")) {
		const [hash, date, ...rest] = line.split("");
		const subject = rest.join("");
		if (!hash || !subject) continue;
		if (subject.startsWith("Merge branch") || subject.startsWith("Merge pull request")) continue;
		list.push({
			hash,
			date,
			subject
		});
	}
	return list;
}
/**
* 检查远端是否有新提交
*
* @param doFetch 是否先 fetch。定时任务要，纯看日志不用
*/
async function checkUpdate(doFetch = true) {
	const empty = {
		hasUpdate: false,
		behind: 0,
		local: "",
		ref: "",
		commits: [],
		error: ""
	};
	if (!await isRepo()) return {
		...empty,
		error: "插件目录不是 git 仓库，无法检查更新"
	};
	if (doFetch) {
		const f = await fetch$1();
		if (!f.ok) return {
			...empty,
			local: await localCommit(),
			error: `拉取远端失败：${f.err}`
		};
	}
	const ref = await upstream();
	if (!ref) return {
		...empty,
		local: await localCommit(),
		error: "当前分支没有跟踪的远端分支"
	};
	const n = await behind(ref);
	return {
		hasUpdate: n > 0,
		behind: n,
		local: await localCommit(),
		ref,
		commits: n > 0 ? await log(`HEAD..${ref}`, 30) : [],
		error: ""
	};
}

//#endregion
//#region src/modules/update/check.ts
/**
* 更新检查：手动指令与定时任务共用的一层
*
* 移植自 karin-plugin-kkk 的 kkk-更新检测（packages/core/src/apps/update.ts），
* 保留了它三个关键设计：
*   1. 检查与更新分离——只通知，不自动 git pull。自动更新会在用户不知情时
*      改动代码并重启，出问题很难回溯
*   2. 版本锁：同一个版本只播报一次，否则每个周期都会私聊主人一遍
*   3. 首次检查延迟：错开启动高峰
*
* 两处按本仓库改写：
*   - 判定方式：kkk 比 npm registry 上的 semver，本插件是 git 安装、没有发布
*     版本号，改比「本地 HEAD 落后跟踪分支几个提交」（见 git.ts）
*   - 锁的存储：kkk 用 redis 存 UPDATE_LOCK_KEY。这里用进程内变量——锁只需要
*     防「同一次运行里反复播报」，重启后本就该重新播报一次（用户可能正是重启
*     后才想知道有没有更新）。少一个外部依赖，也不会在 redis 里留垃圾键。
*/
/** 已播报过的版本标记，值为「本地 HEAD + 远端落后数」 */
let announced = "";
/** 上次真正跑检查的时刻，用于把固定 cron 节流成配置里的间隔 */
let lastRun = 0;
/** 纯文本回退：渲染失败或没有 puppeteer 时用 */
function changelogText(info, local = []) {
	const commits = info.hasUpdate ? info.commits : local;
	const out = [];
	if (info.hasUpdate) out.push(`早柚核心适配器有新版本，落后 ${info.behind} 个提交`);
	else out.push("早柚核心适配器已是最新");
	if (info.local) out.push(`本地：${info.local}`);
	if (info.ref) out.push(`跟踪：${info.ref}`);
	if (info.error) out.push(`注意：${info.error}`);
	if (commits.length) {
		out.push("", info.hasUpdate ? "新提交：" : "最近提交：");
		for (const c of commits.slice(0, 10)) out.push(`${c.hash} [${c.date}] ${c.subject}`);
		if (commits.length > 10) out.push(`…… 其余 ${commits.length - 10} 条见 #早柚更新日志`);
	}
	if (info.hasUpdate) out.push("", "用 #早柚更新 拉取");
	return out.join("\n");
}
/**
* 取更新日志的消息（图优先，失败回退文本）
*
* @param doFetch 是否先 fetch 远端
*/
async function changelogMsg(doFetch) {
	const info = await checkUpdate(doFetch);
	const local = info.hasUpdate ? [] : await log("", 20);
	let msg = false;
	try {
		msg = await renderChangelog(info, local);
	} catch (err) {
		makeLog("error", ["渲染更新日志失败", err], "GsCore");
	}
	return {
		info,
		msg: msg || changelogText(info, local)
	};
}
/** 跑一次检查，有新提交且开了 notify 就私聊主人 */
async function runCheck() {
	const info = await checkUpdate(true);
	if (info.error) {
		makeLog("debug", `更新检查：${info.error}`, "GsCore");
		return info;
	}
	if (!info.hasUpdate) {
		makeLog("debug", "更新检查：已是最新", "GsCore");
		return info;
	}
	const tag = `${info.local}-${info.behind}`;
	if (tag === announced) {
		makeLog("debug", `更新检查：${tag} 已播报过，跳过`, "GsCore");
		return info;
	}
	announced = tag;
	makeLog("mark", `插件有新提交（落后 ${info.behind} 个）`, "GsCore");
	if (config.update_check?.notify === false) return info;
	let msg = false;
	try {
		msg = await renderChangelog(info);
	} catch (err) {
		makeLog("error", ["渲染更新日志失败", err], "GsCore");
	}
	try {
		const ret = Bot.sendMasterMsg?.(msg || changelogText(info));
		if (ret?.catch) ret.catch(() => {});
	} catch {}
	return info;
}
/** 进程启动时刻，用来实现「启动后 delay 分钟才做第一次检查」 */
const bootAt = Date.now();
/**
* 定时任务回调，交给本体的 task 机制按 cron 调用
*
* 为什么用本体 task 而不是自己 setInterval：
* 本体 loader 已经用 node-schedule 管定时任务了（lib/plugins/loader.js:537-551），
* 顺带把开始/结束日志和异常兜底都做了（startTask，同文件 516-534），
* 并且会计入启动时的「加载定时任务[N个]」——用户能看见它存在。
* 自己搓 setInterval 就是把这些重写一遍，还会因为 setInterval 不对齐时钟而漂移。
*
* 为什么 cron 写死每 5 分钟、间隔在函数里判：
* collectTask 只在插件实例化时读一次 plugin.task（loader.js:143 + 507-514），
* cron 字符串之后改不动。所以固定一个高频 tick，真正的节流用 lastRun 比时间差，
* 这样配置改了间隔无需重启即刻生效。
*/
async function tick() {
	const conf = config.update_check;
	if (!conf?.enable) return;
	const now = Date.now();
	const interval = Math.max(30, Number(conf.interval) || 180) * 6e4;
	const delay = Math.max(0, Number(conf.delay) || 0) * 6e4;
	if (now - bootAt < delay) return;
	if (lastRun && now - lastRun < interval) return;
	lastRun = now;
	await runCheck();
}

//#endregion
//#region src/apps/update.ts
/**
* 插件更新
*
* 参照 df-plugin（src/apps/update.ts）的做法：**不自己实现 git 更新**，
* 而是改写 e.msg 后转调云崽本体的 plugins/other/update.js。
*
* 本体那套已经处理了自己写一遍很难覆盖全的部分：
*   - 强制更新前用 getRemoteBranch() 解析真实远端分支，而不是假定 origin/<当前分支>
*   - package.json 有变动时自动重装依赖（updatePackage）
*   - 更新成功后自动重启（Restart），并有 uping 全局锁
*   - gitErr 对超时/连接失败/冲突分别给出可照做的提示
* 自己维护一份只会与本体的行为逐渐分叉。
*
* 契约（plugins/other/update.js）：
*   - getPlugin() 把 "#(安静)?(强制)?更新(日志)?" 前缀剥掉，余下部分当插件目录名，
*     并要求 plugins/<name>/.git 存在（第 92 行），所以要拼成 "#更新gscore-adapter"
*   - update() 首行判 this.e.isMaster，故 e 必须是原事件（带 isMaster），不能自造
*
* 与 df-plugin 的差异：它用相对路径 import 本体插件，本插件改用 YunzaiPath
* 拼绝对路径（理由见 run() 内注释）。
*
* 更新日志例外
* ------------
* "#更新日志" 不转调本体：本体 getLog() 末尾直接 Bot.makeForwardArray()，
* 返回的是拼好的转发消息而非数据，拿不到 hash/时间/标题分开的字段，没法排版成图。
* 所以这一条走本插件自己的 modules/update（理由详见 modules/update/git.ts 头注释）。
*/
var GsCoreUpdate = class extends plugin {
	constructor() {
		super({
			name: "早柚核心适配器更新",
			dsc: "更新 gscore-adapter",
			event: "message",
			priority: 500,
			rule: [
				{
					reg: "^#?早柚(核心)?(适配器)?(强制)?更新$",
					fnc: "update",
					permission: "master"
				},
				{
					reg: "^#?早柚(核心)?(适配器)?更新日志$",
					fnc: "updateLog",
					permission: "master"
				},
				{
					reg: "^#?早柚(核心)?(适配器)?检查更新$",
					fnc: "checkUpdate",
					permission: "master"
				}
			],
			/**
			* 定时更新检查，交给本体的 task 机制（node-schedule）
			*
			* cron 固定每 5 分钟触发，真正的间隔与开关在 tick() 内按配置判——
			* 本体只在插件实例化时读一次 task（loader.js:143），cron 之后改不动，
			* 而这样写改配置就能即刻生效。tick() 没开启用时直接 return，开销可忽略。
			*
			* log: false —— 每 5 分钟一条「开始处理/完成」会把日志刷满，
			* 真正有意义的事件（发现新提交）tick 内部自己打 mark 级日志。
			*/
			task: {
				name: "早柚适配器更新检查",
				cron: "0 */5 * * * *",
				fnc: () => tick(),
				log: false
			}
		});
	}
	async update(e) {
		return this.run(e, e.msg.includes("强制") ? "#强制更新" : "#更新");
	}
	/**
	* 更新日志
	*
	* 不 fetch：只看本地已有的记录，是「刚更新完想知道改了什么」的场景，
	* 不该为此产生一次网络请求。想知道远端有没有新东西用 #早柚检查更新。
	*/
	async updateLog(e) {
		const { msg } = await changelogMsg(false);
		return e.reply(msg);
	}
	/** 检查远端有无新提交（会 fetch） */
	async checkUpdate(e) {
		await e.reply("正在检查更新……");
		const { msg } = await changelogMsg(true);
		return e.reply(msg);
	}
	/**
	* 转调本体的更新插件
	*
	* 改的是 e.msg 而不是 this.e.msg —— 本体读的是它自己实例上的 e。
	* 用完恢复原值：同一个事件对象后面还会流经其他插件，改坏了会影响它们的匹配。
	*/
	async run(e, type) {
		let Update;
		try {
			const url = pathToFileURL(join(YunzaiPath, "plugins/other/update.js")).href;
			({update: Update} = await import(url));
		} catch (err) {
			makeLog("error", ["加载本体更新插件失败", err], "GsCore");
			return e.reply(`无法调用本体更新功能，请手动在插件目录执行 git pull：\n${PluginPath}`);
		}
		const raw = e.msg;
		e.msg = type + PluginName;
		try {
			const up = new Update();
			up.e = e;
			return type === "#更新日志" ? await up.updateLog() : await up.update();
		} finally {
			e.msg = raw;
		}
	}
};

//#endregion
//#region src/modules/loader/index.ts
/**
* 应用加载器
*
* 把 src/apps/ 下的插件 class 收集进 apps 表，交给 index.ts 导出给框架。
*
* 为什么是静态 import 而不是扫目录
* ------------------------------
* 原先这里 readdir 遍历 lib/apps/*.js 再逐个动态 import。打包之后 lib/ 只剩
* 一个 index.js，那个目录根本不存在，扫出来是空表——三个指令会全部静默失效
* （框架只读 apps 对象，不会报错，见 Miao-Yunzai 的 lib/plugins/loader.js）。
*
* 换成静态 import 还顺带修掉了两个隐患：打包器能看见依赖关系（动态路径它看不
* 见，会把 apps 整块从产物里摇掉）；新增 app 忘了注册的话 tsc 立刻报，而不是
* 等到运行时发现指令没反应。代价是加一个 app 要多改这一行，可以接受——三个。
*/
/**
* 载入全部应用
*
* 保持 async 与 `{ apps }` 的返回形状不变：index.ts 是 `await loadApps()`，
* 改成同步会连带改动导出时序，收益为零。
*/
async function loadApps() {
	const apps = {
		GsCoreAdmin,
		GsCoreStatus,
		GsCoreUpdate
	};
	logger.info(`[${PluginName}] 应用加载完成：${Object.keys(apps).length} 个`);
	return { apps };
}

//#endregion
//#region src/modules/conflict/index.ts
/**
* 重复上报检测
*
* 云崽侧可能同时存在多个"往早柚核心上报"的实现，它们互相看不见对方，
* 于是同一条消息被上报两次，核心侧插件回两遍。
*
* 本模块只**告警**，不改别人的配置、不禁用别人的功能 ——
* 用户装了什么是用户的决定，插件越界改动会更难排查。
*
* 已知的两类来源：
*
* 1. ws-plugin 的 `servers[].type == 3`
*    其 apps/message/message.js 的 switch 里 case 3 走 makeGSUidReportMsg，
*    即早柚核心方向。type 1/2/6 是 OneBot、其余非早柚，不算冲突。
*    注意读的是 config/config/ws-config.yaml（运行时配置），
*    不是 config/default_config/ 下的出厂默认值。
*
* 2. 框架自带的 plugins/adapter/GSUIDCore.js
*    面向旧版核心（等核心来连云崽），装着通常收不到东西，
*    但它注册的 adapter 会让回环判断与账号绑定变复杂，仍值得提示。
*
* 检测失败一律静默：这只是个提示，不该因为读不到别人的文件而刷错误日志。
*/
/** ws-plugin 中代表早柚核心方向的连接类型 */
const GSUID_TYPE = 3;
/** 有 gsuid 连接的 ws-plugin 目录名（插件可能被改名，按 ws-config.yaml 存在与否判断） */
function findWsPluginConfigs() {
	const pluginsDir = path.join(YunzaiPath, "plugins");
	let names = [];
	try {
		names = fs.readdirSync(pluginsDir);
	} catch {
		return [];
	}
	const found = [];
	for (const name of names) {
		const file = path.join(pluginsDir, name, "config", "config", "ws-config.yaml");
		if (fs.existsSync(file)) found.push({
			dir: name,
			file
		});
	}
	return found;
}
/** 读出某个 ws-config.yaml 里所有早柚方向的连接名 */
function gsuidServers(file) {
	let doc;
	try {
		doc = YAML.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return [];
	}
	const servers = doc?.servers;
	if (!Array.isArray(servers)) return [];
	return servers.filter((s) => s && Number(s.type) === GSUID_TYPE && s.enable !== false).map((s, i) => String(s.name || s.address || `#${i + 1}`));
}
/**
* 检查并告警。在 client 启动后调用。
*/
function checkConflicts() {
	try {
		for (const { dir, file } of findWsPluginConfigs()) {
			const names = gsuidServers(file);
			if (!names.length) continue;
			log$1("warn", `检测到 ${dir} 也配置了早柚核心连接（type: ${GSUID_TYPE}）：${names.join("、")}\n同一条消息会被上报两次，核心侧插件将回复两遍。请二选一：\n  · 保留本插件 —— 在 ${dir} 的配置里删掉这些连接，或把 enable 设为 false\n  · 保留 ${dir} —— 把本插件配置改为 mode: off`);
		}
		const builtin = path.join(YunzaiPath, "plugins", "adapter", "GSUIDCore.js");
		if (fs.existsSync(builtin)) log$1("warn", "检测到框架自带的 plugins/adapter/GSUIDCore.js。\n它面向旧版核心（等核心来连云崽），与当前核心行为已不一致，建议删除以免干扰账号绑定与回环判断。");
		checkFrameworkApis();
	} catch (err) {
		log$1("debug", ["冲突检测失败", err], void 0, true);
	}
}

//#endregion
//#region src/index.ts
/**
* 入口（真实逻辑）
*
* 由 index.js 转调，index.js 保持 .js 是因为框架 loader 只认
* plugins/<name>/index.js（lib/plugins/loader.js:55）。
*/
let mode = config.mode || "off";
if (mode === "server" || mode === "both") {
	makeLog("warn", `mode: ${mode} 已废弃（早柚核心不会主动连接云崽），已按 client 运行。请把配置改为 mode: client`, "GsCore");
	mode = "client";
}
if (mode === "client") Bot.once("online", () => {
	checkConflicts();
	startClients();
});
await initStats();
if (mode === "client") makeLog("info", "早柚核心适配器已载入", "GsCore");
else makeLog("warn", "早柚核心适配器已禁用（mode: off）", "GsCore");
const { apps } = await loadApps();

//#endregion
export { apps, configFile };
