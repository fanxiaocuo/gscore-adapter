/**
 * 运行环境探测
 *
 * 供页脚角标与 #早柚版本 共用：跑在哪个框架上、框架什么版本、Node 什么版本。
 *
 * 框架判定沿用 karin-plugin-kkk 的做法（module/utils/Version.js 的 getBotName）：
 * 看 `Bot.uin` 是不是数组。TRSS 支持多账号，把 uin 存成数组；Miao 的
 * `class Yunzai extends Client` 继承 ICQQ，uin 是单个数字。
 *
 * 为什么不看目录名或 package.json 的 name：
 * 目录名完全不可靠——本仓库所在的框架目录就叫 Miao-Yunzai、实际却是 TRSS，
 * 这正是 utils/compat.ts 开头记的那个反例。package.json 的 name 稍好，
 * 但 fork 改名即失效，而 uin 的形状是两个框架的架构差异，改名改不掉。
 *
 * 注意这里只用于**显示**。功能上该走哪条兼容路径，仍由 utils/compat.ts
 * 逐个方法探测决定——那才是不会被 fork 骗到的判据。
 */
import fs from "node:fs"
import os from "node:os"
import { join } from "node:path"
import { YunzaiPath } from "@/dir"
import { branch } from "./version.js"

/** 框架名，只有这两种；探测不到按喵崽算（它是缺功能的那一方，回退更安全） */
export type FrameName = "TRSS-Yunzai" | "Miao-Yunzai"

/** 跑在哪个框架上 */
export function frameName(): FrameName {
  try {
    if (Array.isArray(globalThis.Bot?.uin)) return "TRSS-Yunzai"
  } catch {
    // Bot 未初始化（单测、CI）时按喵崽算
  }
  return "Miao-Yunzai"
}

/** 框架版本，读框架根目录的 package.json；读不到返回空串 */
export function frameVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(join(YunzaiPath, "package.json"), "utf8"))
    return String(pkg.version || "")
  } catch {
    return ""
  }
}

/** Node 版本，去掉前缀 v */
export function nodeVersion(): string {
  return process.versions.node
}

/** 框架名 + 版本，拼成角标那一行；没版本号时只给名字 */
export function frameLabel(): string {
  const v = frameVersion()
  return v ? `${frameName()} v${v}` : frameName()
}

/**
 * 发布类型：正式版 / 预览版 / 开发版
 *
 * 原本照搬 kkk 的 `/^\d+\.\d+\.\d+$/.test(version)`，但那套判据在本仓库不成立：
 * kkk 是 npm 包，预览版会带 -beta 之类的后缀，版本号本身就能区分；
 * 本插件三个分支的 package.json 是**同一个** 2.1.0（release-please 只在发版
 * 时改它），全都能通过那个正则，于是 main 上的开发版也被标成正式版。
 *
 * 改成看分支名——这是三条线真正的区别：
 * - release  每个发布一个提交，给用户装的发布分支 → Stable
 * - preview  main 每次提交自动编译产出，尝鲜用     → Preview
 * - main     源码主干，开发中                      → Dev
 *
 * 取不到分支名（压缩包安装、没装 git、游离 HEAD）时按 Preview 算：
 * 宁可把正式版误标成预览版，也别把开发版说成正式版——出问题时前者只是少了个
 * 好看的角标，后者会让人以为跑的是发布版本，白查半天。
 */
export type ReleaseType = "Stable" | "Preview" | "Dev"

const RELEASE_BRANCH: Record<string, ReleaseType> = {
  release: "Stable",
  preview: "Preview",
  main: "Dev",
  master: "Dev",
}

export function releaseType(_version?: string): ReleaseType {
  return RELEASE_BRANCH[branch] || "Preview"
}

/** 角标上那两个字 */
export function releaseLabel(t: ReleaseType = releaseType()): string {
  return t === "Stable" ? "正式版" : t === "Dev" ? "开发版" : "预览版"
}

/** 字节数转可读单位，保留一位小数 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B"
  const u = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

/** 秒数转 3天4小时 这样的时长 */
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

/** 本机资源快照 */
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
 * 采集本机运行信息
 *
 * 隐私边界照 kkk 的 collectRuntimeReport：这张图会发到群里，所以只取
 * 「机器性能」类信息，不取任何能定位到这台机器或这个人的东西——
 * 不读 hostname、不读 os.userInfo()（家目录、用户名）、不读网卡地址、
 * 不读环境变量内容、不读启动参数，也不读任何连接的 token。
 * 加字段前先想一遍：这条信息发到群里会不会暴露机主。
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
