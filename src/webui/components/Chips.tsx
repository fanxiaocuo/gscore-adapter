/**
 * @description chip 标签输入，用在 filter 那批数组字段（前缀、屏蔽词、群号、用户 ID）
 * 不用逗号分隔的单行文本框：群黑白名单是一串 9 位数字，挤一个框里数不清也删不掉中间项。
 * 注意：不校验形状，前缀里的 `#`、关键词的空格与大小写改一字就匹配不上（锅巴那边为此不加 valueFormatter，见 modules/guoba/schemas/filter.ts）；QQ 号 5-11 位、QQBot openid 32 位十六进制，卡长度会把非 QQ 平台的 ID 拦掉。
 */
import { useRef, useState } from "react"
import { FOCUS, MONO, toList } from "../ui.js"

/** 超过这个长度只显示前若干字，全文进 title */
const MAX_SHOW = 18

const CHIP =
  "inline-flex max-w-full items-center gap-[4px] rounded-[999px] border border-border-strong bg-surface2 py-[3px] pl-[10px] pr-[4px] text-[12px]"
/** × 键：24px 命中区（chip 自己在 44px 高的行里，不必再撑到 44） */
const DEL = `flex size-[24px] flex-none cursor-pointer items-center justify-center rounded-[999px] border-0 bg-transparent text-[14px] leading-none text-muted hover:text-danger ${FOCUS}`

export function Chips({
  /** 当前值。原样回写（yaml 里写成数字的群号保持数字，见 api.ts 的 white_group） */
  value,
  onChange,
  placeholder,
  id,
  /** 群号这类要等宽显示（对得上号），前缀与关键词按正文字体 */
  mono,
  describedBy,
}: {
  value: (string | number)[]
  onChange: (next: (string | number)[]) => void
  placeholder?: string
  id?: string
  mono?: boolean
  describedBy?: string
}) {
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * @description 收下当前草稿。静默去重、空值不收
   * 注意：比较前 String() 一遍，已存群号可能是数字、手输的是字符串，不统一类型同一个群会进两次。
   */
  const commit = (raw: string) => {
    // 复用 ui.ts 的 toList（连接弹层逗号文本框同一套解析），别再写一份
    const parts = toList(raw)
    if (!parts.length) {
      setDraft("")
      return
    }
    const seen = new Set(value.map(v => String(v)))
    const add: string[] = []
    for (const p of parts) {
      if (seen.has(p)) continue
      seen.add(p)
      add.push(p)
    }
    setDraft("")
    // 没有新值时不调 onChange，否则会把这一项标成脏、让保存条在「没有变化」时亮起
    if (add.length) onChange([...value, ...add])
  }

  const remove = (i: number) => {
    onChange(value.filter((_, j) => j !== i))
    // 删完把焦点还给输入框：不还的话按钮随 DOM 消失、焦点掉到 body，键盘用户得从页面顶部重新 Tab
    inputRef.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 注意：组字中的回车一律放过。中文输入法用回车确认候选词，Chromium 照样派发 keydown（key === "Enter" 且 isComposing === true），不判这下会把拼音草稿先存成 chip、随后 compositionend 再塞回中文；这几栏给中文用且不清洗，用户看不出存的是拼音。
    if (e.nativeEvent.isComposing) return

    if (e.key === "Enter" || e.key === "," || e.key === "，") {
      // Enter 在表单里触发提交、逗号会落进输入框，两者都要拦
      e.preventDefault()
      commit(draft)
      return
    }
    // 输入框为空时 Backspace 删最后一个（有草稿时是正常的删字符）
    if (e.key === "Backspace" && !draft && value.length) {
      e.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  return (
    /* 整块当输入框画：描边 border-strong（控件边界要过 3:1）、底色 surface2，flex-wrap + min-w-0 让长串换行不顶宽。
       注意：聚焦环挂容器上（focus-within）而非里头的 input，input 自己 outline-none 且只占行末一小条，轮廓画它身上看不出「在编辑中」；hover 只提亮描边不换底色，免得与 chip 的 surface2 糊成一片。 */
    <div className="flex min-w-0 flex-wrap items-center gap-[6px] rounded-[8px] border border-border-strong bg-surface2 px-[8px] py-[6px] hover:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
      {value.map((v, i) => {
        const s = String(v)
        /* 按码点数而非 s.length：后者是 UTF-16 码元数，slice(0, 18) 会把星区字符（emoji 等占两码元）切成半个代理对，chip 上渲染成 U+FFFD。落盘值与 title 全文不受影响，纯显示层，但看到乱码的人会以为填的东西被改了。 */
        const cps = [...s]
        const long = cps.length > MAX_SHOW
        return (
          <span className={`${CHIP} ${mono ? MONO : ""}`} key={`${s}-${i}`}>
            {/* 截断显示 + title 看全。overflow-wrap 不能省：不截断的中等长度串也要能就地断行 */}
            <span className="min-w-0 [overflow-wrap:anywhere]" title={long ? s : undefined}>
              {long ? `${cps.slice(0, MAX_SHOW).join("")}…` : s}
            </span>
            <button
              type="button"
              className={DEL}
              /* 读屏要说出删的是哪一项，光一个 × 说不清 */
              aria-label={`删除 ${s}`}
              onClick={() => remove(i)}
              /* Enter 与 Space 原生都触发 button 的 click，不用自己补 keydown */
            >
              ×
            </button>
          </span>
        )
      })}
      <input
        ref={inputRef}
        id={id}
        className={`min-w-[96px] flex-1 border-0 bg-transparent text-[13px] text-fg outline-none placeholder:text-muted ${
          mono ? MONO : ""
        }`}
        type="text"
        value={draft}
        placeholder={value.length ? "" : placeholder || ""}
        aria-describedby={describedBy}
        onChange={e => {
          const v = e.target.value
          // 粘贴一串带逗号的进来时就地拆开，不用再按一次回车
          if (/[,，]/.test(v)) commit(v)
          else setDraft(v)
        }}
        onKeyDown={onKey}
        // 失焦也提交：填完直接点保存的人不该丢掉最后一项
        onBlur={() => commit(draft)}
      />
    </div>
  )
}
