/**
 * 机器人头像，加载失败回退成首字圆
 *
 * 头像 URL 可能取自 qlogo 的按号猜测（离线账号），号不存在时图挂掉，
 * 不能让页面上顶着一个碎图标。
 *
 * 单独一个文件而不是留在 main.tsx：绑定列表（BotSwitchList）与连接卡片都要画头像，
 * 而 main.tsx 要 import 绑定列表 —— 留在那边就是一个循环引用。
 */
import { useState } from "react"
import type { BotProfile } from "../api.js"

export function Avatar({
  p,
  size = 26,
  className = "",
}: {
  p: BotProfile
  size?: number
  /**
   * 附加 utility。叠放小头像用 `-ml-[6px] ring-2 ring-surface` ——
   * 描边走 ring 而不是 border：border-* 与下面的基础 border 是同一属性，
   * 谁生效取决于样式表里的先后而不是 className 顺序
   */
  className?: string
}) {
  const [err, setErr] = useState(false)
  return (
    <span
      className={`inline-flex flex-none items-center justify-center overflow-hidden rounded-[50%] border border-border bg-bg text-[12px] font-bold text-muted ${className}`}
      style={{ width: size, height: size }}
    >
      {p.avatar && !err ? (
        <img
          className="size-full object-cover"
          src={p.avatar}
          alt=""
          onError={() => setErr(true)}
        />
      ) : (
        (p.name || p.id).slice(0, 1)
      )}
    </span>
  )
}
