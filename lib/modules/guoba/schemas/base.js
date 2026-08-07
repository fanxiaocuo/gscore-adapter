/**
 * 基础配置项：运行模式与其它杂项
 */
export const baseSchemas = [
    {
        component: "Divider",
        label: "运行模式",
    },
    {
        field: "mode",
        label: "模式",
        bottomHelpMessage: "client：云崽主动连接早柚核心；server：早柚核心主动连接云崽；both：同时开启（两者不要互相指向，否则消息死循环）；off：全部关闭",
        component: "Select",
        componentProps: {
            options: [
                { label: "client（云崽 → 早柚核心）", value: "client" },
                { label: "server（早柚核心 → 云崽）", value: "server" },
                { label: "both（双向）", value: "both" },
                { label: "off（关闭）", value: "off" },
            ],
        },
    },
    {
        component: "Divider",
        label: "其它",
    },
    {
        field: "media_max_size",
        label: "媒体内联上限",
        bottomHelpMessage: "媒体转 base64 的大小上限（字节），超过则改用 link:// 外链。若早柚核心跑在 Docker 里，需把框架 server.url 配成对端可达的地址",
        component: "InputNumber",
        componentProps: { min: 0, step: 1048576 },
    },
    {
        field: "file_max_size",
        label: "文件大小上限",
        bottomHelpMessage: "file 段必须内联 base64（协议无 URL 形式），超过此大小直接拒绝发送（字节）",
        component: "InputNumber",
        componentProps: { min: 0, step: 1048576 },
    },
    {
        field: "link_expire",
        label: "外链有效期",
        bottomHelpMessage: "link:// 外链的有效期（毫秒）。云崽默认只保留 1 分钟，核心拉取慢会拿到超时占位图",
        component: "InputNumber",
        componentProps: { min: 0, step: 60000 },
    },
    {
        field: "log_truncate",
        label: "截断日志中的 base64",
        component: "Switch",
    },
    {
        field: "notify_master",
        label: "断线通知主人",
        bottomHelpMessage: "连接断开与恢复时私聊通知主人",
        component: "Switch",
    },
];
