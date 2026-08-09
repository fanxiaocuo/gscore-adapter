/**
 * 运行环境页（#早柚版本）
 *
 * 组件 components/About.tsx。这页不用 .head/.stats/.hp-item 那套骨架——它和状态页
 * 答的是不同的问题，沿用同一套版式会让两条命令的图长得几乎一样（见 About.tsx 顶部注释）。
 *
 * 前缀沿用既有的 rt-（runtime report），拆分前就是这页唯一带前缀的部分，
 * 组件里已经这么写，不再改名。唯一搬走的是 .rt-sec —— 状态页也在用它，
 * 已提到 shared.ts 改名 .sec。
 */
import type { Palette } from "../../theme.js"

export const about = (p: Palette): string => `
/* 顶部小字条：左边「运行诊断 · RUNTIME REPORT」，右边正式版/预览版胶囊 */
.rt-top{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:40px}
.rt-eyebrow{display:flex;align-items:center;gap:14px;font-size:24px;font-weight:800;
  letter-spacing:.18em;color:${p.muted};line-height:1}
.rt-eyebrow .dot{width:11px;height:11px;border-radius:9999px;flex:none}
.rt-eyebrow .sp{opacity:.5}
.rt-badge{flex:none;padding:12px 26px;border-radius:9999px;line-height:1;
  font-size:22px;font-weight:800;letter-spacing:.1em}
/* 标题区：左标题右速览
   ------
   align-items:flex-end 让两栏底边成一条线。速览三格合计约 270px 高，
   比左边的标题+说明（约 200px）高，所以底对齐时它会向上探出约 70px——
   正好填掉标题上方那条空带，而不是在标题下方留出一段。
   顶对齐则相反：速览悬在上面，标题下方空一截，两栏都不落地。
   margin-bottom 由原来 .rt-desc 的 64px 移到这里，整块作为一个单位与 hero 拉开。 */
.rt-lead{display:flex;align-items:flex-end;justify-content:space-between;gap:56px;
  margin-bottom:64px}
.rt-lead .txt{min-width:0}
/* 标题比其他页的 104px 小一档：这页的主视觉是下面的版本号，标题让位 */
.rt-title{font-size:88px;font-weight:900;line-height:1.05;letter-spacing:-.04em;margin-bottom:18px}
.rt-desc{font-size:27px;color:${p.muted};line-height:1.6}
/* 速览格：竖排三行，右对齐
   ------
   右对齐而不是左对齐：它贴着画布右边缘，取值的右边缘成一条线才像「标注」，
   左对齐会在右侧又留出一条不齐的锯齿边。
   text-align 给在 .g 上、并且 flex-direction:column + align-items:flex-end，
   两层都要——小标签与大数值的宽度不同，只靠 text-align 在 flex 子项上不生效。
   数值 44px：比正文 38px 大一档，但远小于 hero 的版本号，层级排在它后面。 */
.rt-glance{flex:none;display:flex;flex-direction:column;gap:22px;align-items:flex-end}
.rt-glance .g{display:flex;flex-direction:column;align-items:flex-end;gap:7px;line-height:1}
.rt-glance .g .k{font-size:19px;font-weight:800;letter-spacing:.18em;color:${p.muted}}
.rt-glance .g .v{font-size:44px;font-weight:900;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;white-space:nowrap}

/* 版本号主视觉
   ------
   kkk 那张图上版本号是最抢眼的一块，这里照做。

   字号不写死，由 About.tsx 的 fitFontSize 按串长算出来写进 style
   ------
   这里原本写死 130px，注释里按「20 字符 × 0.6em」估过一遍，但那个估算漏了两件事：
   一是内容宽是 1296px 不是 1872px（1440 画布减 72×2 的 padding），
   二是 main 分支的 describe 串是 v2.1.0-2-gc6522ee-dirty，23 字符里有 9 个数字、
   11 个小写字母，实际宽约 1790px。结果版本号折成两行，还压到了下面的插件名上。
   现在 CSS 只给下限兜底（放不下时至少不至于溢出），实际字号由组件给。

   white-space:nowrap 取代原来的 overflow-wrap:break-word —— 版本号是一个整体
   标识，从中间断开比缩小更难读（v2.1.0-2- / gc6522ee-dirty 是两个无意义的片段）。
   图标 200px 而不是 168px：右侧三行合计约 220px（小字 22 + 数字 130 + 名字 36
   加两道 8px 间距），168 的图标明显比文字块矮一截，两边体量不相当。 */
.rt-hero{display:flex;align-items:center;gap:44px;margin-bottom:80px}
.rt-hero .art{width:200px;height:200px;flex:none;border-radius:44px;object-fit:contain;
  background:${p.inset};border:1px solid ${p.border}}
.rt-hero .txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.rt-hero .cap{font-size:22px;font-weight:800;letter-spacing:.2em;color:${p.muted};line-height:1}
.rt-hero .num{font-size:130px;font-weight:900;line-height:1;letter-spacing:-.05em;
  white-space:nowrap;font-variant-numeric:tabular-nums}
.rt-hero .nm{font-size:26px;color:${p.muted};letter-spacing:.06em;line-height:1.4}

/* 本版变更
   ------
   数据来自 CHANGELOG.md（changelog.ts 解析），结构是「分类 + 条目」两层。
   不做成卡片：这页已经定了「无边框信息块」的语言（见下面 .rt-grid 的说明），
   变更列表再套一层卡片就又向状态页靠回去了。分类之间靠间距分组，
   条目用一颗小圆点当项目符号，颜色跟着分类走，扫读时能一眼分出属于哪一类。 */
.rt-chg{display:flex;flex-direction:column;gap:40px;margin-bottom:72px}
/* 分类块：拆分前组件里写了 .grp 但 CSS 里从没定义过（靠父级 .rt-chg 的 gap
   恰好达到效果）。488 行单文件里这种漏定义看不出来，现在补上——只声明 min-width:0，
   让长条目在 flex 列里能正常收缩，其余间距仍由 .rt-chg 的 gap 给。 */
.rt-chg .grp{min-width:0}
.rt-chg .gt{font-size:27px;font-weight:800;letter-spacing:.02em;line-height:1.3;
  margin-bottom:18px}
.rt-chg .items{list-style:none;display:flex;flex-direction:column;gap:14px}
/* 圆点用 flex:none + margin-top 手动对齐首行视觉中线：
   align-items:center 在条目折行时会把点带到两行之间，看着像挂错了行 */
.rt-chg .items li{display:flex;align-items:flex-start;gap:16px;font-size:25px;line-height:1.5}
.rt-chg .items li i{width:9px;height:9px;border-radius:9999px;flex:none;margin-top:14px;
  opacity:.85}
.rt-chg .items li span{flex:1;min-width:0;overflow-wrap:break-word}

/* 环境摘要两列
   ------
   不做成圆角卡片：状态页与帮助页已经用满了「卡片列表」这个语言，这页再用一遍
   就是用户说的「像早柚状态」。改成无边框的双列信息块，只用一条底线分隔，
   与卡片页拉开观感。row-gap 给得比 column-gap 大，两列之间才不会读串行。 */
.rt-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:52px 64px;margin-bottom:72px}
.rt-cell{display:flex;flex-direction:column;gap:10px;min-width:0}
.rt-cell .k{font-size:23px;font-weight:800;letter-spacing:.12em;color:${p.muted};line-height:1.2}
/* break-word：CPU 型号这类长串（Intel(R) Core(TM) i3-10100E CPU @ 3.20GHz）
   必须能折，否则会顶破列宽 */
.rt-cell .v{font-size:38px;font-weight:800;line-height:1.25;letter-spacing:-.01em;
  overflow-wrap:break-word}
.rt-cell .s{font-size:21px;color:${p.muted};line-height:1.5;overflow-wrap:break-word}
/* 内存那格：百分比大字与「已用 / 总量」小字同基线 */
.rt-cell .v.mem{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
.rt-cell .v.mem .pct{font-size:46px;font-weight:900;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}
.rt-cell .v.mem small{font-size:22px;font-weight:600;color:${p.muted}}
.rt-cell .bar{margin-top:6px;height:10px;border-radius:9999px;background:${p.inset};
  border:1px solid ${p.border};overflow:hidden}
.rt-cell .bar i{display:block;height:100%;border-radius:9999px}

/* 开源信息
   ------
   两列 × 两行，标签在上、取值在下，四条正好铺满、没有空格。
   原来是单列三行「标签 + 取值」左右并排，最长的一条（docs.sayu-bot.com/…）
   在 22px 等宽下约 567px，整行也只占 720px，右侧 2/3 空着；这块又正压在页脚上方，
   两片空白连起来，整页尾部像塌下去一半。

   为什么标签要上移：如果保留「标签在左」，每列 616px 减去标签 150px 与 24px 间距，
   取值只剩 442px，装不下 567px 的文档地址，会折成「…/Adapte + rList.html」两行——
   断点落在单词中间，比留白更难读。标签上移后取值能用满 616px，最长那条也是一行。

   为什么是两列而不是三列：三列每列只有 (1296-2×48)/3 = 400px，四条里有三条
   （两个 github 地址加文档地址）都超过 400px，得靠跨列拼凑，反而拼不满；
   两列时每条都在自己那格里一行放下，2×2 铺满。
   标签在上、取值在下也与本页 .rt-cell 的结构一致。 */
.rt-links{display:grid;grid-template-columns:repeat(2,1fr);gap:26px 64px;padding-top:44px;
  border-top:1px solid ${p.border}}
.rt-links .link{display:flex;flex-direction:column;gap:8px;min-width:0;font-size:22px}
.rt-links .link .k{color:${p.muted};font-weight:800;letter-spacing:.14em;
  text-transform:uppercase;font-size:19px;line-height:1}
.rt-links .link .v{min-width:0;color:${p.muted};word-break:break-all;line-height:1.5}
.rt-note{margin-top:32px;font-size:21px;color:${p.muted};opacity:.7;line-height:1.6}
`
