/**
 * 客户端生命周期
 */
import { config, configFile, enabled, getWsConnections, wsEnabled } from "@/config"
import type { RuntimeWsConnection, WsConnection } from "@/types"
import { GsCoreClient } from "./GsCoreClient.js"
import { clients } from "./state.js"
import { onYunzaiMessage, onYunzaiNotice } from "./hooks.js"
import { expandConnections } from "./expand.js"
import { makeLog } from "@/utils/compat"

let hooked = false

/** 注册事件钩子（只注册一次） */
function hook() {
  if (hooked) return
  Bot.on("message", onYunzaiMessage)
  Bot.on("notice", onYunzaiNotice)
  hooked = true
}

/** 启动单个连接（已存在同名则跳过） */
export function startClient(conf: WsConnection | RuntimeWsConnection) {
  if (conf.enable === false) return null
  const rt = conf as Partial<RuntimeWsConnection>
  const hasSourceIndex = Number.isInteger(rt.sourceIndex) && Number(rt.sourceIndex) >= 0
  const sourceLabel = hasSourceIndex ? `连接 #${Number(rt.sourceIndex) + 1}` : "(未命名)"
  const name = rt.runtimeName || conf.name || sourceLabel
  if (!conf.url) {
    makeLog("error", `连接 ${name} 缺少 url，已跳过`, "GsCore")
    return null
  }
  if (clients.some(c => c.name === name)) return null

  hook()
  const c = new GsCoreClient(conf)
  if (!rt.runtimeName && !conf.name) c.name = name
  clients.push(c)
  c.connect()
  return c
}

/** 停止并移除单个连接 */
export function stopClient(name: string) {
  const idx = clients.findIndex(c => c.name === name)
  if (idx === -1) return false
  clients[idx].close()
  clients.splice(idx, 1)
  return true
}

/** 停掉一条逻辑连接派生的全部运行时客户端 */
export function stopSource(sourceIndex: number, name?: string) {
  let stopped = 0
  for (let i = clients.length - 1; i >= 0; i--) {
    const client = clients[i]
    const legacyNameHit = client.sourceIndex === -1 && name !== undefined && client.name === name
    if (client.sourceIndex !== sourceIndex && !legacyNameHit) continue
    client.close()
    clients.splice(i, 1)
    stopped++
  }
  return stopped
}

/**
 * 配置里删掉一条之后，把后面各条的来源序号前移，与配置重新对齐
 *
 * sourceIndex 是「运行时连接属于哪条配置」的唯一凭据：面板聚合、状态图、
 * stopSource/startSource 全靠它。删除会让后面的配置项下标整体 -1，不跟着移
 * 就会错位 —— 下一次停用第 3 条，停掉的是原来第 4 条派生的连接。
 */
export function shiftSourceIndex(removedIndex: number) {
  for (const client of clients) if (client.sourceIndex > removedIndex) client.sourceIndex--
}

/** 按当前配置展开并启动一条逻辑连接派生的全部运行时客户端 */
export function startSource(sourceIndex: number) {
  if (!enabled() || !wsEnabled()) return 0

  const list = getWsConnections()
  const source = list[sourceIndex]
  if (!source || source.enable === false) return 0

  // 必须展开完整列表：来源序号与全局「前项优先」冲突语义都依赖原始上下文。
  const { runtime, errors } = expandConnections(list)
  for (const error of errors) makeLog("error", error, "GsCore")

  let started = 0
  for (const conf of runtime) {
    if (conf.sourceIndex === sourceIndex && startClient(conf)) started++
  }
  return started
}

/** 按当前配置重建所有连接（用于 #早柚重载） */
export function reloadClients() {
  stopClients()
  startClients()
  return clients.length
}

export function startClients() {
  hook()

  // 迁移提示要在起连接之前、且不受「有没有连接起来」影响
  // ------
  // 默认配置里带着一条示例 connections，而运行时是深合并的：配置只写了
  // 旧键 client.ws_connections（3.2 短暂用过的名字）时，connections 由默认值
  // 补齐 —— 于是连接**能起来**，起的却是默认那条 ws://127.0.0.1:8765/ws/Yunzai，
  // 用户自己那条地址/token/bind 全都没生效。
  //
  // 正常情况下 config/upgrade.ts 已在启动时把旧键迁回 connections，走到这里
  // 说明迁移没成功（多半是新旧两个键同时存在，那时不敢擅自合并）。
  if (Array.isArray(config.client?.ws_connections))
    makeLog(
      "error",
      [
        "配置里的 client.ws_connections 是旧键名，已改回 client.connections，该键不再生效。",
        `请把其中的连接并入 client.connections 后删除该键（${configFile}）`,
      ].join("\n"),
      "GsCore",
    )

  if (wsEnabled()) {
    const { runtime, errors } = expandConnections(getWsConnections())
    for (const error of errors) makeLog("error", error, "GsCore")
    for (const conf of runtime) startClient(conf)
  }

  if (clients.length) {
    makeLog("mark", `早柚核心客户端启动 ${clients.length} 个连接`, "GsCore")
    return
  }

  makeLog("warn", "早柚核心客户端没有可用连接", "GsCore")
}

export function stopClients() {
  for (const c of clients) c.close()
  clients.length = 0
}
