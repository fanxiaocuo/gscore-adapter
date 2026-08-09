export const shared = (p) => `
/* ---------- 概览统计条 ---------- */
/* 四张卡等高（grid 默认 stretch），内部三行靠 flex 竖排，
   .s 用 margin-top:auto 贴底 —— 某张卡没有 sub 时其余三张的数值也不会错位 */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-bottom:72px}
.stat{padding:30px;border-radius:28px;border:1px solid ${p.border};background:${p.surface};
  display:flex;flex-direction:column;gap:6px}
.stat .k{font-size:19px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;
  color:${p.muted};line-height:1.3}
/* 数值用 tabular-nums：等宽数字让四张卡的数字宽度一致，不会因 1 比 8 窄而歪 */
.stat .v{font-size:60px;font-weight:900;line-height:1.05;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}
.stat .s{font-size:21px;color:${p.muted};line-height:1.4;margin-top:auto}

/* ---------- 分节标题 ---------- */
/* 圆点 + 文字 + 一条向右淡出的渐变线。
   原名 .rt-sec，是关于页（runtime）的私有类，但状态页的分组明细也在用它 ——
   一个页面借另一个页面的类，改哪边都会波及对方。既然是两页共用，就搬到这里
   并去掉 rt- 前缀，语义回归「分节标题」本身。 */
.sec{display:flex;align-items:center;gap:16px;margin-bottom:36px}
.sec .dot{width:11px;height:11px;border-radius:9999px;flex:none}
.sec .t{font-size:26px;font-weight:800;letter-spacing:.16em;color:${p.muted};line-height:1}
.sec .line{flex:1;height:3px;border-radius:9999px;opacity:.55;max-width:220px}
/* 右侧的版本号与日期（关于页「本版变更」那节用），比标题再轻一档 */
.sec .ver{flex:none;font-size:22px;font-weight:700;color:${p.muted};opacity:.8;line-height:1}
.sec .ver em{font-style:normal;opacity:.75}

/* ---------- 状态胶囊 ---------- */
/* line-height:1 + 上下等量 padding，文字与灯都落在胶囊垂直中心。
   align-self:center 是必须的——.st-conn 为了让序号对齐名字行去掉了 align-items:center，
   胶囊要留在整行的垂直中心就得自己声明。 */
.pill{display:flex;align-items:center;gap:11px;flex:none;align-self:center;line-height:1;
  padding:14px 22px;border-radius:9999px;font-size:24px;font-weight:800}
.pill .led{width:12px;height:12px;border-radius:9999px;flex:none}

/* ---------- 空态 ---------- */
/* 内容水平垂直都居中，不靠 text-align 单独摆 */
.empty{padding:96px 80px;border-radius:32px;border:1px dashed ${p.border};background:${p.surface};
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
  text-align:center}
.empty .t{font-size:44px;font-weight:900;line-height:1.2}
.empty .d{font-size:26px;color:${p.muted};line-height:1.7;white-space:pre-line}

/* ---------- 提示条 ---------- */
/* fetch 失败等非致命情况用它说明，不占用空态位置。
   border-color 与背景由组件按语义色内联给，这里只定形。左侧粗边当色标 */
.notice{margin-bottom:44px;padding:26px 32px;border-radius:24px;
  border:1px solid;border-left-width:6px;font-size:25px;line-height:1.65;
  overflow-wrap:break-word}
`;
