/**
 * @description 底部悬浮保存条：有未保存改动时才出现，`有 N 项未保存` + 保存 / 放弃
 *
 * 延迟提交的那批字段（数字、文本、chip、名单，以及文件服务整节）攒在这里一起交，理由见
 * 设计文档 §7.1：`port` / `host` / `public_host` 是一个意图，逐项即时写会按旧端口先重启一次。
 * 注意：`position: fixed` 而不是钉在某个容器里 —— 这是 iframe 里的页面，宿主那个滚动容器
 * 不是本文档的，sticky 会跟着内容滚出视野
 * 注意：条本身遮住最后一行控件的问题在 styles.css 里解（body 常留一条的底部内边距），
 * 不在这儿用 margin 顶 —— 条是 fixed 的，它不占文档流，撑不开任何东西
 */
import { useEffect } from "react"
import { BTN, BTN_PRIMARY } from "../ui.js"

export function SaveBar({
  count,
  saving,
  onSave,
  onReset,
}: {
  /** 未保存的字段数，0 时整条不渲染 */
  count: number
  /** 提交在途：两个按钮一起禁用，免得连点交两遍 */
  saving?: boolean
  onSave: () => void
  onReset: () => void
}) {
  const shown = count > 0
  /*
   * 条出现时给 body 挂一个类，样式表按它补出底部内边距（见 styles.css 的 body.has-savebar）。
   * 注意：只能这么补 —— 条是 fixed 的，不占文档流，撑不开任何东西，而 body 不由 React 渲染，
   * 没有能写 className 的落点。不挂的话最后一行的控件被条压住，点不到
   * 注意：hook 必须排在下面那个 early return **之前**，条件调用 hook 会让 React 在
   * 出现/消失那一刻按错位读 hook 状态
   */
  useEffect(() => {
    if (!shown) return
    document.body.classList.add("has-savebar")
    // 卸载时摘掉：不摘的话保存完条没了，页面底下还空着一条的高度
    return () => document.body.classList.remove("has-savebar")
  }, [shown])

  if (!shown) return null
  return (
    /*
     * 窄屏左右各 12px，与 body 在 `@media (width < 720px)` 下的内边距对齐（桌面 20px）。
     * role=region + aria-label：它是突然出现的一块，读屏用户要能按区域跳到它
     */
    <div
      className="fixed bottom-[20px] left-[20px] right-[20px] z-40 flex flex-wrap items-center justify-between gap-[12px] rounded-[12px] border border-border-strong bg-surface px-[16px] py-[12px] shadow-[0_8px_24px_rgb(0_0_0/18%)] max-[720px]:bottom-[12px] max-[720px]:left-[12px] max-[720px]:right-[12px] max-[720px]:px-[12px]"
      role="region"
      aria-label="未保存的改动"
    >
      {/* aria-live：数字变了要播报，用户改的是别处的控件、焦点不在这条上 */}
      <span className="text-[13px] font-semibold" aria-live="polite">
        有 {count} 项未保存
      </span>
      <div className="flex flex-none gap-[8px]">
        <button className={BTN} onClick={onReset} disabled={saving}>
          放弃
        </button>
        <button
          className={`${BTN_PRIMARY} disabled:cursor-not-allowed disabled:opacity-45`}
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  )
}
