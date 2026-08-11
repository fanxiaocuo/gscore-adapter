/**
 * 配置增量升级
 *
 * 这套逻辑会**改用户已有的配置文件**，是全插件唯一一处这么做的地方，
 * 所以每条分支都要有用例兜着。全程在临时文件上跑，不碰 config/config.yaml。
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import YAML from "yaml"

globalThis.Bot = { makeLog: () => {} }
globalThis.logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, mark: () => {} }

const { upgradeUserConfig } = await import("../src/config/upgrade.ts")

let n = 0
/**
 * 把内容写进临时文件，跑一次升级，返回 { changes, text, parsed }
 *
 * parsed 对故意写坏的用例会是 undefined —— 那种用例只看 changes 与 text。
 */
function upgrade(yaml) {
  const file = path.join(os.tmpdir(), `gscore-upgrade-${process.pid}-${n++}.yaml`)
  fs.writeFileSync(file, yaml)
  try {
    const changes = upgradeUserConfig(file)
    const text = fs.readFileSync(file, "utf8")
    let parsed
    try {
      parsed = YAML.parse(text)
    } catch {
      parsed = undefined
    }
    return { changes, text, parsed }
  } finally {
    fs.rmSync(file, { force: true })
  }
}

test("用户手写的注释不会被补键带走", () => {
  // yaml 把文件开头的注释挂在第一个键上，往文件里加东西时很容易连它一起丢
  const r = upgrade("# 我自己写的说明\nenable: false\n")
  assert.match(r.text, /我自己写的说明/, "用户注释必须保留")
  assert.equal(r.parsed.enable, false, "用户的值不能被动")
})

test("缺失的顶层项连注释一起补进来", () => {
  const r = upgrade("enable: true\n")
  // update_check 是后来才加进默认配置的，正是这个功能要解决的场景
  assert.ok(r.parsed.update_check, "该补上 update_check")
  assert.equal(typeof r.parsed.update_check.interval, "number")
  assert.match(r.text, /定时检查插件仓库/, "注释要跟着搬过来")
  assert.ok(r.changes.includes("+ update_check"))
})

test("已有的键一律不动", () => {
  const r = upgrade("enable: true\nmedia_max_size: 123456\nfilter:\n  report_group: false\n")
  assert.equal(r.parsed.media_max_size, 123456, "用户改过的值不能被默认值覆盖")
  assert.equal(r.parsed.filter.report_group, false)
  // 只补顶层：filter 下面缺的子项由运行时 merge 兜，不往用户文件里塞
  assert.ok(!("report_private" in r.parsed.filter))
})

test("连接列表不被动", () => {
  const r = upgrade("enable: true\nclient:\n  connections:\n    - name: a\n      url: ws://x/ws/Y\n")
  assert.equal(r.parsed.client.connections.length, 1)
  assert.equal(r.parsed.client.connections[0].name, "a")
})

test("幂等：升级过的文件再跑一次不再改动", () => {
  const file = path.join(os.tmpdir(), `gscore-upgrade-idem-${process.pid}.yaml`)
  fs.writeFileSync(file, "enable: true\n")
  try {
    assert.ok(upgradeUserConfig(file).length > 0, "第一次该有改动")
    const once = fs.readFileSync(file, "utf8")
    assert.deepEqual(upgradeUserConfig(file), [], "第二次不该再有改动")
    assert.equal(fs.readFileSync(file, "utf8"), once, "文件内容不该再变")
  } finally {
    fs.rmSync(file, { force: true })
  }
})

test("yaml 写坏了就原样放着，不抛也不改", () => {
  const broken = "enable: true\n  bad indent: ["
  const r = upgrade(broken)
  assert.deepEqual(r.changes, [], "解析不了就不该报告改动")
  assert.equal(r.text, broken, "文件必须原样保留，交给配置读取那边去报错")
})

test("文件不存在时安静返回", () => {
  const missing = path.join(os.tmpdir(), `gscore-upgrade-missing-${process.pid}.yaml`)
  assert.deepEqual(upgradeUserConfig(missing), [])
  assert.ok(!fs.existsSync(missing), "不该顺手把文件创建出来")
})
