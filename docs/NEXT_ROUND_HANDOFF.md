# 下一轮：双语、地图界面与角色扮演

当前更新（2026-10-04）：用户授权的 [复核报告三项补修](T9_T11_REVIEW_2026-10-03.md) **done，全部 closed**。最终 `npm run verify -- --timeout=1200 --balance-runs=50` 退出 0，37 套件（12 CDP）/eslint/tsc/smoke/balance 全绿；HP 10/0、新增 CDP 107/0，12 组新增 PNG/DOM 已实际查看，容器清理完成。证据 `artifacts/verify/2026-10-04T04-22-56-094Z-bc96d5aa/`，失败历史、胜率对比、历史污染 HP/范围外首页徽标/真人试玩边界见报告。保留五项全部未提交成果，不新增 T12/T13、不提交或发布。

**接手先看最新复核与补修**：[T9a–T11 报告](T9_T11_REVIEW_2026-10-03.md)。原独立复核退出 1（34/35），异步路由初始化、HP 重算和动态双语三项现已按授权关闭。原始与迭代失败证据保留，文末指派提示词已执行，不能重复领取。下方模块 done/全绿为主体开发历史，最新验收以顶部为准。

维护：2026-10-03。适用于完全没看过项目的执行 agent。项目为 Node/Express + 原生浏览器 JS/Three.js，本地 JSON 存档，可选 OpenAI-compatible AI。服务器/引擎裁判，模型只写表达。版本 1.10.0 已发布；本轮不包含新发布。

## 为什么这样排

用户偏好故事/选择/角色扮演，同时明确提出中英文分开、地图变大、功能轻量浮层。先建立共同语言契约，再让常用界面可读、地图可玩，再补内容/AI 的语言一致性，最后做一个小而完整的分支故事。避免在界面和语言仍混乱时堆更多玩法。

| 建议顺序 | 模块 | 可交付结果 | 状态 |
|---|---|---|---|
| 0 | [T9a](../tasks/t9a-localization-foundation.md) | 语言偏好、共用资源/API 契约、导航/显示设置示范 | done；29 套件/smoke 全绿、真实浏览器已看 |
| 1 | [T9b](../tasks/t9b-interface-localization.md) | 现有界面固定文字两语言，切换保留操作状态 | done；30 套件/8 CDP/smoke 全绿，137 项双语回归 |
| 2 | [T10](../tasks/t10-map-first-floating-ui.md) | 大地图、简短 HUD、一个主浮层、手机抽屉 | done；31 套件/9 CDP/smoke 全绿，104 项回归与四尺寸双语截图 |
| 3 | [T9c](../tasks/t9c-content-log-ai-localization.md) | 发行内容/规则名称/日志/AI/TTS 的双语一致性 | done；33 套件/10 CDP/smoke 全绿，14 集成场景/1117 断言、154 项浏览器回归 |
| 4 | [T11](../tasks/t11-branching-short-adventure.md) | 三处选择、三种结局、可失败推进的短篇 | done；35 套件/11 CDP/smoke 全绿，11 集成场景/350 断言、134 项浏览器检查 |

顺序是推荐领取顺序，不是额外自动授权。T9a 并不代表全量翻译；T9b 做完也仍需要 T9c。布局 T10 不依赖内容翻译全部完成，因此安排在 T9c 前给玩家先看到画面改进。

T11 已获用户明确授权并完成，最终专用 Docker `npm run verify -- --timeout=1200` **退出 0**，eslint/tsc/35 套件（11 CDP）/smoke 全绿，`cleanupComplete=true`、`timeout=false`。证据 `artifacts/verify/2026-10-04T01-42-52-785Z-343bdb5a/`；中英文公开/保护四路线真实指针通关、刷新与回城，24 组 PNG/DOM，两语言桌面/390×844 手机已实际核对。选择表、身份/记忆边界及加速计时见 [故事规格](../content/missing-courier/STORY.md)，完整测试/失败记录/试玩/真人节奏待反馈见 [T11 交接](../tasks/t11-branching-short-adventure.md)。全自动验证与 Chromium 仍只在专用 Docker；版本仍为 1.10.0，无提交/发布，T12/T13 未授权。

T9c 历史完成证据为 `artifacts/verify/2026-10-03T23-51-30-615Z-1d5334a6/`：完整 verify 退出 0，`cleanupComplete=true`、`timeout=false`；18 组 T9c PNG/DOM 覆盖两语言桌面/手机、和平/战斗路线，实际查看后交付。范围、原文回退、历史失败与修复、可照做的试玩及范围外既有矮人装备 HP 重算问题见 [T9c 结果](../tasks/t9c-content-log-ai-localization.md)。T9a/T9b/T10/T9c/T11 全部完成，成果仍未提交，下一位保留整个工作区。

T10 历史完成证据为 `artifacts/verify/2026-10-03T18-47-08-823Z-e1d6cad3/`，退出 0；两语言 1440×900 / 1280×800 / 390×844 / 844×390 已实际查看。A/B/C 清单、原面板/导航兼容边界、PNG/DOM、同镜头布局/帧间隔比较与试玩在 [T10 交接结果](../tasks/t10-map-first-floating-ui.md)。此前 T9b 证据 `artifacts/verify/2026-10-03T16-10-09-034Z-0f8e666d/` 与 [T9b 结果](../tasks/t9b-interface-localization.md) 保留。

## 项目拥有者怎样交接

1. 给 agent 打开整个 `G:\ai_DND`，不要只给某个文件。让它读 START_HERE 和指定 task；不需要转贴历史聊天。
2. 确认 tasks/README 中前置已完成，指定 **一项**；T9a/T9b/T10/T9c/T11 已完成，不重新领取。需要复核/修复时明确指派；不自动领取 T12/T13。
3. 当前工作区若有未提交改动，这是上一任务的成果，执行 agent 应保留并基于它继续。没有提交也可以交接；避免两个 agent 同时编辑同一个目录。需要并行时用各自隔离 checkout/worktree，并由一个整合者合并；只有你要求时才创建。
4. 验收 agent 报告中的范围、截图、完整 verify 路径/退出码和未完成项，按任务试玩。一个模块内部允许分段开发；不必每次编辑跑完整测试，但每次向你交付一个已完成模块都必须完整验证。
5. 验收后再指派下一项。完成全部也不等于授权 commit/push/改版本/发版；你明确要求发布后才进入 RELEASE 流程。

## 可直接复制的执行提示词

下面是用户已授权 T11 的执行提示词模板；接手时先看实际交接状态，done 后只在用户指派复核/修复时继续，不自动开始候选任务：

```text
请在 G:\ai_DND 接手 AI Dungeon，这次只处理 T11 分支短篇。
你不需要了解之前的聊天；先读 START_HERE.md、AGENTS.md、PROJECT_STATE.md 顶部、
tasks/README.md、ARCHITECTURE.md，再读 docs/NEXT_ROUND_HANDOFF.md、
tasks/t9a-localization-foundation.md、tasks/t9b-interface-localization.md、
tasks/t10-map-first-floating-ui.md、tasks/t9c-content-log-ai-localization.md 的实际交接结果，
以及 tasks/t11-branching-short-adventure.md、content/missing-courier/STORY.md、MODDING.md。

先 git status，保留已有未提交成果；确认 T9a/T9b/T10/T9c 已完成，检查真实代码后再动手。
复用 i18n/localization、T8 内容校验、T6 事实与记忆；不要另建翻译系统或重写地图界面。
一张小地图、两位关键 NPC、三处重要选择、至少两种不同结局；关键对白/证据/失败退路/结局
两语言手写，AI 关闭可完整完成。只做本篇所需的有限条件/效果和真实代价，不造通用脚本系统。
区分当前 save 的场景解锁与永久记忆，刷新/重复选择/迟到 AI/重复结算不得重扣资源或发奖。
模型只收到已发现的当前信息、该 NPC 可知事实与合法选择，不送未选结局全文。
保留玩家输入、焦点、busy、地图实例、生命周期守卫与结算返回锁；切语言不重发行动/AI。
引擎/服务器是唯一裁判；不改规则数值、canonical ID、uniqueId，不添加框架、不物理拆引擎。
本任务不包含 T12 完整同伴长篇、T13 自然语言自由裁判、重做四幕主线或重写布局/城镇。

所有自动测试及 Chromium 都使用 npm run verify 的专用 Docker 容器。
不要在宿主机起自动测试服务/浏览器；容器忙返回73就等待，不删除别人的容器。
直接完成实现和必要修复，用确定性模型 mock 验证，不连接真实 AI；覆盖真实消耗/检定失败、
并发重试、永久/局部事实、旧哨门/旧包/旧档与知识边界，真实浏览器走两条不同结局路线，
查看中文/英文桌面和手机。记录真实计时与加速/夹具条件，不把自动化用时冒充真人 20–30 分钟。
最后完整 verify 全绿才标 done，更新任务交接结果、tasks/README、PROJECT_STATE、ARCHITECTURE/MODDING。
交付完成范围、测试退出码和日志/截图位置、能照做的试玩步骤、遗留项。
不要 commit/push/改版本/tag/发版，不自行继续下一任务。
```

其他任务必须先明确指派，再替换 ID、规格路径、具体范围和排除项；其余入口、验证和交付规则保留。

## 可直接复制的独立检查提示词

```text
请检查 G:\ai_DND 的 T11（把 ID 换成需要复核的已完成任务）。
先按 START_HERE 阅读规则、状态与任务规格，查看 git diff 和真实实现；保留所有改动。
按该规格逐项确认玩家行为与兼容边界，不能只接受执行 agent 的“全绿”报告。
使用专用 Docker npm run verify，真实 Chromium 查看中文/英文和手机关键路径。
不要在宿主机起测试浏览器、不跳过套件；忙返回73就等，不删除其他 agent 容器。
先修复你能确定且属于该任务的必要问题，再完整验证，报告通过项、实际阻碍与复现步骤。
更新交接结果但保留历史证据。不主动 commit/push/改版本/tag/发布或扩展到下个任务。
```

## 两位 agent 能否并行

默认串行，T9a/T9b/T9c 的语言展示、内容/事件/AI 契约与 T10 的布局/面板/生命周期守卫均已完成，后续必须保留。未来只有用户明确要求时才在隔离 checkout 并行，并先指定公共资源/catalog/API 的归属；共同客户端接线由整合者处理，不能各自覆盖文件。所有完整 verify 仍共用一个 Docker 名称锁；分别通过不代替合并后的完整验证。获授权的 T11 已交付，其他候选须另行指派。

未来候选：同伴更深入的态度与个人故事、自然语言提出合法行动。当前没有指派，先用 T11 试玩判断价值。
