/**
 * @description 锅巴 schema 的分组标记
 *
 * 锅巴认两种「分组」，差别很大：
 *   `Divider`           —— 只画一条横线，字段全部铺在同一张长表上
 *   `SOFT_GROUP_BEGIN`  —— 真分组：锅巴按它建 softGroupMap，并给每组的字段挂上 ifShow，
 *                          只渲染当前组，导航切换（见 guoba-plugin 的 BasicForm.js）
 *
 * 这个插件的配置项已经二十多条，铺成一条长表要滚很久，所以用后者。分组与 web 面板的
 * 三个 tab 一一对应（连接 / 设置 / 过滤），两个面板的导航说法一致。
 *
 * 注意：**第一条 schema 必须就是分组标记**。锅巴把首个标记之前的字段全归进一个叫「默认」的组，
 * 于是会凭空多出一个组；`buildSchemas()` 的拼接顺序因此也不能随手改
 */

/** @description 起一个新分组，label 就是导航上的组名 */
export const group = (label: string) => ({ label, component: "SOFT_GROUP_BEGIN" })
