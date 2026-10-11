# T9a：双语基础与语言切换

- 状态：done
- 更新：2026-10-03
- 前置：T1–T8 已完成，当前发布版 1.10.0。
- 本次授权范围：建立全项目可复用的简体中文/英文展示契约，并接入导航和设置页的显示区域。

## 玩家问题与已有能力

原界面英文、T4/T5 和主线中文、地图内容英文并存。目前没有语言偏好。用户希望两种语言分开，也希望地图优先的轻量浮层界面。先统一入口，后续任务复用；这个任务不是全游戏翻译完成。

## 接手阅读与代码入口

按 START_HERE 阅读 AGENTS、PROJECT_STATE、队列与架构。阅读 `public/index.html`、`public/js/app.js`、`api.js`、`views/settings.js`、`server/index.js`、`scripts/test-all.mjs`、`public/sw.js`。

## 目标场景

中文浏览器首次进入采用 zh-CN；英文/其他浏览器采用 en。玩家可在导航栏或设置→游戏与界面修改语言；刷新保留选择。正在冒险时切换已接入文字，不重新挂载地图，不修改存档。

## 范围与实现约定

1. 两个纯文字资源表、稳定 key、命名参数，缺 key 回退英文再显示 key 并诊断；禁止 HTML 资源与字符串全文替换。
2. `public/js/localization/locale.mjs` 为浏览器/Node 共用的纯契约。浏览器原生 import，CommonJS 服务端 dynamic import，无构建器与新依赖。
3. `i18n.js` 提供 getLocale/setLocale/t/translateDOM/onLocaleChange。偏好仅存在 `aiDnd.locale.v1`；语言子系统读写 localStorage 失败不抛出，使用会话语言。其他旧模块的浏览器存储行为不在本任务范围。
4. language change 只发 `game:localechange`；页面订阅自行更新文字并在 cleanup 解除。data-i18n 只标叶子文字节点，不替换交互控件父节点。t 返回纯文字，插入 HTML 时仍须 esc。
5. api.js 请求携带 X-Game-Locale；服务端保存在 res.locals.locale，不能变成全局模型/玩家设置。GET /api/locale 提供只读协商结果；支持 Accept-Language 回退和 CORS。
6. 翻译导航、标题、错误页、设置标题/标签与视角/小地图区域。给出阶段性范围提示，避免声称全部内容已翻译。
7. 不翻译玩家名字，不覆盖 className、装备引用、地图 ID 等引擎输入。没有存档迁移、数值修改或版本变动。
8. 新增语言区域使长设置弹窗需要明确视口上限与内部滚动；桌面关闭按钮和手机弹窗边界不可被裁切。SELECT 焦点下不派发地牢快捷键。

## 本次不包含

首页/创建器/城镇/地牢全量文案、规则名称、模组正文、事件日志、AI 输出与 TTS，由 T9b/T9c 完成；地图比例和浮层交 T10。

## 验收标准

- [x] 默认语言、显式偏好、刷新恢复、非法值回退有明确行为。
- [x] 导航与新打开的显示设置按当前语言呈现；两个 selector 同步。
- [x] 未保存模型输入、活动设置标签和 DOM 身份在切换时保留。
- [x] 地牢切换保持 canvas/路由/完整服务端 state 不变，没有 POST/PUT/DELETE。
- [x] 地牢 SELECT 焦点下方向键不触发走路，语言控件可用键盘操作。
- [x] 服务端并发中文/英文请求互不影响；语言查询不写设置、档案或存档。
- [x] 两表 key/参数一致，无 HTML；未知 key 不输出 undefined，不读取原型属性。
- [x] 桌面、390px 手机真实 Chromium 截图/DOM 已检查；完整 Docker verify 全绿。

## 验证

`npm run verify`，本次不改数值，无需 balance。新增 `tests/integration/localization.test.mjs` 和 `tests/e2e/localization-cdp.test.mjs`（9231；9230 留给负 WebGL 探针），必须在完整 runner 内执行。成功截图也留证。旧六个 CDP 套件继续执行。

## 交接结果

- 完成范围：共用 zh-CN/en 纯契约与资源、浏览器偏好/事件/展示工具、请求语言上下文、导航/部分设置翻译已完成；增加 SELECT 键盘守卫。实际截图发现长设置弹窗顶部关闭按钮被裁，已限制视口尺寸并改内部滚动；没有开始 T10 的地图布局。
- 修改文件：`public/js/localization/{locale,en,zh-CN}.mjs`、`public/js/i18n.js`、`server/locale.js`；`public/index.html`、CSS、app/API/settings、play 的键盘守卫；server/index CORS/中间件；tsconfig/eslint 覆盖 mjs；test-all/cdp-artifacts 与两套新回归；任务和交接入口文档。
- 验证：最终 `npm run verify` 退出 0，eslint/tsc/29 套件（7 CDP）/smoke 全绿；语言集成 7 cases、语言 CDP 27 assertions；无跳过，容器清理完成。证据 `artifacts/verify/2026-10-03T14-10-29-573Z-2c1031fd/result.json` / `last-verify.log`。本次无数值变化，无 balance 必要。
- 浏览器：实际查看上述目录 `screenshots/t9a-zh-settings-9231-0.png`、`t9a-en-play-9231-0.png`、`t9a-zh-mobile-9231-0.png` 及 DOM；中文显示区域、English 导航、手机内部滚动与桌面关闭按钮正常。其他尚未接入的旧界面/正文混排如实留在 T9b/T9c。
- 试玩：导航选择简体中文→设置→游戏与界面→切回 English；两个选择器同步。先在 AI 主持人标签输入未保存模型名，切换后输入保留；地牢中切换/用键盘选择/刷新，冒险状态不变。
- 存档/接口：无存档变化；新增只读 /api/locale 与请求语言 header，其他接口仍保留旧响应结构。
- 未完成项：全量界面 T9b；内容、日志、AI/TTS T9c；布局 T10。
- 版本/交付：仍 1.10.0；本轮改动保留在工作区，没有 commit/push/tag/发版。下一位 agent 直接基于当前文件继续，不清理未提交成果。
