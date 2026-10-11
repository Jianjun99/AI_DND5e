# 本轮开发任务队列

用户明确指派的 **T14/T13a/T15a/T15b 独立复核补修 R1–R9 已实现，待独立复核（2026-10-11）**，见
[复核补修记录](../docs/REVIEW_T14_T15_FIXES_2026-10-11.md)。按复核报告
`G:\ai_DND_handoffs\release-1.11-20261010\REVIEW_T14_T15_2026-10-11.md` 的九条真实失败逐项关闭：
草稿路径与身份边界（R1）、克隆资源引用重映射并真实通关两章（R2）、试玩内容快照隔离与重启可恢复（R3）、
服务端铸造试玩身份与确定生命周期（R4）、脏状态保护与"导出当前编辑"（R5）、文字与按钮共用唯一权威执行器（R6）、
模型候选复用服务端可见性规则（R7）、门瓦片/实体/场景引用一致与刷保护（R8）、承诺过的无代码选择表单与
界面双语及文档口径（R9）。新增 7 个集成套件（`draft-path-boundary` 8/296、`clone-playthrough` 5/41、
`playtest-content-isolation` 6/36、`playtest-lifecycle` 7/72、`action-authority-parity` 8/68、
`action-context-visibility` 7/32、`map-tile-entity-sync` 7/45）与 1 个浏览器套件
（`authoring-review` 8 步 / 82 断言），套件注册数由 57（11/24/22）变为 **65（11 unit / 31 integration /
23 browser）**；另在 `localization` 增加三项检查（英文目录零 CJK、客户端静态键双语齐备、
服务端 52 条显示描述符双语齐备）。
真人约 30 分钟的两条体验路线（新玩家走双章 / 从克隆改内容导出导入通关）**仍待项目拥有者确认**；
未 commit/push/改版本/tag/发版，未使用 reset/clean，动手前已整仓快照到
`G:\ai_DND_backups\20261011T051416Z-review-fix-111\`。

用户明确指派的 **T15b 基础格子地图与安全试玩已完成（2026-10-11，done）**，见 [规格、行为、契约与验收](t15b-map-authoring.md)。
在冒险创作工作室 (`public/js/views/author.js`) 中交付 25×15 样板小格子地图编辑能力（墙 `#`、地 `.`、门 `D`、起点 `🚶`、营火 `🔥`、实体拾取与放置、擦除与撤销/重做栈），保守连通性实时 BFS 检查与告警角标，实体坐标更新时严格保持场景稳定 ID 绑定；支持单图指定沙盒安全试玩 (`POST /api/content/drafts/:id/playtest` 扩展可选 `mapId`)，完全绕过正式存档与英雄数据。新增集成测试 `map-authoring`（8 用例；2026-10-11 复核后为 39 断言，第 8 例改为"未结束不结算 + 真实撤退后结算落在草稿英雄"）与 CDP 测试 `map-authoring-cdp`（27 断言，3 组界面截图）。完整 `npm run verify` 全绿（eslint, tsc, 57 套件全绿，smoke 通过，exit 0）。未改动规则数值，未 commit/push/发版。至此 1.11 候选任务集合（T14, T13a, T15a, T15b）全部完成。

用户明确指派的 **T15a 样板复制与 NPC/故事创作已完成（2026-10-10，done）**，见 [规格、行为、契约与验收](t15a-story-authoring.md)。
交付基于入门样板（`missing-courier` 双章）的一键克隆重映射与命名空间防碰撞；原生前端“冒险创作工作室” (`public/js/views/author.js`)，支持 Manifest 元数据、第一章/第二章 NPC 与剧情选择可视化编辑、容错草稿安全暂存 (`data/drafts/`)、T8 结构化诊断报告、单包导出与一键安装到游戏；服务端完全受控的孤立沙盒试玩 (`isPlaytest: true`)，通关与游玩绝不污染正式英雄数据。新增集成测试 `story-authoring`（5 用例 / 44 断言）与 CDP 测试 `story-authoring-cdp`（22 断言，6 组界面截图）。完整 `npm run verify` 全绿（eslint, tsc, 54 套件全绿，smoke 通过，exit 0）。未改动规则数值，未 commit/push/发版。后续 T15b 格子地图编辑也已完成。

用户明确指派的 **T13a 有限中英文自然语言行动已完成（2026-10-10，done）**，见 [规格、行为、契约与验收](t13a-bounded-natural-actions.md)。
交付五大有限行动类别（调查可见对象、交谈可接触 NPC、使用已有道具、合法场景选择、基础近战/远程攻击）的中英文自然语言确定性解析与白名单授权；歧义目标交互式澄清卡片、金币消耗与不可逆选择代价确认卡片；严格白名单防护与异步模型提案锁外生成 + 锁内权威重验；100% 兼容历史英文命令（hide, rest, shove, disarm, listen, dodge, disengage, quest）；输入错误草稿保留。新增集成测试 `bounded-natural-actions`（13 用例 / 47 断言）与 CDP 测试 `bounded-natural-actions-cdp`（24 断言，3 组双语截图）。完整 `npm run verify` 全绿（eslint, tsc, 47 套件全绿，smoke 通过，exit 0）。未改动规则数值，未 commit/push/发版。后续 T15a/T15b 均已完成。

用户明确指派的 **T14 完整入门冒险与跨章实际后果已完成（2026-10-10，done）**，见 [规格、行为、契约与验收](t14-complete-starter-adventure.md)。
实施新手双章完整冒险：第二章《河湾哨所的决断》（`river-post`），承接第一章 reported / protected / accord 三种结局并体现至少两处玩法差异（通行方式、物资帮助、DC 降低），为 0 GP、0 药水、0 法术位且检定全失败的极端工况提供零资源保底推进；三大终局（`lawful_order`, `free_haven`, `shared_covenant`）确定收束，打磨坚盾卫士（AC 19, STR 17）与奥法学徒（AC 12, INT 17, 调查 +7）推荐角色体验；跨章历史按结算收据 `mode === 'victory'` 确定资格并在开局时冻结；T15a/T15b 均已完成。

用户明确指派的 **Q1 开发检查与完整验收分层及 Q1a 验收补修已完成（2026-10-07，done）**，见 [行为、兼容、验证、测量与剩余工作](q1-dev-check-tiering.md)。
新增 `npm run check` 快速部分验证：Docker 内 eslint → tsc → 全部单元/集成套件 **fail-fast**，
`--browsers=<id,...>` 显式选择 CDP 套件、`--list` 列清单；与 `npm run verify` 共享同一镜像、
容器名互斥锁（占用 73）、2 CPU/4 GiB、网络与数据隔离、容器清理，证据带 PARTIAL 标记落
`artifacts/check/`；`scripts/test-suites.mjs` 是 **49 套件**（unit 11 + integration 20 + browser 18）的单一清单——
默认 check 列出其中 31 个单元/集成套件（dev-check-faults 显示 SKIP、实际执行 30 个），
显式选择的浏览器套件按实际选择追加。两个入口输出结构化耗时
（构建/宿主总时间/步骤/各套件/截图/清理）。verify 套件集合、冒烟、截图与失败清点不变。Q1a 修复 dev-check 退出码契约（任何失败路径——eslint/tsc/服务启动/套件/证据保存——一律非零且不打印 PASSED）并新增容器内故障注入回归套件 dev-check-faults（六用例 22 断言，check 内自跳过防递归）。按任务要求确定性关闭两项既有偶发：t7a CDP 无种子 12 次重掷（~0.8% 掷空）改引擎同形实例直接 staged；V1b CDP
hit 立即读改条件等待后断言（不弱化）。实测（均取自 artifacts 日志）：默认 check 容器内
**29.69s**、宿主 **33.49s**（构建 2.17s，镜像缓存命中）；独立快速复核（2026-10-09，
`--browsers=hud-stability`，镜像重建）容器 **50.98s**、构建 **61.81s**、宿主 **114.06s**，
H1 CDP **32/0**；verify 全量 **≈21.5 分钟**（高负载时段 1200s 预算可能超时，建议
`--timeout=1500`）。最终完整 verify 退出 **0**：eslint/tsc/**49 套件**/smoke 全绿，故障注入
**6 用例/22 断言**，全部 CDP 零失败（含 V1b 51、T7a 52、H1 32），`cleanupComplete=true`、
`timeout=false`，容器已清理；证据 `artifacts/verify/2026-10-07T03-11-06-475Z-68fed60a/`。
未改玩法/数值/稳定 ID；保留全部未提交成果，未 commit/push/改版本/发版，未领取 T13。
**2026-10-09 复核收尾轮（done）**：文档口径同步（49/31/30、耗时与证据按 artifacts 日志）与
`scripts/check.mjs` 注释示例修正；两处既有验证稳定性修复——L1 CDP 预算 300000 → **420000** 毫秒
（302 秒、全部断言通过时被旧上限以 exit 124 终止）、T10 CDP 焦点恢复断言改条件收敛等待（不弱化）。
最终 `npm run verify -- --timeout=1500` 退出 **0**：49 套件全绿（L1 354/0、T10 107/0、T7a 53/0），
`cleanupComplete=true`、`timeout=false`，证据 `artifacts/verify/2026-10-09T03-17-02-163Z-85829183/`；
细节见 [Q1 交接文档](q1-dev-check-tiering.md) 末节。

用户明确指派的 **T12a 布拉姆的关系短篇已完成（2026-10-05/06，done）**，见 [行为、兼容、验证/清理、试玩与剩余工作](t12a-companion-story.md)。
交付「猎犬谷的行囊 / The Pack of Hound Hollow」：绑定真实 bram 同伴的单图三选择多结局短篇（`content/brams-pack/`，
选择表见 [STORY.md](../content/brams-pack/STORY.md)）。故事线需要布拉姆同行（准备页标记与出发门控、服务端
400 双语拒绝，不自动招募/不查忠诚度）；三处选择的忠诚度有涨有跌（+3/+1、+8/+2 与 persuade 失败的 −3 分歧结局），
本局场景面板、回城角色页与二次出发的开局问候都展示引擎已确认的布拉姆反应。旧杀怪个人任务与
`char.companionQuests` 字段原样保留，故事使用独立 `storyId=brams-pack` 命名域；T6/T11 旧协议、旧档与旧包兼容，
无 schema 版本/稳定 ID/规则数值改动。最终 `npm run verify -- --timeout=1200` 退出 **0**，eslint/tsc/**47 套件**（Q1a 更正口径为 48）/smoke
全绿，T12a 集成 **11 场景/326 断言**、CDP **192/0**；30 组双语横向 PNG/DOM 已实际查看，容器已清理且未超时。
证据 `artifacts/verify/2026-10-06T03-56-22-102Z-5b252751/`。接手时全部未提交成果保留；未 commit/push/改版本/发版，
未领取 T13。（验证期间按任务要求把既有随机/时序问题改为确定性处理：smoke 的 plain-goblin 夹具改为有界重采样、
T9c 手机截图滚动+测量合并为单次同步脚本、M1/T8/T9c 内容清单计数随新包更新；引擎新增 `unblockSceneDoors`
保底，防止同伴停在场景门口两格瓶颈把玩家封路。）

用户授权的 **H1 游戏操作区稳定性收尾已完成（2026-10-04，done）**，见 [行为、兼容、验证/清理、试玩与剩余工作](h1-hud-stability.md)。游戏操作区（侧栏/coreHud/遭遇工具/任务浮层/先攻条/背包弹窗）改键控 DOM 调和：辅助 describe/画像/轮询返回时仍有效的按钮节点、键盘焦点与进行中的指针按下全部保留，宿主常驻控件原位修补永不移动（Chromium 在按住节点被 detach 时丢 click——这是 V1b 确定性丢点击证据的根因）；失效按钮照服务端状态变灰且按不出，无补发无重发。新增 32 项确定性 CDP 回归（按下→被拦住的 describe→抬起→恰一次攻击；焦点、双语、失效按钮、离页、结算锁）并翻转 T11 竞态证明为修复后断言。旧 HUD 文字"左缘裁切"确认为测试镜像缺 emoji 字体的 tofu 呈现（第 7/9/10/11 轮像素一致），已给 `Dockerfile.test` 补 `fonts-noto-color-emoji`。最终 `npm run verify -- --timeout=1200` 退出 **0**，eslint/tsc/**46 套件（17 CDP）**/smoke 全绿，H1 CDP **32/0**、T11 **139/0**；四张 PNG/DOM 已实际查看与点击，容器已清理且未超时。证据 `artifacts/verify/2026-10-05T07-17-18-940Z-aa4d736b/`。接手时全部未提交成果保留；引擎/规则数值/稳定 ID/版本未改，无需 balance，未 commit/push/发布。T12/T13 未领取（T12a 随后另行指派，见顶部）；t7a 的 ambush 偶发（约 0.8%，Math.random 无种子）与 V1b 时序抖动为既有问题，见交接剩余问题。

用户授权的 **V1 第二段已完成（2026-10-04，done）**，见 [行为、兼容、验证/清理、试玩与剩余工作](v1b-visual-packs.md)。有限 GLB 包/完整资源导出、桌面预览、英雄/怪物绑定及独立动画/缓存生命周期已交付。最终 `npm run verify -- --timeout=1200` 退出 **0**，eslint/tsc/45 套件（16 CDP）/smoke 全绿；五张 PNG/DOM 已实际查看与点击，容器已清理且未超时。证据 `artifacts/verify/2026-10-05T01-13-43-929Z-243e1475/`。接手的 133 条未提交成果保留；规则数值/稳定 ID/应用版本未改，无需 balance，未 commit/push/发布。T12/T13 未领取；下方第一段验收及第二段未领取字样为历史记录，旧 HUD 观察见交接剩余边界（丢点击与裁切两项现已由 H1 关闭）。

## 最新游玩反馈（2026-10-04）

**V1 第一段已完成（2026-10-04，done）**：[行为、兼容、验证/清理、试玩与剩余工作](v1a-visual-instance.md)。统一视觉实例、默认程序适配、英雄/骷髅代码小样与生命周期；完整 `npm run verify -- --timeout=1200` 退出 **0**，eslint/tsc/**42 套件（15 CDP）**/smoke 全绿，新增单元 **40/0**、CDP **44/0**，四组 PNG/DOM 已实际查看与点击，容器已清理、未超时。证据 `artifacts/verify/2026-10-04T20-13-01-007Z-864d186f/`。本轮不改引擎/规则数值/稳定 ID/版本，无需 balance，未 commit/push/发布；第二段 GLB/视觉包/管理绑定、T12/T13 未领取。下面 M1/L1 及 T9a–T11/补修全部未提交成果保留。

**L1 已完成（2026-10-04，done）**：[行为、兼容、验证/清理、试玩与剩余工作](l1-landscape-fullscreen.md)。该轮仅 L1：横向区域三栏、原生 SVG 标记/长名称、短高度浮层与独立浏览器全屏，复用 i18n、公开目录、T10 与导航/renderer 生命周期。完整 `npm run verify -- --timeout=1200` **退出 0**，eslint/tsc/**40 套件（14 CDP）**/smoke 全绿，L1 **354/0**；四横向尺寸/两语言及 28 组新增 PNG/DOM 已实际查看与点击，容器已清理、未超时。证据 `artifacts/verify/2026-10-04T16-40-01-041Z-c65b7e5c/`。保留 M1 与 T9a–T11/补修全部未提交成果；规则数值/稳定 ID/包格式不改，不追加 balance，不提交/改版本/发布；该轮 V1/T12/T13 未领取。

**M1 已完成（2026-10-04，done，先前验收）**：[交接、兼容与试玩](m1-adventure-directory.md)。城镇与准备页共用注册表公开冒险目录，支持搜索/来源/原文提示和可选区域 waypoint/道路；旧包无 metadata 可玩，活动快照与一次结算保留。完整 `npm run verify -- --timeout=1200` 退出 **0**，eslint/tsc/39 套件（13 CDP）/smoke 全绿；M1 集成 22 cases / 123 assertions、CDP 202/0，16 组新增 PNG/DOM 已实际查看与点击，容器已清理。证据 `artifacts/verify/2026-10-04T14-06-25-617Z-11f292fe/`。该轮仅 M1；后续 L1 结果见顶部，该轮 V1/T12/T13 未指派。无规则数值变化，不追加 balance；全部既有未提交成果保留，不提交/改版本/发布。

**地图入口补修已完成（done，M1 指派前的历史验收）**：城镇区域地图/地下城选择图标丢失已定位为 SVG 文字插入 HTML span；已修并增加真实点击回归。完整 `npm run verify -- --timeout=1200` 退出 **0**，eslint/tsc/37 套件（12 CDP）/smoke 全绿，新增地图 95 项（Review CDP 202/0），已实际查看 PNG/DOM，容器已清理。证据 `artifacts/verify/2026-10-04T06-02-00-897Z-9155f551/`。后续新增 UI 以横向桌面为主，暂不做手机专用优化；该补修未调整冒险内地图。[现状、模块与提示词](../docs/MAP_AND_VISUAL_MOD_PLAN_2026-10-04.md)：后续授权的 M1/L1 完成结果见顶部，该时点 V1 模型/动作包尚未指派。不自动开始 T12/T13，不提交或发布；保留原队列全部成果。

## 下一轮（2026-10-03）：双语、地图优先、分支故事

**授权补修已完成（2026-10-04，done）**：[复核报告三项](../docs/T9_T11_REVIEW_2026-10-03.md) 已关闭：统一路由失效/cleanup、HP 幂等及真实升级、锁箱/陷阱/主线结算 descriptor。先加入确定性复现，最终 `npm run verify -- --timeout=1200 --balance-runs=50` 退出 **0**，eslint/tsc/37 套件（12 CDP）/smoke/balance 全绿；HP 10/0、新增 CDP 107/0，12 组新增 PNG/DOM 已实际查看，容器已清理。证据 `artifacts/verify/2026-10-04T04-22-56-094Z-bc96d5aa/`。保留五项全部未提交成果；历史污染 HP 未批改、范围外首页存档状态徽标观察及真人/真实 AI 试玩边界见报告，不自动开新任务或发布。

**原始独立复核（历史，问题现已关闭）**：[报告与失败证据](../docs/T9_T11_REVIEW_2026-10-03.md)。原完整 Docker verify 退出 1，34/35 套件通过；T11 快速回城→角色页暴露异步路由覆盖，另确认既有 HP 重算问题与双语文字遗漏。原始及补修中的失败证据保留；以下五项为主体开发完成记录，当前补修验收以顶部为准，不自动开始 T12/T13 或发布。

用户分别授权 T9a、T9b、T10，随后授权继续 T9c 和开始 T11；五项均已完成并验证。T11 最终 Docker verify 退出 0，35 套件（11 CDP）/smoke 全绿；单图、两 NPC、三处选择、三种结局和持久后果交付。T1–T8 已发布在 1.10.0；保留 T9a/T9b/T10/T9c/T11 全部未提交成果，本轮不包含发布。完全陌生的 agent 按 [新交接指南](../docs/NEXT_ROUND_HANDOFF.md) 与 T11 实际交接接手。

| 建议顺序 | ID / 规格 | 状态 | 前置 | 玩家得到什么 |
|---|---|---|---|---|
| 0 | [T9a 双语基础](t9a-localization-foundation.md) | done（2026-10-03） | 当前 1.10.0 | 语言偏好、共同资源、导航/显示设置切换；29 套件/smoke 全绿 |
| 1 | [T9b 完整界面双语](t9b-interface-localization.md) | done（2026-10-03） | T9a | A/B/C 固定界面双语；30 套件/8 CDP/smoke 全绿，137 项双语界面回归 |
| 2 | [T10 地图优先与轻量浮层](t10-map-first-floating-ui.md) | done（2026-10-03） | T9a；推荐 T9b | 默认大地图、单浮层、手机抽屉；31 套件/9 CDP/smoke 全绿，104 项 T10 回归及四尺寸双语截图 |
| 3 | [T9c 内容/日志/AI 双语](t9c-content-log-ai-localization.md) | done（2026-10-03） | T9a；推荐 T9b | 七张地图/规则/故事/日志/AI/TTS 同语言；33 套件/10 CDP/smoke 全绿，14 场景、154 项内容浏览器回归 |
| 4 | [T11 分支短篇](t11-branching-short-adventure.md) | done（2026-10-03） | T6/T8/T9b/T9c；推荐 T10 | 失踪信使、三处选择/三种结局、失败推进与持久后果；35 套件/11 CDP/smoke 全绿，11 集成场景/350 断言、134 项浏览器检查 |
| 5 | [T9a–T11 复核三项补修](../docs/T9_T11_REVIEW_2026-10-03.md) | done（2026-10-04） | 保留以上五项全部成果 | 路由初始化不覆盖新页/cleanup、HP 重算幂等、动态标题/主线双语；37 套件/smoke/balance 全绿 |
| 6 | [T12a 布拉姆的关系短篇](t12a-companion-story.md) | done（2026-10-06，用户明确指派） | T6/T8/T9b/T9c/T11/M1 | 猎犬谷的行囊：真实 bram 同伴、三处选择、多结局与有涨有跌的忠诚；48 套件（Q1a 更正口径）/smoke 全绿，11 集成场景/326 断言、192 项浏览器检查、30 组双语 PNG/DOM |
| 7 | [Q1 开发检查与完整验收分层](q1-dev-check-tiering.md) | done（2026-10-07，用户明确指派；含 Q1a 验收补修） | T12a 基线 | `npm run check` 快速部分验证（fail-fast、可选浏览器套件、结构化耗时）与 verify 分层；退出码契约+故障注入回归；t7a/V1b 偶发确定性修复；49 套件全零失败 |

默认串行：T9a/T9b/T10/T9c/T11、另行指派的 T12a 与 Q1 已完成，保留共同的 play/settings/i18n/内容展示与同伴故事契约、
`npm run check`（部分验证）/`npm run verify`（验收）分层入口及全部未提交成果；先收试玩反馈。涉及公共目录的工作需明确归属。T13 自由输入仍是候选，没有可执行指派；不自行 commit/push/改版本/发布。

## 上一轮（1.10.0 已发布，历史结果）

维护日期：2026-10-03。T1–T4a 已复核；T5/T5a 通过；T7/T7a 已补完 [2026-10-02 复核](../docs/T5A_T7A_REVIEW_2026-10-02.md) 的四条剩余项并关闭。T8 与用户授权续做的 T6 均已完成并验证。下面是本轮执行顺序与结果。

新 agent 先读 [START_HERE](../START_HERE.md)。背景与评估见 [设计说明](../docs/GAME_DESIGN.md) 和 [项目评估](../docs/PROJECT_REVIEW_2026-09-30.md)。

## 主线任务

| 顺序 | ID / 规格 | 状态 | 前置 | 玩家得到什么 |
|---|---|---|---|---|
| 1 | [T1 开局入口与接口类型](t1-start-options.md) | done（2026-09-30） | 无 | 地图、难度、同伴与选择一致 |
| 2 | [T2 状态更新与 AI 持久化](t2-state-and-ai.md) | done（2026-09-30） | T1 推荐先完成（已完成） | 慢 AI 不回滚操作，旁白可重读 |
| 2a | [T2a 状态采纳与 NPC 记忆补修](t2a-state-boundaries.md) | done（2026-09-30） | T1/T2 现有实现（已完成） | 旧轮询不回退画面，并发对话不丢记忆 |
| 3 | [T3 一次结算与回城](t3-settlement.md) | done（2026-09-30） | T2、T2a | 奖励保存明确，旧结算不重复处理 |
| 3a | [T3a 结算边界补修](t3a-settlement-boundaries.md) | done（2026-10-01） | T2a/T3 现有实现 | 旧档新结局正常入账、重试镜像正确、键盘锁定有效 |
| 4 | [T4 全程目标与下一步](t4-player-guidance.md) | done（2026-10-01，T4a 验收通过） | T1–T3 | 知道去哪、做什么、为什么继续 |
| 4a | [T4a 完成动作与继续入口](t4a-guidance-outcomes.md) | done（2026-10-01） | T3/T3a、T4 现有实现 | 跟随提示能推进主线，有活动局时优先继续 |
| 5 | [T5 快速开始与首次体验](t5-first-adventure.md) | done（2026-10-02，T5a 补齐后关闭） | T4（含 T4a 验收） | 可以先玩，按需理解创建选项 |
| 5a | [T5a 推荐英雄职业技能补齐](t5a-preset-skills.md) | done（2026-10-02） | 当前 T5 实现 | 推荐英雄拥有规则已有的完整技能选择 |
| 6 | [T6 有记忆与后果的遭遇](t6-remembered-encounter.md) | done（2026-10-03） | T2–T4、T8（均完成） | 山谷哨门两路线、真实后果与回城后的记忆；27 套件/smoke/balance 全绿 |

## 另行指派的支持任务

| ID / 规格 | 状态 | 前置 | 何时处理 |
|---|---|---|---|
| [Docker 专用测试环境](docker-test-environment.md) | done（2026-10-02） | Docker Desktop Linux containers | 自动验证统一容器内执行、资源限制、互斥与失败留证 |
| [T7 引擎统一检定裁决](t7-server-checks.md) | done（2026-10-02，T7a 剩余验收补完后关闭） | T2，涉及结算则 T3 | 为锁箱、拆陷阱、路遇落实已有裁判规则；新遭遇直接在引擎判定 |
| [T7a 路遇实例恢复与检定提示](t7a-road-and-check-feedback.md) | done（2026-10-02） | 当前 T5/T7 整合实现 | 补离页响应、恢复后的开局失败重试、冒烟基线与准确计数 |
| [T8 内容包校验与扩展准备](t8-content-validation.md) | done（2026-10-03） | 无；按新的协议追加验证 | 25 套件与 smoke/balance 全绿，T8 51 场景/180 断言；已由 T6 追加 scene 检查 |

T1/T2/T3 的四个问题已经在隔离环境复现；重新接手时仍应先检查当前代码是否已由别人修好。
T1、T2、补修 T2a 与 T3 已实现（2026-09-30），T3a 完成并通过独立复核（2026-10-01）；T4 与 T4a 已复核。T5/T5a 通过；T7/T7a 已补完 2026-10-02 复核剩余项并关闭。T8 与 T6 已于 2026-10-03 验证完成。上一轮队列已完成；不重开 T5a 或新增 T7b。当前指派见顶部下一轮。

## 状态与完成规则

- planned：未开始。
- in_progress：已开始；记录本次具体范围和未完成项。
- done：实现、验收和 AGENTS 要求的验证全部完成，结果已记录。
- 需要外部条件时保持真实状态，并说明具体阻碍与下一步；不要写 done。

完成时同步对应规格的“交接结果”、本队列表及 PROJECT_STATE 顶部。不把做完一项解释成获准继续其余任务。

## 历史规格

PWA、原 ASI 特长批次、CDP 根因排查、MCP、存档版本化已实现。对应旧文件仅作参考：

- [pwa-offline-cache.md](pwa-offline-cache.md)
- [more-asi-feats.md](more-asi-feats.md)
- [cdp-flaky-investigation.md](cdp-flaky-investigation.md)
- [mcp-server.md](mcp-server.md)
- [save-schema-version.md](save-schema-version.md)

历史规格中的旧候选和目标不是当前待办。新任务用 [TEMPLATE.md](TEMPLATE.md)。
