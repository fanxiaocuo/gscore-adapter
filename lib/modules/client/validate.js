import { readIds } from "../../utils/ids.js";
import { coreKey } from "../../utils/url.js";
import { expandConnections, requireAccounts, sourceLabel } from "./expand.js";
/**
 * @description 这条连接会不会替 account 上传事件 —— 与 GsCoreClient.accept(self_id) 同一套判据
 * 空 bind 表示「除 exclude 之外全放行」，不是「不覆盖任何账号」。
 * 注意：不能借用 utils/url.ts 的 findDuplicate —— 它把「任一侧空 bind」当双向重复，一条空 bind 兼容连接会顶掉用户想新加的每条明确绑定。
 * 注意：exclude 先判，且要与运行时真正决定「转不转发」的函数逐条对齐，而非展开器的中间结果；对不上的症状是用户照话术排掉账号、保存仍被拒。
 */
function servesAccount(conn, account) {
    if (readIds(conn.exclude).includes(account))
        return false;
    if (conn.automatic)
        return conn.account === account;
    const bind = readIds(conn.bind);
    return !bind.length || bind.includes(account);
}
/**
 * @description 同一个核心上，兼容连接与账号级自动连接覆盖了同一个账号 = 那个账号的事件上传两遍
 * 症状是同一命令执行两次、回两遍。这是唯一「两条连接都起来了」的阻塞项，展开器只按路由与名字裁决、不比较账号覆盖，算不出来，必须在这里算。
 * 注意：按核心分组（coreKey 只取协议+主机+端口），不分组会把「主核心按账号连 + 备核心用旧共享路径」误判成重复上传。
 * 注意：只拿兼容连接比自动连接。兼容 × 兼容不管（两条都是用户手写路径，无依据判该谁让路，拦下只会锁死正跑的配置）；自动 × 自动不可能重复（展开器已按 routeKey 跳掉后一条）。
 */
function duplicateUploads(runtime) {
    const automatic = runtime.filter(conn => conn.automatic && conn.account);
    if (!automatic.length)
        return [];
    /** 兼容连接的来源下标 -> 它重复上传的账号，以及被它重复的那些来源 */
    const hits = new Map();
    for (const compat of runtime) {
        if (compat.automatic)
            continue;
        const core = coreKey(compat.runtimeUrl);
        for (const one of automatic) {
            if (coreKey(one.runtimeUrl) !== core)
                continue;
            if (!servesAccount(compat, one.account))
                continue;
            let hit = hits.get(compat.sourceIndex);
            if (!hit)
                hits.set(compat.sourceIndex, (hit = { name: compat.runtimeName, accounts: new Set(), sources: new Set() }));
            hit.accounts.add(one.account);
            hit.sources.add(one.sourceIndex);
        }
    }
    return [...hits].map(([sourceIndex, hit]) => ({
        sourceIndex,
        message: `连接 ${hit.name} 会和来源 ${[...hit.sources].map(i => `#${i + 1}`).join("、")} ` +
            `同时为账号 ${[...hit.accounts].join("、")} 上传同一批事件：核心侧把两条路径当成两个` +
            `客户端、各收一份，同一条命令会被执行两次、回两遍。` +
            // 三条出路都给全：少给一条用户就只能靠删连接解决，而他可能两条都要
            `请给这条连接补上明确的 bind、把这些账号写进 exclude，或停用整条连接。`,
    }));
}
/**
 * @description 用户这次要的东西没进最终计划
 * 与其它阻塞项并列不互相压制：路由冲突说原因（谁把它顶掉），这句说后果（本次保存取消）。
 */
function missingTarget(list, runtime, want) {
    const { sourceIndex, account } = want;
    const action = `本次${want.action || "改动"}`;
    // 注意：下标越界是调用方算错了（多半拿了另一份列表的下标），不是「校验不通过」；放过去会按下标写回改到别的连接（点 A 变 B），回执却一切正常
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= list.length)
        return {
            sourceIndex,
            message: `${action}指向的来源下标 ${String(sourceIndex)} 不在候选列表里（共 ${list.length} 条）。` +
                `继续写盘会改到别的连接上，已取消。`,
        };
    const served = runtime.some(conn => conn.sourceIndex === sourceIndex && (!account || servesAccount(conn, account)));
    if (served)
        return null;
    return {
        sourceIndex,
        message: `${action}要求连接 ${sourceLabel(list[sourceIndex], sourceIndex)}` +
            `${account ? ` 的账号 ${account}` : ""} 在保存后有运行时连接，但按这份配置它不会起来。` +
            `存下去的话面板会显示已生效而实际不连，已取消 —— ` +
            `请检查这条连接的绑定账号、exclude，以及有没有和别条连接落到同一条路由上。`,
    };
}
/**
 * @description 这份候选能不能落盘，附带它真正会跑起来的计划
 * @param list 完整候选列表（入口已在内存里改成想保存的样子），不会被修改
 * @param expectations 本次操作要求保存后必须还在的目标；不传表示「只问配置合不合法」（锅巴整表保存与 watcher 即此类调用方）
 */
export function validateConnections(list, expectations = []) {
    const errors = [];
    const warnings = [];
    const { runtime, errors: expanded } = expandConnections(list);
    /**
     * 已经用 requireAccounts 的话术报过的来源
     * 注意：这几条毛病展开器也会报一遍，两句都进 errors 就是同件事说两遍且措辞不一；留 requireAccounts 这份（指令与面板前置校验用的就是它）。
     */
    const preBlocked = new Set();
    list.forEach((conf, sourceIndex) => {
        // 停用等于「这条不连」：占不住路由、不上传事件，更不该因自己没绑号而挡住整次保存
        if (conf.enable === false)
            return;
        const why = requireAccounts(conf);
        if (!why)
            return;
        preBlocked.add(sourceIndex);
        // 只加一层「是哪条连接」的前缀：requireAccounts 返回值不含连接身份，而 errors 拍平成一串给面板与日志，不说是谁的话多连接配置里用户没法对号入座
        errors.push({ sourceIndex, message: `连接 ${sourceLabel(conf, sourceIndex)}：${why}` });
    });
    for (const one of expanded) {
        if (!one.skipped) {
            // 警告照原样放行，包括 bind ∩ exclude 那句：它往往是「这条为什么没有有效账号」的成因，被阻塞吞掉的话用户只知要绑号、不知是 exclude 减掉的
            warnings.push({ sourceIndex: one.sourceIndex, message: one.message });
            continue;
        }
        // 注意：按 sourceIndex 结构性去重、不比较话术（拿字符串判是否同件事等于把措辞冻成契约，改字就漏判/误判）；安全前提是 preBlocked 那三种毛病都派生不出运行时连接，故不会连带吞掉本该报出的路由/重名冲突
        if (!preBlocked.has(one.sourceIndex))
            errors.push({ sourceIndex: one.sourceIndex, message: one.message });
    }
    errors.push(...duplicateUploads(runtime));
    for (const want of expectations) {
        const miss = missingTarget(list, runtime, want);
        if (miss)
            errors.push(miss);
    }
    return { ok: !errors.length, runtime, errors, warnings };
}
