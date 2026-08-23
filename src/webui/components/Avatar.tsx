/**
 * @description 机器人头像，加载失败回退成首字圆（离线账号的头像是按号猜的 qlogo，号不存在就挂掉）
 * 注意：单独一个文件而不是留在 main.tsx —— main.tsx 要 import BotSwitchList，而它也要画头像，
 * 留在那边就是一个循环引用
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
   * @description 附加 utility。叠放小头像用 `-ml-[6px] ring-2 ring-surface`
   * 注意：描边走 ring 而不是 border —— border-* 与下面的基础 border 是同一属性，
   * 谁生效取决于样式表里的先后而不是 className 顺序
   */
  className?: string
}) {
  /**
   * @description 加载失败标记，按 URL 记
   * 注意：存 URL 而不是布尔 —— 这个号上线、后端换成真头像时布尔值不会自然复位
   *（组件按 `key={b.id}` 一直挂着），会一直显示首字圆
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
