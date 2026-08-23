/**
 * @description 锅巴（Guoba-Plugin）配置面板，由根目录 guoba.support.js 转调
 * 注意：写盘只走 saveConfig 的 yaml Document 增量改写，否则用户注释会被冲掉
 */
import { PluginPath, PluginName, ResPath } from "@/dir"
import { config, configFile, saveConfig, saveConnectionConfig } from "@/config"
import { MEDIA_SIZE_MAX } from "@/constants"
import { syncConnectionAccounts } from "@/config/botmap.js"
import { applyConnections, reloadClients } from "@/modules/client"
import { baseSchemas, SCALED_FIELDS } from "./schemas/base.js"
import { clientSchemas } from "./schemas/client.js"
import { filterSchemas, BLACK_USER_MANUAL_FIELD } from "./schemas/filter.js"
import { join } from "node:path"
import type { guoba } from "trss-yunzai"

/**
 * @description 面板上的全部配置项
 * 注意：必须每次调用重算，提成模块级常量会冻在首次 import 的时刻（那时账号还没登录完，
 * client 那节的账号候选会永远是空的）
 */
function buildSchemas() {
  return [...baseSchemas, ...clientSchemas(), ...filterSchemas]
}

/** 用户黑名单真正落盘的 key，选择器与手输两栏都归到它 */
const BLACK_USER_FIELD = "filter.black_user"

/** 锅巴按点号路径读值 */
function getValue(path: string): unknown {
  let value: unknown = config
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

/**
 * @description 所有在线账号已知的好友 id，String 化以便与配置里的值直接比对
 * @returns 取不到时返回 null，调用方据此把整份名单都归给手输那栏 —— 当成「都不是好友」会让
 *          选择器空着，用户一按保存就把名单抹平
 */
function friendIds(): Set<string> | null {
  try {
    // Miao-Yunzai 的 Bot 是 icqq Client，没有 getFriendMap，只有 fl
    const fl = globalThis.Bot?.getFriendMap?.() ?? globalThis.Bot?.fl
    if (!fl) return null
    return new Set(Array.from(fl.keys(), id => String(id)))
  } catch {
    return null
  }
}

/** 同一个 id 只留一份。数字 123 与字符串 "123" 算同一个，passFilter 也是这么比的 */
function dedupeIds(list: unknown[]): unknown[] {
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const id of list) {
    const key = String(id)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(id)
  }
  return out
}

/**
 * @description 把用户黑名单拆给两栏：好友列表里认得的归 GSelectFriend，其余归手输的 GTags
 * 见 schemas/filter.ts 里 BLACK_USER_MANUAL_FIELD 的说明
 */
function splitBlackUser(value: unknown): { picked: unknown[]; manual: unknown[] } {
  const list = Array.isArray(value) ? value : []
  const known = friendIds()
  if (!known) return { picked: [], manual: list }
  const picked: unknown[] = []
  const manual: unknown[] = []
  for (const id of list) (known.has(String(id)) ? picked : manual).push(id)
  return { picked, manual }
}

/**
 * @description 面板显示值与落盘值的单位换算（见 schemas/base.ts 的 SCALED_FIELDS）
 * 注意：只认有限数字，缺省/字符串/null 原样返回，别在这里补默认值 —— 那等于把「用户没配过」
 * 悄悄写成一个具体数
 */
function toDisplay(field: string, value: unknown): unknown {
  const scale = SCALED_FIELDS[field]
  if (!scale || typeof value !== "number" || !Number.isFinite(value)) return value
  // 除不尽时留两位，避免 10485761 字节显示成一长串小数
  return Math.round((value / scale.divisor) * 100) / 100
}

/**
 * @description 面板值换算回落盘值；这三栏只接受真数字，其余一律返回 undefined 表示「这栏不写」
 * 注意：不能用 Number() 兜 —— 清空输入框时 InputNumber 发 null，Number(null) 是 0，而下游把 0
 * 当「没配」换成默认值（utils/media.ts 的 `|| 默认`），于是面板显示 0、实际跑 10 MiB。原样返回
 * 也不行：那会把 null / "" 写进 yaml。写盘循环跳过 undefined，交给它保住原值
 */
function toStored(field: string, value: unknown): unknown {
  const scale = SCALED_FIELDS[field]
  if (!scale) return value
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const n = value
  // 字节数必须是整数：0.33 MiB 乘出来是 346030.08，写进 yaml 会带小数
  const stored = Math.round(n * scale.divisor)

  // 注意：面板没动过这一栏就原样留着 —— toDisplay 收两位小数，乘回去是另一个数
  //（5000000 显示成 4.77 MB，存回来变 5001708），否则保存别的项会顺手改了它
  const current = getValue(field)
  if (typeof current === "number" && Number.isFinite(current) && toDisplay(field, current) === n)
    return current

  return stored
}

/**
 * @description 三个换算字段落盘值的硬边界，单位与落盘一致（字节 / 毫秒）
 * 注意：schemas/base.ts 里的 min/max 只是面板控件的提示，绕过前端（或换个不 clamp 的锅巴版本）
 * 就能写进任意值，所以服务端必须再拦一遍 —— 与 #早柚设置、web 面板同一条线，共用 MEDIA_SIZE_MAX
 */
const STORED_BOUNDS: Record<
  string,
  { label: string; unit: string; min: number; minText: string; max?: number; maxText?: string }
> = {
  media_max_size: {
    label: "媒体内联上限",
    unit: "MiB",
    min: 1024,
    minText: "1 KiB",
    max: MEDIA_SIZE_MAX,
    maxText: `${MEDIA_SIZE_MAX / 1048576} MiB`,
  },
  file_max_size: {
    label: "文件大小上限",
    unit: "MiB",
    min: 1024,
    minText: "1 KiB",
    max: MEDIA_SIZE_MAX,
    maxText: `${MEDIA_SIZE_MAX / 1048576} MiB`,
  },
  // 不设上限：有效期长只是外链多占一会儿内存，是合理选择（同 schemas/base.ts 的注释）
  link_expire: { label: "外链有效期", unit: "秒", min: 1000, minText: "1 秒" },
}

/**
 * @description 校验换算后的落盘值，越界时给出用户看的那句话，没问题返回 null
 * 注意：报的数字要换回面板单位 —— 面板按 MiB / 秒 收，报字节数用户看不出自己填的是 256 GiB；
 * 非有限数字一律放过，那是 toStored 的「这栏不写」而不是错误
 */
function boundsError(field: string, stored: unknown): string | null {
  const bound = STORED_BOUNDS[field]
  if (!bound || typeof stored !== "number" || !Number.isFinite(stored)) return null
  const divisor = SCALED_FIELDS[field]?.divisor ?? 1
  const got = Math.round((stored / divisor) * 100) / 100
  if (stored < bound.min) return `${bound.label}至少 ${bound.minText}，收到 ${got} ${bound.unit}`
  if (bound.max !== undefined && stored > bound.max)
    return `${bound.label}最多 ${bound.maxText}，收到 ${got} ${bound.unit}`
  return null
}

export function supportGuoba() {
  // 建一次，schemas 与 getConfigData 共用 —— 后者只用到 field 名，跟候选新旧无关
  const schemas = buildSchemas()

  return {
    pluginInfo: {
      name: PluginName,
      title: "早柚核心适配器",
      author: "@fanxiaocuo",
      authorLink: "https://github.com/fanxiaocuo",
      link: "https://github.com/fanxiaocuo/gscore-adapter",
      description: "早柚核心（gsuid_core）适配器，云崽主动连接核心",
      // 本地文件绝对路径（锅巴 iconPath 约定），不借 iconify 的近似图标。
      // 注意：必须是 .webp —— release / preview 两条流水线都会 rm 掉同目录的 logo.png
      iconPath: join(ResPath, "template/image/logo.webp"),
      // iconPath 取不到时锅巴回落到色块，仍给一个主题色
      iconColor: "#7c69ef",
      isV3: true,
      isV2: false,
      showInMenu: true,
    },
    configInfo: {
      schemas,

      getConfigData() {
        const data: Record<string, unknown> = {}
        for (const schema of schemas) {
          // Divider 没有 field
          if (!("field" in schema) || !schema.field) continue
          data[schema.field] = toDisplay(schema.field, getValue(schema.field))
        }
        // 一份 black_user 分给两个控件显示
        const { picked, manual } = splitBlackUser(data[BLACK_USER_FIELD])
        data[BLACK_USER_FIELD] = picked
        data[BLACK_USER_MANUAL_FIELD] = manual
        return data
      },

      /**
       * @param Result 锅巴自己的返回结果类，由它注入 —— 插件不 import 它
       *               （锅巴不装时这个模块整个不会被执行），只标类型
       */
      setConfigData(data: Record<string, unknown>, { Result }: { Result: typeof guoba.Result }) {
        // 手输那栏是伪字段：先并回 filter.black_user 再摘掉，否则 config.yaml 里会
        // 多出一个没人读的 filter.black_user_manual
        const fields = { ...data }
        // 注意：换算必须在下面那句「值没变就不写」之前 —— 拿 MB 去比字节会每次都判成有改动
        for (const field of Object.keys(SCALED_FIELDS)) {
          if (fields[field] === undefined) continue
          const stored = toStored(field, fields[field])
          // 只校验真会改动的值。值没变就不校验 —— 它下面那句「值没变就不写」本来也不会落盘，
          // 拦它只会让用户手写在 yaml 里的越界值（media_max_size: 999999999）把每一次无关
          // 保存都变成失败，而面板上根本没有能改它的入口，用户只能去翻 yaml。
          // 越界值仍然逃不掉：凡是经面板填出来的，换算后必然与当前落盘值不同
          if (stored !== getValue(field)) {
            const err = boundsError(field, stored)
            // 一栏越界就整份不写：与 #早柚设置、web 面板一致，别落一半
            if (err) return Result.error(`保存失败：${err}`)
          }
          fields[field] = stored
        }

        if (BLACK_USER_MANUAL_FIELD in fields) {
          const manual = fields[BLACK_USER_MANUAL_FIELD]
          const picked = fields[BLACK_USER_FIELD]
          delete fields[BLACK_USER_MANUAL_FIELD]
          fields[BLACK_USER_FIELD] = dedupeIds([
            ...(Array.isArray(picked) ? picked : []),
            ...(Array.isArray(manual) ? manual : []),
          ])
        }

        // enable 由 index.ts 的 onConfigReload 热起停，client.* 靠下面的收敛，
        // 两者都不需要重启，所以这里只有成功/失败两种提示
        let touchedClient = false
        // 注意：心跳是建连时读的，必须 reloadClients；别把其余 client.* 也混进来 ——
        // 那会让所有连接一起断线重连，退避期间消息真的丢
        let touchedHeartbeat = false

        try {
          const connectionsTouched =
            fields["client.connections"] !== undefined &&
            JSON.stringify(getValue("client.connections")) !==
              JSON.stringify(fields["client.connections"])
          const persist = connectionsTouched ? saveConnectionConfig : saveConfig

          persist(doc => {
            for (const [field, value] of Object.entries(fields)) {
              if (value === undefined) continue
              const path = field.split(".")
              // 值没变就不写，避免把用户手写的等价格式（如 'a' vs "a"）改掉
              if (JSON.stringify(getValue(field)) === JSON.stringify(value)) continue
              if (path[0] === "client") touchedClient = true
              if (field === "client.heartbeat" || field === "client.heartbeat_timeout")
                touchedHeartbeat = true
              doc.setIn(path, value)
            }
            // 锅巴整表写回连接列表，不会走指令那条 writeAccountBotId
            if (connectionsTouched) syncConnectionAccounts(doc, config.bot_id_map)
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.error(`[${PluginName}] 保存配置失败：`, err)
          return Result.error(`保存失败：${message}，可手动编辑 ${configFile}`)
        }

        if (touchedHeartbeat) reloadClients()
        else if (touchedClient) applyConnections()
        return Result.ok({}, "保存成功~")
      },
    },
  }
}

// 供锅巴读取插件根目录（部分版本会用到）
export const guobaPluginPath = PluginPath
