/**
 * 基础配置项：运行模式与其它杂项
 */
export const baseSchemas = [
  {
    component: "Divider",
    label: "总开关",
  },
  {
    field: "enable",
    label: "启用适配器",
    bottomHelpMessage: "关掉则完全不连早柚核心。改完即时生效，不用重启云崽",
    component: "Switch",
  },
  {
    component: "Divider",
    label: "其它",
  },
  {
    field: "media_max_size",
    label: "媒体内联上限",
    bottomHelpMessage:
      "媒体转 base64 的大小上限（字节），超过则改用 link:// 外链。若早柚核心跑在 Docker 里，需把框架 server.url 配成对端可达的地址",
    component: "InputNumber",
    componentProps: { min: 0, step: 1048576 },
  },
  {
    field: "file_max_size",
    label: "文件大小上限",
    bottomHelpMessage:
      "file 段必须内联 base64（协议无 URL 形式），超过此大小直接拒绝发送（字节）",
    component: "InputNumber",
    componentProps: { min: 0, step: 1048576 },
  },
  {
    field: "link_expire",
    label: "外链有效期",
    bottomHelpMessage:
      "link:// 外链的有效期（毫秒）。云崽默认只保留 1 分钟，核心拉取慢会拿到超时占位图",
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
  {
    component: "Divider",
    label: "更新检查",
  },
  {
    field: "update_check.enable",
    label: "定时检查更新",
    bottomHelpMessage:
      "定时检查插件仓库有没有新提交，只通知不会自动更新。关掉后 #早柚检查更新 仍可手动用",
    component: "Switch",
  },
  {
    field: "update_check.interval",
    label: "检查间隔",
    bottomHelpMessage: "单位分钟。每次都要 git fetch 一次远端，低于 30 会按 30 处理",
    component: "InputNumber",
    componentProps: { min: 30, step: 30 },
  },
  {
    field: "update_check.delay",
    label: "首次检查延迟",
    bottomHelpMessage: "单位分钟。启动后多久做第一次检查，用于错开启动高峰",
    component: "InputNumber",
    componentProps: { min: 0, step: 1 },
  },
  {
    field: "update_check.notify",
    label: "发现新版本时通知主人",
    bottomHelpMessage: "把更新日志渲染成图片私聊推送给主人",
    component: "Switch",
  },
]
