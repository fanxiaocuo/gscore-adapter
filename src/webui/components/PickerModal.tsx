/**
 * @description 群 / 好友选择器：开弹层时才拉候选，搜索 + 虚拟滑动，勾选写回同一份 filter.* 数组
 *
 * 候选不进 {@link Payload} 整包：整包每 10 秒轮询一次，几千个群跟着来回传毫无必要，
 * 所以 `GET /targets?kind=…` 只在这个弹层打开时发一次。
 * 注意：勾选状态**不存本地 state** —— 收 `value` 与 `onChange`，与 chip 输入读写同一份
 * 数组。存一份自己的会让「弹层里勾了、chip 区没变」这种两份数据不一致的状态成为可能
 * 注意：虚拟滑动是自己按 scrollTop 切窗口，不加依赖（宿主白名单只放行 3 个文件名，
 * 依赖只能进 bundle，而这点逻辑不值一个包）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { TargetsPayload } from "../api.js"
import { errMsg, request } from "../http.js"
import { BTN, BTN_PRIMARY, INPUT } from "../ui.js"
import { useAutoFocus, useDialog } from "./useDialog.js"
import { Avatar } from "./Avatar.js"

/**
 * 行高只有这一处定义，虚拟滑动的窗口计算与行元素的 minHeight 都读它
 * 注意：别把 48 再写进 ROW 那串 class（原先是 `min-h-[48px]`，与这个常量两处各一份）——
 * 那时改一处就要改两处，而漏改的后果是静默的：行实际变高而 start/end 仍按 48 除 scrollTop，
 * 窗口越滑越偏，列表顶上看着正常、底下的行凭空消失
 */
const ROW_H = 48
/** 头像 28px：48 减去上下留白正好放得下，再大就把行撑高、与上面那条冲突 */
const AVATAR = 28
/** 视窗外多渲几行：滑动时新行提前进 DOM，免得快滑时露白 */
const OVERSCAN = 4
/** 列表视窗高度。8 行多一点，够看出「还能往下滑」 */
const VIEW_H = ROW_H * 8

const ROW =
  "flex cursor-pointer items-center gap-[10px] border-t border-border px-[10px] text-[13px] hover:bg-accent-soft"

export function PickerModal({
  kind,
  title,
  api,
  value,
  onChange,
  onClose,
}: {
  kind: "group" | "friend"
  /** 弹层标题，调用方按字段给（「群白名单」/「用户黑名单」…） */
  title: string
  /** 接口前缀，main.tsx 那个 API 常量 */
  api: string
  /** 当前名单，与 chip 输入同一份（元素可能是数字：yaml 里写成数字就是数字） */
  value: (string | number)[]
  onChange: (next: (string | number)[]) => void
  onClose: () => void
}) {
  /* 形状直接借契约里那一项：写第二份 `{id,name,avatar}` 会在服务端加字段时悄悄漂 */
  const [items, setItems] = useState<TargetsPayload["items"]>([])
  const [note, setNote] = useState("")
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [q, setQ] = useState("")
  const [top, setTop] = useState(0)
  // Esc 关 + Tab 焦点锁：与连接弹层共用同一套（components/useDialog.ts）
  const { box, onKeyDown } = useDialog(onClose)

  /**
   * @description 滚动位置按帧合并再进 state
   * 甩一下会派发 60-120 个 scroll 事件，逐个 setState 就是逐个重渲整层弹层（连带每行的
   * Avatar），而一帧内只有最后那个位置有意义 —— 几千个群的列表正是虚拟滑动要救的场景，
   * 在这儿掉帧等于白做
   */
  const frame = useRef(0)
  const pending = useRef(0)
  const onScroll = useCallback((y: number) => {
    // always 记下最新位置：一帧里派发多次时，要用的是最后那个，不是第一个
    pending.current = y
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      setTop(pending.current)
    })
  }, [])
  // 卸载时取消在途的那一帧：回调里 setState 会对已卸载的组件发警告
  useEffect(() => () => frame.current && cancelAnimationFrame(frame.current), [])
  const search = useRef<HTMLInputElement>(null)

  /* 已选的用字符串比：yaml 里的群号可能是数字，`value.includes("123")` 对数字 123 是 false */
  const picked = useMemo(() => new Set(value.map(String)), [value])

  // 懒加载：只在挂载时拉一次。失败要说出来而不是显示成空列表 —— 空列表会让用户
  // 以为「本来就没有」，一按保存把存着的名单抹平
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        /* 走 http.ts 的 request 而不是裸 fetch：错误信封与「宿主回 HTML 登录页」那一支
           都在那儿处理好了。自己 fetch 过一次，结果 session 过期时这里报的是
           `Unexpected token '<'`，而整包轮询那条路报「未登录或无权限」—— 同一件事两套说法 */
        const data = await request<TargetsPayload>(api, `/targets?kind=${kind}`)
        if (!alive) return
        setItems(data.items || [])
        setNote(data.note || "")
      } catch (e) {
        if (alive) setErr(errMsg(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [api, kind])

  // 打开时焦点落到搜索框：键盘用户进来第一件事就是筛，不该先 Tab 过整个列表
  useAutoFocus(box, search)

  const kw = q.trim().toLowerCase()
  // 号码与名字都能搜：群名记不住、号码记得住，反过来也一样
  // 注意：号码这半也要 toLowerCase —— openid 与 qg_ 前缀的 id 带大写十六进制，
  // 拿压成小写的关键词去比原样大小写的 id 会搜不到，用户以为这个号不在列表里
  const list = useMemo(
    () =>
      kw
        ? items.filter(x => x.id.toLowerCase().includes(kw) || x.name.toLowerCase().includes(kw))
        : items,
    [items, kw],
  )

  /* 窗口：按 scrollTop 算首行下标，上下各多留 OVERSCAN 行。总高由撑高的空 div 给，
     于是滚动条长度与真实条数对得上 */
  const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN)
  const end = Math.min(list.length, Math.ceil((top + VIEW_H) / ROW_H) + OVERSCAN)
  const win = list.slice(start, end)

  const toggle = (id: string) => {
    // 删的时候按字符串比、留原类型：名单里存的数字 123 不能因为点了一下变成 "123"
    onChange(picked.has(id) ? value.filter(v => String(v) !== id) : [...value, id])
  }

  return (
    // 遮罩层收键盘事件（弹层内的按键会冒泡到这儿），点遮罩本身关闭
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(0_0_0/45%)] p-[20px] max-[720px]:p-[8px]"
      onClick={e => e.target === e.currentTarget && onClose()}
      onKeyDown={onKeyDown}
    >
      <div
        ref={box}
        className="flex max-h-[90vh] w-[min(520px,100%)] flex-col overflow-hidden rounded-[14px] bg-surface p-[20px] max-[720px]:p-[14px]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="mb-[12px] text-[17px] font-semibold">{title}</h2>
        <input
          ref={search}
          className={`${INPUT} mb-[10px] w-full`}
          type="search"
          placeholder={kind === "group" ? "搜索群号或群名" : "搜索账号或昵称"}
          aria-label="搜索"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {/* 服务端有话就显示：账号离线、列表取不到，都靠这句让用户知道「不是本来就没有」 */}
        {note && <p className="mb-[8px] text-[12px] text-warning">{note}</p>}
        {err && <p className="mb-[8px] text-[12px] text-danger">拉取候选失败：{err}</p>}
        <div
          className="min-h-0 overflow-y-auto rounded-[10px] border border-border bg-surface2"
          style={{ maxHeight: VIEW_H }}
          onScroll={e => onScroll(e.currentTarget.scrollTop)}
        >
          {loading ? (
            <p className="p-[12px] text-[12px] text-muted">加载中…</p>
          ) : list.length === 0 ? (
            <p className="p-[12px] text-[12px] text-muted [overflow-wrap:anywhere]">
              {kw
                ? `没有匹配「${q}」的${kind === "group" ? "群" : "账号"}`
                : kind === "group"
                  ? "列表是空的：当前没有账号在线，或在线账号一个群都没有。已经存着的群号仍然生效，只是这里查不到名字，可以在上面的输入框里直接手填号码。QQBot 的群没有头像，只显示群名。"
                  : "列表是空的：当前没有账号在线，或好友列表还没写进过。QQBot 官方号只有私聊过的人才在列表里 —— 挑不到的直接在上面的输入框里手填 ID，已存的名单不受影响。"}
            </p>
          ) : (
            // 撑高的外壳 + 绝对定位的窗口：外壳高度 = 总条数 × 行高，滚动条才对得上真实长度
            <div style={{ height: list.length * ROW_H, position: "relative" }}>
              <div style={{ position: "absolute", top: start * ROW_H, left: 0, right: 0 }}>
                {win.map(x => {
                  const on = picked.has(x.id)
                  return (
                    // label + 原生 checkbox：勾选、键盘、读屏播报全是浏览器给的
                    <label className={ROW} style={{ minHeight: ROW_H }} key={x.id}>
                      <input
                        className="size-[18px] flex-none accent-[var(--accent)]"
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(x.id)}
                      />
                      {/*
                       * 头像走 Avatar：它自带「空串 / 加载失败回退成首字圆」，正是这里要的。
                       * 注意：avatar 由服务端算好，前端**不拼**任何头像 URL —— QQBot 用户头像是
                       * q.qlogo.cn/qqapp/<appid>/<openid>/0，appid 只有服务端知道；
                       * 而 QQBot 的群官方 API 不给头像，那一档恒为空串、必然走首字圆
                       */}
                      <Avatar
                        p={{ id: x.id, name: x.name, avatar: x.avatar, online: true }}
                        size={AVATAR}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{x.name || x.id}</span>
                        {/* 名字与号码分行：名字重名时只有号码能区分 */}
                        {x.name && x.name !== x.id && (
                          <span className="block truncate text-[11px] text-muted">{x.id}</span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        <div className="mt-[12px] flex items-center justify-between gap-[12px]">
          {/* 已选数量取自 value，不是这个列表 —— 离线时列表是空的，但名单里的号还在 */}
          <span className="text-[12px] text-muted">
            已选 {value.length} 项{list.length ? ` · 候选 ${list.length}` : ""}
          </span>
          <div className="flex gap-[8px]">
            <button className={BTN} onClick={onClose}>
              取消
            </button>
            {/* 勾选已经即时写进上层的 filter.* 数组了，这个按钮只是关掉层 */}
            <button className={BTN_PRIMARY} onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
