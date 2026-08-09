import { base } from "./base.js";
import { backdrop } from "./backdrop.js";
import { frame } from "./frame.js";
import { shared } from "./shared.js";
import { help } from "./pages/help.js";
import { status } from "./pages/status.js";
import { changelog } from "./pages/changelog.js";
import { about } from "./pages/about.js";
/**
 * 生成整张画布的 CSS
 *
 * 四个页面共用同一份：外壳 shell.html 是固定的（那边注释说明了为什么不能按页
 * 换模板），一份完整样式表约 24KB、内联进 <style> 的开销可以忽略（相较出图本身
 * 的几百 KB 不值一提），而按页裁剪要多维护一张「页面 → 需要哪些层」的映射表，
 * 不划算。
 *
 * 拼装顺序即层叠顺序，不能随意调：base 先落地全局盒模型与字体，pages 放最后，
 * 让页面专属规则在同等特异度下能覆盖 shared。四个页面之间互不覆盖（前缀已隔开），
 * 彼此顺序无所谓，按命令的出场顺序排以便查阅。
 *
 * 显式列出而不是 LAYERS.map()：base 需要 scale、其余层只认调色板，
 * 签名不一致的函数放进同一个数组再统一调用，类型上过不去。
 *
 * @param p 调色板
 * @param scale 高清倍率，用 zoom 实现（理由见 render/index.ts 的 SCALE 注释）
 */
export function buildCss(p, scale = 1) {
    return [
        base(p, scale),
        backdrop(p),
        frame(p),
        shared(p),
        help(p),
        status(p),
        changelog(p),
        about(p),
    ]
        .map(css => css.trim())
        .join("\n\n");
}
