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

const defFile = path.join(ConfigPath, "default_config.yaml")

/**
 * 老配置的 mode 迁移到 enable
 *
 * mode 只剩 client / off 两个值，等价于一个布尔；已废弃的 server / both 也只是
 * 「按 client 跑并提示改配置」。所以换成 enable: true/false。
 *
 * 在这里做一次性文件迁移，而不是在读取处长期兼容两个键：
 * **`mode: off` 的用户升级后绝不能被当成 enable 的默认值 true 而悄悄启用。**
 * 迁移改写文件，用户能看到自己的配置变成了什么；运行时双读则会留下一条
 * 「两个键都在、以谁为准」的长期歧义。
 */
function migrateMode(doc): string | null {
  if (!doc.has("mode")) return null
  const mode = String(doc.get("mode") ?? "").trim()
  // 只有明确写了 off 才是关。server / both 是已废弃的服务端方向，
  // 当初的行为就是「按 client 运行」，故迁移成开
  const enable = mode !== "off"

  const items = () => doc.contents?.items || []
  // 键可能是 Scalar 节点（解析出来的），也可能是裸字符串（doc.set 塞进去的），
  // 两种形状都要认
  const pairOf = k => items().find(it => (it.key?.value ?? it.key) === k)

  // mode 上挂着的注释要救出来
  // ------
  // yaml 把「键上方的注释」挂在 pair 的 **key 节点**上（不是 value —— 注意
  // doc.get(k, true) 返回的是 value，那上面没有 commentBefore），而文件开头的
  // 注释又会挂到第一个键上。直接 delete("mode") 会把用户写在文件顶部的说明
  // 一起带走。
  const keep = pairOf("mode")?.key?.commentBefore

  const had = doc.has("enable")
  if (!had) {
    // 必须用 createNode 造一个真正的 Scalar 键：doc.set("enable", v) 存的是
    // **裸字符串**键，字符串上挂不住 commentBefore，注释会被静默丢掉。
    doc.add(doc.createPair("enable", enable))
  }

  const pair: any = pairOf("enable")
  if (pair?.key && typeof pair.key === "object" && !pair.key.commentBefore) {
    const mine =
      " 是否启用适配器。false 则完全不连早柚核心（取代旧版的 mode: client/off）\n" +
      " 改这项需重启云崽生效"
    pair.key.commentBefore = keep ? `${keep}\n${mine}` : mine
  }

  // 挪到最前面：它是总开关，留在文件末尾读起来像个补丁
  if (!had) {
    const arr = items()
    const i = arr.indexOf(pair)
    if (i > 0) arr.unshift(arr.splice(i, 1)[0])
  }

  doc.delete("mode")
  return `mode: ${mode} -> enable: ${enable}`
}

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

  const modeChange = migrateMode(userDoc)
  if (modeChange) changes.push(modeChange)

  for (const item of defDoc.contents?.items || []) {
    const key = String(item.key?.value ?? "")
    if (!key || userDoc.has(key)) continue
    // mode 已被 enable 取代，别再把它从默认文件搬回来
    if (key === "mode") continue
    // 整节点搬（含 commentBefore / comment），值与注释一起过去
    userDoc.add(item)
    changes.push(`+ ${key}`)
  }

  if (!changes.length) return changes

  // 写盘前先自查一遍：解析不回来就别写，宁可保持原样
  const out = userDoc.toString({ lineWidth: 0 })
  try {
    const check = YAML.parse(out)
    if (!check || typeof check !== "object") return []
  } catch {
    return []
  }

  // 备份一份再写。这是唯一一处「插件主动改用户已有配置」的地方，
  // 出了问题要能原样找回来
  try {
    fs.copyFileSync(userFile, path.join(PluginPath, "config", "config.yaml.bak"))
  } catch {
    // 备份失败不阻断升级，下面的写入本身是原子替换
  }
  fs.writeFileSync(userFile, out)
  return changes
}
