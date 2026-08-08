/**
 * 样式表
 *
 * 手写 CSS 而非 Tailwind：kkk 那边靠构建期扫描类名生成 CSS，本插件是运行时
 * SSR（没有构建产物流程能跑 tailwind CLI），所以按语义类名写一份精简样式，
 * 由 shell.ts 内联进 <style>。
 */
import { CANVAS_WIDTH, FONT_STACK, MONO_STACK, type Palette } from "./theme.js"

/**
 * 生成整张画布的 CSS
 * @param p 调色板
 * @param scale 高清倍率，用 zoom 实现（理由见 render/index.ts 的 SCALE 注释）
 */
export function buildCss(p: Palette, scale = 1): string {
  return `
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

/* ---------- 背景层 ---------- */
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
   透明度也压到 .028——列表卡片比统计卡更透，同样的 .035 在这里更显眼。 */
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

/* ---------- 页面骨架 ---------- */
.page{position:relative;z-index:10;padding:72px}
.head{display:flex;justify-content:space-between;align-items:flex-end;
  margin-bottom:72px;padding-bottom:32px;border-bottom:4px solid ${p.border}}
/* gap 10px -> 22px：徽标与 104px 的巨型标题之间原来只隔 10px，上面又压着角落
   点阵，整条徽标被夹在两者中间。标题字号大，间距也得按比例给。 */
.head-l{display:flex;flex-direction:column;gap:22px}
/* flex:none + 固定尺寸的圆点，配 align-items:center 才不会被文字行高拉扁或带偏
   padding-left:4px：徽标做成一个独立的胶囊，左移会与巨型标题的左边缘脱开，
   所以只给很小的内缩——让 LED 离开角落装饰的视觉范围，标题仍与它左对齐。 */
.badge{display:flex;align-items:center;gap:14px;opacity:.7;padding-left:4px}
.badge .led{width:10px;height:10px;border-radius:9999px;flex:none;background:${p.success};
  box-shadow:0 0 12px ${p.success}}
.badge .led.off{background:${p.muted};box-shadow:none}
.badge .led.warn{background:${p.warning};box-shadow:0 0 12px ${p.warning}}
.badge span{font-size:20px;letter-spacing:.22em;text-transform:uppercase;color:${p.muted};
  font-weight:700;line-height:1}
.title{font-size:104px;font-weight:900;line-height:.95;letter-spacing:-.045em}
/* 右上键值：与左侧巨型标题的基线对齐靠 .head 的 align-items:flex-end，
   这里只保证两行自身紧凑 */
.head-r{text-align:right;padding-bottom:8px;display:flex;flex-direction:column;gap:8px}
.head-r .k{font-size:19px;font-weight:800;letter-spacing:.20em;text-transform:uppercase;
  color:${p.muted};line-height:1}
.head-r .v{font-size:34px;font-weight:800;line-height:1.1}

/* ---------- 概览统计 ---------- */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-bottom:72px}
/* 四张卡等高（grid 默认 stretch），内部三行靠 flex 竖排，
   .s 用 margin-top:auto 贴底 —— 某张卡没有 sub 时其余三张的数值也不会错位 */
.stat{padding:30px;border-radius:28px;border:1px solid ${p.border};background:${p.surface};
  display:flex;flex-direction:column;gap:6px}
.stat .k{font-size:19px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;
  color:${p.muted};line-height:1.3}
/* 数值用 tabular-nums：等宽数字让四张卡的数字宽度一致，不会因 1 比 8 窄而歪 */
.stat .v{font-size:60px;font-weight:900;line-height:1.05;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}
.stat .s{font-size:21px;color:${p.muted};line-height:1.4;margin-top:auto}

/* ---------- 分组 ---------- */
.group{margin-bottom:88px}
.group:last-child{margin-bottom:0}
/* 色条与标题都用 line-height:1 + align-items:center，色条才会正对标题的视觉中线 */
.group-h{display:flex;align-items:center;gap:24px;margin-bottom:44px}
.group-h .bar{width:12px;height:56px;border-radius:9999px;flex:none}
.group-h h2{font-size:64px;font-weight:900;line-height:1;letter-spacing:-.03em}
/* 计数做成描边胶囊，和标题拉开层级；line-height:1 让数字在胶囊里居中 */
.group-h .n{margin-left:auto;flex:none;font-size:22px;font-weight:800;letter-spacing:.14em;
  color:${p.muted};padding:9px 18px;border-radius:9999px;line-height:1;
  background:${p.inset};border:1px solid ${p.border}}
.sub{margin-top:56px}
.sub-h{display:flex;align-items:center;gap:14px;margin-bottom:32px;opacity:.62;
  font-size:28px;font-weight:800;letter-spacing:.06em;line-height:1.3}
/* flex:none 防止圆点被长标题挤成椭圆 */
.sub-h .d{width:10px;height:10px;border-radius:9999px;background:${p.foreground};flex:none}

/* ---------- 指令条目 ---------- */
/* align-items:start —— 每张卡按自身内容收缩，不被同行的邻居撑高。
   grid 默认 stretch：连接管理第一行，左边「#早柚添加连接」有三行说明加两行示例框，
   把右边「#早柚删除连接」也拉到同样高，而后者只有一行说明加一行示例框，
   多出来的高度就成了卡片下半部的一大片空白，看着像张没填满的卡。
   改成 start 后每张卡只有自己需要的高度；同一行两张卡顶端仍然对齐（网格行的
   起始线是同一条），所以标题照样齐平。 */
.items{display:grid;grid-template-columns:repeat(2,1fr);gap:32px 48px;align-items:start}
.items.one{grid-template-columns:1fr}
/* 卡片与「卡片里的一行内容」是两层，各管各的：
   ------
   卡片高度由同一行里内容最多的那张决定 —— 状态与连接那组，右边「#早柚连接列表」
   说明折三行，把左边「#早柚状态」也拉高了 ~60px。
   曾经把 .item 自己设成 align-items:center，图标与文字确实同心了，但整块内容
   跟着浮到卡片正中，上下各留一条空带；同一行两张卡的标题起点差出大半行，
   看着就是「不协调」。
   现在分成两层：.item 只负责外框，内容交给 .row —— .row 高度只由自身内容决定、
   贴在卡片顶部，所以同一行的标题永远齐平。 */
.item{padding:28px 30px;border-radius:26px;
  border:1px solid ${p.border};background:${p.surface}}
/* align-items:flex-start —— .row 里两块各自贴顶，图标的垂直位置不交给 flex，
   而是用 align-self:center 让它对齐 .row 自身的中线。
   .row 的高度就是这张卡「整行内容」的高度（标题 + 说明 + 示例框），所以图标
   落在整行行高的一半上；.row 又贴在卡片顶部，同一行两张卡的标题仍然齐平。
   注意不能把 align-items 直接设成 center：那样 .body 也会跟着居中，
   内容会在被邻居撑高的卡片里上下浮动，标题就不齐了。 */
.item .row{display:flex;align-items:flex-start;gap:24px}
/* 图标框
   ------
   之前用 ◉ ≡ ⚙ 这类字符当图标，看着总是偏下：flex 居中的是行盒，字形墨迹
   在行盒里的位置由字体基线决定，而这些符号在 Latin 字体里缺字、回落到中文
   字体后墨迹整体偏下。现在换成内联 SVG（components/Icons.tsx），几何由
   viewBox 定死，place-items:center 居中的结果与字体无关，必然是正的。

   垂直位置：align-self:center，对齐 .row 的中线，也就是「这张卡整行内容行高的
   一半」——标题折几行、说明几行、有没有示例框都算进去。
   曾经试过对齐标题首行（margin-top 负值反推首行中线），图标便贴在卡片最上沿，
   与「垂直居中」的直觉相反。也曾把 .row 整个 align-items:center，那会连带 .body
   一起居中、内容在被邻居撑高的卡片里浮动，标题就不齐平了。
   现在两件事分开：.body 贴顶保证同行标题齐平，.ico 居中保证图标落在整行中线。 */
.item .ico{width:60px;height:60px;border-radius:18px;flex:none;align-self:center;
  display:grid;place-items:center}
.item .ico svg{width:30px;height:30px;display:block}
.item .body{flex:1;min-width:0;display:flex;flex-direction:column;
  gap:10px;padding-top:2px}
/* 下面三块的间距统一由 .body 的 gap 给，不再各自写 margin-top */
/* 命令标题行
   ------
   flex 而不是「标签内联在文字里」：标签原本是 .cmd 的内联子元素，跟着文字流走，
   而标题本身会折行——全局设置那组四条命令，一条不折、两条折两行、media_max_size
   折三行，标签便分别落在「自己单独一行」「第二行右边」「第三行右边」，同一个
   组件排出四种样子，就是看着乱的原因。
   现在 cmd 文本与标签是两个兄弟块：文本 min-width:0 允许内部折行，标签 flex:none
   不参与压缩，align-self:flex-start 把它钉在首行，与首行文字顶端对齐。
   标签自身再用 margin-top 微调，让它的视觉中线落在首行文字的中线上。 */
.item .cmd{display:flex;align-items:flex-start;gap:12px;
  font-size:36px;font-weight:900;line-height:1.2;letter-spacing:-.01em}
/* 标题文本：overflow-wrap:break-word 而不是 anywhere / word-break:break-word。
   #早柚设置 media_max_size=10485760 比栏宽长，必须折。三种写法的断点不同：
   word-break:break-word 与 anywhere 都会在放不下的那一位上硬断，把数值劈成
   「104 / 85760」——一串数字从中间断开最难读。
   break-word 只在整个「词」放不下时才硬断，而这里空格已提供了合法断点，
   于是它先在 media_max_size 前的空格换行，数值保持完整。
   中文标题不受影响——本来就处处可断。 */
.item .cmd .t{min-width:0;overflow-wrap:break-word}
.item .dsc{font-size:24px;line-height:1.6;color:${p.muted};white-space:pre-line}
/* 示例框：keep-all 而不是 normal —— 示例是「#早柚添加连接 127.0.0.1:8765 name=主核心」
   这种空格分段的参数串，CJK 默认可在任意字之间断行，于是 name=主核心 被拆成
   「name=主 / 核心」，参数值从中间断开，读起来像两个词。keep-all 让中日韩连续文字
   不再随意断，只在空格处换行，正好与参数串的语义一致。
   overflow-wrap:break-word 兜底：万一某一段本身宽过整框，仍允许强制断开而不溢出。
   align-self:flex-start 让框只包住文字，不被拉成整行宽 */
.item .eg{align-self:flex-start;margin-top:2px;padding:8px 16px;border-radius:12px;
  font-size:21px;color:${p.muted};background:${p.inset};
  border:1px solid ${p.border};overflow-wrap:break-word;word-break:keep-all;
  line-height:1.5;max-width:100%}

/* 子分组条目（可选参数那一组）
   ------
   这些条目与上面的指令卡结构不同：cmd 是 name / token 这种短标识，dsc 恒为一行，
   没有 eg，也没有 MASTER 标签。沿用指令卡的尺寸会有两个问题：
   1. 图标框 60px、上移 8px 去对齐标题行 —— 但这里卡片只有两行内容、总高比图标
      框大不了多少，「顶端对齐标题行」失去意义，反而看着像图标卡在卡片最上沿
      （用户反馈的「子菜单图标还是在最上面」）。
   2. 36px 的 cmd 配一行 24px 说明，块头和主指令卡一样大，读起来分不出主次。
   所以这里整体降一档。图标与主指令卡同理，对齐 .row 的中线。 */
.sub .item{padding:22px 26px}
.sub .item .row{gap:20px}
/* 图标同样对齐 .row 中线，尺寸降一档 */
.sub .item .ico{width:48px;height:48px;border-radius:14px;align-self:center}
.sub .item .ico svg{width:23px;height:23px}
.sub .item .body{gap:6px;padding-top:0}
.sub .item .cmd{font-size:30px;line-height:1.25}
.sub .item .dsc{font-size:21px;line-height:1.5}
/* MASTER 标签
   ------
   曾经用 vertical-align:middle + top:-3px 去纠正基线，那是它还内联在文字里时的
   补丁。现在它是 flex 兄弟，不再受基线影响，改用几何对齐：
   首行文字行高 43.2px（36px × 1.2），中线在 21.6px；标签自身 18（line-height:1）
   + 4 × 2 内边距 + 1 × 2 边框（边框由组件按语义色内联给）= 28px，中线 14px。
   margin-top = 21.6 − 14 = 7.6px，不取整——zoom 1.5 下是 11.4 个物理像素，
   取 8px 会留 0.6px 的可见偏差。 */
.tag{flex:none;align-self:flex-start;margin-top:7.6px;
  padding:4px 13px;border-radius:9999px;line-height:1;
  font-size:18px;font-weight:800;letter-spacing:.08em}

/* ---------- 连接列表 ---------- */
.conns{display:flex;flex-direction:column;gap:22px}
.conn{display:flex;gap:26px;padding:28px 32px;border-radius:28px;
  border:1px solid ${p.border};background:${p.surface}}
/* 序号做成定宽方块，和 changelog 的 hash 一套语言：竖排时数字左边缘成列。
   align-self:center —— 对齐整条连接的垂直中线。
   曾经用 align-self:flex-start + margin-top:-7px 去对齐「名字那一行」，那个 −7px
   是按「名字 + url」两行内容反推的：名字行高 46px 中线 23px，方块高 58px 中线 29px。
   可这条卡片的行数是变的——带 token / 重连次数时会多出一行 meta 标签，
   三行内容下方块就贴在了卡片最上沿，与右侧的状态胶囊（align-self:center）也不在
   一条线上。改用居中后，序号、名字块、状态胶囊三者共用同一条中线，行数再变也不会飘。 */
.conn .idx{font-size:26px;font-weight:800;color:${p.muted};flex:none;align-self:center;
  line-height:1;width:60px;padding:16px 0;text-align:center;border-radius:14px;
  background:${p.inset};border:1px solid ${p.border}}
.conn .main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.conn .nm{font-size:38px;font-weight:900;line-height:1.2}
.conn .url{font-size:23px;color:${p.muted};word-break:break-all;line-height:1.45}
.conn .meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}
.conn .meta em{font-style:normal;font-size:20px;padding:5px 13px;border-radius:10px;
  color:${p.muted};background:${p.inset};border:1px solid ${p.border};line-height:1.4}
/* 状态胶囊：line-height:1 + 上下等量 padding，文字与灯都落在胶囊垂直中心。
   align-self:center 是必须的——.conn 为了让序号对齐名字行去掉了 align-items:center，
   胶囊要留在整行的垂直中心就得自己声明。 */
.pill{display:flex;align-items:center;gap:11px;flex:none;align-self:center;line-height:1;
  padding:14px 22px;border-radius:9999px;font-size:24px;font-weight:800}
.pill .led{width:12px;height:12px;border-radius:9999px;flex:none}

/* ---------- 状态页的分组明细 ---------- */
/* 两列：条目短，单列铺满 1296px 会在右侧留一大片空白。
   column-gap 给到 64px —— 两列都是「左标签右取值」的两端对齐结构，
   列间距小于列内的空档时，右列的标签会读成左列取值的一部分。
   margin-top:72px 与 .stats 的 margin-bottom 同值，纵向节奏一致。 */
.panels{display:grid;grid-template-columns:repeat(2,1fr);gap:56px 64px;margin-top:72px}
/* .rt-sec 自带 36px 下边距，这里不再加 */
.panel{min-width:0}
.kv{display:flex;flex-direction:column;gap:14px}
/* 两端对齐：标签靠左、取值靠右，长短不齐的取值右边缘成列（账单式排版）。
   align-items:baseline：取值用等宽字、标签用正文字，基线对齐才不会一高一低。 */
.kv .row{display:flex;align-items:baseline;gap:14px;font-size:23px;line-height:1.5}
.kv .row .k{flex:none;color:${p.muted}}
.kv .row .v{flex:1;min-width:0;text-align:right;font-weight:700;overflow-wrap:break-word}

/* ---------- 更新日志 ---------- */
/* 提示条：fetch 失败等非致命情况用它说明，不占用空态位置 */
/* border-color 与背景由组件按语义色内联给，这里只定形。左侧粗边当色标 */
.notice{margin-bottom:44px;padding:26px 32px;border-radius:24px;
  border:1px solid;border-left-width:6px;font-size:25px;line-height:1.65;
  overflow-wrap:break-word}
.logs{display:flex;flex-direction:column;gap:18px}
/* align-items:center 而不是 flex-start：右侧是「标题 + 时间」两行，左边的短
   hash 只有一行，顶对齐会让 hash 明显偏上。居中后两栏的视觉重心在同一水平线。 */
.log{display:flex;align-items:center;gap:28px;padding:26px 32px;border-radius:24px;
  border:1px solid ${p.border};background:${p.surface}}
/* hash 做成独立的胶囊块：等宽 + 定宽让标题左边缘对齐成一列（短 hash 恒 7 位），
   淡底把它和标题分层，一屏几十行时更容易扫读 */
.log .sha{font-size:25px;font-weight:800;flex:none;line-height:1;
  padding:11px 0;width:132px;text-align:center;border-radius:12px;
  background:${p.inset};border:1px solid ${p.border}}
.log .main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
/* break-word 而非 break-all：提交标题多为中文，break-all 会从词中间断开 */
.log .msg{font-size:30px;font-weight:700;line-height:1.45;overflow-wrap:break-word}
.log .at{font-size:21px;color:${p.muted}}

/* ---------- 运行环境页 ---------- */
/* 这页不用 .head/.stats/.item 那套骨架——它和状态页答的是不同的问题，
   沿用同一套版式会让两条命令的图长得几乎一样（见 About.tsx 顶部注释）。 */
/* 顶部小字条：左边「运行诊断 · RUNTIME REPORT」，右边正式版/预览版胶囊 */
.rt-top{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:40px}
.rt-eyebrow{display:flex;align-items:center;gap:14px;font-size:24px;font-weight:800;
  letter-spacing:.18em;color:${p.muted};line-height:1}
.rt-eyebrow .dot{width:11px;height:11px;border-radius:9999px;flex:none}
.rt-eyebrow .sp{opacity:.5}
.rt-badge{flex:none;padding:12px 26px;border-radius:9999px;line-height:1;
  font-size:22px;font-weight:800;letter-spacing:.1em}
/* 标题比其他页的 104px 小一档：这页的主视觉是下面的版本号，标题让位 */
.rt-title{font-size:88px;font-weight:900;line-height:1.05;letter-spacing:-.04em;margin-bottom:18px}
.rt-desc{font-size:27px;color:${p.muted};line-height:1.6;margin-bottom:64px}

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
/* 前缀 v 小一档并压低不透明度，让数字本身成为主体 */
.rt-hero .num .pre{font-size:.48em;opacity:.55;margin-right:6px}
.rt-hero .nm{font-size:26px;color:${p.muted};letter-spacing:.06em;line-height:1.4}

/* 分节标题：圆点 + 文字 + 一条向右淡出的渐变线 */
.rt-sec{display:flex;align-items:center;gap:16px;margin-bottom:36px}
.rt-sec .dot{width:11px;height:11px;border-radius:9999px;flex:none}
.rt-sec .t{font-size:26px;font-weight:800;letter-spacing:.16em;color:${p.muted};line-height:1}
.rt-sec .line{flex:1;height:3px;border-radius:9999px;opacity:.55;max-width:220px}
/* 分节标题右侧的版本号与日期（本版变更那节用），比标题再轻一档 */
.rt-sec .ver{flex:none;font-size:22px;font-weight:700;color:${p.muted};opacity:.8;line-height:1}
.rt-sec .ver em{font-style:normal;opacity:.75}

/* 本版变更
   ------
   数据来自 CHANGELOG.md（changelog.ts 解析），结构是「分类 + 条目」两层。
   不做成卡片：这页已经定了「无边框信息块」的语言（见上面 .rt-grid 的说明），
   变更列表再套一层卡片就又向状态页靠回去了。分类之间靠间距分组，
   条目用一颗小圆点当项目符号，颜色跟着分类走，扫读时能一眼分出属于哪一类。 */
.rt-chg{display:flex;flex-direction:column;gap:40px;margin-bottom:72px}
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

/* 开源信息：紧凑两列，比摘要再轻一档 */
.rt-links{display:flex;flex-direction:column;gap:12px;padding-top:44px;
  border-top:1px solid ${p.border}}
.rt-links .link{display:flex;align-items:baseline;gap:24px;font-size:22px;line-height:1.6}
.rt-links .link .k{width:180px;flex:none;color:${p.muted};font-weight:800;letter-spacing:.1em;
  text-transform:uppercase}
.rt-links .link .v{flex:1;min-width:0;color:${p.muted};word-break:break-all}
.rt-note{margin-top:32px;font-size:21px;color:${p.muted};opacity:.7;line-height:1.6}


/* ---------- 页脚水印 ---------- */
/* 版式照 kkk 的 DefaultLayout：整块居中的一排，插件半边 ｜ 版本 ｜ 竖线 ｜ 框架半边。
   之前是左右分栏（左插件名、右信息行），两边的图标只有框架一个；现在两边各有
   自己的图标，居中排布才让「插件 × 框架」这层关系一眼可读。

   一行不换行
   ----------
   flex-wrap 从 wrap 改成 nowrap：main 分支的版本号是 v2.1.0-2-gc6522ee-dirty，
   整排宽度超过内容宽 1296px，框架半边会被甩到第二行，并列关系就断了。
   禁止换行后靠 --fs 等比缩字号保证放得下，计算在 Layout.tsx 的 FOOT。
   --fs 缺省 1，即 scale=1 时与原来的写死字号完全一致。 */
.foot{position:relative;z-index:10;padding:0 72px 64px;
  display:flex;flex-direction:column;align-items:center;gap:26px}
.foot .wm{--fs:1;display:flex;align-items:center;justify-content:center;gap:32px;
  flex-wrap:nowrap;white-space:nowrap;max-width:100%}
/* 一侧 = 图标 + 两行文字。align-items:center 让图标对齐文字块中线 */
.foot .side{display:flex;align-items:center;gap:20px;min-width:0}
/* 图标：外层 span 定框，内层 img 决定字形实际大小
   ------
   72px -> 80px，并且两个图标分开给尺寸。原因是两张图的构图完全不同：
   logo.png（1024²）的字形只占画幅 70.7%（实测 alpha 包围盒 724px），
   frame-logo.png 是满幅 JPEG。同样塞进 72px 的框、同样 6px padding 时，
   早柚字形只有 42px、云崽有 60px —— 差了三分之一，就是「适配器图标偏小」的来源。
   所以 ico-plugin 让 img 溢出框 (112%) 把那圈留白顶出去，ico-frame 保留内缩，
   两边字形的视觉体量才相当。overflow:hidden 负责裁掉溢出部分，圆角不会被破坏。 */
.foot .side .ico{width:80px;height:80px;flex:none;border-radius:20px;overflow:hidden;
  background:${p.inset};border:1px solid ${p.border};
  display:flex;align-items:center;justify-content:center}
.foot .side .ico img{display:block;object-fit:contain}
/* 放大到 112%：留白占 29.3%，字形 = 80 × 1.12 × 0.707 ≈ 63px，与下面的框架标一致 */
.foot .side .ico-plugin img{width:112%;height:112%}
/* 满幅图内缩 8px：字形 = 80 - 16 = 64px */
.foot .side .ico-frame img{width:100%;height:100%;padding:8px}
.foot .side .txt{display:flex;flex-direction:column;gap:7px;min-width:0}
/* 上排小字（PLUGIN / POWER BY）：字距拉开，与下排的粗名字分层 */
.foot .cap{font-size:calc(19px * var(--fs));font-weight:800;letter-spacing:.2em;
  text-transform:uppercase;color:${p.muted};line-height:1}
.foot .side .nm{font-size:calc(38px * var(--fs));font-weight:900;line-height:1;
  letter-spacing:-.01em}
/* 框架版本跟在框架名后面，小一档并压低不透明度 */
.foot .side .nm small{font-size:calc(24px * var(--fs));font-weight:700;color:${p.muted};
  letter-spacing:0}
/* 版本号块：与两侧的名字同高，靠 line-height:1 对齐 */
.foot .ver{display:flex;flex-direction:column;gap:7px;min-width:0}
.foot .ver .num{font-size:calc(38px * var(--fs));font-weight:900;line-height:1;
  letter-spacing:-.01em;font-variant-numeric:tabular-nums}
/* 分隔竖线：高度取文字块高度（19 + 7 + 38 = 64），略收到 56 留出呼吸 */
.foot .sep{width:3px;height:56px;flex:none;border-radius:9999px;background:${p.border}}
/* 底部一行小字：时间戳与提示，居中排开，与水印分层 */
.foot .sub{display:flex;align-items:center;justify-content:center;gap:28px;flex-wrap:wrap;
  font-size:20px;color:${p.muted};opacity:.75;line-height:1.5}
/* 空态：内容水平垂直都居中，不靠 text-align 单独摆 */
.empty{padding:96px 80px;border-radius:32px;border:1px dashed ${p.border};background:${p.surface};
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
  text-align:center}
.empty .t{font-size:44px;font-weight:900;line-height:1.2}
.empty .d{font-size:26px;color:${p.muted};line-height:1.7;white-space:pre-line}
`.trim()
}
