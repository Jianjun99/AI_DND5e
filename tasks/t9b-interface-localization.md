# T9b：完整界面双语

- 状态：done
- 更新：2026-10-03
- 前置：T9a 完成并验证；接手先确认最新状态。
- 本次授权范围：把现有玩家界面的固定文字迁入共同资源表，中文/英文模式下都能走完一次冒险。

## 玩家问题与已有能力

T9a 已定义语言 API 和资源，只有导航/部分设置接入。首页快速开始仍中文，其他旧界面多为英文。此任务处理按钮、说明、状态、弹窗与错误表达；故事正文和规则实体名称由 T9c 处理。

## 接手阅读与代码入口

START_HERE → AGENTS → PROJECT_STATE 顶部 → tasks/README → ARCHITECTURE → T9a 结果。
读 `public/js/i18n.js`、`localization/*.mjs`、`app.js`、`api.js`；然后 `views/home.js`、`creator.js`、`sheet.js`、`overworld.js` 与 `overworld/`、`play.js` 与 `play/`、`campaign.js`、`settings.js`；服务端固定引导见 `server/game/guidance.js`、`presets.js`。
先用 rg 列出实际文字入口和手写 fetch，不凭截图猜范围。快捷键说明要核对真实绑定：当前 play.js 中 V 切 immersive、F 切跟随镜头；旧设置里的 V 视角说明不能原样翻译成新误导。

## 目标场景

分别选择简体中文/English：首页推荐英雄→命名→准备入口→出发→教学→互动/战斗→撤退或胜利→结算→下一目标，固定操作文案都使用选定语言。模态框/设置/地图视角切换时同样如此。

## 范围与实现约定

1. 用三段检查清单推进：A 首页/创建/准备；B 地牢 HUD/教学/操作面板/结算；C 角色/城镇/主线/所有设置/备份与内容管理。每段记录迁移入口和剩余项，全部验收才将 T9b 标 done。
2. 使用 T9a t 与资源文件，不建立另一套翻译工具，不做 MutationObserver 自动翻译，不靠刷新整页切换。
3. 每个长驻视图定义 refreshLocalizedText；绑定 onLocaleChange 并通过已有 cleanup 释放。保持 busy/disabled、焦点、输入、卷动、地图实例、选择状态与迟到响应守卫。不 rerender 整个 playView 或重启 WebGL。
4. 临时按钮“处理中”与普通文案均按当前状态重绘；切换不能使正在处理的按钮恢复为可点击。异步回调落地时用当时语言，不保留过期闭包文字。
5. 服务端 guidance/preset 等固定展示字段若需要在此接入，先增加 key+params/display 字段并保留旧 text 兼容；客户端不复制目标判断与推荐英雄 build。具体 ID/数值来自服务端。
6. 原有裸 fetch 逐项审计。JSON API 优先现有 api.js；文件下载/上传可用显式 locale header。不能 monkeypatch 全局 fetch。
7. 所有新文案使用稳定 key；输出为纯文字，HTML 模板继续 esc，正确处理中英文插值和长按钮。可保留 D&D、HP、AC、d20、品牌与玩家输入。
8. 将 T9a 阶段提示改为准确剩余范围：此任务完成不代表 T9c 的故事/规则/日志/AI 完成。

## 本次不包含

T10 的布局改造、通用剧情系统、规则/内容翻译全集、改变装备/className/XP/奖励、替换框架。不迁移玩家自定义名字或历史聊天原文。

## 验收标准

- [x] A/B/C 入口清单和两语言完整游玩路径均记录，固定界面文案没有任意中英混排。
- [x] 地牢/角色面板/准备页中切换语言不会丢表单、取消行动或回退 rev；打开弹窗的焦点与点击事件仍正常。
- [x] 所有“不可用原因”“处理中/失败可重试/奖励保存中”等状态正确翻译且行为保持。
- [x] 中文/英文桌面与手机没有按钮裁切；设置和教学能读清楚。
- [x] 无新增规则表和框架；旧存档、老接口字段兼容。
- [x] 真实 Chromium 验收 + npm run verify 全绿。

## 验证

为忙碌按钮切换、未保存输入、地牢内打开面板切换与结算重试补有意义的 CDP 回归。保留 T2/T3/T4/T5/T7/T9a 回归；不要仅比较翻译实现与自身。完整 verify 一次用于最终交付，失败修复后再跑；不要求每次改一个词就跑完整测试。

## 交接结果

### A：首页 / 创建 / 准备

- 首页推荐英雄、推荐理由与提示、命名/创建 busy、活动存档/待结算状态、备份与内容包管理；`home.js` 复用 `api.js`，下载显式发送 locale header。
- `creator.js` 七步标题、表单说明、校验、能力值/装备/复核、提交状态；仅更新文字叶子与属性，草稿、选择、焦点保留。规则实体名称/特性说明仍为 T9c。
- `overworld.js` 准备目的地、难度/同伴选项、主线推荐、出发 busy/失败；`play/new` 旧入口同样迁移。路遇恢复/防重复/迟到守卫保持；切换语言不调用 start/trigger。

### B：地牢 / 教学 / 操作面板 / 结算

- `play.js` 固定 HUD、回合资源、悬停操作、相机/暂停/沉浸控制、快捷物品、法术位、不可用原因与暂态提示；`ribbon.js` 先攻条；`map.js` 2D 出口标记。语言事件不调用 update/renderSide，不换 WebGL canvas。
- `tutorial.js` 四步教学与进度/跳过；`delve-inventory.js` 背包装备；`panels.js` 商店/日记/检定/遭遇固定控制、结算保存中/失败重试/已入账/重复回执/下一目标。检定加值与状态由服务端展示描述给出。
- `tooltip.js` 稀有度与效果/属性标题迁移，物品故事和规则说明保留。玩家插值继续转义。
- 必要补修：同一浏览器连续两场冒险时，旧模块级 summaryShown 会让第二场不自动弹结算；每次地牢挂载重置。已关闭的检定/升级/设置以及已离开的结算弹窗丢弃迟到渲染。

### C：角色 / 城镇 / 主线 / 设置 / 数据管理

- `sheet.js` 角色卡标题/数值栏/装备弹窗/肖像状态；`levelup.js` 升级向导固定步骤与提交/重试。
- `overworld/districts.js` 五城区、商店/出售/锻造、休息/同伴、赌桌游戏/投注/处理中、药瓶鉴定状态、图鉴筛选/详情栏、成就/榜单固定操作；`road-encounter.js` 继续/选择/价格与检定提示。
- `campaign.js` 主线状态/奖励/进度/下一操作/统计；已完成主线标签来自服务端描述。
- `settings.js` 六个标签（音频、AI DM、语音、游戏、肖像、备份），预设与风格卡、连接/保存状态、默认语音、显示设置、导入导出。核对 V=沉浸、F=跟随；视角使用 2D/3D 按钮。locale.progress 明确剩余 T9c 范围。

### 验证与兼容

- 最终专用 Docker `npm run verify` **退出 0**（2026-10-03 16:15 UTC）：eslint、tsc、全部 **30 套件（8 CDP）**、smoke 全绿；语言集成 **9 cases**、T9a CDP **27 assertions**、T9b CDP **137 passed / 0 failed**。`result.json` 为 `cleanupComplete=true`、`timeout=false`；宿主机没有自动测试服务或 Chromium。
- 新增 `interface-localization-cdp.test.mjs` 已纳入完整 verify（第 30 套件/第 8 个 CDP）；覆盖七步创建草稿、双语言连续冒险、pending 创建/出发、地图与弹窗/输入/焦点/卷动、设置各页、失败结算与 pending 重试、城镇投注、装备弹窗和手机 PNG/DOM；最后确认 runtime/missing-key 诊断为零。
- 最终证据：[验证目录](../artifacts/verify/2026-10-03T16-10-09-034Z-0f8e666d/)、[完整日志](../artifacts/verify/2026-10-03T16-10-09-034Z-0f8e666d/last-verify.log)、[退出码与清理结果](../artifacts/verify/2026-10-03T16-10-09-034Z-0f8e666d/result.json)。截图/DOM 在该目录 `screenshots/`；T9b 有 **27 组 PNG + DOM JSON**，已实际查看两语言桌面地牢/背包/结算/城镇、390×844 手机设置与教学。主要文件：`t9b-zh-CN-play-tutorial-9232-0`、`t9b-en-play-tutorial-9232-0`、`t9b-zh-CN-mobile-settings-9232-0`、`t9b-en-mobile-settings-9232-0`、两语言 `mobile-play` / `summary-failed` / `summary-saving` / `summary-saved` / `town`；每个同名 `.png` 配 `.json`。
- 修复前的失败证据保留在同日早先 verify 目录；不把之前失败或早于最后文案修正的成功运行当最终结果。没有改战斗/掉落/赌桌/魔药数值表，因此本任务未追加 balance-sim。
- 原有 T2/T3/T4/T5/T6/T7/T9a 回归保留。旧 CDP 对混排文字的断言改为所选语言；服务端数值和行为断言不放宽。
- 真实截图复核补正中文图鉴“击杀”标签，并为两语言图鉴计数栏增加行为断言；中文赌桌/周试炼/深渊榜标题不再附带重复英文。资源表残留的英文限品牌、键位/命令、技术名和 T9c 规则实体。
- 验证环境补修：T6 等待浏览器进程退出后再移除临时 profile，子进程短暂写入可有限重试；清理错误计入失败并打印。2 CPU 软件 WebGL 的截图等待由 8 秒改为有上限的 20 秒，截图超时/缺 PNG 仍失败；最终 27 个配套 DOM 文件已逐项核对，没有跳过渲染检查。
- `guidance/presets/difficulty/settings/city/check preview` 与固定 `error/message` 新增 `*Display`（或 preset.display）key+params，保留原 text/label/error/message。api 在落地时读取当前语言，偏好不写存档；没有改规则值、canonical ID、uniqueId 或版本。
- 玩家名字、历史聊天、剧情、内容/规则实体名称与说明、战斗/赌桌/魔药等引擎事件日志、AI/TTS 正文属于 T9c，保持原文。T10 布局未实施。本次不自动续做任何任务，不 commit/push/改版本/tag/发布。

### 可照做的试玩

1. 在已有游戏服务打开 `http://localhost:3000`；若尚未启动，由项目拥有者在 `G:\ai_DND` 执行 `npm start`。这是人工试玩入口；agent 的自动测试/Chromium 仍全部在 verify 容器中。先在顶部选“简体中文”，选首页推荐英雄、填写名字、创建；准备页调整难度/同伴，阅读推荐理由后出发。有路遇则选择并继续。
2. 按教学移动、点击可达对象互动，有敌人时攻击/结束回合；打开背包，在聊天输入未发送文字。打开设置的 AI DM 页，填入未保存的模型名，切换 English：草稿、选中标签和地图保留；关闭设置和背包后继续操作。V 是沉浸模式、F 是跟随镜头，2D/3D 使用视角按钮。
3. 从入口撤退（或完成地图目标后回营火），确认结算“战利品已保存到英雄档案 / Spoils banked”且返回按钮解锁，再回城。查看五城区、投注选项、图鉴/荣誉榜、角色装备和主线页。切 English 新建第二位英雄重复“创建→准备→出发→撤退→结算”，第二场同样自动打开结算。
4. 手机以约 390×844 竖屏打开同一入口，在两语言下查看教学、设置六页和背包；长设置可内部滚动。结算失败/重试与处理中切换由容器 CDP 故障注入覆盖，人工试玩不需要改存档或制造网络错误。页面中的剧情/规则实体/引擎日志原文是 T9c 的明确剩余范围。
