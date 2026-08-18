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
 *
 * client.connections 同样不往里补，但它另有一层更硬的理由：地址、bind、token 全是
 * 用户手里的东西，替他补一个默认值就是替他改路由。**唯一**允许写进连接项的动作是
 * 删掉已经完成迁移的连接级 `bot_id` —— 那一条例外的完整理由写在 {@link seedAccountBotIds}
 * 上，改这个文件之前先读那段，别按「这里说了绝不动连接项」把它当违规改动删掉。
 *
 * 保留注释靠 yaml 的 Document API：把默认文件解析成 Document，取出那个键对应的
 * 节点（yaml 库把注释挂在节点的 comment / commentBefore 上），整节点塞进用户
 * 的 Document 再序列化。用 YAML.stringify(值) 会把注释全丢掉。
 */
import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"
import type { Document, ParsedNode, YAMLMap } from "yaml"
import { ConfigPath, PluginPath } from "@/dir"
import { unflow } from "./yaml.js"
import { writeAccountBotId } from "./botmap.js"
// compat 只 import 了一个 type，不会与本文件成环
import { makeLog } from "@/utils/compat"

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

  let userDoc: Document.Parsed<ParsedNode>
  let defDoc: Document.Parsed<ParsedNode>
  try {
    userDoc = YAML.parseDocument(userSrc)
    defDoc = YAML.parseDocument(defSrc)
  } catch {
    // 用户把 yaml 写坏了。这里不该抛 —— 配置读取那边会报错并退回默认值，
    // 让那条路径去提示，比在升级逻辑里炸掉启动好
    return changes
  }
  if (userDoc.errors.length || defDoc.errors.length || !YAML.isMap(defDoc.contents)) return changes

  // 3.2 曾把连接列表改名为 client.ws_connections，现已改回 client.connections。
  // 中间版本写出的配置要迁回来，否则保存时对不存在的键做索引操作会抛
  // YAML collection 错误。只在新键不存在时改名，直接搬 Pair 节点以保留
  // 连接项和用户注释；两套键同时存在时不擅自合并（lifecycle 启动时会告警）。
  const client = userDoc.getIn(["client"], true)
  if (YAML.isMap(client) && client.has("ws_connections") && !client.has("connections")) {
    const legacy = client.items.find(
      item => YAML.isScalar(item.key) && String(item.key.value ?? "") === "ws_connections",
    )
    if (legacy && YAML.isScalar(legacy.key)) {
      legacy.key.value = "connections"
      changes.push("~ client.ws_connections -> client.connections")
    }
  }

  for (const item of defDoc.contents.items) {
    const key = YAML.isScalar(item.key) ? String(item.key.value ?? "") : ""
    if (!key || userDoc.has(key)) continue
    // 整节点搬（含 commentBefore / comment），值与注释一起过去
    userDoc.add(item)
    changes.push(`+ ${key}`)
  }

  // 绑定的账号在 bot_id_map 里各自有一行；顺带把连接级旧 bot_id 迁成账号级并删掉它
  seedAccountBotIds(userDoc, changes)

  if (!changes.length) return changes

  // 写盘前先自查一遍：解析不回来就别写，宁可保持原样。
  // unflow 与 saveConfig 那条路共用，理由见它的注释（flow 标记记在节点上，
  // toString 的选项管不着，一行两百字符的 ws_connections 就是这么来的）
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

function readIdList(item: YAMLMap, key: string): string[] {
  const node = item.get(key, true)
  if (!YAML.isSeq(node)) return []
  return [
    ...new Set(
      node.items.map(n => (YAML.isScalar(n) ? String(n.value ?? "").trim() : "")).filter(Boolean),
    ),
  ]
}

/**
 * 给每个绑定账号补一条 bot_id_map，并把连接级旧 `bot_id` 迁成账号级
 *
 * 补映射这件事不是一次性迁移：账号随时会加（指令、面板、手改配置都能加），而那一栏
 * 空着时平台标识只能落到 default 上，核心侧就会按错的平台回消息。已有记录不覆盖由
 * {@link writeAccountBotId} 把守，所以对已经配全的文件是空操作。
 *
 * 为什么这里可以写连接项（本文件头部说「绝不动连接项」的那个例外）
 * ------
 * 连接级 `bot_id` 是老版本的写法，它断言「这条连接上所有账号都是这个平台」，而运行时
 * 早就只读 `bot_id_map`（见 config/index.ts 的 resolveBotId）—— 也就是说这个字段现在
 * 是一份**已经不生效**的声明。留着它比删掉更坏：用户在里面写着 `bot_id: qqguild`，
 * 消息却按 onebot 上报，配置从头到尾看不出哪里错了。所以迁移必须连删除一起做，
 * 只写不删就变成「同一件事有两个真源，其中一个永远是死的」。
 *
 * 这是本文件唯一往连接项里写的动作，且只删这一个键：地址、bind、token、name 一概不碰。
 *
 * 为什么按 bind 减 exclude，而不是整个 bind
 * ------
 * 这个字段断言的是「**这条连接**转发的账号是什么平台」。被 exclude 掉的账号从这条连接
 * 派生不出任何运行时连接（见 client/expand.ts 的 effectiveAccounts），这条断言对它没有
 * 效力 —— 照搬过去就等于拿这条连接的平台去写另一条连接负责的账号，而写进去是不带
 * force 的（所以会一直留着），源字段又在同一次里被删掉，事后没有任何线索指得回来。
 *
 * 注意这与下面那轮 `writeAccountBotId(userDoc, id)` 的口径**故意不同**：那一轮的值来自
 * 账号自己的形状（guessPlatform 看前缀与 appid），跟哪条连接无关，给被排除的账号先补上
 * 也是对的 —— 用户把它绑回来时那一行本来就该是那个值。
 *
 * 关联不到账号时保留并告警，不静默丢
 * ------
 * bind 为空（自定义路径那种「全量转发」的连接就是这么写的），或者 bind 里的账号全被
 * exclude 掉了：此时没有任何账号能承接这条断言。删掉等于悄悄改变上报平台，所以字段
 * 留在原处、打一句 warn 让用户自己决定绑给谁。
 *
 * 告警**不进** changes：非空的 changes 会触发整份文档重新序列化写盘，还会打一句
 * 「配置已升级」—— 而这次什么也没升级。那会让每次启动都重写一遍文件（序列化结果可能
 * 与原文差字节），也让日志里那句话变成假话。
 */
function seedAccountBotIds(userDoc: Document.Parsed<ParsedNode>, changes: string[]) {
  const client = userDoc.getIn(["client"], true)
  if (!YAML.isMap(client)) return
  const seq = client.get("connections", true)
  if (!YAML.isSeq(seq)) return

  for (const [i, item] of seq.items.entries()) {
    if (!YAML.isMap(item)) continue
    const bind = readIdList(item, "bind")

    const legacy = item.get("bot_id", true)
    const platform = YAML.isScalar(legacy) ? String(legacy.value ?? "").trim() : ""
    if (platform) {
      const excluded = new Set(readIdList(item, "exclude"))
      const targets = bind.filter(id => !excluded.has(id))
      if (targets.length) {
        // 不带 force：账号级已有的值是用户显式记过的，优先级高于这条连接级断言
        for (const id of targets)
          if (writeAccountBotId(userDoc, id, platform)) changes.push(`+ bot_id_map.${id}`)
        // 删除放在写入之后、且无条件执行：即便所有目标账号都已有显式值（上面一行都没写成），
        // 这个字段承载的信息也已经在账号级表达完了，留着就是那份「死声明」。
        // 删掉同时也是幂等的保证 —— 下次启动这里读不到 bot_id，整段不再执行。
        item.delete("bot_id")
        // 序号用 1 起：插件其它所有面向用户的地方（连接 #N、连接序号 N）都是 1 起，
        // 这一句会原样出现在「配置已升级：…」里，独用 0 起会让人对不上号
        changes.push(`- 连接 #${i + 1} 的 bot_id`)
      } else {
        const name = YAML.isScalar(item.get("name", true))
          ? String(item.get("name") ?? "").trim()
          : ""
        // 走 compat 的 makeLog 而不是 `globalThis.Bot?.makeLog?.()`：升级发生在启动最早
        // 的一段，那时 Bot 未必已经装好 makeLog，而可选链在那种情况下**静默什么也不做**
        // —— 这一条恰恰是设计要求「不能静默丢弃」的那个分支，丢了就等于字段悄悄留着、
        // 没人知道它不生效。compat 会退到 globalThis.logger，那个在这一刻已经在了。
        makeLog(
          "warn",
          `连接 ${name || `#${i + 1}`} 的旧字段 bot_id: ${platform} 没有可迁移的账号` +
            `（bind 为空或全在 exclude 里），已原样保留。` +
            `运行时只读 bot_id_map，这一行当前不生效 —— ` +
            `请把它填进 bot_id_map 的对应账号行，或给这条连接补上 bind。`,
          "GsCore",
        )
      }
    }

    // 迁移之后再跑形状推断：上面刚写进去的值会让这一轮对同一批账号成为空操作
    // （writeAccountBotId 有值就不写），而被 exclude 的账号仍旧按自己的形状补上
    for (const id of bind) {
      if (writeAccountBotId(userDoc, id)) changes.push(`+ bot_id_map.${id}`)
    }
  }
}
