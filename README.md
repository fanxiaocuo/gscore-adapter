# gscore-adapter 文档站

[gscore-adapter](https://github.com/fanxiaocuo/gscore-adapter) 的文档站源码，VitePress。

**这个分支不是插件。** 想装插件请用 `release`（稳定版）或 `preview`（预览版）分支，
见[安装说明](https://fanxiaocuo.github.io/gscore-adapter/guide/install)。

| 分支 | 内容 |
| :--- | :--- |
| `main` | 插件的 TypeScript 源码 |
| `release` | 插件产物，稳定版，跟发版 |
| `preview` | 插件产物，预览版，跟 main 每次提交 |
| `doc` | **本分支**，文档站源码 |
| `gh-pages` | 文档站产物，由 Actions 自动发布，勿手改 |

## 本地跑

```bash
pnpm install
pnpm dev        # http://localhost:5173/gscore-adapter/
pnpm build      # 产物在 docs/.vitepress/dist
pnpm preview    # 预览构建产物
```

## 版式

UI 遵循 `DESIGN.md`（MekaVerse style reference）：纯黑画布、白字、无彩色强调、
零阴影、2/10/20 三档半径、chrome 一律等宽小字，标题下的 1px underline mark 是品牌记号。

两处有意偏离，理由写在 `docs/.vitepress/theme/style.css` 的文件头注释里：

- **标题字号行高**。规范是 80px / line-height 0.78，为西文写的——中文方块字压到 0.78
  会上下粘连，故取 52px / 1.06。左对齐、weight 400、underline mark 全部保留。
- **全屏艺术画布**。规范假设每屏都是一张 3D 渲染图，文档站没有这种素材也不该有，
  改由纯黑画布 + 大字标题 + underline mark 承担同样的空旷感。

## 发布

推到 `doc` 分支即触发 `.github/workflows/docs.yml`，构建后发到 `gh-pages`。
死链会让构建失败（`ignoreDeadLinks: false`），所以站内链接写错在 CI 就会拦下。
