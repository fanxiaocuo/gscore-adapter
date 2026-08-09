export const frame = (p) => `
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
   两边字形的视觉体量才相当。overflow:hidden 负责裁掉溢出部分。

   不给底色和描边：logo.png 是透明底 PNG，加了淡底+边框就变成两个方块罩在字形外，
   页脚这一行本来只是水印，方框比它要标记的内容更抢眼。圆角留着只为裁剪溢出，
   在透明背景下看不出来。frame-logo 是满幅 JPEG 自带白底，本身就是个方块，
   不需要再补边框去「框住」它。 */
.foot .side .ico{width:80px;height:80px;flex:none;border-radius:20px;overflow:hidden;
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
/* 底部一行小字：时间戳与提示，居中排开，与水印分层。
   类名叫 .lines 而不是 .sub —— .sub 已经是帮助页「子分组」的语义（pages/help.ts），
   两个页面里同名不同义正是拆分前最难改的那类耦合。 */
.foot .lines{display:flex;align-items:center;justify-content:center;gap:28px;flex-wrap:wrap;
  font-size:20px;color:${p.muted};opacity:.75;line-height:1.5}
`;
