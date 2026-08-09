export const status = (p) => `
/* ---------- 连接列表 ---------- */
.st-conns{display:flex;flex-direction:column;gap:22px}
.st-conn{display:flex;gap:26px;padding:28px 32px;border-radius:28px;
  border:1px solid ${p.border};background:${p.surface}}
/* 序号做成定宽方块，和更新日志的 hash 一套语言：竖排时数字左边缘成列。
   align-self:center —— 对齐整条连接的垂直中线。
   曾经用 align-self:flex-start + margin-top:-7px 去对齐「名字那一行」，那个 −7px
   是按「名字 + url」两行内容反推的：名字行高 46px 中线 23px，方块高 58px 中线 29px。
   可这条卡片的行数是变的——带 token / 重连次数时会多出一行 meta 标签，
   三行内容下方块就贴在了卡片最上沿，与右侧的状态胶囊（align-self:center）也不在
   一条线上。改用居中后，序号、名字块、状态胶囊三者共用同一条中线，行数再变也不会飘。 */
.st-conn .idx{font-size:26px;font-weight:800;color:${p.muted};flex:none;align-self:center;
  line-height:1;width:60px;padding:16px 0;text-align:center;border-radius:14px;
  background:${p.inset};border:1px solid ${p.border}}
.st-conn .main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.st-conn .nm{font-size:38px;font-weight:900;line-height:1.2}
.st-conn .url{font-size:23px;color:${p.muted};word-break:break-all;line-height:1.45}
.st-conn .meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}
.st-conn .meta em{font-style:normal;font-size:20px;padding:5px 13px;border-radius:10px;
  color:${p.muted};background:${p.inset};border:1px solid ${p.border};line-height:1.4}

/* ---------- 分组明细 ---------- */
/* 两列：条目短，单列铺满 1296px 会在右侧留一大片空白。
   column-gap 给到 64px —— 两列都是「左标签右取值」的两端对齐结构，
   列间距小于列内的空档时，右列的标签会读成左列取值的一部分。
   margin-top:72px 与 .stats 的 margin-bottom 同值，纵向节奏一致。 */
.st-panels{display:grid;grid-template-columns:repeat(2,1fr);gap:56px 64px;margin-top:72px}
/* shared 的 .sec 自带 36px 下边距，这里不再加 */
.st-panel{min-width:0}
.st-kv{display:flex;flex-direction:column;gap:14px}
/* 两端对齐：标签靠左、取值靠右，长短不齐的取值右边缘成列（账单式排版）。
   align-items:baseline：取值用等宽字、标签用正文字，基线对齐才不会一高一低。 */
.st-kv .row{display:flex;align-items:baseline;gap:14px;font-size:23px;line-height:1.5}
.st-kv .row .k{flex:none;color:${p.muted}}
.st-kv .row .v{flex:1;min-width:0;text-align:right;font-weight:700;overflow-wrap:break-word}
`;
