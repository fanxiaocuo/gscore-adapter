export const help = (p) => `
/* ---------- 分组 ---------- */
.hp-group{margin-bottom:88px}
.hp-group:last-child{margin-bottom:0}
/* 色条与标题都用 line-height:1 + align-items:center，色条才会正对标题的视觉中线 */
.hp-group-h{display:flex;align-items:center;gap:24px;margin-bottom:44px}
.hp-group-h .bar{width:12px;height:56px;border-radius:9999px;flex:none}
.hp-group-h h2{font-size:64px;font-weight:900;line-height:1;letter-spacing:-.03em}
/* 计数做成描边胶囊，和标题拉开层级；line-height:1 让数字在胶囊里居中 */
.hp-group-h .n{margin-left:auto;flex:none;font-size:22px;font-weight:800;letter-spacing:.14em;
  color:${p.muted};padding:9px 18px;border-radius:9999px;line-height:1;
  background:${p.inset};border:1px solid ${p.border}}
.hp-sub{margin-top:56px}
.hp-sub-h{display:flex;align-items:center;gap:14px;margin-bottom:32px;opacity:.62;
  font-size:28px;font-weight:800;letter-spacing:.06em;line-height:1.3}
/* flex:none 防止圆点被长标题挤成椭圆 */
.hp-sub-h .d{width:10px;height:10px;border-radius:9999px;background:${p.foreground};flex:none}

/* ---------- 指令条目 ---------- */
/* align-items:start —— 每张卡按自身内容收缩，不被同行的邻居撑高。
   grid 默认 stretch：连接管理第一行，左边「#早柚添加连接」有三行说明加两行示例框，
   把右边「#早柚删除连接」也拉到同样高，而后者只有一行说明加一行示例框，
   多出来的高度就成了卡片下半部的一大片空白，看着像张没填满的卡。
   改成 start 后每张卡只有自己需要的高度；同一行两张卡顶端仍然对齐（网格行的
   起始线是同一条），所以标题照样齐平。 */
.hp-items{display:grid;grid-template-columns:repeat(2,1fr);gap:32px 48px;align-items:start}
/* 卡片与「卡片里的一行内容」是两层，各管各的：
   ------
   卡片高度由同一行里内容最多的那张决定 —— 状态与连接那组，右边「#早柚连接列表」
   说明折三行，把左边「#早柚状态」也拉高了 ~60px。
   曾经把 .hp-item 自己设成 align-items:center，图标与文字确实同心了，但整块内容
   跟着浮到卡片正中，上下各留一条空带；同一行两张卡的标题起点差出大半行，
   看着就是「不协调」。
   现在分成两层：.hp-item 只负责外框，内容交给 .row —— .row 高度只由自身内容决定、
   贴在卡片顶部，所以同一行的标题永远齐平。 */
.hp-item{padding:28px 30px;border-radius:26px;
  border:1px solid ${p.border};background:${p.surface}}
/* align-items:flex-start —— .row 里两块各自贴顶，图标的垂直位置不交给 flex，
   而是用 align-self:center 让它对齐 .row 自身的中线。
   .row 的高度就是这张卡「整行内容」的高度（标题 + 说明 + 示例框），所以图标
   落在整行行高的一半上；.row 又贴在卡片顶部，同一行两张卡的标题仍然齐平。
   注意不能把 align-items 直接设成 center：那样 .body 也会跟着居中，
   内容会在被邻居撑高的卡片里上下浮动，标题就不齐了。 */
.hp-item .row{display:flex;align-items:flex-start;gap:24px}
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
.hp-item .ico{width:60px;height:60px;border-radius:18px;flex:none;align-self:center;
  display:grid;place-items:center}
.hp-item .ico svg{width:30px;height:30px;display:block}
.hp-item .body{flex:1;min-width:0;display:flex;flex-direction:column;
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
.hp-item .cmd{display:flex;align-items:flex-start;gap:12px;
  font-size:36px;font-weight:900;line-height:1.2;letter-spacing:-.01em}
/* 标题文本：overflow-wrap:break-word 而不是 anywhere / word-break:break-word。
   #早柚设置 media_max_size=10485760 比栏宽长，必须折。三种写法的断点不同：
   word-break:break-word 与 anywhere 都会在放不下的那一位上硬断，把数值劈成
   「104 / 85760」——一串数字从中间断开最难读。
   break-word 只在整个「词」放不下时才硬断，而这里空格已提供了合法断点，
   于是它先在 media_max_size 前的空格换行，数值保持完整。
   中文标题不受影响——本来就处处可断。 */
.hp-item .cmd .t{min-width:0;overflow-wrap:break-word}
.hp-item .dsc{font-size:24px;line-height:1.6;color:${p.muted};white-space:pre-line}
/* 示例框：keep-all 而不是 normal —— 示例是「#早柚添加连接 127.0.0.1:8765 name=主核心」
   这种空格分段的参数串，CJK 默认可在任意字之间断行，于是 name=主核心 被拆成
   「name=主 / 核心」，参数值从中间断开，读起来像两个词。keep-all 让中日韩连续文字
   不再随意断，只在空格处换行，正好与参数串的语义一致。
   overflow-wrap:break-word 兜底：万一某一段本身宽过整框，仍允许强制断开而不溢出。
   align-self:flex-start 让框只包住文字，不被拉成整行宽 */
.hp-item .eg{align-self:flex-start;margin-top:2px;padding:8px 16px;border-radius:12px;
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
.hp-sub .hp-item{padding:22px 26px}
.hp-sub .hp-item .row{gap:20px}
/* 图标同样对齐 .row 中线，尺寸降一档 */
.hp-sub .hp-item .ico{width:48px;height:48px;border-radius:14px;align-self:center}
.hp-sub .hp-item .ico svg{width:23px;height:23px}
.hp-sub .hp-item .body{gap:6px;padding-top:0}
.hp-sub .hp-item .cmd{font-size:30px;line-height:1.25}
.hp-sub .hp-item .dsc{font-size:21px;line-height:1.5}
/* MASTER 标签
   ------
   曾经用 vertical-align:middle + top:-3px 去纠正基线，那是它还内联在文字里时的
   补丁。现在它是 flex 兄弟，不再受基线影响，改用几何对齐：
   首行文字行高 43.2px（36px × 1.2），中线在 21.6px；标签自身 18（line-height:1）
   + 4 × 2 内边距 + 1 × 2 边框（边框由组件按语义色内联给）= 28px，中线 14px。
   margin-top = 21.6 − 14 = 7.6px，不取整——zoom 1.5 下是 11.4 个物理像素，
   取 8px 会留 0.6px 的可见偏差。 */
.hp-tag{flex:none;align-self:flex-start;margin-top:7.6px;
  padding:4px 13px;border-radius:9999px;line-height:1;
  font-size:18px;font-weight:800;letter-spacing:.08em}
`;
