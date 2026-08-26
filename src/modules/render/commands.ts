/**
 * @description 指令清单，帮助图与文本回退的唯一事实源（对应 kkk 的 HELP_MENU_CONFIG）
 * 单独成文件是因为 apps/admin.ts 里那份纯文本帮助原先硬编码在 reply 里，加一条指令要同时改两处。
 * 不按角色分支（kkk 按 master/member 过滤）：本插件所有指令都是 permission: "master"，只在条目上标 MASTER。
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
        cmd: "#早柚添加连接 <地址>",
        dsc: "新增一个早柚核心连接（ws:// / wss://）。\n只填 host:port 即可，路由段按绑定账号在连接时生成\n默认只绑定收到这条指令的机器人账号\n其他号再发一次会并进同一条连接，不会新开 ws",
        eg: "#早柚添加连接 127.0.0.1:8765    或    wss://域名:8765 n=主核心 t=abc",
        icon: "plus",
        master: true,
      },
      {
        cmd: "#早柚修改连接 <名字|序号> <key=value>",
        dsc: "改已有连接，最常用的是给同一个核心再绑一个机器人：\nbind+=<账号> 追加，bind-=<账号> 移除\nbind=账号1+账号2 整体替换（至少留一个账号）\nurl / token / enable / interval / retry 也可改；id= 按账号写入平台映射",
        eg: "#早柚修改连接 1 bind+=2463381624    或    #早柚修改连接 主核心 bind=2463381624",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚删除连接 <名字|序号>",
        dsc: "按连接名或列表序号删除",
        eg: "#早柚删除连接 主核心    或    #早柚删除连接 1",
        icon: "minus",
        master: true,
      },
      {
        cmd: "#早柚开启连接 <名字|序号>",
        dsc: "启用某个连接并立即发起连接",
        eg: "#早柚开启连接 1",
        icon: "play",
        master: true,
      },
      {
        cmd: "#早柚关闭连接 <名字|序号>",
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
          {
            cmd: "bot_id（id）",
            dsc: "该账号的平台标识（onebot / qqgroup 等），写入 bot_id_map",
            icon: "dot",
          },
          {
            cmd: "bind",
            dsc: "转发哪些机器人账号的消息，每个账号各起一条 ws。\n添加时默认为发指令的账号，必须至少绑一个；\n改已有连接用 #早柚修改连接 的 bind+= / bind-=",
            icon: "dot",
          },
          {
            cmd: "exclude",
            dsc: "排除哪些机器人账号（不转发这些账号的消息）。\n优先级高于 bind，留空表示不排除",
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
        dsc: "不带参数时出图，列出当前所有配置与改法",
        eg: "#早柚设置    或    #早柚配置",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置适配器开启",
        dsc: "总开关，关掉则完全不连核心，改完即时生效\n等价 enable=true",
        eg: "#早柚设置适配器关闭",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置仅响应at开启",
        dsc: "仅在被 @ 或带前缀时才上报群消息\n等价 only_reply_at=true",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置私聊上报关闭",
        dsc: "关掉私聊上报。另有 群聊上报（含频道）与 事件上报（入群/退群/戳一戳）",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置断线通知开启",
        dsc: "连接断开与重连成功时私聊通知主人\n等价 notify_master=true",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置最大媒体大小 2",
        dsc: "媒体转 base64 的上限，单位 MB，超过改用外链\n等价 media_max_size=2097152",
        icon: "settings",
        master: true,
      },
      {
        cmd: "#早柚设置更新检查开启",
        dsc: "开启定时更新检查，发现新提交时私聊推送更新日志\n等价 update_check=true",
        icon: "settings",
        master: true,
      },
    ],
    subGroups: [
      {
        title: "开关词与英文写法",
        items: [
          {
            cmd: "开启 / 关闭",
            dsc: "启用、打开、开 与 停用、禁用、关 都认，也可以写 true/false",
            icon: "dot",
          },
          {
            cmd: "key=value",
            dsc: "英文写法仍然有效，只是不再逐条列出。\n注意它按字节收：media_max_size=2097152",
            icon: "dot",
          },
        ],
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

/** @description 纯文本帮助：渲染失败时的回退，内容与图保持同源 */
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
