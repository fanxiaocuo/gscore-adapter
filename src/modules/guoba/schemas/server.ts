/**
 * 服务端方向（早柚核心 -> 云崽）
 */
export const serverSchemas = [
  {
    component: "Divider",
    label: "服务端（早柚核心 → 云崽）",
  },
  {
    field: "server.path",
    label: "ws 路由",
    bottomHelpMessage:
      "最终地址 ws://<云崽地址>/<路由>。默认值刻意与 plugins/adapter/GSUIDCore.js 的 GSUIDCore 区分，避免同一条消息被处理两次",
    component: "Input",
  },
  {
    field: "server.id",
    label: "适配器 id",
    component: "Input",
  },
  {
    field: "server.name",
    label: "适配器名称",
    component: "Input",
  },
  {
    field: "server.on_conflict",
    label: "路由冲突时",
    bottomHelpMessage: "检测到路由已被其它适配器占用时的行为",
    component: "Select",
    componentProps: {
      options: [
        { label: "abort（放弃注册并报错，推荐）", value: "abort" },
        { label: "force（强行注册，消息会被处理两次，仅调试用）", value: "force" },
      ],
    },
  },
  {
    field: "server.binary",
    label: "下行发二进制帧",
    bottomHelpMessage:
      "早柚核心 core.py 用 receive_bytes() 接收，只认二进制。仅当对端明确只收文本时才关闭",
    component: "Switch",
  },
]
