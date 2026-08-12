/**
 * 写盘前的 YAML 规整
 *
 * 单独一个文件而不是放 `config/index.ts`：`index.ts` 已经 import 了 `upgrade.js`，
 * 而两处写盘（`saveConfig` 与 `upgradeUserConfig`）都要用这个函数，
 * 让 upgrade 反过来 import index 就成环了。放这里两边都只依赖它。
 */
import YAML from "yaml"
import type { Document, Node } from "yaml"

/**
 * 把 flow 风格的集合压回块状
 *
 * 为什么需要
 * --------
 * `doc.createNode({...})` 造出来的节点默认是 flow 的，于是 #早柚添加连接 写进去的
 * `ws_connections` 会变成一行两百字符的 `[ { name: ..., url: ..., ... } ]` ——
 * 用户既读不了也没法手改。而 flow 这个标记记在**节点自身**上，`toString` 的
 * `lineWidth: 0` 管不着它，所以一旦某次写入把它变成 flow，之后每次保存都会照写成一行。
 *
 * 修在写盘的出口而不是各个 createNode 调用点（`apps/admin.ts` 的 add、
 * `modules/webadapter/index.ts` 的 add 与 bind/exclude 那几处）：将来新加写入点
 * 不必记得这件事。
 *
 * 空集合留 flow —— `bind: []` 比展开成三行的空块好读，而空集合本来也不长。
 *
 * 注释不受影响：yaml 库把注释挂在节点的 `comment` / `commentBefore` 上，
 * 与 `flow` 是两个独立字段，改后者不动前者（test/upgrade.test.mjs 有断言）。
 */
export function unflow<T>(doc: T): T {
  YAML.visit(doc as unknown as Document | Node, {
    Collection(_key, node) {
      if (node.flow && node.items?.length) node.flow = false
    },
  })
  return doc
}
