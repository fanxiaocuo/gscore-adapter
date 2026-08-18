import { coreKey } from "../../utils/url.js";
import { expandConnections, readIds, requireAccounts, sourceLabel } from "./expand.js";
/**
 * 这条连接会不会替 account 上传事件 —— 与 GsCoreClient.accept(self_id) 同一套判据
 *
 * 空 bind 表示「除 exclude 之外全放行」，而**不是**「不覆盖任何账号」。
 * 这也正是不能借用 utils/url.ts 的 findDuplicate 的地方：它把「任一侧空 bind」当成
 * 双向重复，于是一条空 bind 的兼容连接（老配置升级后的默认形态）会顶掉用户想新加的
 * 每一条明确绑定 —— 他要的恰恰是第二条。
 *
 * exclude 先判，尽管展开器已经把 exclude 从 bind 里减过了：这里要与运行时那个真正
 * 决定「转不转发」的函数逐条对齐，而不是与展开器的中间结果对齐。对不上时的症状是
 * 用户照着话术把账号排掉了、保存仍被拒。
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
 * 同一个核心上，兼容连接与账号级自动连接覆盖了同一个账号 = 那个账号的事件上传两遍
 *
 * 症状：核心侧按 `/ws/<id>` 认客户端，两条路径就是两个客户端、各收一份同样的消息，
 * 于是同一条命令被执行两次、群里回两遍。这是全部阻塞项里唯一「两条连接都好好地起
 * 来了」的一种，展开器压根算不出来 —— 它只按路由与名字裁决，从不比较账号覆盖，
 * 「仍在用共享路径」那句还只是条照常启动的警告。所以必须在这里算。
 *
 * 为什么按核心分组
 * ------
 * 不分的话，「主核心按账号连 + 备核心用旧共享路径」这种正常的双核心用法会被判成
 * 重复上传：那两份消息本来就该发给两个不同的核心。coreKey 只取协议+主机+端口，
 * 正是「哪个核心」这个粒度。
 *
 * 为什么只拿兼容连接去比自动连接，兼容 × 兼容不管
 * ------
 * 自动连接是插件按 bind 派生出来的，所以插件知道「账号 X 的规范通道就是它」，
 * 另一条撞上来的兼容连接就是需要用户动手迁移的那一条 —— 有明确的责任方可以记名，
 * 与展开器把路由冲突记在被跳过那条名下同一个道理。两条都是用户手写的自定义路径时，
 * 没有任何依据判定该谁让路：拦下来只会把一份正在跑的配置锁死，连改名都保存不了。
 *
 * 自动 × 自动不可能重复：同账号同核心必然撞同一条 routeKey，展开器已经跳掉后一条了。
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
            // 三条出路都给全：少给一条，用户就只能靠删连接解决，而他可能两条都要
            `请给这条连接补上明确的 bind、把这些账号写进 exclude，或停用整条连接。`,
    }));
}
/**
 * 用户这次要的东西没进最终计划
 *
 * 与其它阻塞项并列而不互相压制：路由冲突那句说的是**原因**（谁把它顶掉了），
 * 这句说的是**后果**（所以这次保存取消）。只留原因的话，用户得自己把「B 被跳过」
 * 推到「所以我刚才那次绑定白点了」；只留后果则无从下手去修。
 */
function missingTarget(list, runtime, want) {
    const { sourceIndex, account } = want;
    const action = `本次${want.action || "改动"}`;
    // 下标越界不是「校验不通过」而是调用方算错了 —— 常见成因是拿另一份列表（过滤过的
    // 视图、或改动前的快照）算出的下标。放过去的话按下标写回会改到**别的**连接上，
    // 用户点的是 A、变的是 B，而回执一切正常。原值用 String 带出来定位，它是个数字，
    // 不涉及凭据
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
 * @param list 完整候选列表（入口已在内存里改成想要保存的样子），不会被修改
 * @param expectations 本次操作要求保存后必须还在的目标；不传表示「只问这份配置合不合法」
 *   —— 锅巴整表保存与 watcher 就是这种没有具体诉求的调用方
 */
export function validateConnections(list, expectations = []) {
    const errors = [];
    const warnings = [];
    const { runtime, errors: expanded } = expandConnections(list);
    /**
     * 已经用 requireAccounts 的话术报过的来源
     *
     * 这几条毛病展开器也会报一遍（`缺少 url` / `无法解析` / `没有可用的绑定账号`），
     * 两句都进 errors 就是同一件事说两遍、措辞还不一样 —— 用户会以为是两个问题。
     * 留 requireAccounts 那一份，因为指令与面板的前置校验用的就是它：三处说同一句话，
     * 用户在面板上看到的建议才与指令里该敲的写法对得上。
     */
    const preBlocked = new Set();
    list.forEach((conf, sourceIndex) => {
        // 停用等于「这条不连」：它占不住路由、不上传任何事件，更不该因为自己没绑号而
        // 挡住整次保存 —— 那会把用户锁在一条他早就关掉的连接上，连删都删不掉
        if (conf.enable === false)
            return;
        const why = requireAccounts(conf);
        if (!why)
            return;
        preBlocked.add(sourceIndex);
        // 只加一层「是哪条连接」的前缀：requireAccounts 的返回值不含连接身份，而 errors
        // 是拍平成一串给面板与日志的，不说是谁的话，多连接配置里用户没法对号入座
        errors.push({ sourceIndex, message: `连接 ${sourceLabel(conf, sourceIndex)}：${why}` });
    });
    for (const one of expanded) {
        if (!one.skipped) {
            // 警告一律照原样放行，包括 bind ∩ exclude 那句 —— 它往往正是「这条为什么没有
            // 有效账号」的成因，被上面那条阻塞顺手吞掉的话，用户只知道要绑号，
            // 不知道自己明明绑了、是 exclude 把它减掉的
            warnings.push({ sourceIndex: one.sourceIndex, message: one.message });
            continue;
        }
        // 按 sourceIndex 结构性地去重，不比较话术：拿字符串判「这两条说的是不是同一件事」
        // 等于把措辞冻成契约，改一个字就漏判或误判（webui/api.ts 与 conflict.ts 都为此
        // 明确拒绝过按话术分类）。这里安全的前提是 preBlocked 里的三种毛病都派生不出任何
        // 运行时连接，因此不可能连带吞掉一条本该报出的路由/重名冲突
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
