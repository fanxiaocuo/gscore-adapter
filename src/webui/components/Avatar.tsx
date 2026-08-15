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
  /**
   * 加载失败标记，按 URL 记
   * ------
   * 存 URL 而不是布尔：离线账号的头像是按号猜的 qlogo，挂掉后置位；等这个号上线、
   * 后端换成真头像时 URL 变了，布尔值却不会自然复位 —— 卡片按 `key={b.id}` 渲染，
   * 组件一直挂着，于是明明有真头像还一直显示首字圆，刷新页面也不好（key 没变）。
   * 与当前 URL 比一次，换了地址就重新试。
   */
  const [failed, setFailed] = useState<string | null>(null)
  const broken = !!p.avatar && failed === p.avatar
  return (
    <span
      className={`inline-flex flex-none items-center justify-center overflow-hidden rounded-[50%] border border-border bg-bg text-[12px] font-bold text-muted ${className}`}
      style={{ width: size, height: size }}
    >
      {p.avatar && !broken ? (
        <img
          className="size-full object-cover"
          src={p.avatar}
          alt=""
          onError={() => setFailed(p.avatar ?? null)}
        />
      ) : (
        (p.name || p.id).slice(0, 1)
      )}
    </span>
  )
}
