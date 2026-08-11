/**
 * 指令清单
 *
 * 单独成文件（对应 kkk 的 HELP_MENU_CONFIG）：apps/admin.ts 里那份纯文本帮助
 * 是硬编码在 reply 里的，加一条指令要同时改两处。这里作为唯一事实源，
 * 帮助图与文本回退都从它生成。
 *
 * 与 kkk 的差异：它按 role 过滤（master/member），本插件所有指令都是
 * permission: "master"（见 apps/admin.ts 与 apps/status.ts 的 rule），
 * 所以不做角色分支，只在条目上标 MASTER 说明权限要求。
 */
import type { HelpGroup } from "./components/Help.js"

export const HELP_GROUPS: HelpGroup[] = [
  {
    title: "状态与连接",
    items: [
      {
        cmd: "#早柚状态",
        dsc: "查看适配器运行模式与各连接的实时状态",
        icon: "status",
        master: true,
      },
      {
        cmd: "#早柚连接列表",
        dsc: "列出全部已配置的连接，含地址、鉴权与重连次数",
        icon: "list",
        master: true,
      },
      {
        cmd: "#早柚重连",
        dsc: "立即重连全部连接，不改动任何配置",
        icon: "refresh",
        master: true,
      },
      {
        cmd: "#早柚版本",
        dsc: "插件版本与运行环境：框架、Node、运行模式、框架能力探测结果",
        icon: "info",
        master: true,
      },
    ],
  },
  {
    title: "连接管理",
    items: [
      {
        cmd: "#早柚添加连接",
        dsc: "新增一个早柚核心连接。\n只填 host:port 即可，自动补全为 /ws/Yunzai\n默认只绑定收到这条指令的机器人账号",
        eg: "#早柚添加连接 127.0.0.1:8765    或    …8765 n=主核心 t=abc",
        icon: "plus",
        master: true,
      },
      {
        cmd: "#早柚删除连接",
        dsc: "按连接名或列表序号删除",
        eg: "#早柚删除连接 主核心    或    #早柚删除连接 1",
        icon: "minus",
        master: true,
      },
      {
        cmd: "#早柚开启连接",
        dsc: "启用某个连接并立即发起连接",
        eg: "#早柚开启连接 1",
        icon: "play",
        master: true,
      },
      {
        cmd: "#早柚关闭连接",
        dsc: "停用某个连接，配置保留",
        eg: "#早柚关闭连接 1",
        icon: "stop",
        master: true,
      },
    ],
    subGroups: [
      {
        title: "可选参数，以 key=value 追加，中英文冒号等号均可（括号内为简写）",
        items: [
          { cmd: "name（n）", dsc: "连接名，用于日志与各处指令定位", icon: "dot" },
          { cmd: "token（t）", dsc: "鉴权 token，以 ?token= 附在地址上", icon: "dot" },
          { cmd: "bot_id（id）", dsc: "上报时填入 MessageReceive.bot_id 的平台标识", icon: "dot" },
          {
            cmd: "bind",
            dsc: "只转发哪个机器人账号的消息。\n默认为发指令的账号，all 表示不限",
            icon: "dot",
          },
          { cmd: "reconnect_interval（interval）", dsc: "重连间隔（秒），默认 5", icon: "dot" },
          {
            cmd: "max_reconnect_attempts（retry）",
            dsc: "最大重连次数，默认 5，填 0 为无限重连",
            icon: "dot",
          },
        ],
      },
    ],
  },
  {
    title: "全局设置",
    items: [
      {
        cmd: "#早柚设置",
        dsc: "不带参数时出图列出当前所有配置及各自的改法",
        eg: "#早柚设置    或    #早柚配置",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置 enable=true|false",
        dsc: "总开关，关掉则完全不连核心，改完即时生效",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置 only_reply_at=true",
        dsc: "仅在被 @ 或带前缀时才上报群消息",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置 report_private=false",
        dsc: "关掉私聊上报。另有 report_group（群，含频道）与 report_meta（入群/退群/戳一戳）",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置 notify_master=true",
        dsc: "连接断开与重连成功时私聊通知主人",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置 media_max_size=10485760",
        dsc: "媒体转 base64 的大小上限（字节），超过改用外链",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置 update_check=true",
        dsc: "开启定时更新检查，发现新提交时私聊推送更新日志",
        icon: "settings",
        master: true,
      },
    ],
  },
  {
    title: "更新",
    items: [
      {
        cmd: "#早柚更新",
        dsc: "拉取插件最新代码，有依赖变动会自动重装并重启",
        icon: "arrowUp",
        master: true,
      },
      {
        cmd: "#早柚强制更新",
        dsc: "丢弃本地改动后强制更新，改过插件源码时才需要",
        icon: "arrowUpDouble",
        master: true,
      },
      {
        cmd: "#早柚更新日志",
        dsc: "查看本地最近的提交记录",
        icon: "changelog",
        master: true,
      },
      {
        cmd: "#早柚检查更新",
        dsc: "拉取远端信息，看有没有新提交。\n只检查不更新，可在配置里开启定时检查",
        icon: "search",
        master: true,
      },
    ],
  },
]

/** 纯文本帮助：渲染失败时的回退，内容与图保持同源 */
export function helpText(): string {
  const out = ["早柚核心适配器 指令："]
  for (const g of HELP_GROUPS) {
    out.push("", `【${g.title}】`)
    for (const it of g.items) {
      out.push(`${it.cmd} —— ${it.dsc.replace(/\n/g, " ")}`)
      if (it.eg) out.push(`  例：${it.eg}`)
    }
    for (const sub of g.subGroups || []) {
      out.push(`  · ${sub.title}`)
      for (const it of sub.items) out.push(`    ${it.cmd}：${it.dsc}`)
    }
  }
  return out.join("\n")
}
