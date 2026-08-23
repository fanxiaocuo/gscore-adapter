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
 * 那 5 个长期不满足 --check 的文件（apps/admin.ts、config/index.ts、
 * modules/convert/toGscore.ts、modules/webadapter/index.ts、utils/message.ts）已在
 * 全项目注释压缩那次一并 --write 收齐，现在全仓 --check 是干净的。压注释本就把这几个
 * 文件整篇动了，格式噪声没有额外代价。
 *
 * 注意：验证漂移必须把探针文件放在仓库内**未被 .gitignore 忽略**的路径上 —— 放进
 * test/ 会被 prettier 跳过，--check 直接报干净，是个假阴性。
 *
 * 注意 prettier 本身不在本仓库的 devDependencies 里，当前是从 Yunzai 根目录的
 * node_modules 找到的（3.8.1）。干净克隆的仓库里没有它，`npx prettier` 会现拉。
 */
export default {
  semi: false,
  printWidth: 100,
  arrowParens: "avoid",
}
