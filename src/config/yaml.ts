/**
 * @description 写盘前的 YAML 规整
 * 单独一个文件是为了避环：saveConfig 与 upgradeUserConfig 两处写盘都要用它，而 index.ts 已 import upgrade.js。
 */
import YAML from "yaml"
import type { Document, Node } from "yaml"

/**
 * @description 把 flow 风格的集合压回块状（空集合留 flow，`bind: []` 比三行空块好读）
 * `doc.createNode({...})` 造出来的节点默认是 flow 的，写进去的 connections 会成一行两百字符。
 * 修在写盘出口而不是各个 createNode 调用点，将来新加写入点不必记得这件事。
 * 注意：flow 标记记在节点自身上，`toString` 的 `lineWidth: 0` 管不着它，一旦写成 flow 之后每次保存都照写成一行
 * 注意：注释不受影响 —— 注释挂在节点的 `comment` / `commentBefore` 上，与 `flow` 是两个独立字段（test/upgrade.test.mjs 有断言）
 */
export function unflow<T>(doc: T): T {
  YAML.visit(doc as unknown as Document | Node, {
    Collection(_key, node) {
      if (node.flow && node.items?.length) node.flow = false
    },
  })
  return doc
}
