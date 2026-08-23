import { expandConnections } from "./expand.js";
/** @description 来源下标 -> 它派生出的运行时连接数 */
function tally(runtime) {
    const counts = new Map();
    for (const conn of runtime)
        counts.set(conn.sourceIndex, (counts.get(conn.sourceIndex) ?? 0) + 1);
    return counts;
}
/**
 * @description 把第 index 条改成 next 之后会不会有连接哑掉；有则返回一句可直接回给用户的原因，没有返回 null
 * 措辞取自 expand 自己的错误（只含连接名、来源序号与 pathname，回前端也安全）；句末不带「已取消保存」，
 * 由调用方按各自语气拼。
 * 注意：`next.enable` 要传改完之后的启用状态 —— 「把停用的一条打开」正是最容易撞上别人的操作，不能跳过检查。
 * 注意：不能改用 utils/url.ts 的 findDuplicate —— 它按核心 origin 判重且「任一侧空 bind 即算重复」，
 * 对编辑会误伤（同核心上另有一条自定义路径时连改个名字都保存不了），也不看 enable。
 */
export function findRouteConflict(list, index, next) {
    if (!next.enable)
        return null;
    const base = expandConnections(list);
    const after = expandConnections(list.map((conf, i) => (i === index ? { ...conf, ...next } : conf)));
    const had = tally(base.runtime);
    const has = tally(after.runtime);
    // 自己一条都派生不出来（被别人顶掉），或别人本来能起的变少了（被自己顶掉）
    const stolen = [...had].some(([i, n]) => i !== index && (has.get(i) ?? 0) < n);
    if (has.get(index) && !stolen)
        return null;
    // 注意：按话术去重而不是按对象 —— ExpandError 每次展开都是新对象，用它做 Set 成员的话
    // 「新出现的错误」永远等于 after 的第一条，连不致命的告警都会把「只改个名字」拦掉
    const seen = new Set(base.errors.map(e => e.message));
    return (after.errors.find(e => !seen.has(e.message))?.message ?? "修改后会与另一条连接落到同一条路由上");
}
