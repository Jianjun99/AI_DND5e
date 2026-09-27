# Task: PWA / 离线缓存

> ✅ **已实现**（v1.9.4 批次）：runtime 缓存策略比本规格更保守——HTML/JS/CSS network-first（本地改动即时生效），vendor/icons cache-first，/api 永不缓存。图标是 node zlib 生成的占位 PNG。

## 背景

游戏是单 Node 进程 + 原生 JS SPA，无构建步骤（这是核心设计，**不要引入打包器**）。
玩家希望手机/断网时也能打开已缓存的页面（对局需要服务端，纯离线只能玩到「缓存壳 + 上次静态资源」）。

## 目标

加一个 service worker，把静态资源（HTML/CSS/JS/vendor/字体/图标）缓存起来；
`/api/*` 一律不缓存。装上 PWA manifest 后手机可以「添加到主屏幕」全屏运行。

## 动哪些文件

- 新建 `public/sw.js`（cache-first for 静态资源，network-only for `/api/`）
- 新建 `public/manifest.webmanifest` + 一个 192/512 的图标（现成 favicon 放大即可）
- `public/index.html`：注册 sw + 引 manifest（两行）
- `server/index.js`：确认 express static 会正确服务 sw.js（scope 是根路径）

## 实现要点

- SW 版本号写死在文件顶部常量（`CACHE_VERSION`），更新资源时 bump——旧缓存整体清除。
- install 时预缓存核心清单（index.html + 主要 js/css/vendor 文件列表，手写数组即可，别搞构建时生成）。
- fetch 拦截：`/api/` 开头 → 直接网络（不命中缓存，失败就失败）；其余 → cache-first，
  命中不了再网络并回填缓存。
- 不要引入 workbox 或任何依赖。

## 验收标准

- `npm run verify` 全绿。
- Chrome DevTools → Application → Service Workers 注册成功；断网刷新首页能出壳。
- e2e（responsive-cdp）不受影响：SW 不能拦截或改变 `/api` 响应。
- ARCHITECTURE.md 前端表格加一行 sw.js。

## 验证

`npm run verify`；手动浏览器验证按 AGENTS.md（CDP 截图 / DevTools）。
