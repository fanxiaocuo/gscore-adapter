/**
 * 基础层：reset、画布、字体
 *
 * 这一层只放「整张图都成立」的规则。页面专属的东西一律去 pages/ 下对应文件，
 * 免得又长回从前那份 488 行、四个页面混在一起的单文件。
 */
import { CANVAS_WIDTH, FONT_STACK, MONO_STACK } from "../theme.js";
/**
 * @param p 调色板
 * @param scale 高清倍率，用 zoom 实现（理由见 render/index.ts 的 SCALE 注释）
 */
export const base = (p, scale) => `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{background:${p.bg}}
#container{
  width:${CANVAS_WIDTH}px;min-width:${CANVAS_WIDTH}px;
  position:relative;overflow:hidden;
  background:${p.bg};color:${p.foreground};
  font-family:${FONT_STACK};
  -webkit-font-smoothing:antialiased;
  zoom:${scale};
}
.mono{font-family:${MONO_STACK}}
`;
