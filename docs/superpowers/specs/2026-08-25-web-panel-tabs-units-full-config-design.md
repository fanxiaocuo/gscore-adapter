# Web 面板：tab 分页、MB 单位后端换算、配置项全量对齐 设计

## 背景

web 面板（`src/webui/`，宿主 iframe 加载 `webadapter/page.html`）现在只收 9 项配置，锅巴那边有
23 项，两边差 14 项；`file_server.*` 与 `upload_hook` 两边都没有，只能改 yaml。

单位这条线现在有三种口径：

| 入口 | 用户看到的单位 | 落盘 |
| --- | --- | --- |
| `#早柚设置最大媒体大小 2` | MiB（`utils/settings.ts` 乘 1048576） | 字节 |
| 锅巴 | MiB（`guoba/index.ts` 的 toDisplay/toStored 换算） | 字节 |
| web 面板 | **字节**（`10485760` 原样填） | 字节 |

第三行就是这次的起因：面板里那个 8 位数字没人愿意手敲，而把它原样敲进中文指令会被当成
10 TiB 拦下来（`apps/admin.ts:750`，那条错误话术就是为这个场景写的）。

## 目标

1. 面板按 **MB** 收大小、按 **秒** 收时长，换算在**后端**做，配置文件仍存字节 / 毫秒。
2. 面板配置项从 9 项扩到 **30 项**，覆盖锅巴全部 23 项 + `file_server.*` 6 项 + `upload_hook`。
3. 30 项塞进三个 tab（连接 / 设置 / 过滤），不靠一列长表硬撑。
4. 换一套配色（中性石灰 + 宝蓝），两套主题都过 WCAG 阈值并有脚本卡住。
5. 数组类字段（前缀、屏蔽词、群号、用户 ID）用 chip 标签输入 + 从已知群/好友里挑。
6. 单位字样全局统一写 MB，锅巴、指令话术、出图那张设置图一起改。

## 非目标

- 不动 `bot_id_map`：它是映射表不是标量字段，形状与这批配置项不同，单独一轮。
- 不动出图（`modules/render/`）的版式与配色，只改那里的单位字样。
- 不改连接卡的交互（添加 / 编辑 / 删除 / 绑定开关），只跟着新节奏对齐间距与字重。
- 不改宿主鉴权：新接口与现有 `/config` 同一道 `apiAuthGuard`。

---

## 一、单位：MB 与后端换算

### 1.1 换算落在后端

`payload()` 回换算后的值，`saveGlobal()` 乘回字节落盘。前端一个换算都不做 —— 前端做的话，
`MEDIA_SIZE_MAX` 那道校验（`webadapter/index.ts:306`）与前端显示会各持一种单位，三个写入口
就有两种口径。

三个换算字段（除数与锅巴一字不差）：

| 字段 | 面板单位 | 除数 | 落盘 |
| --- | --- | --- | --- |
| `media_max_size` | MB | 1048576 | 字节 |
| `file_max_size` | MB | 1048576 | 字节 |
| `link_expire` | 秒 | 1000 | 毫秒 |

**除数仍是 1048576**，不是 1000。写「MB」是口语一致（用户说的就是 mb），术语上不严格；
换成 1000 会与 `#早柚设置` 和锅巴算出不同的字节数，那是真的错。

### 1.2 漂移防护

`toDisplay` 收两位小数，乘回去是另一个数：5000000 字节显示 4.77 MB，存回来变 5001708。
所以 `toStored` 必须带「面板没动过这一栏就原样留着」那一支（照搬 `guoba/index.ts:104-115`
的做法）：把当前落盘值也过一遍 `toDisplay`，与收到的显示值相等就返回原值。

没有这一支，用户保存任何一项都会顺手改掉这两栏的字节数。

### 1.3 MB 字样全局统一

现存 MiB 字样共 11 处文件，全部改写 MB（除数不变）：

`guoba/schemas/base.ts`（标签与 `addonAfter`）、`guoba/index.ts`（`STORED_BOUNDS`）、
`apps/admin.ts`（三条报错话术）、`constants/index.ts`（注释）、`render/commands.ts`、
`render/pages.ts`、`render/env.ts`（`formatBytes` 的单位梯）、`webui/main.tsx`（`bytes()` 的单位梯）、
`utils/media.ts`、`utils/fileServer.ts`、`webadapter/index.ts`。

两个 `formatBytes`/`bytes()` 的单位梯是 1024 进制标着 KiB/MiB/GiB，改标签留除数。

---

## 二、配置项全集（30 项）

### 2.1 分布

| tab | 内容 | 项数 |
| --- | --- | --- |
| **连接** | 统计卡 + 连接卡列表 + `client.enable_ws`、`client.heartbeat`、`client.heartbeat_timeout` | 3 |
| **设置** | `enable`、`media_max_size`、`file_max_size`、`link_expire`、`log_truncate`、`notify_master`、`update_check.*`(4)、`file_server.*`(6)、`upload_hook` | 17 |
| **过滤** | `filter.*` 全部 10 项 | 10 |

设置 tab 内部再分四节：**总开关 / 媒体与外链 / 文件服务 / 更新检查**。

`client.enable_ws` 与总开关 `enable` 语义有重叠（一个关 ws、一个关整个适配器），放在不同 tab，
说明文案要点明差别：`enable` 关掉连都不连，`enable_ws` 只关 ws 这条通路。

### 2.2 契约变更

`webui/api.ts` 的 `PayloadConfig` 从 9 个字段扩到 30 个，其中三项换了单位。这是前后端共用的
契约类型，两端同时改才编译得过 —— 这正是那份文件存在的理由（`api.ts:4`）。

嵌套结构按 yaml 原样分层：`client`、`filter`、`update_check`、`file_server` 各一层，不摊平。
前端已有 `dig()` 按点号路径取值，字段表的 key 继续写 `filter.report_private` 这种形式。

### 2.3 回效力值，不回原值

现在 `payload()` 写的是 `Number(config.media_max_size) || 0` —— 用户显式写 0 时面板显示 0，
而 `utils/media.ts:47` 把 0 当「没配」跑的是 10 MiB，面板与实际不一致（锅巴那边有同一条注释）。

新版一律回**效力值**：读合并后的 `config`，对「0 当没配」的那两项按下游同一个默认值回。
代价是从没配过这两栏的用户一按保存会把默认值写进 yaml —— 值相等，行为不变，可以接受。

---

## 三、校验：一份共用表

抽 `src/config/units.ts`，锅巴与 webadapter 同 import：

```ts
/** 一栏的换算与边界并成一条记录：divisor / unit / label / min / minText / max? / maxText? */
export const UNIT_FIELDS: Record<string, UnitField>
export function displayRange(field: string): { min: number; max?: number }
export function toDisplay(field: string, value: unknown): unknown
export function toStored(field: string, value: unknown, current?: unknown): unknown
export function boundsError(field: string, stored: unknown): string | null
```

换算与边界并成**一条**记录而不是两张表（原先锅巴那边是 `SCALED_FIELDS` + `STORED_BOUNDS` 两份）：
同一栏的除数、单位名、上下限总是一起用，分两张表就有「加了字段只补一张」的漏法。
`displayRange()` 给锅巴的 InputNumber 算 min/max，那两个数是从落盘边界除出来的，不再手写一遍。

现在这组数字（1024 下限、`MEDIA_SIZE_MAX` 上限、1048576 除数、单位名）在锅巴的
`STORED_BOUNDS` 与 webadapter 的手写 if 里各写了一遍。新增 `link_expire`、`update_check.interval`、
`file_server.port` 之后会再重复第三遍，所以这次抽 —— 两个消费方 + 去掉重复，不是为分层而分层。

`apps/admin.ts` 那份不抽：它的措辞是给出图那张结果图写的，形状不一样（`CN_LABEL` + 单条话术）。
它继续用自己那套，只跟着改 MB 字样。

`src/modules/guoba/schemas/base.ts` 里的 `SCALED_FIELDS` 迁走 —— webadapter 不该 import
guoba 目录里的东西。

---

## 四、信息架构：三个 tab

- tab 条钉在页头下方，选中态用 `accentSoft` 底 + `accent` 字，不用下划线（下划线在 iframe 窄屏
  里与卡片描边打架）。
- 选中页记 `localStorage`，key `gscore-panel-tab`。**读写都要 try/catch**：这是 iframe 里的页面，
  宿主域被浏览器按第三方存储拦掉时 `localStorage` 访问本身就抛。取不到就回第一个 tab。
- tab 用真 `<button role="tab">` + `aria-selected` + 左右方向键切换，不是 div。
- 顶部四张统计卡留在 tab 条**上方**，三个 tab 都能看见 —— 它们是状态而不是某一页的内容。

---

## 五、配色

### 5.1 token 表

两套仍是「浅色写 `:root`、深色只覆盖要变的项」（现有做法，`styles.css:31`），不用 Tailwind
的 `dark:` 变体。字栈不动（system-ui 那串）：宿主静态白名单只放行 3 个文件名，外网字体在
离线机器上直接掉字。

| 角色 | 浅 | 对 surface | 深 | 对 surface |
| --- | --- | --- | --- | --- |
| `bg` | `#f1f1ef` | — | `#17171a` | — |
| `surface` | `#fbfbfa` | — | `#212124` | — |
| `surface2` | `#f5f5f2` | — | `#2a2a2e` | — |
| `fg` | `#1a1a18` | 16.66:1 | `#ebebe8` | 13.58:1 |
| `muted` | `#605f58` | 6.30:1 | `#a2a29b` | 6.33:1 |
| `accent` | `#1f3fc9` | 7.76:1 | `#8ba4ff` | 6.77:1 |
| `accent-fg`（压在 accent 上的字） | `#ffffff` | 8.04:1 | `#0d1330` | 7.68:1 |
| `accent-soft` / `-fg` | `#e8ecfb` / `#16267a` | 9.95:1 | `#1e2547` / `#b9c6ff` | 9.41:1 |
| `border`（分隔线） | `#dcdcd7` | 1.33:1 | `#3a3a3f` | 1.42:1 |
| `border-strong`（控件边界） | `#8b8b83` | 3.31:1 | `#767680` | 3.57:1 |
| `danger` | `#b3261e` | 5.63:1 | `#f2837a` | 5.75:1 |
| `warning` | `#8a5300` | 5.72:1 | `#e0a33c` | 7.27:1 |
| `success` | `#1a7f37` | 5.20:1 | `#5fd67f` | 9.22:1 |

比值是 `test/contrast.mjs` 实测（本次为面板新增一节，出图那两套不动）。改任何一格都要重跑。

### 5.2 实测挑出来的四处，与修法

第一版跑出四条不合格，表里已经是修完的值：

1. **深色主按钮白字只有 2.37:1** —— 宝蓝在深色下必须提亮才够对底的对比度，白字压上去就不够了。
   改成深底色字 `#0d1330`（7.68:1）。这是深色下唯一一处「按钮文字不是白的」，写进 token 而不是
   就地写死。
2. **`border-strong` 第一版 1.71:1 / 1.92:1** —— 输入框与 chip 的边界属于非文本对比度
   （SC 1.4.11，要 3:1），压到 `#8c8c84` / `#70707a` 才过，且对 `bg` 也各有 3.00:1 / 3.65:1
   （行落在页面底上时同样要看得见）。
3. **`border` 1.33:1 / 1.42:1** —— 这一格是**装饰性分隔线**，行与行本来就靠标题和间距分开，
   没有 3:1 的要求（脚本里那 1.5 是我自己设的可感知门槛，不是 WCAG 条款）。判据是「能看见」
   而不是达标，保留现值，脚本里把这一行的阈值标成 informational。
4. **浅色 `switch-on` 2.14:1** —— 见下。

### 5.3 开关那两个绿保留

`--switch-on` / `--switch-off` 与新配色无关，原样留着（`#34c759` / `#30d158`）：绿开关表达的是
「用户选了启用」，连接通不通由状态点说，两者同色会让「开关绿着但连不上」像自相矛盾
（`styles.css:48` 的原注释）。

浅色下 2.14:1 不达标不是缺陷：控件边界由 `--switch-edge` 那圈内描边给（实测见
`test/switch-contrast.mjs`），填充色本身不承担这项。脚本里这一行同样标 informational。

---

## 六、控件

### 6.1 chip 标签输入（`components/Chips.tsx`）

用在 `filter.prefix`、`block_prefix`、`block_include`、`white_group`、`black_group`、`black_user`。

- 提交：回车 / 中英文逗号 / 失焦。
- 删除：每个 chip 一个 `×`（可聚焦、Enter 与 Space 都触发）；输入框为空时 Backspace 删最后一个。
- **静默去重**，空值不收，超长值截断显示 + `title` 看全。
- **不校验形状**：前缀里的 `#`、关键词里的空格与大小写改一个字都会让匹配对不上（锅巴那边
  为此专门不加 `valueFormatter`）；QQ 号 5-11 位、openid 32 位十六进制，卡长度只会把非 QQ 平台
  的 ID 拦在外面。
- 状态：default / hover / `:focus-visible`（`accent` 聚焦环）/ disabled / error（超出上限时）。
  loading 与 success 这两态对它没有意义，不造。

不用现成的逗号分隔文本框（连接弹层里那个 `type: "list"`）：群黑白名单是一串 9 位数字，挤在
一个输入框里既读不出有几项、也删不掉中间那个。

### 6.2 群 / 好友选择器（`components/PickerModal.tsx`）

新接口 `GET /gscore-adapter/targets?kind=group|friend`，**开弹层时懒加载**，不进整包
—— 整包每 10 秒轮询一次，几千个群跟着来回传毫无必要。

- 服务端聚合所有在线 Bot 的群/好友表（`getGroupMap()`/`gl`、`getFriendMap()`/`fl`），按 id 去重，
  取第一个查到的名字。取不到列表回空数组 + 一句说明，**不能**回空后让用户一按保存把名单抹平
  （锅巴那边 `friendIds()` 返回 null 就是为了这件事）。
- 前端搜索 + 虚拟滑动（固定行高，按 scrollTop 切窗口），不加依赖。
- 已选的走同一份 `filter.*` 数组，与 chip 输入读写同一份状态 —— 手输与挑选不是两份数据
  （连接弹层的绑定账号已经是这个模式）。
- 账号离线时列表是空的，此时存着的名单仍在，只显示成光秃秃的号码。这句要写进空态文案。

### 6.3 底部悬浮保存条（`components/SaveBar.tsx`）

有未保存改动时才出现：`有 N 项未保存` + `保存` / `放弃`。`position: fixed` 贴底，避开
iframe 滚动容器；窄屏下与 body 的 12px 内边距对齐。

---

## 七、保存模型

### 7.1 即时 / 延迟 两条路

| 类型 | 行为 |
| --- | --- |
| 开关 | **即时写**，单字段 POST `/config`，回包整包换 state |
| 数字、文本、chip、名单 | **延迟**，攒到悬浮条一起提交 |
| **文件服务一节的全部控件（含开关）** | **延迟** |

文件服务整节延迟的理由：`port` / `host` / `public_host` 是一个意图，`enable` 先即时写会按旧端口
重启一次、用户填完端口再重启一次；而重启会作废在途外链。

`saveGlobal()` 只写 body 里出现的键（现有行为），所以单字段提交与整批提交是同一条路，不用
两个接口。

`client.enable_ws` 要加进 `touchedClient` 判据 —— 现在只有 `heartbeat` / `heartbeat_timeout`
会触发 `reloadClients()`，enable_ws 改了不重载等于没生效。

### 7.2 轮询与本地编辑

现在的 `Settings` 用整表指纹判断「服务端是不是真的变了」（`main.tsx:535`）。30 项之后这招不够：
任何一项外部变化都会整表覆盖，把用户正在填的另一项抹掉。

改成**逐字段脏集合**：`touched: Set<string>`，轮询回包只覆盖不在集合里的字段。保存成功后清空
集合。`inflight` / `gen` 那两个计数器保留，语义不变（一个管「别发起」、一个管「别采用」）。

---

## 八、文件服务与敏感字段

### 8.1 改完自动重启

`utils/fileServer.ts` 现在只有模块内的 `start()`，没有可控重启。新增导出 `restartFileServer()`：
关掉现有 server、清空 `server` / `starting`，按新配置重起。

- 只有 `port` / `host` 改了才要重启；`public_host` / `once` / `imagebed_token` 每次请求现读。
- `enable` 由 true 改 false：关掉 server 即可。
- 重启会作废在途外链（最长一个 `link_expire`），toast 里说清楚，并报出新端口
  （`port: 0` 时端口是随机的，用户必须能看到实际值）。
- 挂在 `Bot.express` 上的图床转接口路径固定，不受重启影响，不用重挂。

### 8.2 `imagebed_token` 脱敏

照连接 token 同一套：整包只回 `has_imagebed_token: boolean`，输入框占位符写「留空则不修改」，
要清空得点一个显式的「清除」。凭据不回前端。

### 8.3 `upload_hook` 试加载

保存时 `import()` 一次，检查默认导出是不是函数，失败连着原因一起 400。

两个要写进注释的点：import 会**执行**那个模块 —— 但运行时发文件的时候本来也会执行它，
没有新增风险；ESM 有模块缓存，改完文件重填同一个路径不会重新加载，校验时要带 `?t=<时间戳>`。

---

## 九、改动清单

**新增**

| 文件 | 内容 |
| --- | --- |
| `src/config/units.ts` | 换算表 + 边界表 + toDisplay/toStored/boundsError |
| `src/webui/fields.ts` | 30 项字段表，按 tab 与节分组 |
| `src/webui/components/Chips.tsx` | chip 标签输入 |
| `src/webui/components/Tabs.tsx` | 顶部 tab 条 |
| `src/webui/components/PickerModal.tsx` | 群/好友选择器（搜索 + 虚拟滑动） |
| `src/webui/components/SaveBar.tsx` | 底部悬浮保存条 |

**改**

| 文件 | 内容 |
| --- | --- |
| `src/webui/api.ts` | `PayloadConfig` 扩到 30 项、单位注释、`TargetsPayload` |
| `src/webui/main.tsx` | 拆 tab、接新组件、逐字段脏集合、即时/延迟两条路 |
| `src/webui/styles.css` | 新 token 两套 |
| `src/webui/ui.ts` | 新增跨组件共用的 className 常量 |
| `src/modules/webadapter/index.ts` | `payload()` 回全字段（换算后）、`saveGlobal()` 白名单扩到 30 项、`/targets` 接口、file_server 重启、upload_hook 校验 |
| `src/utils/fileServer.ts` | 导出 `restartFileServer()` |
| `src/modules/guoba/schemas/base.ts` | `SCALED_FIELDS` 迁走、MB 字样 |
| `src/modules/guoba/index.ts` | 改 import 指向 `config/units` |
| MB 字样那 11 处 | 见 §1.3 |
| `docs/guide/panel.md`、`docs/guide/config.md` | 设置项清单、单位、新 tab 结构 |

## 十、验收

1. `pnpm run typecheck`（两份 tsconfig）+ `pnpm run build`。
2. `test/contrast.mjs` 加面板那两套，浅深都跑过，四处不合格清零（`border` 与 `switch-on`
   两行标 informational）。
3. 扩 `test/panel-verify.mjs`，新增断言：
   - MB 换算往返不漂移（填 4.77 保存再读回仍是 4.77，落盘字节数不变）
   - chip 键盘增删（回车加、Backspace 删、`×` 可聚焦）
   - 30 项在 390px 下无页面级横向滚动
   - tab 方向键切换 + localStorage 抛错时能回落
   - 拨了延迟项不保存，过一轮轮询（10s）不许弹回去
   - 只改了 A 项时轮询带来的 B 项变化不覆盖 A（逐字段脏集合）
4. 出图：390px 深浅两张 + 桌面一张，交付时贴出来。
5. `docs/` 两篇跟着改。

测试文件继续留在本地不入库（`test/` 在 .gitignore、CI 不跑 `pnpm test`）。

## 十一、风险

| 风险 | 处理 |
| --- | --- |
| `PayloadConfig` 换单位是契约变更 | 两端同一份类型，改错编译期就报；漂移防护见 §1.2 |
| `/targets` 几千个群一次性传 | 只在开弹层时拉、不进轮询整包；前端虚拟滑动。真的大到卡住再改服务端搜索 |
| file_server 重启作废在途外链 | 整节延迟提交（§7.1）+ toast 说明；影响窗口最长一个 `link_expire` |
| `upload_hook` 试加载会执行用户代码 | 运行时本来也执行；只在保存这一刻、只加载用户自己填的路径 |
| 30 项 + 新配色一次交付太大 | 本文档先审；实现按 单位换算 → 字段扩容 → tab 与配色 → 新控件 四步走，每步能独立跑 panel-verify |

---

## 落地后的偏离（留档）

这份文档是**当时的设计决策**，不是现状快照。实现与验证阶段有几处按实测改了，记在这里免得后来人照文档反推代码：

| 项 | 文档写的 | 实际落地 | 原因 |
| --- | --- | --- | --- |
| 强色 | 宝蓝 `#1f3fc9` / `#8ba4ff` | 赤陶 `#b8431f` / `#e8825a` | 中性色是暖石灰，配冷蓝是「说不上哪里怪」的根因；中性色必须跟着强色的色相走 |
| `accent-soft` | `#e8ecfb` / `#1e2547` | `#fbeee9` / `#3a1e14` | 跟着强色换暖 |
| `border-strong` | `#8c8c84` / `#70707a` | `#8b8b83` / `#767680` | 文档那两个值实测差一点：`#8c8c84` 对 `--bg` 是 2.9952:1（四舍五入成 3.00 看着达标），`#70707a` 对 `surface2` 只有 2.92:1 —— 控件边界要卡三种底（surface / surface2 / bg），文档只核了一种才漏掉 |
| 账号行 | 卡片信息行里的一个折叠标签 | **整行可点**的折叠开关（右侧「管理 ▼」/「收起 ▲」） | 标签与旁边几个只读胶囊长得一样，唯一能点的那个只靠 hover 变色区分，而触屏没有 hover。同一轮把只读信息一律降级成纯文字，「有描边 = 可点」成为这个面板的硬规则 |
| 列表项主操作 | 实心主色 | 主色描边（`BTN_ACCENT`） | 每张卡一个实心「编辑」，整页平铺出四五个色块，与页面级唯一的主按钮抢注意力 |

另外几件文档没提、实现时补上的：`webui/http.ts`（取数出口，选择器原先自己裸 fetch 导致同一件事两套错误话术）、`components/useDialog.ts`（Esc + 焦点锁，连接弹层原先三样都没有）、以及 `test/panel.test.mjs` 里那两条**字段表与服务端契约的接缝**测试 —— `FIELD_COUNT` 那条断言只把 fields.ts 自己的两个数互相比，拦不住它声称要拦的「契约扩了字段而字段表忘了跟」。
