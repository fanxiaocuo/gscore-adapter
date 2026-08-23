/**
 * @description 插件更新：不自己实现 git 更新，而是改写 e.msg 后转调云崽本体的 plugins/other/update.js
 * 参照 df-plugin 的做法。本体那套已经处理了自己写一遍很难覆盖全的部分：强制更新前解析真实远端分支、
 * package.json 有变动时自动重装依赖、更新成功后自动重启（带 uping 全局锁）、对超时/连接失败/冲突分别给出提示。
 * 注意：契约有两条 —— getPlugin() 把 "#(安静)?(强制)?更新(日志)?" 前缀剥掉后当插件目录名，并要求
 * plugins/<name>/.git 存在，所以必须拼成 "#更新gscore-adapter"；update() 首行判 this.e.isMaster，
 * 所以 e 必须是原事件，不能自造。
 * 注意：「更新日志」不转调本体 —— 本体 getLog() 末尾直接 Bot.makeForwardArray()，返回拼好的转发消息而非数据，
 * 排不成图，所以那一条走本插件自己的 modules/update。
 */
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { PluginName, PluginPath, YunzaiPath } from "@/dir"
import { makeLog } from "@/utils/compat"
import { changelogMsg, tick } from "@/modules/update"
import type { YunzaiEvent } from "@/types"

export default class GsCoreUpdate extends plugin<"message"> {
  constructor() {
    super({
      name: "早柚核心适配器更新",
      dsc: "更新 gscore-adapter",
      event: "message",
      priority: 500,
      rule: [
        { reg: "^#?早柚(核心)?(适配器)?(强制)?更新$", fnc: "update", permission: "master" },
        { reg: "^#?早柚(核心)?(适配器)?更新日志$", fnc: "updateLog", permission: "master" },
        { reg: "^#?早柚(核心)?(适配器)?检查更新$", fnc: "checkUpdate", permission: "master" },
      ],
      /**
       * @description 定时更新检查，交给本体的 task 机制（node-schedule）
       * cron 固定每 5 分钟触发，真正的间隔与开关在 tick() 内按配置判 —— 本体只在插件实例化时读一次 task，
       * cron 之后改不动，这样写改配置就能即刻生效；tick() 没开启用时直接 return。
       * log: false —— 每 5 分钟一条「开始处理/完成」会把日志刷满，真正有意义的事件由 tick 内部打 mark 级日志。
       */
      task: {
        name: "早柚适配器更新检查",
        cron: "0 */5 * * * *",
        fnc: () => tick(),
        log: false,
      },
    })
  }

  async update(e: YunzaiEvent) {
    return this.run(e, e.msg.includes("强制") ? "#强制更新" : "#更新")
  }

  /**
   * @description 更新日志：不 fetch，只看本地已有的记录
   * 这是「刚更新完想知道改了什么」的场景，不该为此产生一次网络请求。想知道远端有没有新东西用 #早柚检查更新。
   */
  async updateLog(e: YunzaiEvent) {
    const { msg } = await changelogMsg(false)
    return e.reply(msg)
  }

  /** @description 检查远端有无新提交（会 fetch） */
  async checkUpdate(e: YunzaiEvent) {
    // fetch 走网络，慢的时候用户会以为指令没响应
    await e.reply("正在检查更新……")
    const { msg } = await changelogMsg(true)
    return e.reply(msg)
  }

  /**
   * @description 转调本体的更新插件
   * 注意：改的是 e.msg 而不是 this.e.msg（本体读的是它自己实例上的 e），用完要恢复原值 —— 同一个事件对象后面
   * 还会流经其他插件，改坏了会影响它们的匹配。
   */
  async run(e: YunzaiEvent, type: string) {
    let Update
    try {
      // 与 modules/client/framework.ts 同一套做法：由 YunzaiPath 拼绝对路径后动态 import。
      // 注意：别写成 ../../../other/update.js —— 相对写法既依赖编译产物的目录深度，又会让 tsc 静态解析这个
      // 字面量，而本体的 plugins/other/ 不在本仓库里，CI 单独 checkout 时必然 TS2307（运行时有 try/catch
      // 兜底，但类型检查阶段就已经失败，产物分支根本构建不出来）
      const url = pathToFileURL(join(YunzaiPath, "plugins/other/update.js")).href
      ;({ update: Update } = await import(url))
    } catch (err) {
      makeLog("error", ["加载本体更新插件失败", err], "GsCore")
      return e.reply(`无法调用本体更新功能，请手动在插件目录执行 git pull：\n${PluginPath}`)
    }

    const raw = e.msg
    e.msg = type + PluginName
    try {
      const up = new Update()
      up.e = e
      return type === "#更新日志" ? await up.updateLog() : await up.update()
    } finally {
      e.msg = raw
    }
  }
}
