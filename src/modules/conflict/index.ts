/**
 * 重复上报检测
 *
 * 云崽侧可能同时存在多个"往早柚核心上报"的实现，它们互相看不见对方，
 * 于是同一条消息被上报两次，核心侧插件回两遍。
 *
 * 本模块只**告警**，不改别人的配置、不禁用别人的功能 ——
 * 用户装了什么是用户的决定，插件越界改动会更难排查。
 *
 * 已知的两类来源：
 *
 * 1. ws-plugin 的 `servers[].type == 3`
 *    其 apps/message/message.js 的 switch 里 case 3 走 makeGSUidReportMsg，
 *    即早柚核心方向。type 1/2/6 是 OneBot、其余非早柚，不算冲突。
 *    注意读的是 config/config/ws-config.yaml（运行时配置），
 *    不是 config/default_config/ 下的出厂默认值。
 *
 * 2. 框架自带的 plugins/adapter/GSUIDCore.js
 *    面向旧版核心（等核心来连云崽），装着通常收不到东西，
 *    但它注册的 adapter 会让回环判断与账号绑定变复杂，仍值得提示。
 *
 * 检测失败一律静默：这只是个提示，不该因为读不到别人的文件而刷错误日志。
 */
import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"
import { YunzaiPath } from "@/dir"
import { log } from "@/utils"
import { checkFrameworkApis } from "@/utils/compat"

/** ws-plugin 中代表早柚核心方向的连接类型 */
const GSUID_TYPE = 3

/** 有 gsuid 连接的 ws-plugin 目录名（插件可能被改名，按 ws-config.yaml 存在与否判断） */
function findWsPluginConfigs() {
  const pluginsDir = path.join(YunzaiPath, "plugins")
  let names: string[] = []
  try {
    names = fs.readdirSync(pluginsDir)
  } catch {
    return []
  }

  const found: { dir: string; file: string }[] = []
  for (const name of names) {
    const file = path.join(pluginsDir, name, "config", "config", "ws-config.yaml")
    if (fs.existsSync(file)) found.push({ dir: name, file })
  }
  return found
}

/** 读出某个 ws-config.yaml 里所有早柚方向的连接名 */
function gsuidServers(file: string): string[] {
  let doc
  try {
    doc = YAML.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return []
  }

  const servers = doc?.servers
  if (!Array.isArray(servers)) return []

  return servers
    .filter(s => s && Number(s.type) === GSUID_TYPE && s.enable !== false)
    .map((s, i) => String(s.name || s.address || `#${i + 1}`))
}

/**
 * 检查并告警。在 client 启动后调用。
 */
export function checkConflicts() {
  try {
    for (const { dir, file } of findWsPluginConfigs()) {
      const names = gsuidServers(file)
      if (!names.length) continue
      log(
        "warn",
        `检测到 ${dir} 也配置了早柚核心连接（type: ${GSUID_TYPE}）：${names.join("、")}\n` +
          `同一条消息会被上报两次，核心侧插件将回复两遍。请二选一：\n` +
          `  · 保留本插件 —— 在 ${dir} 的配置里删掉这些连接，或把 enable 设为 false\n` +
          `  · 保留 ${dir} —— 把本插件配置改为 mode: off`,
      )
    }

    const builtin = path.join(YunzaiPath, "plugins", "adapter", "GSUIDCore.js")
    if (fs.existsSync(builtin)) {
      log(
        "warn",
        "检测到框架自带的 plugins/adapter/GSUIDCore.js。\n" +
          "它面向旧版核心（等核心来连云崽），与当前核心行为已不一致，建议删除以免干扰账号绑定与回环判断。",
      )
    }

    checkFrameworkApis()
  } catch (err) {
    // 提示性功能，不该因自身异常影响启动
    log("debug", ["冲突检测失败", err], undefined, true)
  }
}
