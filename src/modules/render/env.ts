/**
 * @description 运行环境探测：框架名、框架版本、Node 版本，供页脚角标与 #早柚版本 共用
 * 框架判定看 `Bot.uin` 是不是数组（TRSS 多账号存数组，Miao 继承 ICQQ 是单个数字）
 * 注意：不看目录名或 package.json 的 name —— 目录名用户随意取、name 被 fork 改名即失效；uin 的形状是架构差异，改名改不掉
 * 注意：这里只用于显示，功能上走哪条兼容路径仍由 utils/compat.ts 逐个方法探测决定
 */
import fs from "node:fs"
import os from "node:os"
import { join } from "node:path"
import { YunzaiPath } from "@/dir"
import { branch } from "./version.js"

/** @description 框架名，只有这两种；探测不到按喵崽算（它是缺功能的那一方，回退更安全） */
export type FrameName = "TRSS-Yunzai" | "Miao-Yunzai"

/**
 * @description 跑在哪个框架上
 * 注意：绝不能缓存 —— 判据 Bot.uin 要等框架挂上 Bot 才有，早一步缓存就把 TRSS 永久标成喵崽，且肉眼看不出来
 */
export function frameName(): FrameName {
  try {
    if (Array.isArray(globalThis.Bot?.uin)) return "TRSS-Yunzai"
  } catch {
    // Bot 未初始化（单测、CI）时按喵崽算
  }
  return "Miao-Yunzai"
}

/** @description 框架 package.json 里的版本号，读一次就够（同 styles/index.ts 的缓存理由） */
let verCache: string | undefined

/** @description 框架版本，读框架根目录的 package.json；读不到返回空串（缓存省掉重复读盘） */
export function frameVersion(): string {
  if (verCache !== undefined) return verCache

  try {
    const pkg = JSON.parse(fs.readFileSync(join(YunzaiPath, "package.json"), "utf8"))
    verCache = String(pkg.version || "")
  } catch {
    verCache = ""
  }
  return verCache
}

/** @description Node 版本，去掉前缀 v */
export function nodeVersion(): string {
  return process.versions.node
}

/** @description 框架名 + 版本，拼成角标那一行；没版本号时只给名字 */
export function frameLabel(): string {
  const v = frameVersion()
  return v ? `${frameName()} v${v}` : frameName()
}

/**
 * @description 发布类型：release 分支 Stable、preview 分支 Preview、main/master Dev
 * 注意：判据是分支名而非版本号形状，且 main 算 Dev —— 三个分支 package.json 同一版本号（release-please 只在发版时改），
 * 按版本号形状判会把 main 上的开发版标成正式版
 * 注意：表里没有的分支（功能分支）与取不到分支名（压缩包安装、没装 git、游离 HEAD）都按 Dev 算，
 * 原则是「宁可把稳的说成不稳的，也别把开发版说成正式版」；兜底用 Dev 而非 Preview（feat/xxx 显然比 main 更不稳，不配「预览版」）
 */
export type ReleaseType = "Stable" | "Preview" | "Dev"

const RELEASE_BRANCH: Record<string, ReleaseType> = {
  release: "Stable",
  preview: "Preview",
  main: "Dev",
  master: "Dev",
}

export function releaseType(_version?: string): ReleaseType {
  return RELEASE_BRANCH[branch] || "Dev"
}

/** @description 角标上那两个字 */
export function releaseLabel(t: ReleaseType = releaseType()): string {
  return t === "Stable" ? "正式版" : t === "Dev" ? "开发版" : "预览版"
}

/** @description 字节数转可读单位，保留一位小数 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B"
  const u = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

/** @description 秒数转 3天4小时 这样的时长 */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d} 天 ${h} 小时`
  if (h) return `${h} 小时 ${m} 分`
  if (m) return `${m} 分 ${s % 60} 秒`
  return `${s} 秒`
}

/** @description 本机资源快照 */
export interface SysInfo {
  /** 操作系统，如 Windows_NT 10.0.19044 */
  os: string
  platform: string
  arch: string
  cpuModel: string
  cpuCores: number
  totalMemory: string
  usedMemory: string
  /** 已用内存占比，0~100 的数值，用于画进度条 */
  memoryPercent: number
  /** 本进程常驻内存 */
  processRss: string
  /** 系统已运行时长 */
  systemUptime: string
  /** 本进程已运行时长 */
  processUptime: string
}

/**
 * @description 采集本机运行信息
 * 注意：这张图会发到群里，只取「机器性能」类信息，不读 hostname、os.userInfo()、网卡地址、环境变量、启动参数、连接 token；
 * 加字段前先想：这条发到群里会不会暴露机主
 */
export function sysInfo(): SysInfo {
  const cpus = os.cpus() || []
  const total = os.totalmem()
  const used = Math.max(0, total - os.freemem())

  return {
    os: `${os.type()} ${os.release()}`,
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() || "未知处理器",
    cpuCores: cpus.length,
    totalMemory: formatBytes(total),
    usedMemory: formatBytes(used),
    memoryPercent: total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0,
    processRss: formatBytes(process.memoryUsage().rss),
    systemUptime: formatDuration(os.uptime()),
    processUptime: formatDuration(process.uptime()),
  }
}
