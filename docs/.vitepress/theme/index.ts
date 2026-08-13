/**
 * 主题入口
 *
 * 只做一件事：套用默认主题 + 自己那份样式。不注册任何自定义组件 ——
 * DESIGN.md 的东西全部能用 CSS 表达（极光画布、玻璃面、渐变强调都是
 * 伪元素与变量），加组件只会让「改版式要动两处」。
 */
import DefaultTheme from "vitepress/theme"
import "./style.css"

export default DefaultTheme
