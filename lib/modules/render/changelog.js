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
import fs from "node:fs";
import { join } from "node:path";
import { PluginPath } from "../../dir.js";
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
    return line
        // 先摘掉末尾的 ([hash](url))，它总在行尾
        .replace(/\s*\(\[[0-9a-f]+\]\([^)]*\)\)\s*$/i, "")
        // 再把剩下的行内链接压成纯文本
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\*\*/g, "")
        .trim();
}
/**
 * 解析 CHANGELOG.md
 *
 * @param limit 最多取几个版本
 *
 * 解析用逐行状态机而不是正则整段切分：整段切分要写一个跨行的 (?=^## |\z) 模式，
 * 在 CHANGELOG 里出现代码块或引用时很容易吃错边界。逐行只认三种行首，简单且可预期。
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
 * 读取本插件当前版本的变更
 *
 * @param version 期望的版本号。CHANGELOG 最新一节与它不一致时仍返回最新一节——
 *   开发中的版本（package.json 已提前 bump，release-please 还没写入 CHANGELOG）
 *   属于正常状态，此时展示上一个已发布版本比什么都不显示有用。
 *
 * 与 kkk 一样：任何失败都静默退化成 null，绝不抛错——一张图不该因为读不到
 * 变更日志就整个渲染失败。
 */
export function currentRelease(version) {
    try {
        const text = fs.readFileSync(join(PluginPath, "CHANGELOG.md"), "utf8");
        const list = parseChangelog(text, 1);
        const r = list[0];
        if (!r || !r.groups.length)
            return null;
        // 版本号对不上时标注出来，免得用户以为图上这段就是当前版本的改动
        if (version && r.version && r.version !== version)
            r.date = r.date || "";
        return r;
    }
    catch {
        return null;
    }
}
