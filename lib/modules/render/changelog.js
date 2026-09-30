/**
 * @description CHANGELOG.md 解析，给 #早柚版本 的「本版变更」用
 * 不引 markdown 运行时：只需渲染「### 分类 + * 条目」两层固定结构（release-please 格式规整），直接解析成结构化数据由 About.tsx 排版
 * 与 #早柚更新日志 分工：那条读 git 答「代码更新到哪了」，这里读 CHANGELOG.md 答「当前版本改了什么」
 */
import fs from "node:fs";
import { join } from "node:path";
import { PluginPath } from "../../dir.js";
/**
 * @description 把一条 markdown 列表项清成纯文本
 * 去掉三样：末尾 commit 链接（图上无点击价值）、`**` 粗体标记（纯文本渲染会直接显出星号）、其余 [文本](链接) 行内链接（只留文本）
 */
function clean(line) {
    return (line
        // 先摘掉末尾的 ([hash](url))，它总在行尾
        .replace(/\s*\(\[[0-9a-f]+\]\([^)]*\)\)\s*$/i, "")
        // 再把剩下的行内链接压成纯文本
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\*\*/g, "")
        .trim());
}
/**
 * @description 解析 CHANGELOG.md
 * 用逐行状态机而非正则整段切分：跨行 (?=^## |\z) 模式遇到代码块/引用容易吃错边界，逐行只认三种行首、可预期
 * @param limit 最多取几个版本
 */
export function parseChangelog(text, limit = 1) {
    const out = [];
    let cur = null;
    let group = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trimEnd();
        // 版本标题：## [2.1.0](compare-url) (2026-08-08)
        // 也兼容没有链接的 ## 2.1.0 (2026-08-08)
        const ver = /^##\s+(?:\[([^\]]+)\]\([^)]*\)|(\S+))\s*(?:\((\d{4}-\d{2}-\d{2})\))?/.exec(line);
        if (ver) {
            if (out.length >= limit)
                break;
            cur = { version: (ver[1] || ver[2] || "").replace(/^v/, ""), date: ver[3] || "", groups: [] };
            out.push(cur);
            group = null;
            continue;
        }
        if (!cur)
            continue;
        // 分类标题：### ✨ 新功能
        const sec = /^###\s+(.+)$/.exec(line);
        if (sec) {
            group = { title: clean(sec[1]), items: [] };
            cur.groups.push(group);
            continue;
        }
        // 条目：* xxx 或 - xxx。没有分类标题时（少见）挂到一个无名分类下
        const item = /^[*-]\s+(.+)$/.exec(line);
        if (item) {
            if (!group) {
                group = { title: "变更", items: [] };
                cur.groups.push(group);
            }
            const t = clean(item[1]);
            if (t)
                group.items.push(t);
        }
    }
    // 丢掉空分类：release-please 不会生成，但手改过的 CHANGELOG 可能有
    for (const r of out)
        r.groups = r.groups.filter(g => g.items.length > 0);
    return out;
}
/**
 * @description 上次解析结果，按 CHANGELOG.md 的 mtime 记账
 * 注意：不能无条件缓存 —— 文件在进程活着时会变（git pull / 切分支、#早柚更新 转调 git pull 而自动重启没成），留一次 stat 换掉 24KB 读盘 + 整份逐行解析
 */
let relCache;
/**
 * @description 读取本插件当前版本的变更；任何失败都静默退化成 null，绝不抛错（一张图不该因读不到变更日志整个渲染失败）
 * 注意：交出的是 relCache 里那个对象本身，没有防御性拷贝 —— 调用方只读（pages.ts 的 trimChanges 全程复制），别写它的字段，否则污染缓存
 * @param _version 期望的版本号，目前不参与判断：最新一节与它不一致（package.json 提前 bump、release-please 还没写入 CHANGELOG）属正常，
 *   展示上一个已发布版本比什么都不显示有用；且 About.tsx 已在「本版变更」标题旁写了这节的 v 号，与页首版本号一对照即知
 */
export function currentRelease(_version) {
    try {
        const file = join(PluginPath, "CHANGELOG.md");
        const { mtimeMs } = fs.statSync(file);
        if (!relCache || relCache.mtimeMs !== mtimeMs) {
            const r = parseChangelog(fs.readFileSync(file, "utf8"), 1)[0];
            relCache = { mtimeMs, release: r && r.groups.length ? r : null };
        }
        return relCache.release;
    }
    catch {
        return null;
    }
}
