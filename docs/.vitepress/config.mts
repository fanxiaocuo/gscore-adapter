import { defineConfig } from "vitepress"

/**
 * VitePress 配置
 *
 * base 必须是 /<仓库名>/：站点发到 GitHub Pages 的项目页
 * （fanxiaocuo.github.io/gscore-adapter/），不带这一段的话所有资源
 * 都会去要 fanxiaocuo.github.io/assets/... 而 404 —— 本地 dev 正常、
 * 一发布就整站掉样式，是这类站最常见的翻车方式。
 */
export default defineConfig({
  title: "gscore-adapter",
  description: "Miao-Yunzai / TRSS-Yunzai 的早柚核心适配器",
  lang: "zh-CN",
  base: "/gscore-adapter/",
  // 死链直接让构建失败：文档里链错路径不该等用户点了才发现
  ignoreDeadLinks: false,
  cleanUrls: true,
  lastUpdated: true,

  // .vitepress/ 里的 DESIGN.md 是版式规范，不是页面。
  // VitePress 的页面 glob 是 `**.md`，其 ignore 列表并不含 .vitepress——
  // 只是 tinyglobby 默认 dot:false 才没扫到点目录。这条把它显式钉死，
  // 免得哪天那个默认值变了，规范文档就成了站点上的一页。
  srcExclude: ["**/.vitepress/**"],

  head: [["link", { rel: "icon", href: "/gscore-adapter/logo.webp" }]],

  // 默认深色，但开关可用（style.css 里深浅两套都写了）。
  // 不写 color-scheme 的 meta —— 那会把浅色主题下的表单控件也按深色配，
  // 而 appearance 交给 VitePress 自己在 <html> 上切 .dark 就够了。
  appearance: "dark",

  markdown: {
    // config.md 里有 20 行以上的 yaml 块，没有行号不好指位置
    lineNumbers: true,
  },

  themeConfig: {
    logo: "/logo.webp",
    // 站点标题在导航里由 logo + 文字组成，这里关掉重复的文字
    siteTitle: "GSCORE ADAPTER",

    nav: [
      { text: "指南", link: "/guide/install", activeMatch: "/guide/" },
      { text: "协议", link: "/protocol/segments", activeMatch: "/protocol/" },
      { text: "开发", link: "/dev/architecture", activeMatch: "/dev/" },
      {
        text: "下载",
        items: [
          { text: "稳定版 release", link: "https://github.com/fanxiaocuo/gscore-adapter/tree/release" },
          { text: "预览版 preview", link: "https://github.com/fanxiaocuo/gscore-adapter/tree/preview" },
        ],
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "开始",
          items: [
            { text: "安装", link: "/guide/install" },
            { text: "配置", link: "/guide/config" },
            { text: "指令", link: "/guide/commands" },
            { text: "面板", link: "/guide/panel" },
          ],
        },
        {
          text: "排障",
          items: [{ text: "常见问题", link: "/guide/faq" }],
        },
      ],
      "/protocol/": [
        {
          text: "协议与兼容",
          items: [
            { text: "消息段", link: "/protocol/segments" },
            { text: "非消息事件", link: "/protocol/meta-events" },
            { text: "协议要点", link: "/protocol/notes" },
            { text: "回环防护", link: "/protocol/loop-guard" },
            { text: "双框架兼容", link: "/protocol/compat" },
          ],
        },
      ],
      "/dev/": [
        {
          text: "参与开发",
          items: [
            { text: "架构", link: "/dev/architecture" },
            { text: "出图管线", link: "/dev/render" },
            { text: "测试", link: "/dev/testing" },
          ],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/fanxiaocuo/gscore-adapter" }],

    footer: {
      message: "GPL-3.0-only · 仅供学习交流使用",
      copyright: "早柚核心适配器",
    },

    outline: { level: [2, 3], label: "本页" },
    docFooter: { prev: "上一篇", next: "下一篇" },
    lastUpdatedText: "最后更新",
    returnToTopLabel: "回到顶部",
    darkModeSwitchLabel: "主题",
    sidebarMenuLabel: "菜单",

    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "搜索", buttonAriaLabel: "搜索" },
          modal: {
            noResultsText: "没有找到",
            resetButtonTitle: "清除",
            footer: { selectText: "选择", navigateText: "切换", closeText: "关闭" },
          },
        },
      },
    },
  },

  vite: {
    // 站点很小，关掉分包让产物更少几个请求
    build: { chunkSizeWarningLimit: 1500 },
  },
})
