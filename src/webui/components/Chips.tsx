/**
 * @description chip 标签输入，用在 filter 那批数组字段（前缀、屏蔽词、群号、用户 ID）
 *
 * 不用逗号分隔的单行文本框（连接弹层里那个 `type: "list"`）：群黑白名单是一串 9 位数字，
 * 挤在一个输入框里既数不出有几项、也删不掉中间那个。
 * 注意：**不校验形状** —— 前缀里的 `#`、关键词里的空格与大小写改一个字都会让匹配对不上
 *（锅巴那边为此专门不加 valueFormatter，见 modules/guoba/schemas/filter.ts）；
 * QQ 号 5-11 位、QQBot openid 32 位十六进制，卡长度只会把非 QQ 平台的 ID 拦在外面
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
   * 注意：比较前 String() 一遍 —— 已存的群号可能是数字 9 位，用户手输的是字符串，
   * 不统一类型比的话同一个群会进两次
   */
  const commit = (raw: string) => {
    // 与连接弹层那个逗号文本框同一套解析（ui.ts 的 toList），别在这儿再写一份
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
    // 一个新值都没有时不调 onChange：那会把这一项标成脏、让保存条为「没有变化」亮起
    if (add.length) onChange([...value, ...add])
  }

  const remove = (i: number) => {
    onChange(value.filter((_, j) => j !== i))
    // 删完把焦点还给输入框：不还的话按钮随 DOM 一起消失，焦点掉到 body，
    // 键盘用户得从页面顶部重新 Tab 一遍
    inputRef.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    /*
     * 注意：组字中的回车一律放过。中文输入法用回车**确认候选词**，而 Chromium 照样派发
     * keydown（key === "Enter"、isComposing === true）—— 不判这一下，打 chouka 选「抽卡」
     * 会先把拼音草稿 "chouka" 存成一个 chip，随后 compositionend 再把「抽卡」塞回输入框。
     * 而这几栏（屏蔽关键词、屏蔽前缀）本来就是给中文用的，且明确不做任何清洗，
     * 用户根本看不出存进去的是拼音
     */
    if (e.nativeEvent.isComposing) return

    if (e.key === "Enter" || e.key === "," || e.key === "，") {
      // Enter 在表单里会触发提交，逗号会落进输入框，两者都要拦
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
    /*
     * 整块当输入框画：描边用 border-strong（控件边界要过 3:1），底色 surface2。
     * flex-wrap + min-w-0 让长串换行而不是把行顶宽。
     * 注意：聚焦环挂在容器上（focus-within）而不是里头那个 input —— input 自己
     * outline-none、只占一行末尾的一小条，轮廓画在它身上看不出「这个框在编辑中」；
     * hover 只提亮描边不换底色，免得与 chip 自己的 surface2 糊成一片
     */
    <div className="flex min-w-0 flex-wrap items-center gap-[6px] rounded-[8px] border border-border-strong bg-surface2 px-[8px] py-[6px] hover:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
      {value.map((v, i) => {
        const s = String(v)
        /*
         * 按**码点**数而不是 `s.length`：后者是 UTF-16 码元数，`slice(0, 18)` 会把一个星区字符
         * （emoji 等占两个码元的字）切成半个代理对，chip 上渲染成 U+FFFD 替换字符。
         * 这几栏明确「原样存、给中文用」，看到乱码的人会以为自己填的东西被改了
         *（落盘值与 title 全文都不受影响，纯显示层，但显示层正是这里唯一的产出）
         */
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
