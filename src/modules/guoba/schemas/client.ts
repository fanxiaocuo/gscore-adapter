/**
 * 客户端方向（云崽 -> 早柚核心）
 *
 * connections 是数组，锅巴用 GSubForm 渲染可增删的子表单。
 */
export const clientSchemas = [
  {
    component: "Divider",
    label: "客户端（云崽 → 早柚核心）",
  },
  {
    field: "client.heartbeat",
    label: "心跳间隔",
    bottomHelpMessage: "ws ping 间隔（秒），0 关闭",
    component: "InputNumber",
    componentProps: { min: 0 },
  },
  {
    field: "client.heartbeat_timeout",
    label: "心跳超时",
    bottomHelpMessage: "超过多少秒没收到 pong 判定掉线并重连，0 关闭",
    component: "InputNumber",
    componentProps: { min: 0 },
  },
  {
    field: "client.connections",
    label: "连接列表",
    bottomHelpMessage: "可配置多个早柚核心连接，改动后需 #早柚重连 生效",
    component: "GSubForm",
    componentProps: {
      multiple: true,
      schemas: [
        {
          field: "name",
          label: "连接名",
          bottomHelpMessage: "仅用于日志与 #早柚状态",
          component: "Input",
        },
        {
          field: "url",
          label: "地址",
          bottomHelpMessage:
            "早柚核心地址。路由为 /ws/{bot_id}，{bot_id} 是本机器人平台名，可自定义",
          component: "Input",
          componentProps: { placeholder: "ws://127.0.0.1:8765/ws/Yunzai" },
        },
        {
          field: "token",
          label: "Token",
          bottomHelpMessage: "早柚核心以 ?token= 查询参数接收，留空则不发送",
          component: "InputPassword",
        },
        {
          field: "bot_id",
          label: "平台标识",
          bottomHelpMessage: "上报时填入 MessageReceive.bot_id，留空则按平台标识映射自动推断",
          component: "Input",
        },
        {
          field: "enable",
          label: "启用",
          component: "Switch",
        },
        {
          field: "reconnect_interval",
          label: "重连间隔",
          bottomHelpMessage: "单位秒",
          component: "InputNumber",
          componentProps: { min: 1 },
        },
        {
          field: "max_reconnect_attempts",
          label: "最大重连次数",
          bottomHelpMessage: "小于等于 0 为无限重连",
          component: "InputNumber",
        },
        {
          field: "bind",
          label: "仅转发",
          bottomHelpMessage: "只转发这些 self_id 的消息，留空表示全部",
          component: "GTags",
          componentProps: { allowAdd: true, allowDel: true },
        },
        {
          field: "exclude",
          label: "排除",
          bottomHelpMessage: "排除这些 self_id，优先级高于「仅转发」",
          component: "GTags",
          componentProps: { allowAdd: true, allowDel: true },
        },
      ],
    },
  },
]
