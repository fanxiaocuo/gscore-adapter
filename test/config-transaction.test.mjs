import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, beforeEach, test } from "node:test"

const ACCOUNT = "100000001"
const CORE = "ws://127.0.0.1:58765"
const OTHER_CORE = "ws://127.0.0.1:58766"

const logs = []
globalThis.Bot = {
  makeLog: (level, message, tag) => logs.push({ level, message, tag }),
  bots: {},
  uin: [],
  on: () => {},
}
globalThis.logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  mark: () => {},
}

const tempDir = mkdtempSync(path.join(tmpdir(), "gscore-config-transaction-"))
const configPath = path.join(tempDir, "config.yaml")
process.env.GSCORE_CONFIG = configPath

function fixture() {
  return [
    "enable: true",
    "client:",
    "  enable_ws: true",
    "  connections:",
    "    - name: 手写路径",
    `      url: ${CORE}/ws/Yunzai-${ACCOUNT}`,
    "    - name: 可修改连接",
    `      url: ${OTHER_CORE}`,
    `      bind: ["${ACCOUNT}"]`,
    "",
  ].join("\n")
}

function invalidFixture(withExtra = false) {
  return [
    "enable: true",
    "client:",
    "  enable_ws: true",
    "  connections:",
    "    - name: 手写路径",
    `      url: ${CORE}/ws/Yunzai-${ACCOUNT}`,
    "    - name: 冲突自动连接",
    `      url: ${CORE}`,
    `      bind: ["${ACCOUNT}"]`,
    ...(withExtra ? ["    - name: 保留连接", `      url: ${OTHER_CORE}`] : []),
    "",
  ].join("\n")
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForLog() {
  for (let i = 0; i < 40 && !logs.length; i++) await delay(25)
  assert.ok(logs.length, "配置监听器没有处理外部文件变更")
}

writeFileSync(configPath, fixture(), "utf8")

const {
  appendConnection,
  getWsConnections,
  removeConnection,
  saveConfig,
  stopConfigWatch,
  updateConnection,
} = await import("../src/config/index.ts")
const { supportGuoba } = await import("../src/modules/guoba/index.ts")
const guobaConfig = supportGuoba().configInfo

beforeEach(async () => {
  writeFileSync(configPath, fixture(), "utf8")
  saveConfig(() => {})
  await delay(100)
  logs.length = 0
})

after(async () => {
  await stopConfigWatch()
  rmSync(tempDir, { recursive: true, force: true })
})

test("无效候选连接不会写入磁盘或替换内存配置", () => {
  const beforeFile = readFileSync(configPath, "utf8")
  const beforeList = JSON.stringify(getWsConnections())

  assert.throws(() =>
    appendConnection({
      name: "自动连接",
      url: CORE,
      bind: [ACCOUNT],
    }),
  )

  assert.equal(readFileSync(configPath, "utf8"), beforeFile)
  assert.equal(JSON.stringify(getWsConnections()), beforeList)
})

test("修改连接造成路由冲突时不会写入磁盘或替换内存配置", () => {
  const beforeFile = readFileSync(configPath, "utf8")
  const beforeList = JSON.stringify(getWsConnections())

  assert.throws(() => updateConnection(1, { url: CORE }))

  assert.equal(readFileSync(configPath, "utf8"), beforeFile)
  assert.equal(JSON.stringify(getWsConnections()), beforeList)
})

test("监听器收到无效候选时保留当前有效内存配置", async () => {
  const beforeList = JSON.stringify(getWsConnections())

  writeFileSync(configPath, invalidFixture(), "utf8")
  await waitForLog()

  assert.equal(JSON.stringify(getWsConnections()), beforeList)
})

test("Guoba 保存无效连接表时拒绝写盘", () => {
  const beforeFile = readFileSync(configPath, "utf8")
  const beforeList = JSON.stringify(getWsConnections())
  const invalid = [
    { name: "手写路径", url: `${CORE}/ws/Yunzai-${ACCOUNT}` },
    { name: "冲突自动连接", url: CORE, bind: [ACCOUNT] },
  ]
  const Result = {
    error: message => ({ kind: "error", message }),
    ok: (value, message) => ({ kind: "ok", value, message }),
  }

  const result = guobaConfig.setConfigData({ "client.connections": invalid }, { Result })

  assert.equal(result.kind, "error")
  assert.equal(readFileSync(configPath, "utf8"), beforeFile)
  assert.equal(JSON.stringify(getWsConnections()), beforeList)
})

test("删除操作也不会保存仍然无效的完整候选表", () => {
  writeFileSync(configPath, invalidFixture(true), "utf8")
  saveConfig(() => {})

  const beforeFile = readFileSync(configPath, "utf8")
  const beforeList = JSON.stringify(getWsConnections())

  assert.throws(() => removeConnection(2))

  assert.equal(readFileSync(configPath, "utf8"), beforeFile)
  assert.equal(JSON.stringify(getWsConnections()), beforeList)
})
