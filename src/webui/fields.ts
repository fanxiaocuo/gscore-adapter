/**
 * @description 面板配置项的字段表：渲染、收集、脏集合三处共用同一份定义
 *
 * 字段全集就是 `api.ts` 的 {@link PayloadConfig}，一个不漏一个不多 —— 两边对不上时表现为
 * 面板上一个空控件或一项永远存不下去的配置，而不是编译错误。
 *
 * 注意：类型层**没有**联系。本文件一个 import 都没有（浏览器包不能 import 服务端代码，
 * 见 vite.config.mts），`Field.k` 标的是 string 而不是 `keyof PayloadConfig`。下面那个
 * {@link FIELD_COUNT} 只是把本文件自己的两个数互相比，拦不住「契约加了字段而这里忘了跟」。
 * 真正的门在 `test/panel.test.mjs` 那两条：一条把本表与 `GET /config` 的真回包逐项对齐
 *（回包那侧由 tsc 卡着 —— configView() 的返回类型标了 `Payload["config"]`），另一条逐项提交
 * 去撞服务端的写白名单。加字段时那两条会红，别只看 FIELD_COUNT
 *
 * 注意：key 写成 `filter.report_private` 这种点号路径，取值由 main.tsx 的 `dig()` 按路径走。
 * 分层照 yaml 原样（client / filter / update_check / file_server 各一层），不摊平 —— 提交时
 * 按同一条路径塞回嵌套对象，摊平的话服务端白名单还得再维护一份映射
 * 注意：三个换算字段收的是 MB 与秒，落盘是字节与毫秒，**换算在服务端做**。前端一个换算都不做：
 * 两头各算一次的话 MEDIA_SIZE_MAX 那道校验与面板显示会各持一种口径
 */

/**
 * @description 数字控件的取值区间，**必须与服务端一致**
 *
 * 权威在 `src/config/units.ts`（`displayRange()`）与 webadapter 的 `NUM_FIELDS`。这里只能抄一份
 * 字面值，不能 import 过来：webui 是浏览器包，Vite 刻意不给 `@/` 别名（见 vite.config.mts
 * 「只有浏览器端进 bundle」），开了这个口子迟早有人把带 fs/chokidar 的 `@/config` 拉进 bundle。
 * 注意：抄的这几个数由 `test/panel-bounds.test.mjs` 钉着 —— 那条测试同时 import 本文件与
 * units.ts 逐项比对，改任一边而忘了另一边就会红。别只改这里
 * 注意：两边不一致的后果是「面板放行、保存必失败」：控件让用户填 0 或 500，服务端 boundsError
 * 一律拒，整批保存被回退
 */
const MB_RANGE = { min: 0.01, max: 256 }
const EXPIRE_MIN = 1
/** 端口上限；与 webadapter 的 NUM_FIELDS 那条同源 */
const PORT_MAX = 65535
/** 检查间隔下限；服务端卡的是 1（低于 30 由下游按 30 兜底，不报错） */
const INTERVAL_MIN = 1

/**
 * @description 控件类型。用联合字面量而不是 string：写错一个字母时 `type === "swtich"`
 * 不会报错，只会让那一行静默渲成输入框
 *
 * - `chips` 是标签输入（components/Chips.tsx），不叫 list —— 连接弹层里的 `list` 是
 *   逗号分隔的单行文本框，两者的交互与数据形状都不同
 * - `path` 与 text 的差别只在等宽字与占位符提示，值都是字符串
 */
export type FieldType = "switch" | "number" | "text" | "password" | "chips" | "path"

/** tab 标识，也是 localStorage 里记着的值 */
export type TabId = "conn" | "settings" | "filter"

export interface Field {
  /** 提交用的点号路径，与 yaml 的层级一致 */
  k: string
  label: string
  /**
   * @description 说明列的中文短句，写「改了会怎样」而不是「这一项是什么」
   * 空串表示这一行不需要说明（标题已经说清了）
   */
  hint: string
  type: FieldType
  /**
   * @description 读值路径，与 {@link k} 不同时才给
   * 凭据脱敏用：写的是 `file_server.imagebed_token`，而整包只回 `has_imagebed_token`
   *（布尔，只说明配没配）。见 api.ts 的 PayloadConfig.file_server
   */
  read?: string
  /** chips 能从已知群 / 好友里挑时给，对应 `GET /targets?kind=` */
  picker?: "group" | "friend"
  /**
   * @description 这一栏收的是 MB，说明列顺手报出保存后会落盘的字节数
   * 只给「面板单位是 MB」的那两项。link_expire 收的是秒，没有量级可折算，不给
   */
  scale?: "MB"
  /**
   * @description 数字上下界，直接给控件的 min/max
   * 值取本文件顶上那几个常量，别在字段里现写数字 —— 权威是 config/units.ts 与 webadapter
   * 的 NUM_FIELDS，而这里只是抄的一份（不能跨包 import 的理由见那段注释），
   * 由 test/panel-bounds.test.mjs 钉着两边一致。
   * 其余字段的 0 是「关闭」或「随机」，那种不设下界
   */
  min?: number
  max?: number
  ph?: string
}

export interface Section {
  id: string
  title: string
  /** 整节的说明，挂在小标题下面。逐字段说不清的前提写这儿 */
  hint?: string
  /**
   * @description 整节延迟提交：连开关都不即时写，攒到悬浮保存条一起交
   * 只有文件服务一节是 true。`port` / `host` / `public_host` 是一个意图，`enable` 先即时写
   * 会按旧端口重启一次、用户填完端口再重启一次，而每次重启都作废在途外链
   */
  defer?: boolean
  fields: Field[]
}

export interface Tab {
  id: TabId
  label: string
  sections: Section[]
}

/**
 * @description 三个 tab 的完整字段表，顺序即显示顺序
 * 连接 tab 的统计卡与连接卡列表不在这里 —— 它们不是配置项，由 main.tsx 直接渲
 */
export const TABS: Tab[] = [
  {
    id: "conn",
    label: "连接",
    sections: [
      {
        id: "ws",
        title: "WebSocket",
        fields: [
          {
            k: "client.enable_ws",
            label: "启用 ws 通路",
            type: "switch",
            // 与「设置」tab 的总开关 enable 语义重叠，两处的说明都要点明差别，
            // 否则用户关了一个发现还连着、以为没生效
            hint: "只关 ws 这一条通路。要连都不连请用「设置」里的启用适配器",
          },
          {
            k: "client.heartbeat",
            label: "心跳间隔（秒）",
            type: "number",
            min: 0,
            hint: "ws ping 的间隔，0 关闭。改完自动重连一次",
          },
          {
            k: "client.heartbeat_timeout",
            label: "心跳超时（秒）",
            type: "number",
            min: 0,
            hint: "超过这么久没收到 pong 就判掉线重连，0 关闭",
          },
        ],
      },
    ],
  },
  {
    id: "settings",
    label: "设置",
    sections: [
      {
        id: "main",
        title: "总开关",
        fields: [
          {
            k: "enable",
            label: "启用适配器",
            type: "switch",
            // 与 client.enable_ws 的分工见那一项的 hint
            hint: "关掉则完全不连核心，连都不连。改完即时生效，不用重启云崽",
          },
          {
            k: "log_truncate",
            label: "日志截断 base64",
            type: "switch",
            hint: "关掉后日志里会出现完整的 base64 长串，排查编码问题时才需要",
          },
          {
            k: "notify_master",
            label: "断线通知主人",
            type: "switch",
            hint: "连接断开与恢复时私聊主人。核心常重启的话会比较吵",
          },
        ],
      },
      {
        id: "media",
        title: "媒体与外链",
        fields: [
          {
            k: "media_max_size",
            label: "媒体内联上限（MB）",
            type: "number",
            scale: "MB",
            min: MB_RANGE.min,
            max: MB_RANGE.max,
            hint: "超过这个大小的图片、语音改用 link:// 外链发。配置文件里仍按字节存",
          },
          {
            k: "file_max_size",
            label: "文件内联上限（MB）",
            type: "number",
            scale: "MB",
            min: MB_RANGE.min,
            max: MB_RANGE.max,
            // file 段没有 URL 形式，只能内联，所以超限是「直接拒绝」而不是「改外链」
            hint: "file 段只能内联 base64，超过就直接拒绝发送。配置文件里仍按字节存",
          },
          {
            k: "link_expire",
            label: "外链有效期（秒）",
            type: "number",
            min: EXPIRE_MIN,
            hint: "外链多久失效。太短会让核心拉到超时占位图。配置文件里仍按毫秒存",
          },
          {
            k: "upload_hook",
            label: "自定义图床模块",
            type: "path",
            // 占位符只放示例路径：输入框 260px，塞「留空则不用，如 …」会被截成半句
            ph: "./plugins/xxx/upload.js",
            hint: "内置文件服务的后备，留空则不用：填模块路径，默认导出一个 (buf, name) => 图床链接 的函数。保存时会试加载一次，导出不是函数就存不下去",
          },
        ],
      },
      {
        id: "file_server",
        title: "内置文件服务",
        // 措辞照 resources/config/default_config.yaml 那一节的注释，别自己另写一版：
        // 用户对着 yaml 与面板两处看，说法不一致会以为是两个不同的开关
        hint: "仅在框架没有 Bot.fileToUrl 时启用（Miao-Yunzai）。TRSS-Yunzai 自带文件服务，这一节完全无效，不用管。改完自动重启文件服务，在途外链会作废",
        defer: true,
        fields: [
          {
            k: "file_server.enable",
            label: "启用文件服务",
            type: "switch",
            hint: "关掉则回落到上面的自定义图床模块。与本节其余项一起保存，不即时生效",
          },
          {
            k: "file_server.port",
            label: "监听端口",
            type: "number",
            min: 0,
            // 与服务端 NUM_FIELDS 那条一致，否则填 99999 要等保存失败才知道
            max: PORT_MAX,
            hint: "0 为每次随机取可用端口，不会撞端口。改了会重启文件服务",
          },
          {
            k: "file_server.host",
            label: "监听地址",
            type: "text",
            ph: "0.0.0.0",
            hint: "默认 0.0.0.0：核心常跑在 Docker 或另一台机器上，只听 127.0.0.1 它连不进来",
          },
          {
            k: "file_server.public_host",
            label: "外链 host",
            type: "text",
            ph: "留空则自动推断",
            hint: "外链里用的地址。留空按 ws 连接的本机地址推断，推断不对时在这儿写死",
          },
          {
            k: "file_server.once",
            label: "取走即删",
            type: "switch",
            hint: "核心拿到内容后立刻释放，缩小外链被重放的窗口。核心会重复拉同一链接时才关",
          },
          {
            k: "file_server.imagebed_token",
            // 凭据不回前端，整包只回 has_imagebed_token
            read: "file_server.has_imagebed_token",
            label: "图床转接口凭据",
            type: "password",
            ph: "留空则不修改",
            hint: "同机部署留空即可。核心跨机时才要配，并把地址写成 …/gscore/imagebed?token=<口令>。不配口令时非本机来源一律拒绝",
          },
        ],
      },
      {
        id: "update_check",
        title: "更新检查",
        hint: "只做检查与通知，不会自动更新",
        fields: [
          {
            k: "update_check.enable",
            label: "定时检查更新",
            type: "switch",
            hint: "关掉后 #早柚检查更新 仍能手动用",
          },
          {
            k: "update_check.interval",
            label: "检查间隔（分钟）",
            type: "number",
            // 服务端 NUM_FIELDS 卡的是 1，面板放行 0 只会让保存整批失败
            min: INTERVAL_MIN,
            // 下游按 30 兜底，面板照原值显示（改成显示 30 会让用户以为自己填的没存上）
            hint: "低于 30 会被按 30 处理：每次都要 git fetch 一次远端，太频繁没有意义",
          },
          {
            k: "update_check.delay",
            label: "启动后首次检查（分钟）",
            type: "number",
            min: 0,
            hint: "错开启动高峰：刚起来时连接还在建、渲染要拉浏览器，再插一次 fetch 容易拖慢启动",
          },
          {
            k: "update_check.notify",
            label: "有新版本私聊主人",
            type: "switch",
            hint: "关掉则只记日志，不推送",
          },
        ],
      },
    ],
  },
  {
    id: "filter",
    label: "过滤",
    sections: [
      {
        id: "report",
        title: "上报开关",
        hint: "比下面的名单粗一档：想「只让群消息过核心」时不必把私聊用户逐个列进黑名单",
        fields: [
          {
            k: "filter.report_private",
            label: "上报私聊",
            type: "switch",
            hint: "关掉则私聊不再转发给核心",
          },
          {
            k: "filter.report_group",
            label: "上报群聊",
            type: "switch",
            hint: "QQ 频道也算群",
          },
          {
            k: "filter.report_meta",
            label: "上报进群 / 退群 / 戳一戳",
            type: "switch",
            hint: "核心侧没装消费这些事件的插件时可以关掉，省下全部无用上报",
          },
          {
            k: "filter.only_reply_at",
            label: "仅被 @ 或带前缀才上报",
            type: "switch",
            hint: "只管群消息，私聊不受影响。开启后没带前缀又没 @ 的群消息一律不上报",
          },
        ],
      },
      {
        id: "words",
        title: "前缀与关键词",
        // 不校验形状的理由：多一个空格、少一个 # 都会让匹配对不上，而用户填的就该原样存
        hint: "原样存，不做任何清洗 —— 前缀里的 # 与关键词的空格、大小写都参与匹配",
        fields: [
          {
            k: "filter.prefix",
            label: "触发前缀",
            type: "chips",
            ph: "如 # 或 *",
            hint: "「仅被 @ 或带前缀才上报」开启时，以这些开头也算触发",
          },
          {
            k: "filter.block_prefix",
            label: "屏蔽前缀",
            type: "chips",
            ph: "如 #原神",
            hint: "以任一项开头即不上报，用来把某些指令留给本地插件",
          },
          {
            k: "filter.block_include",
            label: "屏蔽关键词",
            type: "chips",
            ph: "如 抽卡",
            hint: "消息里出现它就不上报，出现在哪个位置都算",
          },
        ],
      },
      {
        id: "groups",
        title: "群名单",
        hint: "列表是所有在线账号已知的群。账号离线时列表是空的，此时存着的名单仍在，只显示成光秃秃的号码",
        fields: [
          {
            k: "filter.white_group",
            label: "群白名单",
            type: "chips",
            picker: "group",
            ph: "群号",
            hint: "只上报这些群，留空为全部。填了就等于其余群全部不上报",
          },
          {
            k: "filter.black_group",
            label: "群黑名单",
            type: "chips",
            picker: "group",
            ph: "群号",
            hint: "这些群不上报。与白名单同时填时，黑名单优先",
          },
        ],
      },
      {
        id: "users",
        title: "用户名单",
        fields: [
          {
            k: "filter.black_user",
            label: "用户黑名单",
            type: "chips",
            picker: "friend",
            ph: "QQ 号 / openid",
            // 官方号的 fl 只在有人私聊过之后才写一笔，群里刷屏的人挑不到，必须能手输
            hint: "这些用户的消息不上报。QQBot 官方号只有私聊过的人在好友列表里，挑不到的直接手填",
          },
        ],
      },
    ],
  },
]

/** tab id 列表，顺序即显示顺序。Tabs 的 useTab 用它核对 localStorage 里的旧值 */
export const TAB_IDS: TabId[] = TABS.map(t => t.id)

/** 摊平的字段表，按 tab 顺序。收集提交体与算脏集合都走它 */
export const ALL_FIELDS: Field[] = TABS.flatMap(t => t.sections.flatMap(s => s.fields))

/** 按 key 取字段定义。脏集合里存的是 key，提交时要回头查它的 type 才知道怎么转值 */
export const FIELD_BY_KEY: Record<string, Field> = Object.fromEntries(ALL_FIELDS.map(f => [f.k, f]))

/**
 * @description 整节延迟的字段（文件服务那一节的全部控件，含开关）
 * 注意：是 Set 而不是前缀判断 —— 前缀判断会把将来新增的 `file_server_xxx` 顶层字段一起吃掉
 */
export const DEFERRED = new Set(
  TABS.flatMap(t => t.sections.filter(s => s.defer).flatMap(s => s.fields.map(f => f.k))),
)

/**
 * @description 字段总数，与 api.ts 的 PayloadConfig 字段数一致（30）
 *
 * 契约扩了字段而字段表忘了跟，面板上只是少一行、没有任何报错，所以要有这道数目校验。
 * 注意：**这里不能 throw**。原先写的是「模块顶层 throw 会在打包期炸掉」，那是错的 ——
 * Vite/Rolldown 只打包、不执行模块顶层，那句 throw 会原样进 panel.js，改到浏览器加载时才炸：
 * React 根本没挂上，用户看到的是一整片空白面板加一条控制台报错，比「少一行」严重得多。
 * 真正的门在 `test/panel-bounds.test.mjs`（Node 侧能执行，跑得到断言）；这里只留一条
 * console.error，让面板照常渲染出来、同时把不一致喊出来
 */
export const FIELD_COUNT = 30
if (ALL_FIELDS.length !== FIELD_COUNT)
  console.error(
    `[gscore-adapter] 字段表有 ${ALL_FIELDS.length} 项，应为 ${FIELD_COUNT} 项（对齐 api.ts 的 PayloadConfig）`,
  )
