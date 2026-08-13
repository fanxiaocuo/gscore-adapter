/**
 * 机器人档案：按账号取头像、昵称与在线状态
 *
 * 供 Web 面板（bind 管理）与出图（连接列表的 bind 胶囊）共用。
 *
 * 头像与昵称在各适配器上的位置（对源码核实过）：
 *   QQBot-Plugin   Bot[id].nickname（getter → info.username）、Bot[id].avatar
 *                  （getter → info.avatar，形如 q.qlogo.cn/g?b=qq&nk=<uin>，index.js:1893）
 *   ICQQ-Plugin    Bot[uin].nickname（icqq Client 自带）；avatar 无直接属性，
 *                  按 QQ 号拼 qlogo
 *   TRSS 其余适配器 大多按约定填 bot.nickname / bot.avatar，读不到就回退
 *
 * 为什么只查 Bot.bots 而不是 Bot[id]
 * --------------------------------
 * TRSS 的 Bot 是个 Proxy，未知键会兜底到随机一个在线 Bot（lib/bot.js，
 * index.ts 顶部那段注释记的就是这个坑）。拿它判「这个账号在不在线」，
 * 任何账号都会显示在线且顶着别人的头像。Bot.bots 是普通对象，没有这层魔法。
 * Miao-Yunzai 没有 bots 表，但它只有一个账号 —— Bot 自身就是，按 uin 比对。
 */
import { isQQBotAppId } from "./platform.js"

export interface BotProfile {
  /** 账号（self_id） */
  id: string
  /** 昵称，取不到时等于账号 */
  name: string
  /** 头像 URL，可能为空串（消费方回退成首字圆） */
  avatar: string
  /** 是否在线（框架里有实例） */
  online: boolean
}

/** 安全字符串化：null/undefined 归空串 */
function s(v: unknown): string {
  return v == null ? "" : String(v)
}

/** 取某账号的 Bot 实例，取不到返回 null（绝不走 TRSS 的随机兜底 Proxy） */
function pickBot(id: string): Record<string, any> | null {
  const B: any = globalThis.Bot
  if (!B) return null
  try {
    const bot = B.bots?.[id]
    if (bot) return bot
    // Miao-Yunzai：Bot 自身就是唯一账号（uin 是单个数字，不是 TRSS 的数组）
    if (B.uin != null && !Array.isArray(B.uin) && String(B.uin) === id) return B
  } catch {
    // 读 Proxy/getter 出错一律当离线
  }
  return null
}

/**
 * 按账号取档案。离线账号也尽量给头像：
 * 纯数字的 QQ 号 / 官方 bot 的 appid 都能从 qlogo 按号取图
 * （官方 bot 的写法与 QQBot-Plugin 给自己的头像一致）。
 */
export function botProfile(id: string | number): BotProfile {
  const sid = s(id)
  const bot = pickBot(sid)

  let name = ""
  let avatar = ""
  try {
    name = s(bot?.nickname) || s(bot?.info?.username)
    avatar = s(bot?.avatar) || s(bot?.info?.avatar)
  } catch {
    // nickname/avatar 是 getter，个别适配器实现可能抛；档案宁缺毋错
  }

  if (!avatar && (/^\d{5,12}$/.test(sid) || isQQBotAppId(sid)))
    avatar = `https://q.qlogo.cn/g?b=qq&s=100&nk=${sid}`

  return { id: sid, name: name || sid, avatar, online: !!bot }
}

/**
 * 当前在线的机器人清单，供面板的「添加绑定」候选
 *
 * TRSS 的 Bot.uin 是数组（Object.assign([], …) 那个），Miao 是单个数字。
 * 空串要滤掉：QQBot 的 token 拆分异常时可能出现 "" 账号。
 */
export function onlineBots(): BotProfile[] {
  const B: any = globalThis.Bot
  if (!B) return []
  const ids: string[] = Array.isArray(B.uin)
    ? [...new Set<string>(Array.from(B.uin, x => s(x)))]
    : B.uin != null
      ? [s(B.uin)]
      : []
  return ids.filter(Boolean).map(botProfile)
}
