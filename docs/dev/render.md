# 出图管线

状态 / 帮助 / 版本 / 更新日志四页，React SSR + Tailwind，深浅主题按时段切。

## 那条链

```
React 组件 → @karinjs/template-react 的 createRenderer / HtmlWrapper
          → 整页 HTML 写到 temp/html/ → 本体 screenshot() 打开并截图
```

外壳与 SSR 写盘直接用 `@karinjs/template-react`（kkk 那条渲染路径本身）。它按「目录即路由」约定扫 `.ktr/`，本插件绕过了这层，直接给 `createRenderer` 一张 route → 组件的表。

## 为什么仍然走本体 screenshot()

而不自己驱动 puppeteer——它还管着浏览器生命周期、超时强制重启、每 N 次渲染主动重启、分片截图的 viewport 计算。

## 三个坑

### CSS 必须内联

不能 `<link>`。puppeteer 用 `file://` 打开临时目录下的 HTML，相对路径的基准是那个目录，链不到插件里的文件。

### 高清用 `zoom` 而非 `transform: scale`

本体截的是 `#container` 的 boundingBox，`scale` 不改布局盒尺寸，图会被裁。

### 本体按路径缓存模板且永不失效

见 `lib/renderer/Renderer.js`。取「每页固定文件名 + 渲染前清掉该键」：路径固定则 watcher 不会无限增长，清缓存则每次读到新内容。

::: warning 两者缺一都会静默出错
要么图永远不更新，要么 watcher 泄漏。
:::
