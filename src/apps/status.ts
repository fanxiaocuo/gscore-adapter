import { config } from "@/config"
import { makeLog } from "@/utils/compat"
import { clients } from "@/modules/client"
import { forName, snapshot, resetStats } from "@/modules/stats"
import { renderStatus, renderAbout } from "@/modules/render/pages"
import { versionLabel, branch } from "@/modules/render/version"
import { frameLabel, nodeVersion, releaseLabel, sysInfo } from "@/modules/render/env"

export default class GsCoreStatus extends plugin {
  constructor() {
    super({
      name: "早柚核心适配器",
      dsc: "gscore-adapter 状态与重连",
      event: "message",
      priority: 500,
      rule: [
        { reg: "^#?早柚(核心)?状态$", fnc: "status", permission: "master" },
        { reg: "^#?早柚(核心)?重连$", fnc: "reconnect", permission: "master" },
        // 计数落盘后不再随重启归零，得有条路能清。放在「重连」之后：
        // 两条正则互不匹配，顺序无关，挨着写只是让相关指令聚在一起
        { reg: "^#?早柚(核心)?清空统计$", fnc: "resetStats", permission: "master" },
        // 「版本」放在「更新日志」之后无所谓——两者正则互不匹配。
        // 不写成 (版本|版本信息)：早柚版本信息 会被 ^...版本$ 拒掉再由本条的 (信息)? 接住
        { reg: "^#?早柚(核心)?(适配器)?版本(信息)?$", fnc: "about", permission: "master" },
      ],
    })
  }

  async about(e) {
    const img = await renderAbout()
    if (img) return e.reply(img)

    // 文本回退：与图上的环境摘要同源，只是不排版。
    // 同样只取性能类信息，不带任何能定位机主的东西（见 env.ts sysInfo 的隐私边界）
    const sys = sysInfo()
    await e.reply(
      [
        `早柚核心适配器 ${versionLabel()}（${releaseLabel()}${branch ? ` @${branch}` : ""}）`,
        `操作系统：${sys.os}（${sys.platform} ${sys.arch}）`,
        `运行框架：${frameLabel()}`,
        `Node 版本：v${nodeVersion()}`,
        `运行模式：${config.mode || "off"}`,
        `处理器：${sys.cpuModel}（${sys.cpuCores} 核心）`,
        `内存占用：${sys.memoryPercent}%（${sys.usedMemory} / ${sys.totalMemory}）`,
        `运行时长：${sys.processUptime}`,
        `已配置连接：${clients.length} 个`,
      ].join("\n"),
    )
  }

  async status(e) {
    const img = await renderStatus()
    if (img) return e.reply(img)

    // 文本回退：与图上同源。中转计数要带上——出不了图往往正是浏览器有问题的时候，
    // 而「连着但一条没转」这个判断不该因为出图失败就看不到了。
    const s = snapshot()
    const msg = [`早柚核心适配器\n运行模式：${config.mode}`]

    if (config.mode !== "off") {
      if (!clients.length) {
        msg.push("\n连接：无")
      } else {
        msg.push("\n连接：")
        for (const c of clients) {
          const n = forName(c.name)
          msg.push(`\n  ${c.name}：${c.statusText}（↑${n.up + n.event} ↓${n.down}）`)
        }
      }
      msg.push(
        `\n今日中转：上行 ${s.today.up + s.today.event}，下行 ${s.today.down}`,
        // 标一下累计是不是跨重启的：数据库不可用时它退化成「本次运行」，
        // 两个数字长得一样但含义差很远，不写清楚会让人以为计数丢了
        `\n累计中转：上行 ${s.total.up + s.total.event}，下行 ${s.total.down}${s.persisted ? "" : "（本次运行）"}`,
      )
    }

    await e.reply(msg.join(""))
  }

  async reconnect(e) {
    if (!clients.length) return e.reply("没有可重连的客户端连接")
    for (const c of clients) c.restart()
    await e.reply(`已触发 ${clients.length} 个连接重连`)
  }

  async resetStats(e) {
    const s = snapshot()
    try {
      await resetStats()
    } catch (err) {
      makeLog("error", ["清空中转计数失败", err], "GsCore")
      return e.reply("清空统计失败，详见日志")
    }
    // 回报清掉了多少，免得误触后不知道丢了什么
    await e.reply(
      `已清空中转统计（原累计：上行 ${s.total.up + s.total.event}，下行 ${s.total.down}）`,
    )
  }
}
