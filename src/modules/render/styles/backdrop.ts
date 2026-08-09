/**
 * 背景装饰层
 *
 * 对应组件 components/Layout.tsx 的 <Backdrop>。四个页面共用，所以不加页面前缀。
 * 这一层全是「绝对定位 + 低透明度」的东西，z-index 一律 0，正文在 .page 的 z-index:10。
 */
import type { Palette } from "../theme.js"

export const backdrop = (p: Palette): string => `
.bg{position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.glow{position:absolute;border-radius:9999px}
.glow-1{width:1260px;height:1440px;top:-270px;left:-180px;filter:blur(128px);transform:rotate(-20deg);
  background:radial-gradient(ellipse at 40% 40%,${p.glow[0]} 0%,transparent 70%)}
.glow-2{width:900px;height:1080px;top:450px;right:-90px;filter:blur(108px);transform:rotate(15deg);
  background:radial-gradient(ellipse at 50% 50%,${p.glow[1]} 0%,transparent 70%)}
.glow-3{width:1080px;height:900px;bottom:-180px;left:180px;filter:blur(128px);transform:rotate(-10deg);
  background:radial-gradient(ellipse at 50% 60%,${p.glow[2]} 0%,transparent 70%)}
.noise{position:absolute;inset:0;opacity:.04;pointer-events:none;z-index:0}
.noise svg{width:100%;height:100%}
/* 竖排气氛大字
   top 从 120px 下移到 560px：概览统计条占 309~500px，原来的起点让大字正好压在
   第四张卡（TRACKING / origin/main）背后，字面笔画透过半透明卡片显出来，像脏了。
   560px 起正好落在统计条下方的列表区，那里行高一致、底色均匀，才是它该待的地方。
   透明度也压到 .028——列表卡片比统计卡更透，同样的 .035 在这里更显眼。
   关于页版式不同，起点由组件的 ghostTop 覆盖（见 Layout.tsx 的 Backdrop）。 */
.ghost{position:absolute;top:560px;right:56px;z-index:0;opacity:.028;pointer-events:none;
  writing-mode:vertical-rl;text-orientation:mixed;
  font-size:200px;font-weight:900;line-height:1;letter-spacing:-.04em;color:${p.foreground}}
/* 角落装饰：左上点阵与右上刻度线是一对，要对称
   ------
   left/top 与 .page 的 72px padding 拉开：原来放在 48px，点阵右下角正好压到
   徽标那颗 LED 上（点阵止于 y=68，徽标起于 y=72，只差 4px），看着像挤在一起。
   现在整体退到画布边缘 40px 处、并把点阵缩到 3 列，让出徽标所在的横带。

   两块的几何对齐（Layout.tsx 里给的数量与宽度）：
   点阵 3 列 × 3 行 = 3×5 + 2×7 = 29px 见方；
   刻度 3 条 = 3×4 + 2×4 = 20px 高，最长 72px。
   行数相同、高度接近、最长边同量级，两个角落才配平。
   曾经是点阵 2 行（17px 高）配 128px 的长刻度线，右边分量重出四倍。 */
.dots{position:absolute;top:40px;left:40px;display:grid;grid-template-columns:repeat(3,1fr);gap:7px;opacity:.16;z-index:0}
.dots i{width:5px;height:5px;border-radius:9999px;background:${p.foreground}}
.ticks{position:absolute;top:40px;right:40px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;opacity:.16;z-index:0}
.ticks i{height:4px;background:${p.foreground}}
.stripes{position:absolute;bottom:0;left:0;width:520px;height:400px;opacity:.04;z-index:0;
  background:repeating-linear-gradient(45deg,${p.foreground},${p.foreground} 5px,transparent 2px,transparent 10px)}
`
