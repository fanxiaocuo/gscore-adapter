/**
 * 插件更新
 *
 * 参照 df-plugin（src/apps/update.ts）的做法：**不自己实现 git 更新**，
 * 而是改写 e.msg 后转调云崽本体的 plugins/other/update.js。
 *
 * 本体那套已经处理了自己写一遍很难覆盖全的部分：
 *   - 强制更新前用 getRemoteBranch() 解析真实远端分支，而不是假定 origin/<当前分支>
 *   - package.json 有变动时自动重装依赖（updatePackage）
 *   - 更新成功后自动重启（Restart），并有 uping 全局锁
 *   - gitErr 对超时/连接失败/冲突分别给出可照做的提示
 * 自己维护一份只会与本体的行为逐渐分叉。
 *
 * 契约（plugins/other/update.js）：
 *   - getPlugin() 把 "#(安静)?(强制)?更新(日志)?" 前缀剥掉，余下部分当插件目录名，
 *     并要求 plugins/<name>/.git 存在（第 92 行），所以要拼成 "#更新gscore-adapter"
 *   - update() 首行判 this.e.isMaster，故 e 必须是原事件（带 isMaster），不能自造
 */
import { PluginName, PluginPath } from "@/dir"

export default class GsCoreUpdate extends plugin {
  constructor() {
    super({
      name: "早柚核心适配器更新",
      dsc: "更新 gscore-adapter",
      event: "message",
      priority: 500,
      rule: [
        { reg: "^#?早柚(核心)?(适配器)?(强制)?更新$", fnc: "update", permission: "master" },
        { reg: "^#?早柚(核心)?(适配器)?更新日志$", fnc: "updateLog", permission: "master" },
      ],
    })
  }

  async update(e) {
    return this.run(e, e.msg.includes("强制") ? "#强制更新" : "#更新")
  }

  async updateLog(e) {
    return this.run(e, "#更新日志")
  }

  /**
   * 转调本体的更新插件
   *
   * 改的是 e.msg 而不是 this.e.msg —— 本体读的是它自己实例上的 e。
   * 用完恢复原值：同一个事件对象后面还会流经其他插件，改坏了会影响它们的匹配。
   */
  async run(e, type: string) {
    let Update
    try {
      // 本体插件不在 @/ 别名覆盖范围内，用相对路径。
      // 编译产物在 lib/apps/，上跳三级即 plugins/，与 df-plugin 的写法一致
      ;({ update: Update } = await import("../../../other/update.js"))
    } catch (err) {
      Bot.makeLog("error", ["加载本体更新插件失败", err], "GsCore")
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
