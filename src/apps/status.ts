import { config } from "@/config"
import { clients } from "@/modules/client"

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
      ],
    })
  }

  async status(e) {
    const msg = [`早柚核心适配器\n运行模式：${config.mode}`]

    if (config.mode !== "off") {
      if (!clients.length) {
        msg.push("\n连接：无")
      } else {
        msg.push("\n连接：")
        for (const c of clients) msg.push(`\n  ${c.name}：${c.statusText}`)
      }
    }

    await e.reply(msg.join(""))
  }

  async reconnect(e) {
    if (!clients.length) return e.reply("没有可重连的客户端连接")
    for (const c of clients) c.restart()
    await e.reply(`已触发 ${clients.length} 个连接重连`)
  }
}
