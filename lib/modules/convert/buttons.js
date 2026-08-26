/**
 * @description 云崽按钮 -> 早柚核心 Button
 * 注意：字段拼写 permisson 为协议原文（非标准拼法），勿改。
 * @param b 云崽侧按钮。标 {@link YunzaiButton} 之外还要允许任意对象：`segment.button()` 收什么都不校验，
 *          用户手写的按钮可能只有 `data` + `action`（早柚形状直接塞进来），`b.data != null` 那条分支为它留的
 * @returns 造不出可用按钮时返回 false（缺 data/link/callback/input 就无从点击）
 */
export function buttonToGscore(raw) {
    if (!raw || typeof raw !== "object")
        return false;
    const b = raw;
    // 分两步：先拼共有字段，再按动作补 action / data。先造 Omit 再补齐 —— 直接标成 Button 会因为缺这两个键
    // 报错，而标成 any 就等于放弃后面所有字段名检查
    const btn = {
        text: b.text ?? "",
        pressed_text: b.clicked_text ?? b.pressed_text ?? null,
        style: typeof b.style === "number" ? b.style : 1,
        permisson: 2,
        specify_role_ids: [],
        specify_user_ids: [],
        unsupport_tips: b.unsupport_tips ?? "您的客户端暂不支持该功能, 请升级后适配",
        ...b.GsCore,
        ...b.GSUIDCore,
    };
    // action: 0 跳转 1 回调 2 命令
    if (b.input != null) {
        btn.data = String(b.input);
        btn.action = 2;
    }
    else if (b.callback != null) {
        btn.data = String(b.callback);
        btn.action = 1;
    }
    else if (b.link != null) {
        btn.data = String(b.link);
        btn.action = 0;
    }
    else if (b.data != null) {
        btn.data = String(b.data);
        // 早柚形状直接塞进来时 action 已经在 b 上，但那是用户写的任意数字，协议只认 0/1/2。
        // 不在范围内按 2（发送命令）算 —— 最保守的一档，点了只会往会话里发一句文本，不会跳到意外的链接
        const a = b.action;
        btn.action = a === 0 || a === 1 || a === 2 ? a : 2;
    }
    else
        return false;
    // permisson: 0 指定用户 1 管理者 2 所有人 3 指定身份组
    const p = b.permission;
    if (p === "admin") {
        btn.permisson = 1;
    }
    else if (p != null && p !== "all") {
        /*
         * 空名单不写 permisson —— 留在默认的 2（所有人）。
         * `permission: []` 表达不出「一个人都不许点」这种意图，只可能是调用方没填；
         * 而按 0 + 空 specify_user_ids 发出去，官方端判定成「白名单里没有你」，谁都点不动
         */
        const ids = (Array.isArray(p) ? p : [p]).map(String).filter(Boolean);
        if (ids.length) {
            btn.permisson = 0;
            btn.specify_user_ids = ids;
        }
    }
    if (Array.isArray(b.role_ids) && b.role_ids.length) {
        btn.permisson = 3;
        btn.specify_role_ids = b.role_ids.map(String);
        // 身份组与用户白名单互斥，换档时把上一档的名单清掉，别留着一份不生效却对不上的数据
        btn.specify_user_ids = [];
    }
    return btn;
}
/**
 * @description segment.button(...rows).data -> Button[][]
 * @param square 行 × 列的二维数组。云崽侧不保证形状：单行时可能是一维数组，单个按钮时可能连数组都不是，
 *               所以两层都 `Array.isArray` 兜一次
 */
export function buttonsToGscore(square) {
    const rows = [];
    for (const row of Array.isArray(square) ? square : [square]) {
        const out = [];
        for (const b of Array.isArray(row) ? row : [row]) {
            const btn = buttonToGscore(b);
            if (btn)
                out.push(btn);
        }
        if (out.length)
            rows.push(out);
    }
    return rows;
}
/**
 * @description 早柚核心 buttons -> segment.button(...rows)；扁平列表按每行 2 个切分
 * @returns 一个按钮都造不出来时返回 null（调用方跳过这一段）
 */
export function buttonsFromGscore(raw) {
    let square = Array.isArray(raw) ? raw : [raw];
    if (!square.every(i => Array.isArray(i))) {
        const chunked = [];
        for (let i = 0; i < square.length; i += 2)
            chunked.push(square.slice(i, i + 2));
        square = chunked;
    }
    const rows = [];
    for (const row of square) {
        const out = [];
        for (const i of (Array.isArray(row) ? row : [row])) {
            if (!i || typeof i !== "object")
                continue;
            const key = { 0: "link", 1: "callback", 2: "input" }[i.action] ?? "input";
            const btn = { text: i.text, [key]: i.data };
            if (i.pressed_text)
                btn.clicked_text = i.pressed_text;
            if (typeof i.style === "number")
                btn.style = i.style;
            if (i.unsupport_tips)
                btn.unsupport_tips = i.unsupport_tips;
            /*
             * permisson: 0 指定用户 1 管理者 2 所有人 3 指定身份组
             *
             * 注意：「所有人」必须**什么都不写**，绝不能写 `permission: "all"`。
             * QQBot-Plugin 的判据是 `if (button.permission)` → 只认字符串 "admin"，其余任何真值一律
             * 当成用户白名单（`specify_user_ids.push(...)`）。写 "all" 会被它塞成一个叫 `all` 的用户 ID，
             * 官方端于是判定「白名单里没有你」——核心那边明明是普通权限，点下去却回「权限不足」。
             * 它每个 action 分支本来就带 `permission: { type: 2 }` 默认值，留空正好是所有人。
             * 同理空名单也不能写：`[]` 在 JS 里是真值，一样会掉进那条白名单分支
             */
            const ids = (i.specify_user_ids || []).map(String).filter(Boolean);
            const roles = (i.specify_role_ids || []).map(String).filter(Boolean);
            if (i.permisson === 1) {
                btn.permission = "admin";
            }
            else if (i.permisson === 0 && ids.length) {
                btn.permission = ids;
            }
            else if (i.permisson === 3 && roles.length) {
                /*
                 * 身份组：只带 role_ids，**不伪造 permission.type**。
                 *
                 * 官方群消息文档（v2_groups_group_openid_messages）里 Permission.type 只有
                 * 0 指定用户 / 1 管理员 / 2 所有人 三挡，没有 3；specify_role_ids 明确标注「仅频道可用」。
                 * 所以往群聊发 `{type: 3}` 是照核心的枚举硬凑出来的非法值，可能让整条消息被拒 ——
                 * 那比「限制没生效」更糟（按钮整个发不出去）。
                 * 注意：QQBot-Plugin 全文没有 role_ids，所以这一档在群聊里**事实上不生效**、退化成所有人可点。
                 * 这是协议本身的限制而非本转换的疏漏，别再往这儿塞 type 3；频道要支持得先确认走的是频道接口
                 */
                btn.role_ids = roles;
            }
            out.push(btn);
        }
        if (out.length)
            rows.push(out);
    }
    // 本 fork 没有 Bot.Button，只能用 segment.button
    return rows.length ? segment.button(...rows) : null;
}
