/**
 * 消息过滤（仅影响 client 方向的上报）
 */
export const filterSchemas = [
    {
        component: "Divider",
        label: "消息过滤（仅影响上报）",
    },
    {
        field: "filter.report_private",
        label: "上报私聊消息",
        bottomHelpMessage: "关掉则私聊不再转发给早柚核心",
        component: "Switch",
    },
    {
        field: "filter.report_group",
        label: "上报群消息",
        bottomHelpMessage: "QQ 频道也算群",
        component: "Switch",
    },
    {
        field: "filter.report_meta",
        label: "上报非消息事件",
        bottomHelpMessage: "入群 / 退群 / 戳一戳；核心侧没有消费插件时可关掉",
        component: "Switch",
    },
    {
        field: "filter.only_reply_at",
        label: "仅响应 @ 与前缀",
        bottomHelpMessage: "开启后群消息只有被 @ 或带下方前缀时才上报",
        component: "Switch",
    },
    {
        field: "filter.prefix",
        label: "触发前缀",
        bottomHelpMessage: "「仅响应 @ 与前缀」开启时，这些前缀也视为触发",
        component: "GTags",
        componentProps: { allowAdd: true, allowDel: true },
    },
    {
        field: "filter.block_prefix",
        label: "屏蔽前缀",
        bottomHelpMessage: "以任一项开头即不上报，用于避免与本地插件抢命令",
        component: "GTags",
        componentProps: { allowAdd: true, allowDel: true },
    },
    {
        field: "filter.block_include",
        label: "屏蔽关键词",
        bottomHelpMessage: "包含任一项即不上报",
        component: "GTags",
        componentProps: { allowAdd: true, allowDel: true },
    },
    {
        field: "filter.white_group",
        label: "群白名单",
        bottomHelpMessage: "只上报这些群，留空为全部",
        component: "GTags",
        componentProps: { allowAdd: true, allowDel: true },
    },
    {
        field: "filter.black_group",
        label: "群黑名单",
        component: "GTags",
        componentProps: { allowAdd: true, allowDel: true },
    },
    {
        field: "filter.black_user",
        label: "用户黑名单",
        component: "GTags",
        componentProps: { allowAdd: true, allowDel: true },
    },
];
