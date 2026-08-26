/** @description 消息过滤（仅影响 client 方向的上报） */
import { group } from "./group.js"

/**
 * @description 用户黑名单「手动填」那栏的字段名 —— 一个不落盘的伪字段
 * GSelectFriend 只能从好友列表里挑，而 QQBot 官方号的 fl 只在有人私聊时才写一笔，
 * 群里刷屏的人根本不在列表里，所以另挂一个 GTags 收手输 ID。
 * 注意：两栏共用 filter.black_user 一个 key，拆分与合并在 ../index.ts 里做；不能写两条同名
 * field —— getConfigData 以 field 当 key，同名的会互相盖掉
 */
export const BLACK_USER_MANUAL_FIELD = "filter.black_user_manual"

/**
 * @description 可增删的标签输入，点「新增」弹窗填写（GTags 内联输入框宽度写死 78px，长词只能盲打）
 * 注意：不加 valueFormatter，值原样存 —— 前缀里的 `#`、关键词里的空格与大小写改一个字都会让匹配对不上
 *
 * @param content 弹窗里的提示语
 * @param placeholder 输入框占位符
 * @param help 弹窗内的补充说明，省略则不显示
 */
function tagsInput(content: string, placeholder: string, help?: string) {
  return {
    component: "GTags",
    componentProps: {
      allowAdd: true,
      allowDel: true,
      showPrompt: true,
      promptProps: {
        content,
        placeholder,
        okText: "添加",
        ...(help ? { bottomHelpMessage: help } : {}),
        // showInput 先铺 required:true 再展开 promptProps，这条同名规则覆盖它、把「不能为空」说得具体些
        rules: [{ required: true, message: "填点内容再添加吧" }],
      },
    },
  }
}

export const filterSchemas = [
  // 「过滤」组：与 web 面板的过滤 tab 对应
  group("过滤"),
  {
    component: "Divider",
    label: "消息过滤（仅影响上报）",
  },
  {
    field: "filter.report_private",
    label: "上报私聊消息",
    bottomHelpMessage: "关掉则私聊不再转发给早柚核心",
    component: "Switch",
  },
  {
    field: "filter.report_group",
    label: "上报群消息",
    bottomHelpMessage: "QQ 频道也算群",
    component: "Switch",
  },
  {
    field: "filter.report_meta",
    label: "上报非消息事件",
    bottomHelpMessage: "入群 / 退群 / 戳一戳；核心侧没有消费插件时可关掉",
    component: "Switch",
  },
  {
    field: "filter.only_reply_at",
    label: "仅响应 @ 与前缀",
    bottomHelpMessage: "开启后群消息只有被 @ 或带下方前缀时才上报",
    component: "Switch",
  },
  {
    field: "filter.prefix",
    label: "触发前缀",
    bottomHelpMessage: "「仅响应 @ 与前缀」开启时，这些前缀也视为触发",
    ...tagsInput("请输入触发前缀：", "如 # 或 *", "消息以它开头就当作被 @ 了，原样填，不用带引号"),
  },
  {
    field: "filter.block_prefix",
    label: "屏蔽前缀",
    bottomHelpMessage: "以任一项开头即不上报，用于避免与本地插件抢命令",
    ...tagsInput(
      "请输入要屏蔽的前缀：",
      "如 #原神",
      "消息以它开头就不上报，用来把某些指令留给本地插件",
    ),
  },
  {
    field: "filter.block_include",
    label: "屏蔽关键词",
    bottomHelpMessage: "包含任一项即不上报",
    ...tagsInput("请输入要屏蔽的关键词：", "如 抽卡", "消息里出现它就不上报，出现在哪个位置都算"),
  },
  {
    field: "filter.white_group",
    label: "群白名单",
    bottomHelpMessage:
      "只上报这些群，留空为全部。列表是所有在线账号已知的群，账号离线时点开是空的 —— 此时存着的群仍在，只是显示成光秃秃的号码（名字查不到）",
    component: "GSelectGroup",
    componentProps: { placeholder: "请选择要上报的群" },
  },
  {
    field: "filter.black_group",
    label: "群黑名单",
    bottomHelpMessage: "这些群不上报",
    component: "GSelectGroup",
    componentProps: { placeholder: "请选择不上报的群" },
  },
  {
    /*
     * 注意：QQBot 账号在这一栏的头像必然是 Bot 自己那张，插件改不了 —— 锅巴的 g-avatar 把
     * URL 写死成 `q1.qlogo.cn/g?b=qq&nk=<id>`（QQ 号模板），而它传进去的 id 是 fl 的键
     * `<appid>:<openid>`，q.qlogo 认出开头那个 appid 就回了 Bot 的图；fl 条目里本来带着正确的
     * `q.qlogo.cn/qqapp/<appid>/<openid>/0` 被整个忽略。schema 过序列化、塞不进自定义渲染函数，
     * 所以只能在说明里点明并指向 web 面板（那边的 /targets 自己取图）
     */
    field: "filter.black_user",
    label: "用户黑名单（好友里选）",
    bottomHelpMessage:
      "从账号已知的好友里挑。QQBot 官方号只有私聊过的人才在列表里，挑不到的填下面那栏。" +
      "注意：QQBot 账号在这里头像全是 Bot 自己那张、昵称也可能对不上，认人请看 web 面板",
    component: "GSelectFriend",
    componentProps: { placeholder: "请选择不上报的用户" },
  },
  {
    field: BLACK_USER_MANUAL_FIELD,
    label: "用户黑名单（手动填）",
    bottomHelpMessage:
      "与上一栏合成同一份名单保存，填平台原样 ID。保存后能在好友列表里查到的会挪到上一栏去",
    // 只校验非空：QQ 号 5-11 位、QQBot openid 32 位十六进制，卡长度只会把非 QQ 平台的 ID 拦在外面
    ...tagsInput(
      "请输入要屏蔽的用户 ID：",
      "QQ 号 / openid",
      "上一栏里挑不到的人填这儿，填平台原样 ID",
    ),
  },
]
