/**
 * 锅巴（Guoba-Plugin）配置面板
 *
 * 由根目录 guoba.support.js 转调。锅巴不存在时这些代码不会被执行。
 *
 * 写盘走 config 模块的 saveConfig（yaml Document 增量改写），
 * 因此默认配置里的注释不会因为过一遍面板就被冲掉。
 */
import { PluginPath, PluginName } from "@/dir"
import { config, configFile, saveConfig } from "@/config"
import { reloadClients } from "@/modules/client"
import { baseSchemas } from "./schemas/base.js"
import { clientSchemas } from "./schemas/client.js"
import { filterSchemas } from "./schemas/filter.js"

/** 锅巴按点号路径读值 */
function getValue(path: string) {
  return path.split(".").reduce<any>((obj, key) => obj?.[key], config)
}

export function supportGuoba() {
  return {
    pluginInfo: {
      name: PluginName,
      title: "早柚核心适配器",
      author: "@fanxiaocuo",
      description: "早柚核心（gsuid_core）适配器，云崽主动连接核心",
      // 仅用于面板展示，取不到时锅巴自己会兜底
      iconColor: "#7c69ef",
      isV3: true,
      isV2: false,
      showInMenu: true,
    },
    configInfo: {
      schemas: [...baseSchemas, ...clientSchemas, ...filterSchemas],

      getConfigData() {
        const data: Record<string, any> = {}
        for (const schema of [...baseSchemas, ...clientSchemas, ...filterSchemas]) {
          // Divider 没有 field
          if (!("field" in schema) || !schema.field) continue
          data[schema.field] = getValue(schema.field)
        }
        return data
      },

      setConfigData(data: Record<string, any>, { Result }) {
        // enable 改动需要重启才生效（连接在 online 时拉起），
        // client.* 可以靠 reloadClients 热生效，这里据此给出不同提示
        let needRestart = false
        let touchedClient = false

        try {
          saveConfig(doc => {
            for (const [field, value] of Object.entries(data)) {
              if (value === undefined) continue
              const path = field.split(".")
              // 值没变就不写，避免把用户手写的等价格式（如 'a' vs "a"）改掉
              if (JSON.stringify(getValue(field)) === JSON.stringify(value)) continue
              if (field === "enable") needRestart = true
              if (path[0] === "client") touchedClient = true
              doc.setIn(path, value)
            }
          })
        } catch (err: any) {
          logger.error(`[${PluginName}] 保存配置失败：`, err)
          return Result.error(`保存失败：${err?.message || err}，可手动编辑 ${configFile}`)
        }

        if (touchedClient) reloadClients()
        if (needRestart) return Result.ok({}, "保存成功，启用开关需重启云崽生效")
        return Result.ok({}, "保存成功~")
      },
    },
  }
}

// 供锅巴读取插件根目录（部分版本会用到）
export const guobaPluginPath = PluginPath
