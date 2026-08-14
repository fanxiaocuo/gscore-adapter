/**
 * 客户端生命周期
 */
import { config, configFile, getWsConnections, wsEnabled } from "@/config"
import type { WsConnection } from "@/types"
import { GsCoreClient } from "./GsCoreClient.js"
import { clients } from "./state.js"
import { onYunzaiMessage, onYunzaiNotice } from "./hooks.js"
import { makeLog } from "@/utils/compat"
import { isAutoYunzaiPath } from "@/utils/url.js"

let hooked = false

/** 注册事件钩子（只注册一次） */
function hook() {
  if (hooked) return
  Bot.on("message", onYunzaiMessage)
  Bot.on("notice", onYunzaiNotice)
  hooked = true
}

/** 启动单个连接（已存在同名则跳过） */
export function startClient(conf: WsConnection) {
  if (conf.enable === false) return null
  if (!conf.url) {
    makeLog("error", `连接 ${conf.name || "(未命名)"} 缺少 url，已跳过`, "GsCore")
    return null
  }
  if (clients.some(c => c.name === (conf.name || conf.url))) return null

  hook()
  const c = new GsCoreClient(conf)
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
    warnPathCollision(getWsConnections())
    for (const conf of getWsConnections()) startClient(conf)
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

/**
 * 两条启用中的连接若 URL 路径相同，核心侧后连上的会把先连上的 socket 顶掉。
 * 自动路径（/ws/Yunzai）本该合并 bind，走到这里说明用户手改了配置。
 */
function warnPathCollision(list: WsConnection[]) {
  const seen = new Map<string, string>()
  for (const c of list) {
    if (c.enable === false || !c.url) continue
    let key = ""
    try {
      const u = new URL(String(c.url))
      key = `${u.origin}${u.pathname}`.toLowerCase()
    } catch {
      key = String(c.url)
    }
    const prev = seen.get(key)
    if (prev) {
      const hint = (() => {
        try {
          return isAutoYunzaiPath(new URL(String(c.url)).pathname)
            ? "请把账号都绑到同一条连接（#早柚修改连接 bind+=）。"
            : "请改成不同的路径，或把账号合并到一条连接。"
        } catch {
          return "请检查连接地址。"
        }
      })()
      makeLog(
        "error",
        `连接 ${c.name || c.url} 与 ${prev} 的 URL 路径相同（${key}），` +
          `核心侧后连上的会顶掉先连上的。${hint}`,
        "GsCore",
      )
    } else seen.set(key, String(c.name || c.url))
  }
}
