/**
 * @description 落盘前的最后一道门：这份完整候选配置能不能存
 * 纯函数 —— 不读 config、不碰 clients、不打日志、不写盘，全部信息从入参来。一读 config 就答不了它唯一
 * 想回答的那个问题「存下去会怎样」（那时磁盘上还是旧的那份），而 watcher 手里压根没有「当前配置」可读。
 * 会造成重复上传、账号被跳过、或用户这次操作不生效的进 errors，调用方据此放弃写盘；只是「该迁移了」的进 warnings。
 * 注意：判定必须收在这一处 —— 四个入口各自拿「改完的那一条」去判，同一份配置会得到四种答案，
 * 最松的那条把坏配置写进磁盘。
 * 注意：全局开关（适配器总开关、ws 总开关）有意不在这里判，那是「现在要不要连」，见 lifecycle.planClients。
 * 注意：别拿 {@link ExpandError.skipped} 当阻塞/警告的分界 —— 重复上传恰好是两条连接都起来了才成立的。
 */
import type { RuntimeWsConnection, WsConnection } from "@/types"
import { readIds } from "@/utils/ids.js"
import { coreKey } from "@/utils/url.js"
import { expandConnections, requireAccounts, sourceLabel } from "./expand.js"

/**
 * @description 「本次操作要求保存后必须还在」的目标：某条来源、或它上头的某个账号必须在最终计划里有连接
 * 校验器看不见用户刚点了什么，而最坏的失败只在「意图」这个维度成立：配置合法、别的连接都在跑，唯独用户
 * 这次要的那一条没进计划，回执却说「已绑定」「已启用」。
 * 注意：扁平数组而不是给编辑/新增/绑定/开关各开一个字段 —— 那等于把逐字相同的判据抄四遍，
 * 下一个入口漏掉时不报错，只是静静地不校验。
 */
export interface RuntimeExpectation {
  /** 目标在候选列表里的下标，与 {@link RuntimeWsConnection.sourceIndex} 同源 */
  sourceIndex: number
  /**
   * 只关心某一个账号时填它；不填 = 「这条来源至少要有一条连接」
   *
   * 注意：绑定与合并新增必须填到账号级 —— 一条绑了多个账号的连接掉了其中一个账号时，
   * 来源级判据仍然满足，那次操作会失效得毫无声响。
   */
  account?: string
  /** 话术里的动作名，如「修改」「新增」「绑定」「启用」。由入口写死，不取用户输入 */
  action?: string
}

/** @description 一条判定结果，带上是哪一条连接出的问题，便于按来源筛（见 ExpandError.sourceIndex） */
export interface ValidationIssue {
  sourceIndex: number
  message: string
}

export interface ValidationResult {
  /** 能不能落盘。等价于 `!errors.length`，单独给一个是让调用方少写一次这个等价关系 */
  ok: boolean
  /**
   * 这份候选真正会跑起来的计划
   *
   * 一并返回是为了让调用方不必「校验一遍、写盘、再展开一遍」：一旦哪天两次展开不一致，
   * 用户拿到的是「校验通过」加一份谁也没校验过的计划。
   */
  runtime: RuntimeWsConnection[]
  /** 阻塞项：有一条就不该写盘 */
  errors: ValidationIssue[]
  /** 照常保存，但要让用户看见 */
  warnings: ValidationIssue[]
}

/**
 * @description 这条连接会不会替 account 上传事件 —— 与 GsCoreClient.accept(self_id) 同一套判据
 * 空 bind 表示「除 exclude 之外全放行」，而不是「不覆盖任何账号」。
 * 注意：这正是不能借用 utils/url.ts 的 findDuplicate 的地方 —— 它把「任一侧空 bind」当双向重复，
 * 于是一条空 bind 的兼容连接会顶掉用户想新加的每一条明确绑定，而他要的恰恰是第二条。
 * 注意：exclude 先判，尽管展开器已经减过一遍 —— 这里要与运行时那个真正决定「转不转发」的函数逐条对齐，
 * 不是与展开器的中间结果对齐；对不上时的症状是用户照着话术把账号排掉了、保存仍被拒。
 */
function servesAccount(conn: RuntimeWsConnection, account: string): boolean {
  if (readIds(conn.exclude).includes(account)) return false
  if (conn.automatic) return conn.account === account
  const bind = readIds(conn.bind)
  return !bind.length || bind.includes(account)
}

/**
 * @description 同一个核心上，兼容连接与账号级自动连接覆盖了同一个账号 = 那个账号的事件上传两遍
 * 症状是同一条命令被执行两次、群里回两遍。这是全部阻塞项里唯一「两条连接都好好地起来了」的一种，
 * 展开器只按路由与名字裁决、从不比较账号覆盖，算不出来，所以必须在这里算。
 * 注意：按核心分组（coreKey 只取协议+主机+端口），不分组会把「主核心按账号连 + 备核心用旧共享路径」
 * 这种正常的双核心用法误判成重复上传。
 * 注意：只拿兼容连接去比自动连接，兼容 × 兼容不管 —— 两条都是用户手写的自定义路径时没有依据判定该谁
 * 让路，拦下来只会把一份正在跑的配置锁死。自动 × 自动不可能重复，展开器已按 routeKey 跳掉后一条。
 */
function duplicateUploads(runtime: RuntimeWsConnection[]): ValidationIssue[] {
  const automatic = runtime.filter(conn => conn.automatic && conn.account)
  if (!automatic.length) return []

  /** 兼容连接的来源下标 -> 它重复上传的账号，以及被它重复的那些来源 */
  const hits = new Map<number, { name: string; accounts: Set<string>; sources: Set<number> }>()

  for (const compat of runtime) {
    if (compat.automatic) continue
    const core = coreKey(compat.runtimeUrl)
    for (const one of automatic) {
      if (coreKey(one.runtimeUrl) !== core) continue
      if (!servesAccount(compat, one.account)) continue
      let hit = hits.get(compat.sourceIndex)
      if (!hit)
        hits.set(
          compat.sourceIndex,
          (hit = { name: compat.runtimeName, accounts: new Set(), sources: new Set() }),
        )
      hit.accounts.add(one.account)
      hit.sources.add(one.sourceIndex)
    }
  }

  return [...hits].map(([sourceIndex, hit]) => ({
    sourceIndex,
    message:
      `连接 ${hit.name} 会和来源 ${[...hit.sources].map(i => `#${i + 1}`).join("、")} ` +
      `同时为账号 ${[...hit.accounts].join("、")} 上传同一批事件：核心侧把两条路径当成两个` +
      `客户端、各收一份，同一条命令会被执行两次、回两遍。` +
      // 三条出路都给全：少给一条，用户就只能靠删连接解决，而他可能两条都要
      `请给这条连接补上明确的 bind、把这些账号写进 exclude，或停用整条连接。`,
  }))
}

/**
 * @description 用户这次要的东西没进最终计划
 * 与其它阻塞项并列而不互相压制：路由冲突那句说的是原因（谁把它顶掉了），这句说的是后果（所以本次保存取消）。
 */
function missingTarget(
  list: WsConnection[],
  runtime: RuntimeWsConnection[],
  want: RuntimeExpectation,
): ValidationIssue | null {
  const { sourceIndex, account } = want
  const action = `本次${want.action || "改动"}`

  // 注意：下标越界是调用方算错了（多半拿了另一份列表的下标），不是「校验不通过」。
  // 放过去的话按下标写回会改到别的连接上，用户点的是 A、变的是 B，而回执一切正常
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= list.length)
    return {
      sourceIndex,
      message:
        `${action}指向的来源下标 ${String(sourceIndex)} 不在候选列表里（共 ${list.length} 条）。` +
        `继续写盘会改到别的连接上，已取消。`,
    }

  const served = runtime.some(
    conn => conn.sourceIndex === sourceIndex && (!account || servesAccount(conn, account)),
  )
  if (served) return null

  return {
    sourceIndex,
    message:
      `${action}要求连接 ${sourceLabel(list[sourceIndex], sourceIndex)}` +
      `${account ? ` 的账号 ${account}` : ""} 在保存后有运行时连接，但按这份配置它不会起来。` +
      `存下去的话面板会显示已生效而实际不连，已取消 —— ` +
      `请检查这条连接的绑定账号、exclude，以及有没有和别条连接落到同一条路由上。`,
  }
}

/**
 * @description 这份候选能不能落盘，附带它真正会跑起来的计划
 * @param list 完整候选列表（入口已在内存里改成想要保存的样子），不会被修改
 * @param expectations 本次操作要求保存后必须还在的目标；不传表示「只问这份配置合不合法」
 *   —— 锅巴整表保存与 watcher 就是这种没有具体诉求的调用方
 */
export function validateConnections(
  list: WsConnection[],
  expectations: RuntimeExpectation[] = [],
): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const { runtime, errors: expanded } = expandConnections(list)

  /**
   * 已经用 requireAccounts 的话术报过的来源
   *
   * 注意：这几条毛病展开器也会报一遍，两句都进 errors 就是同一件事说两遍、措辞还不一样。
   * 留 requireAccounts 那一份，因为指令与面板的前置校验用的就是它。
   */
  const preBlocked = new Set<number>()

  list.forEach((conf, sourceIndex) => {
    // 停用等于「这条不连」：它占不住路由、不上传事件，更不该因为自己没绑号而挡住整次保存
    if (conf.enable === false) return
    const why = requireAccounts(conf)
    if (!why) return
    preBlocked.add(sourceIndex)
    // 只加一层「是哪条连接」的前缀：requireAccounts 的返回值不含连接身份，而 errors 是
    // 拍平成一串给面板与日志的，不说是谁的话，多连接配置里用户没法对号入座
    errors.push({ sourceIndex, message: `连接 ${sourceLabel(conf, sourceIndex)}：${why}` })
  })

  for (const one of expanded) {
    if (!one.skipped) {
      // 警告一律照原样放行，包括 bind ∩ exclude 那句 —— 它往往正是「这条为什么没有有效账号」
      // 的成因，被上面那条阻塞顺手吞掉的话，用户只知道要绑号，不知道是 exclude 把它减掉的
      warnings.push({ sourceIndex: one.sourceIndex, message: one.message })
      continue
    }
    // 注意：按 sourceIndex 结构性去重，不比较话术 —— 拿字符串判「这两条说的是不是同一件事」
    // 等于把措辞冻成契约，改一个字就漏判或误判。安全的前提是 preBlocked 里那三种毛病都派生
    // 不出任何运行时连接，因此不会连带吞掉一条本该报出的路由/重名冲突
    if (!preBlocked.has(one.sourceIndex))
      errors.push({ sourceIndex: one.sourceIndex, message: one.message })
  }

  errors.push(...duplicateUploads(runtime))

  for (const want of expectations) {
    const miss = missingTarget(list, runtime, want)
    if (miss) errors.push(miss)
  }

  return { ok: !errors.length, runtime, errors, warnings }
}
