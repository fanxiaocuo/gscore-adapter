/**
 * Prettier 配置
 *
 * 内容与 Yunzai 根目录的 prettier.config.js 完全一致 —— 在这里补一份，是为了让
 * 格式不再依赖「插件恰好被放在 Yunzai 里」这件事：没有这份配置时 prettier 会向上
 * 找到根目录那份，仓库单独克隆出来就会退回默认值（semi: true、printWidth: 80），
 * 于是任何一次格式化都会把全仓库的分号和换行改一遍。
 *
 * 值保持不变，所以补这份文件不改变既有格式化结果（两份配置跑 --check 结果逐项一致）。
 * 改这里的任何一项都会波及全仓库，要动的话请单独一次提交，不要和功能改动混在一起。
 *
 * 已知：src 下有 5 个文件当前不满足 --check —— apps/admin.ts、config/index.ts、
 * modules/convert/toGscore.ts、modules/webadapter/index.ts、utils/message.ts。
 * 这是既有漂移（在 57cee1f 上就复现），多半是 ced3fa2「prettier --write 收齐 29 个
 * 文件」之后 prettier 升级改了三元表达式的折行策略。没有在补配置时顺手 --write：
 * 那会把 5 个文件整篇重排，功能 diff 就淹没在格式噪声里。要收的话单独开一次提交。
 *
 * 注意 prettier 本身不在本仓库的 devDependencies 里，当前是从 Yunzai 根目录的
 * node_modules 找到的（3.8.1）。干净克隆的仓库里没有它，`npx prettier` 会现拉。
 */
export default {
  semi: false,
  printWidth: 100,
  arrowParens: "avoid",
}
