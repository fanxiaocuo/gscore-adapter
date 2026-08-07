/**
 * 测试总入口：依次跑完所有套件，任一失败则整体失败。
 *
 * 各套件都由 import.meta.url 推出插件目录，不依赖工作目录；
 * 这里仍切到框架根目录，是为了让套件里对框架的 import 与真实运行时一致。
 *
 * 注意：套件跑的是 lib/ 下的编译产物，改完 src/ 需要先 pnpm build。
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"

const testDir = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.dirname(testDir)
const rootDir = path.resolve(pluginDir, "../..")

if (!fs.existsSync(path.join(pluginDir, "lib", "index.js"))) {
  console.error("\x1b[31m找不到 lib/ 编译产物，请先执行 pnpm build\x1b[0m")
  process.exit(1)
}

// 套件目录与 src/ 的模块划分一致：
//   modules/     单个模块的行为
//   apps/        指令类
//   integration/ 跨模块与真实 ws 往返
// conflict 只用退出码表达结果，没有「=== 结果 ===」汇总行，
// 所以这里一律以退出码为准，不去解析各套件的输出格式。
const suites = [
  "modules/client",
  "modules/notice",
  "modules/server",
  "apps/admin",
  "integration/e2e",
  "integration/conflict",
]
const failed = []

for (const name of suites) {
  console.log(`\n\x1b[36m━━━ ${name} ━━━\x1b[0m`)
  const { status } = spawnSync(process.execPath, [path.join(testDir, `${name}.js`)], {
    cwd: rootDir,
    stdio: "inherit",
  })
  if (status !== 0) failed.push(name)
}

console.log(`\n${"═".repeat(40)}`)
if (failed.length) {
  console.log(`\x1b[31m${failed.length}/${suites.length} 个套件失败：${failed.join("、")}\x1b[0m`)
  process.exit(1)
}
console.log(`\x1b[32m全部 ${suites.length} 个套件通过\x1b[0m`)
