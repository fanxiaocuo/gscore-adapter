import { expandConnections } from "./expand.js";
/** 来源下标 -> 它派生出的运行时连接数 */
function tally(runtime) {
    const counts = new Map();
    for (const conn of runtime)
        counts.set(conn.sourceIndex, (counts.get(conn.sourceIndex) ?? 0) + 1);
    return counts;
}
/**
 * 把第 index 条改成 next 之后，会不会有连接哑掉
 *
 * 返回一句可以直接回给用户的原因，没问题则返回 null。措辞取自 expand 自己的错误
 * （里面只有连接名、来源序号与 pathname，没有完整地址，回前端也安全），
 * 拿不到就退回一句通用说明。句末不带「已取消保存」，由调用方按各自语气拼。
 *
 * `next.enable` 要传**改完之后**的启用状态：停用的连接不派生任何运行时连接，自然
 * 撞不上谁；而「把停用的一条打开」恰恰是最容易撞上别人的操作，不能跳过检查。
 *
 * 不用 findDuplicate：它按核心 origin 判重且「任一侧空 bind 即算重复」。对新增是
 * 对的（新连接一定是 origin 形态），对编辑会误伤 —— 同一核心上另有一条自定义路径
 * 的兼容连接时，两者路由并不相撞（路径不同，核心侧是两个客户端），它却一律判重，
 * 于是连「只改个名字」都保存不了；它也不看 enable，一条停用的连接能挡住整次编辑。
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
    // 按**话术**去重，不是按对象：ExpandError 是每次展开新建的对象，用它本身做 Set
    // 成员的话「新出现的错误」永远等于 after 的第一条 —— 连不致命的告警都会被当成
    // 冲突理由，把「只改个名字」也拦掉
    const seen = new Set(base.errors.map(e => e.message));
    return (after.errors.find(e => !seen.has(e.message))?.message ?? "修改后会与另一条连接落到同一条路由上");
}
