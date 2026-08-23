/**
 * @description 账号 id 列表归一化：手写 yaml、指令与面板三种来源的 bind/exclude 收敛到同一套规则
 * 注意：本文件不 import 任何东西 —— utils/url.ts 的判重要用它，而那是连接判定的最底层。
 * 注意：黑白名单不走这里 —— guoba 的 dedupeIds 有意不 trim、也不改值类型，理由见那边。
 */
/** @description 配置账号列表归一化：字符串化、去空白、丢空项、去重且保留首次顺序 */
export function readIds(v) {
    const ids = [];
    const seen = new Set();
    for (const value of Array.isArray(v) ? v : []) {
        const id = String(value).trim();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}
