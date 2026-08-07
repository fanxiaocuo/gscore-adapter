/**
 * 应用加载器
 *
 * 自动遍历 lib/apps/ 下的 .js 文件，把默认导出的 class 收集进 apps 表。
 * 参考 Yunzai-DF-Plugin 的 src/modules/loader/index.ts，
 * 这里按需精简：只取 default 导出，不处理具名导出。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { AppsDir, PluginName } from "@/dir"

/** 递归收集目录下所有 .js 文件 */
async function getJsFilePaths(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir, { withFileTypes: true })
    const jsFiles = []
    for (const file of files) {
      const pathname = path.join(dir, file.name)
      if (file.isDirectory()) jsFiles.push(...(await getJsFilePaths(pathname)))
      else if (file.name.endsWith(".js")) jsFiles.push(pathname)
    }
    return jsFiles
  } catch {
    return []
  }
}

/**
 * 载入 lib/apps/ 下所有应用
 * @returns { apps } 默认导出 class 按文件名收集
 */
export async function loadApps() {
  // 在函数内取起点：放模块顶层的话量到的是"从本模块被 import 到调用"的时间，
  // 中间还夹着适配器启动，数字会偏大
  const startTime = Date.now()
  const apps: Record<string, any> = {}
  let succeed = 0
  let failed = 0

  const files = await getJsFilePaths(AppsDir)
  await Promise.all(
    files.map(async file => {
      try {
        const mod = await import(pathToFileURL(file).href)
        const key = mod.default?.name
        if (key && typeof mod.default === "function" && mod.default.prototype) {
          apps[key] = mod.default
          succeed++
        } else {
          logger.warn(`[${PluginName}] 跳过无默认 class 导出: ${path.basename(file)}`)
        }
      } catch (error: any) {
        logger.error(`[${PluginName}] 载入 ${path.basename(file)} 错误：`, error)
        failed++
      }
    }),
  )

  const duration = Date.now() - startTime
  logger.info(
    `[${PluginName}] 应用加载完成：成功 ${succeed} 个，失败 ${failed} 个，耗时 ${duration}ms`,
  )
  return { apps }
}
