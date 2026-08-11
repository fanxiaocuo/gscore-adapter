/**
 * 用户配置的增量升级
 *
 * 问题
 * ----
 * 首次运行会把 default_config.yaml **整份复制**成 config/config.yaml。之后插件
 * 升级、默认配置里加了新项，用户那份不会跟着长 —— 运行时 merge 兜得住值
 * （config/index.ts 的 merge：默认打底、用户覆盖），功能不会坏，但那些新项在
 * 用户的文件里**根本看不到**：既不知道有这么个开关，也读不到解释它的注释。
 *
 * 实际发生过：update_check 整段是后加的，早期装的用户配置里没有它。
 *
 * 做法
 * ----
 * 启动时比顶层键，缺的从默认文件里**连注释一起**搬过来，追加到用户文件末尾。
 * 已有的键一律不碰 —— 值是用户改过的，注释也可能是用户自己写的。
 *
 * 为什么只比顶层
 * -------------
 * 往深了比就要面对「用户是不是故意删掉某个子项」的问题，而子项缺失由 merge
 * 兜住、语义上没有歧义。顶层缺失才是「整块功能不可见」，这一层收益最大、风险最小。
 * 唯一的例外是 client.connections：那是用户的连接列表，绝不能动。
 *
 * 保留注释靠 yaml 的 Document API：把默认文件解析成 Document，取出那个键对应的
 * 节点（yaml 库把注释挂在节点的 comment / commentBefore 上），整节点塞进用户
 * 的 Document 再序列化。用 YAML.stringify(值) 会把注释全丢掉。
 */
import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"
import { ConfigPath, PluginPath } from "@/dir"
import { unflow } from "./yaml.js"

const defFile = path.join(ConfigPath, "default_config.yaml")

/**
 * 补齐用户配置里缺失的顶层键
 *
 * @returns 变更说明，没有任何改动时返回空数组
 */
export function upgradeUserConfig(userFile: string): string[] {
  const changes: string[] = []
  let userSrc: string
  let defSrc: string
  try {
    userSrc = fs.readFileSync(userFile, "utf8")
    defSrc = fs.readFileSync(defFile, "utf8")
  } catch {
    // 用户文件还不存在（首次运行会整份复制，没有可补的），或默认文件读不到
    return changes
  }

  let userDoc: any
  let defDoc: any
  try {
    userDoc = YAML.parseDocument(userSrc)
    defDoc = YAML.parseDocument(defSrc)
  } catch {
    // 用户把 yaml 写坏了。这里不该抛 —— 配置读取那边会报错并退回默认值，
    // 让那条路径去提示，比在升级逻辑里炸掉启动好
    return changes
  }
  if (userDoc.errors?.length || defDoc.errors?.length) return changes

  for (const item of defDoc.contents?.items || []) {
    const key = String(item.key?.value ?? "")
    if (!key || userDoc.has(key)) continue
    // 整节点搬（含 commentBefore / comment），值与注释一起过去
    userDoc.add(item)
    changes.push(`+ ${key}`)
  }

  if (!changes.length) return changes

  // 写盘前先自查一遍：解析不回来就别写，宁可保持原样。
  // unflow 与 saveConfig 那条路共用，理由见它的注释（flow 标记记在节点上，
  // toString 的选项管不着，一行两百字符的 connections 就是这么来的）
  const out = unflow(userDoc).toString({ lineWidth: 0 })
  try {
    const check = YAML.parse(out)
    if (!check || typeof check !== "object") return []
  } catch {
    return []
  }

  // 备份一份再写。这是唯一一处「插件主动改用户已有配置」的地方，
  // 出了问题要能原样找回来。
  //
  // 只在 .bak 不存在时写 —— 原来是每次升级都 copyFileSync 覆盖，于是这份备份
  // 记的永远是「上一次升级前」的样子。而它真正的用途是「插件第一次动我的文件之前
  // 长什么样」，那一份被覆盖掉就再也回不去了（实际发生过：用户的 .bak 只剩 13 字节）。
  // 已存在就跳过，这一步失败也不阻断升级 —— 下面的写入本身是原子替换。
  try {
    const bak = path.join(PluginPath, "config", "config.yaml.bak")
    if (!fs.existsSync(bak)) fs.copyFileSync(userFile, bak)
  } catch {
    // 备份失败不阻断升级
  }
  fs.writeFileSync(userFile, out)
  return changes
}
