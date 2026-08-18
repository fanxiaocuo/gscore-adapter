/**
 * 绑定账号展开区：一行一个机器人，行尾一个绑定开关
 *
 * 为什么收散字段而不是收一个 ConnView
 * --------------------------------
 * 新增连接弹层里还没有连接 —— 用户正在填地址，服务端那份视图要等提交之后才存在。
 * 收 `conn: ConnView` 就得在弹层里造一个假的，字段填什么都是编的。改成收自己真正
 * 要的那几项，连接卡片与弹层就能共用同一份行渲染，开关语义（含「最后一个不能关」）
 * 也只有这一处实现。
 *
 * 开关的开合判据是「有效账号」而不是 bind
 * ----------------------------------
 * `checked` 由调用方传 `ConnView.accounts`（等价于 `id ∈ bind && id ∉ exclude`）。
 * 被 exclude 排除的号仍然列出来，只是灰着并挂 conflicts 标记：绿着却不转发是在
 * 说谎，而从列表里抹掉它会让用户以为自己没绑过。拨开它会连带把它从 exclude 里
 * 放出来（后端 bindConnection 的 freed 分支），一步自愈。
 */
import { useId } from "react"
import type { BotProfile } from "../api.js"
import { MONO, TAG } from "../ui.js"
import { Avatar } from "./Avatar.js"
import { Switch } from "./Switch.js"

/** 平台标签：淡蓝底深蓝字，配色 token 在 styles.css 的 --chip */
const CHIP = "flex-none rounded-[999px] bg-chip px-[8px] py-[1px] text-[11px] text-chip-fg"
const NOTE = `${TAG} flex-none`

/*
 * 一行的布局
 *
 * 桌面四列（头像 / 昵称+账号 / 平台与状态 / 开关），列宽固定所以多行之间对得齐，
 * 是「系统设置」那种观感。720px 以下改三列：元信息挪到昵称下面一行、开关跨两行
 * 钉在行尾，宽度全部让给可变列（minmax(0,1fr) 允许收缩，配合子元素 truncate 才
 * 不会把长昵称顶出页面 —— 页面级横向滚动就是这么来的）。
 *
 * 窄屏下每个格子都写死 col-start / row-start，不靠自动排布：省掉的那点字数换来的是
 * 「改一处顺序就整行错位」的隐式依赖。
 */
const ROW =
  "grid min-h-[66px] grid-cols-[auto_minmax(120px,1fr)_minmax(90px,0.65fr)_auto] items-center gap-x-[12px] gap-y-[2px] border-t border-border px-[12px] first:border-t-0 max-[720px]:grid-cols-[auto_minmax(0,1fr)_auto]"

export function BotSwitchList({
  bots,
  checked,
  conflicts,
  lockLast = false,
  saving = null,
  onToggle,
  empty,
}: {
  /** 候选账号（在线的全部机器人 ∪ 本连接绑过的账号），顺序即显示顺序 */
  bots: BotProfile[]
  /** 开着的账号：传 ConnView.accounts，见文件头 */
  checked: string[]
  /** bind 与 exclude 都写了的账号，只用来挂标记 */
  conflicts: string[]
  /**
   * 不允许关掉最后一个绑定：**已保存的自动端点**才给 true
   *
   * 收的是这个结论而不是 `automatic`，因为「是不是自动端点」与「该不该锁」并不等价：
   * 新增/编辑弹层里的改动还没落盘，没有需要提前维护的不变量，锁住只会让「只有一个
   * 机器人在线」的用户点开之后关不掉（唯一出路是去文本框手删或取消整个弹层）。
   * 弹层那边由 `blocked` 与一段红字负责，把关仍在后端 requireAccounts。
   */
  lockLast?: boolean
  /** 正在保存的账号，非 null 时整组禁用，避免连点把状态叠乱 */
  saving?: string | null
  onToggle: (id: string, on: boolean) => void
  /** 没有候选账号时显示的话术，随场景不同（连接卡片 / 新增弹层） */
  empty: string
}) {
  /*
   * 自动端点的最后一个开关直接禁用
   *
   * 后端 requireAccounts 会拒掉零有效账号的自动端点（核心侧的客户端标识就是
   * /ws/Yunzai-<账号>，一个都没有等于这条连接不存在），拨了只会挨一个 400。
   * 灰着 + 一句**可见**的理由，比让用户先失败一次再读报错好。
   */
  const locked = lockLast && checked.length === 1
  // 禁用理由要能被 aria-describedby 指到，而同一个账号可能同时出现在多条连接的
  // 列表里（页面上有多张卡片），id 必须逐实例唯一 —— 这正是 useId 的用途
  const uid = useId()

  return (
    <div className="mt-[10px] overflow-hidden rounded-[10px] border border-border bg-bg">
      {bots.length === 0 ? (
        <p className="p-[12px] text-[12px] text-muted">{empty}</p>
      ) : (
        bots.map(b => {
          const on = checked.includes(b.id)
          const last = locked && on
          const noteId = `${uid}-${b.id}`
          return (
            <div className={ROW} key={b.id}>
              <Avatar
                p={b}
                size={38}
                className="max-[720px]:col-start-1 max-[720px]:row-span-2 max-[720px]:row-start-1"
              />
              <div className="min-w-0 max-[720px]:col-start-2 max-[720px]:row-start-1">
                <div className="truncate text-[13px] font-semibold">
                  {b.name !== b.id ? b.name : "未知昵称"}
                </div>
                {/* self_id 与平台 bot_id 是两种 ID，分行显示，不混成一串 */}
                <div className={`truncate text-[12px] text-muted ${MONO}`}>{b.id}</div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-[6px] max-[720px]:col-start-2 max-[720px]:row-start-2">
                {/* 推断不出平台时说「未识别」，不伪装成默认 onebot */}
                <span className={CHIP}>{b.platform || "未识别"}</span>
                {/* 掉线的号不自动解绑，说清它还在名单里，免得以为面板漏了它 */}
                <span className={NOTE}>{b.online ? "在线" : "离线 · 已保留"}</span>
                {conflicts.includes(b.id) && (
                  <span className={`${NOTE} text-danger`}>已被排除，不会转发</span>
                )}
                {saving === b.id && <span className={NOTE}>保存中…</span>}
                {/* 禁用理由写成可见标签：tooltip 在触屏上不存在，而这是个手机优先的面板 */}
                {last && (
                  <span className={NOTE} id={noteId}>
                    最后一个绑定，不能关
                  </span>
                )}
              </div>
              <div className="flex justify-end max-[720px]:col-start-3 max-[720px]:row-span-2 max-[720px]:row-start-1">
                <Switch
                  checked={on}
                  // 只禁别的，不禁刚被点的那个：浏览器会把 disabled 元素的焦点丢给
                  // body，请求回来解禁时也不还 —— 键盘用户拨完第 3 个开关，想拨第 4 个
                  // 得从页面顶部重新 Tab 一遍。防连点的目的排除当前项也达到了
                  disabled={(saving !== null && saving !== b.id) || last}
                  label={`绑定 ${b.name !== b.id ? `${b.name}（${b.id}）` : b.id}`}
                  describedBy={last ? noteId : undefined}
                  hint={
                    last
                      ? "自动连接至少要留一个绑定账号：核心侧的客户端标识就是 /ws/Yunzai-<账号>。不想连了请停用或删除整条连接"
                      : undefined
                  }
                  onChange={next => onToggle(b.id, next)}
                />
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
