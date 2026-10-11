# 从这里接手 AI Dungeon

**2026-10-11 T14/T13a/T15a/T15b 独立复核补修 R1–R9 已实现，待独立复核（本轮不做发版）**：按
`G:\ai_DND_handoffs\release-1.11-20261010\REVIEW_T14_T15_2026-10-11.md` 的九条真实失败逐项关闭，
逐项闭环、改动清单、套件计数与真人试玩步骤见
[复核补修记录](docs/REVIEW_T14_T15_FIXES_2026-10-11.md)。要点：草稿路径/身份边界与越权哨兵回归（R1）、
克隆重映射真实资源引用并"导出 → 隔离环境导入 → 两章真实通关"（R2）、试玩内容快照隔离且重启可恢复（R3）、
服务端铸造试玩身份与确定生命周期（R4）、脏状态保护与"导出当前编辑"（R5）、按钮与句子共用唯一权威执行器（R6）、
模型候选复用服务端可见性规则（R7）、门瓦片/实体/场景引用一致与刷保护（R8）、T15a 承诺的无代码选择表单补齐 +
界面双语与文档口径（R9）。只修既有功能与缺失验收，未新增职业/大型内容/框架，未改规则数值（不追加 balance）。
套件注册数 **65（11 unit / 31 integration / 23 browser）**，复核基线 57（11/24/22）；本轮新增 7 个集成套件与
1 个浏览器套件，未删除或合并任何既有套件。**两次真人体验（新玩家走双章 / 从克隆改内容导出导入通关）仍待项目
拥有者确认**，真实 AI 联调不在本轮范围。保全：HEAD 仍为 `89f78d3`，未 commit/push/改版本/tag/发版，未 reset/clean，
动手前整仓快照在 `G:\ai_DND_backups\20261011T051416Z-review-fix-111\`。此前 T14/T13a/T15a/T15b 的实现结果见
[任务队列](tasks/README.md) 顶部四段与 [PROJECT_STATE.md](PROJECT_STATE.md)。

用户明确指派的 **Q1 开发检查与完整验收分层及 Q1a 验收补修已完成（2026-10-07，done）**，见 [行为、兼容、验证、测量与剩余工作](tasks/q1-dev-check-tiering.md)。
新增 `npm run check`：Docker 内快速**部分**验证——eslint → tsc → 全部单元/集成套件 **fail-fast**，
`npm run check -- --browsers=companion-story-cdp,hud-stability` 显式选择 CDP 套件、`--list` 列清单；
与 `npm run verify` 共享同一镜像、容器名互斥锁（占用 73）、2 CPU/4 GiB、网络与数据隔离、容器清理，
证据带 PARTIAL 标记落 `artifacts/check/`；`scripts/test-suites.mjs` 是 **49 套件**（unit 11 +
integration 20 + browser 18）的单一清单（id + 分层），verify 与 check 共同消费——默认 check 列出
其中 31 个单元/集成套件（dev-check-faults 显示 SKIP、实际执行 30 个），选中的浏览器套件按实际
选择追加。两个入口输出结构化耗时
（宿主总时间/构建/各步骤/逐套件/截图/清理 → `timings.json` + `suite-timings.json`）。
verify 的套件集合、冒烟、截图与失败清点不变——**check 是开发信号，完成验收仍然只有 verify**，
报告里不得混称。Q1a 修复了 dev-check 的退出码契约（修复前 eslint/tsc/服务启动失败会以 exit 0 打印
PASSED——任何失败路径现在一律非零且无 PASSED 横幅），并新增容器内故障注入回归套件
`dev-check-faults`（六用例 22 断言，check 内自跳过防递归，verify 内全量运行）；
文档浏览器 id 示例已修正为合法 id。按任务要求确定性关闭两项既有偶发：t7a CDP 的无种子 12 次重掷
（~0.8% 掷空）改为引擎同形实例直接 staged（零 RNG）；V1b CDP 的 hit 立即读改为条件等待后断言
（不弱化）。实测（artifacts 日志）：默认 check 容器内 **29.69s**、宿主 **33.49s**（构建 2.17s，
镜像缓存命中）；独立快速复核（2026-10-09，`--browsers=hud-stability`，镜像重建）容器 50.98s、
构建 61.81s、宿主 114.06s（H1 CDP 32/0）；verify 全量 **≈21.5 分钟**（1200s 预算在高负载时段不足，已改用并建议 `--timeout=1500`）。
最终完整 verify 退出 **0**：eslint/tsc/**49 套件**/smoke 全绿，全部 CDP 零失败（含 V1b 51、T7a 52、
Q1a 故障注入 6/0），`cleanupComplete=true`、`timeout=false`，容器已清理；证据
`artifacts/verify/2026-10-07T03-11-06-475Z-68fed60a/`。未改游戏玩法/数值/稳定 ID；接手时全部未提交
成果保留；未 commit/push/改版本/发版，未领取 T13。此前的 T12a 结果见下一段。
**2026-10-09 复核收尾轮（done）**：Q1/Q1a 文档口径同步（49/31/30、耗时与证据均按 artifacts 日志）
外加两处既有验证稳定性修复——L1 CDP 预算 `timeoutMs` 300000 → **420000**（在 302 秒、全部断言仍
通过时被 300 秒上限以 exit 124 杀掉），T10 CDP 焦点恢复断言改为条件收敛等待（不弱化）；最终 verify
退出 **0**（L1 354/0、T10 107/0），证据 `artifacts/verify/2026-10-09T03-17-02-163Z-85829183/`，详见
[Q1 交接文档](tasks/q1-dev-check-tiering.md) 末节。

用户明确指派的 **T12a 布拉姆的关系短篇已完成（2026-10-06，done）**，见 [行为、兼容、验证/清理、试玩与剩余工作](tasks/t12a-companion-story.md)。
交付「猎犬谷的行囊 / The Pack of Hound Hollow」：`content/brams-pack/` 单图三选择多结局短篇，第一处选择的对话者是
**真实 bram 同伴实体**（`companion: true` 场景，无同名 NPC 冒充）；故事线需要布拉姆同行（准备页/城镇目录
"需要同伴"标记与出发门控、服务端 400 双语拒绝，不自动招募、不花资源、不查忠诚度）；三处选择的忠诚度有涨有跌
（+3/+1、+8/+2、persuade 成功 +2 / 失败 −3 的分歧结局），本局场景面板显示布拉姆反应卡与忠诚变化，回城角色页
显示结局+反应+实际消耗，二次出发时开局问候与场景记忆引用上次真实结局（记忆不解锁新局，另一英雄不继承）。
旧杀怪任务与 `char.companionQuests` 原样保留，故事使用独立 `storyId=brams-pack` 命名域；T6/T11 旧协议、旧档、
旧包兼容，无 schema/稳定 ID/规则数值改动；协议扩展（story.companion / companion 场景 / reactions 同伴键 / 有限
loyalty）全部纳入 T8 校验并已同步 [MODDING](MODDING.md) 与 [ARCHITECTURE](ARCHITECTURE.md)。最终
`npm run verify -- --timeout=1200` 退出 **0**：eslint/tsc/**48 套件**（Q1a 更正口径，原报告 47 系 grep 少计）/smoke 全绿，T12a 集成 **11 场景/326 断言**、
CDP **192/0**；30 组双语横向 PNG/DOM 已实际查看，`cleanupComplete=true`、`timeout=false`，容器已移除。证据
`artifacts/verify/2026-10-06T03-56-22-102Z-5b252751/`。验证期间按任务要求把既有随机/时序测试改为确定性处理
（smoke plain-goblin 夹具改有界重采样、T9c 手机截图滚动+测量合并单次同步脚本、M1/T8/T9c 内容清单计数随新包更新），
引擎新增 `unblockSceneDoors` 保底防止同伴停在场景门口瓶颈封路。接手时全部未提交成果保留；未 commit/push/改版本/发版，
未领取 T13；t7a ambush 偶发与 V1b 时序抖动仍为既有问题。T12a 之前的 H1 结果见下方历史段。

用户授权的 **H1 游戏操作区稳定性收尾已完成（2026-10-04，done）**，见 [行为、兼容、验证/清理、试玩与剩余工作](tasks/h1-hud-stability.md)。游戏操作区改键控 DOM 调和（新模块 `public/js/views/play/hud-patch.js`）：辅助 describe/画像/轮询返回时仍有效的按钮节点、键盘焦点与进行中的指针按下全部保留，宿主常驻控件原位修补永不移动（Chromium 在按住节点被 detach 时丢 click——V1b 确定性丢点击证据的根因，现已修复并翻转该证据）；失效按钮照服务端状态变灰，无补发无重发；结算锁/地图/相机/输入草稿/浮层/全屏原样。新增 H1 CDP 32 项确定性回归（含按下→被拦住的 describe→抬起→恰一次攻击），T11 竞态证明翻转为修复后断言。旧 HUD 文字"左缘裁切"确认为测试镜像缺 emoji 字体的 tofu 呈现，`Dockerfile.test` 已补 `fonts-noto-color-emoji`。最终 `npm run verify -- --timeout=1200` 退出 **0**，eslint/tsc/**46 套件（17 CDP）**/smoke 全绿，H1 CDP **32/0**、T11 **139/0**；四张 PNG/DOM 已实际查看与点击，容器已清理且未超时。证据 `artifacts/verify/2026-10-05T07-17-18-940Z-aa4d736b/`。接手时的全部未提交成果保留；规则数值/稳定 ID/应用版本未改，无需 balance，未 commit/push/发布。T12/T13 未领取（T12a 随后另行指派并已完成，见顶部）；t7a ambush 偶发与 V1b 时序抖动为既有问题（见交接剩余问题）。

用户授权的 **V1 第二段已完成（2026-10-04，done）**，见 [行为、兼容、验证/清理、试玩与剩余工作](tasks/v1b-visual-packs.md)。有限 GLB 包/完整资源导出、桌面预览、英雄/怪物绑定及独立动画/缓存生命周期已交付。最终 `npm run verify -- --timeout=1200` 退出 **0**，eslint/tsc/45 套件（16 CDP）/smoke 全绿；五张 PNG/DOM 已实际查看与点击，容器已清理且未超时。证据 `artifacts/verify/2026-10-05T01-13-43-929Z-243e1475/`。接手的 133 条未提交成果保留；规则数值/稳定 ID/应用版本未改，无需 balance，未 commit/push/发布。T12/T13 未领取；下方第一段验收及第二段未领取字样为历史记录，旧 HUD 观察见交接剩余边界（丢点击与裁切两项现已由 H1 关闭）。

这份入口给第一次接触仓库的开发者和 coding agent。维护日期：2026-10-04。

用户另行指派的 **V1 第一段已完成（2026-10-04，done）**：视觉实例接口、默认程序模型适配、英雄/骷髅代码小样、已确认动作去重与资源生命周期，见 [行为、兼容、验证/清理、试玩与剩余工作](tasks/v1a-visual-instance.md)。完整 `npm run verify -- --timeout=1200` 退出 **0**，eslint/tsc/**42 套件（15 CDP）**/smoke 全绿，新增单元 **40/0**、CDP **44/0**；四组 PNG/DOM 已实际查看与点击，容器已清理且未超时。证据 `artifacts/verify/2026-10-04T20-13-01-007Z-864d186f/`。第二段资源包/GLB/管理绑定、T12/T13 未领取；保留下列全部未提交成果，本轮不改引擎/规则/稳定 ID/包格式/版本，无需 balance，未 commit/push/发布。

此前接手结果：用户明确指定的 **L1 横向桌面与全屏已完成**，见 [行为、兼容、验证/清理、试玩与剩余工作](tasks/l1-landscape-fullscreen.md)。区域三栏、原生 SVG 标记/长名称、短高度浮层和独立全屏复用 i18n、公开目录、T10 与导航/renderer 生命周期。完整 Docker `npm run verify -- --timeout=1200` **退出 0**，eslint/tsc/**40 套件（14 CDP）**/smoke 全绿，L1 **354/0**；四横向尺寸/两语言、28 组新增 PNG/DOM 已实际查看和点击。证据 `artifacts/verify/2026-10-04T16-40-01-041Z-c65b7e5c/`，容器已清理且未超时。M1 和 T9a–T11/补修的全部未提交成果保留；不改规则数值/稳定 ID/版本，无需 balance。该轮 V1/T12/T13 未领取，不 commit/push 或发布。下方 M1 是此前已完成结果。

此前接手结果：用户指定的 **M1 地图包正常入口已完成**，[交接与试玩](tasks/m1-adventure-directory.md)。城镇/准备页共用公开目录，旧包可列表出发，可选区域 metadata 复用 T8 校验/事务；引擎、稳定 ID、活动快照与一次结算不改。最终 Docker `npm run verify -- --timeout=1200` 退出 **0**，eslint/tsc/39 套件（13 CDP）/smoke 全绿；M1 集成 22 cases / 123 assertions、CDP 202/0，16 组新增 PNG/DOM 已查看并实际点击，容器已清理。证据 `artifacts/verify/2026-10-04T14-06-25-617Z-11f292fe/`。保留 T9a–T11 与补修全部未提交成果；随后另行授权的 L1 结果见顶部，该轮 V1/T12/T13 未指派。没有规则数值变化，不追加 balance；未 commit/push、改版本或发布。下方是此前补修与主体开发历史。

当前接手状态（2026-10-04）：用户授权的 [复核报告三项补修](docs/T9_T11_REVIEW_2026-10-03.md) 已完成。最终专用 Docker `npm run verify -- --timeout=1200 --balance-runs=50` 退出 0，37 套件（12 CDP）/eslint/tsc/smoke/balance 全绿，新增 HP 10/0、CDP 107/0，12 组新增 PNG/DOM 已实际查看，容器已清理；证据 `artifacts/verify/2026-10-04T04-22-56-094Z-bc96d5aa/`。保留 T9a/T9b/T10/T9c/T11 全部未提交成果、历史失败和玩家存档；不重做或自动开始 T12/T13、不提交或发布。剩余边界和范围外观察以报告及 PROJECT_STATE 顶部为准，下方 T11 35 套件为主体开发历史。

## 项目目标与当前任务

这是一个个人爱好项目：单人 D&D 2024 网页游戏，本地部署，AI 可选，支持内容扩展。用户当前的核心反馈是“功能已经很多，但体验不顺、不知道该玩什么”。

上一轮完成顺畅冒险、目标引导与有记忆的遭遇，已发布 1.10.0。新一轮用户偏好故事/选择/角色扮演，同时要求简体中文/英文分开、地图更大、功能采用轻量浮层。执行模块与提示词见 [下一轮交接](docs/NEXT_ROUND_HANDOFF.md)：T9a 双语基础、T9b 完整固定界面、T10 地图优先、T9c 内容/日志/AI 双语和随后授权的 T11 分支短篇均已完成。T11 为单图、两 NPC、三处选择、三种结局与持久后果；最终专用 Docker `npm run verify -- --timeout=1200` 退出 0，eslint/tsc/35 套件（11 Chromium CDP）/smoke 全绿，T11 集成 11 场景/350 断言、CDP 134/0。证据 `artifacts/verify/2026-10-04T01-42-52-785Z-343bdb5a/`，容器已清理；24 组 T11 PNG/DOM，两语言桌面/手机公开与保护四路线已核对。范围、兼容、历史失败、加速计时条件、真人节奏待反馈及试玩见 [T11 交接](tasks/t11-branching-short-adventure.md) 和 [选择表](content/missing-courier/STORY.md)。此前 [T9c 结果](tasks/t9c-content-log-ai-localization.md)、[覆盖与术语](docs/T9C_LOCALIZATION_COVERAGE.md)及 [T10 结果](tasks/t10-map-first-floating-ui.md) 保留。接手保留 T9a/T9b/T10/T9c/T11 全部未提交成果，不重做、不自动续 T12/T13；版本仍为 1.10.0，未提交或发布。

当前代码版本见 `package.json`，为 1.10.0。T1–T4a 已实现并复核；T5/T5a 通过；两轮独立复核（[2026-10-01](docs/T5_T7_REVIEW_2026-10-01.md)、[2026-10-02](docs/T5A_T7A_REVIEW_2026-10-02.md)）发现的问题均由 [T5a](tasks/t5a-preset-skills.md) / [T7a](tasks/t7a-road-and-check-feedback.md) 补修关闭（2026-10-02：离页注销视图身份、恢复后开局失败原地重试、冒烟权威基线与伏击胜→神社覆盖、CDP 包装器单发计数）。本轮 T8/T6 也已完成，用户已授权将这些改动发布为 v1.10.0，见 [发布说明](docs/RELEASE_NOTES_1.10.0.md)。最新进度以 PROJECT_STATE 和任务队列为准。

## 第一次接手的阅读顺序

1. [AGENTS.md](AGENTS.md)：必读硬约束、验证和协作规则。
2. [PROJECT_STATE.md](PROJECT_STATE.md)：先读顶部当前摘要、任务队列和已知问题；后面的版本段落是历史记录。
3. [游戏设计说明](docs/GAME_DESIGN.md)：理解玩家目标和本轮取舍。
4. [任务队列](tasks/README.md)：定位用户指定任务，读取对应完整规格。
5. [ARCHITECTURE.md](ARCHITECTURE.md)：理解请求链路、状态形状、文件定位和历史坑位。
6. 本次任务涉及的实际代码和测试。只有内容任务再读 [MODDING.md](MODDING.md)。

要看建议的依据，读 [项目评估](docs/PROJECT_REVIEW_2026-09-30.md)。历史评估里的文件行号可能随开发变化，以函数名和当前代码定位。

给项目拥有者的逐步操作及复制提示词见 [交接操作指南](docs/AGENT_HANDOFF.md)。

## 已有内容：先复用

- 角色创建、12 职业、10 种族、等级上限 12、升级与特长、装备与词缀、战斗与探索。
- 八张静态地图：crypt、drowned-vault、howling-hills、sewers、mill、roost、vale-gate（山谷哨门）、courier-crossing（渡口的失踪信使）；另有无尽深渊与每周试炼。
- 城镇补给、招募、悬赏、赌桌、魔药、锻造、图鉴与荣誉榜。
- 四幕主线、三位同伴的忠诚度与个人任务、AI 旁白/对话/回顾、语音和 3D/2D 渲染。
- JSON 内容包、存档迁移、seeded RNG、回放机器人、零依赖 MCP、完整验证。

不要重新实现 PWA、存档版本化、Crusher/Slasher/Piercer、同伴忠诚或四幕主线。

## 运行方式

仓库根目录是当前会话的工作区；项目拥有者的电脑上为 `G:\ai_DND`。换机器后使用实际路径。

本地运行游戏需要 Node.js >=20、npm；自动验证另需 Docker Desktop Linux containers，开发依赖与 Chromium 由测试镜像提供。游戏开发已存在 `node_modules` 时先使用现有依赖；需要安装时运行 `npm install` 并检查意外产生的依赖文件改动，不主动升级依赖。

```powershell
Set-Location 'G:\ai_DND'
npm start
```

默认游戏地址 `http://localhost:3000`。自动验证统一在专用 Docker Desktop Linux 测试容器内运行：

```powershell
npm run verify
```

入口自动构建 `Dockerfile.test`（开发依赖、完整测试、Chromium），固定 2 CPU / 4 GiB RAM，
服务端和全部 CDP e2e 都在容器内。固定容器名保证所有 agent 同时最多一轮完整验证；占用返回 73。
玩家 `data/` 与模型配置不进入镜像也不挂载，真实 AI 和外网关闭，测试使用容器独立 `DATA_DIR`。
每轮成功/失败/超时均移除容器；日志、失败截图和退出码保留在 `artifacts/verify/`。
缺浏览器/WebGL2 必须失败；Windows 环境问题先报告，禁止回退宿主机浏览器。
安装路径、时限和故障诊断见 [Docker 测试指南](docs/DOCKER_TESTING.md)。

## 代码导航与重要边界

| 需要处理什么 | 从哪里读起 |
|---|---|
| 浏览器 API 调用与开局选项 | `public/js/api.js`、`views/play.js`、`views/overworld.js`、`views/overworld/districts.js` |
| 开始游戏、行动、AI 结果 | `server/routes/game.js`、`server/game/dm.js`、`server/llm/client.js` |
| 骰子、战斗、地图交互、胜利、升级 | `server/game/engine.js` |
| 档案、地牢存档、迁移 | `server/store.js` |
| 城镇与地牢结算 | `server/routes/city.js`、`public/js/views/play/panels.js` |
| 主线目标与推进 | `server/game/campaign.js`、`public/js/app.js` |
| 内容包与地图 | `server/game/content.js`、`shared/`、`content/` |
| 自动验证与浏览器检查 | `scripts/verify.mjs`、`scripts/test-all.mjs`、`tests/e2e/` |

当前角色档案和 `state.character` 是两份数据；后者是地牢快照。修改一份不等于另一份已同步。结算、城镇修改和异步 AI 请求会涉及这个边界，必须读实际实现。

AI 是可选表达层；未来意图提案也需要引擎验证。T7/T7a 已把锁箱/拆陷阱/路遇裁决、只读检定预览与路遇恢复收敛到服务端权威协议，新功能复用现有边界。

## 执行与交付

- 先 `git status --short`，保留现有改动。交接文档可能尚未提交，不能清理掉。
- 只做用户指定任务及其必要修复；一般实现选择自行决定，勿停留在计划。
- 基线异常与自己的改动分别记录。完工后 `npm run verify` 必须全绿；数值变化另跑 balance-sim；客户端改动必须真实浏览器查看。
- 更新对应 task 的状态和结果，再更新 PROJECT_STATE。架构/接口变化同步 ARCHITECTURE，模组协议变化同步 MODDING。
- 完成报告要说明玩家可感知变化、验证、手动试玩路径、未完成项。测试未通过时不能标 done。
- commit、push、修改版本、tag 和发版遵守 AGENTS 的授权规则。本轮任务不包含发布。

T8 与用户授权续做的 T6 均于 2026-10-03 完成，1.10.0 已发布。历史最终 Docker 验证 27 套件（6 CDP）/smoke/balance 全绿，容器清理完成。山谷哨门两路线与回城后记忆见 tasks/t6-remembered-encounter.md；内容扩展见 MODDING。当前任务和后续依赖以 tasks/README 顶部为准，不重新实施历史任务。

此前分工、基线与整合记录见 [并行交接指南](docs/T5_T7_PARALLEL_HANDOFF.md)；最新结论以 2026-10-02 独立复核为准。
