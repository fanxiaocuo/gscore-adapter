/**
 * 锅巴（Guoba-Plugin）配置面板
 *
 * 由根目录 guoba.support.js 转调。锅巴不存在时这些代码不会被执行。
 *
 * 写盘走 config 模块的 saveConfig（yaml Document 增量改写），
 * 因此默认配置里的注释不会因为过一遍面板就被冲掉。
 */
import { PluginPath, PluginName, ResPath } from "@/dir"
import { config, configFile, saveConfig } from "@/config"
import { reloadClients } from "@/modules/client"
import { baseSchemas } from "./schemas/base.js"
import { clientSchemas } from "./schemas/client.js"
import { filterSchemas } from "./schemas/filter.js"
import { join } from "node:path"
import type { guoba } from "trss-yunzai"

/** 锅巴按点号路径读值 */
function getValue(path: string): unknown {
  let value: unknown = config
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

export function supportGuoba() {
  return {
    pluginInfo: {
      name: PluginName,
      title: "早柚核心适配器",
      author: "@fanxiaocuo",
      authorLink: "https://github.com/fanxiaocuo",
      link: "https://github.com/fanxiaocuo/gscore-adapter",
      description: "早柚核心（gsuid_core）适配器，云崽主动连接核心",
      // 图标走绝对路径的本地文件（锅巴 pluginInfo 的 iconPath 约定），
      // 而不是 iconify 名字 —— 插件有自己的 logo，没必要借一个近似的图标。
      //
      // 必须是 .webp 而不是同目录那张 .png：位图母版不进产物，release /
      // preview 两条流水线都会 rm 掉 logo.png（788KB，页面只引用 webp），
      // 指向它等于在用户实际安装的分支上指了个不存在的文件。
      iconPath: join(ResPath, "template/image/logo.webp"),
      // iconPath 取不到时锅巴回落到色块，仍给一个主题色
      iconColor: "#7c69ef",
      isV3: true,
      isV2: false,
      showInMenu: true,
    },
    configInfo: {
      schemas: [...baseSchemas, ...clientSchemas, ...filterSchemas],

      getConfigData() {
        const data: Record<string, unknown> = {}
        for (const schema of [...baseSchemas, ...clientSchemas, ...filterSchemas]) {
          // Divider 没有 field
          if (!("field" in schema) || !schema.field) continue
          data[schema.field] = getValue(schema.field)
        }
        return data
      },

      /**
       * @param Result 锅巴自己的返回结果类，由它注入 —— 插件不 import 它
       *               （锅巴不装时这个模块整个不会被执行），只标类型
       */
      setConfigData(
        data: Record<string, unknown>,
        { Result }: { Result: typeof guoba.Result },
      ) {
        // enable 由 index.ts 的 onConfigReload 热起停，client.* 靠 reloadClients，
        // 两者都不需要重启，所以这里只有成功/失败两种提示
        let touchedClient = false

        try {
          saveConfig(doc => {
            for (const [field, value] of Object.entries(data)) {
              if (value === undefined) continue
              const path = field.split(".")
              // 值没变就不写，避免把用户手写的等价格式（如 'a' vs "a"）改掉
              if (JSON.stringify(getValue(field)) === JSON.stringify(value)) continue
              if (path[0] === "client") touchedClient = true
              doc.setIn(path, value)
            }
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.error(`[${PluginName}] 保存配置失败：`, err)
          return Result.error(`保存失败：${message}，可手动编辑 ${configFile}`)
        }

        if (touchedClient) reloadClients()
        return Result.ok({}, "保存成功~")
      },
    },
  }
}

// 供锅巴读取插件根目录（部分版本会用到）
export const guobaPluginPath = PluginPath
