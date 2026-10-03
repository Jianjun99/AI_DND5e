# PROJECT STATE（AI Dungeon — 给后续会话的状态快照）

> 本文件是给 AI 助手/开发者看的项目状态快照。更新版本后请同步更新此文件。
> 架构与扩展方法见 `ARCHITECTURE.md`（含 cookbook）；模组格式见 `MODDING.md`。

## 当前摘要（2026-10-03）

- 当前代码版本：**1.10.0**，以 `package.json` 为准；用户已授权发布本轮的快速开始、全程引导、可靠结算、内容校验与山谷哨门记忆遭遇。发布说明见 `docs/RELEASE_NOTES_1.10.0.md`。
- 本轮 T8 与用户授权续做的 T6 均已完成（2026-10-03）：T8 为内容包两阶段校验、结构化诊断、预检 API/作者 CLI、导入替换/回滚、最小通关示例，修复发行地图坏坐标/营火 ID 与已有实体 Boss 标记；[详细结果](tasks/t8-content-validation.md)。T6 加入城镇区域地图可进入的“山谷哨门”：交回真实通行印可和平通过，或走现有 bandit 战斗路线；一次性引擎事实、回城档案合并、不同 NPC 记忆、服务器选项面板、AI 失败/迟到边界与 scene 协议校验；[结果与试玩](tasks/t6-remembered-encounter.md)。最终专用 Docker `npm run verify -- --balance-runs=50` 退出 0，27 套件（6 CDP）与 smoke/balance 全绿，T8 51 场景/180 断言，T6 9 场景/210 断言 + 39 CDP 断言；两路线各 50 次普通单人模拟完成率为和平 100% / 战斗 96%。`artifacts/verify/2026-10-03T05-22-00-971Z-9fa5e442/`，容器清理完成；本轮任务无未完成项。
- 自动验证环境（2026-10-02）：已建立专用 `Dockerfile.test` 与统一 `npm run verify` Docker 入口；
  固定 2 CPU / 4 GiB、容器名互斥、临时测试数据、关闭真实 AI/外网，服务端和 Chromium 都在容器内。
  Windows 用户目录 Docker Desktop 已实测；并发拒绝 73、超时 124 与真实游戏截图/容器清理通过。
  最终 eslint、tsc、24 套件（5 个正常 CDP e2e + 5 项环境回归）、smoke 与追加回放/模拟全绿，退出 0。
  日志/截图迁至 `artifacts/verify/`，完整说明见 [测试指南](docs/DOCKER_TESTING.md)与[任务结果](tasks/docker-test-environment.md)。
- 用户本轮目标：解决“功能很多，但体验不顺、不知道该玩什么”，串起一次冒险与下一目标。
- 首次接手入口：[`START_HERE.md`](START_HERE.md)；游戏方向：[`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)。
- 最新独立复核：[2026-10-02 报告](docs/T5A_T7A_REVIEW_2026-10-02.md) 的四条剩余项（离页后迟到响应仍弹旧路遇、刷新恢复后 start 失败丢失原地重试、smoke 金币基线、CDP 包装器双发计数）已于同日补完并验证：overworld cleanup 注销视图身份、恢复路径保留 start 结果可原地重试、smoke 改为献祭前权威基线并确定性覆盖“伏击胜→神社”、e2e 包装器单发并新增两条真实 UI 回归（生命周期套件 50 断言）；**T5/T5a/T7/T7a 均通过**，之后的 T8 → T6 也已完成。历史复核报告原样保留。
- 开发与整合历史（其中“关闭/全绿”是开发阶段记录，以顶部最新独立复核为准）：**T1、T2、补修 T2a、T3、T3a、T4 及 T4a 补修已完成（2026-10-01，本轮纳入 v1.10.0）**——T1：开局准备页的地图/难度/
  同伴选择真实生效，`api.startGame` 统一为显式 options 对象并带类型，顺带修活每周试炼入口；
  T2：同档写入契约（rev + 同步读改写 + 模型等待出锁 + 字段级合并），慢 describe 不再回退
  位置，旁白按 actionId 关联并持久化；T2a：轮询/升级 GET/动作/辅助响应统一经 adoptState
  （存档身份 + rev）采纳并带视图存活检查——旧轮询响应不再回退画面；同 NPC 并发对话按
  actionId 合并问答——慢回复不再抹掉已落库的快回复；T3：一次结算契约——结算 id
  `<saveId>#<endSeq>` 独立于 rev，收据存角色档并镜像地牢档，重复 sync-delve 返回同一收据
  零重放，结算后的购买/升级不被旧快照覆盖，保存失败可重试且零落盘，摘要面板显示
  保存中/成功/失败并锁定未确认的返回操作；T3a：旧终局档缺 endSeq 由 store 迁移在读取时
  补 #1 基线（下次真实结束为 #2，镜像写失败不丢基线），过期镜像由 duplicate 分支修成
  当前收据，摘要面板用点击守卫 + `aria-disabled`/`tabindex` 封锁键盘与脚本导航、
  确认前金额不宣称入账；T4：`server/game/guidance.js` 确定性提供"下一步"——首页卡片
  目标 + 主行动 + 理由（待结算优先）、区域地图推荐点与理由（`?node=` 预选、不自动出发）、
  地牢 HUD 目标与战斗经济行（行动为何不可用）、结算面板展示本局增量/故事推进/下一目标
  并把统计折叠；全流程无 LLM 依赖；T4a：目标取得文案对齐引擎裁决（走回营火才算完成胜利，
  入口撤退只结算已有收获且明示主线不推进，区域清空不再被当作完成），pickLiveSave 改为
  "待结算终局 → 进行中（explore/combat）→ 准备"优先级（较新已结算档不再遮住活动局，
  权威收据即算已结算）。**T5 已实现（2026-10-02 随 T5a 关闭）**：`server/game/presets.js` 提供两个经真实
  buildCharacter 构建的推荐英雄（guardian 近战 / arcane 施法），客户端只提交 presetId+名字，
  首页快速开始卡创建后直达主线准备入口（不自动出发）；`play/tutorial.js` 悬浮教学卡（移动→互动→
  战斗→结算）只观察服务端状态/事件推进、可跳过、localStorage 一次性，play.js 仅 6 行挂接；
  顺带修复 buildCharacter 从未把背景 origin feat 传入 finalizeSpells（magic-initiate 背景的
  赠礼戏法/免费法术此前对所有新角色丢失）；新增第 20 套件 quick-start（55 断言）与第 4 个 CDP
  e2e quick-start（24 断言，端口 9227）；真实浏览器全流程试玩通过（含一次死亡豁免与撤退结算，
  教学四步全部完成；试玩抓出并修复"击杀步永不完成"bug）。**T7 主体已实现（独立验收待 T7a）**：开锁（`pick`/`force`）、
  拆陷阱与路遇全量收归服务端引擎权威裁决；`engine.unlockChest`/`disarmTrap` 在服务端投掷并派发事件
  （`chest_unlocked`/`chest_locked`、`trap_disarmed`/`trap_disarm_failed`），带 natural/modifier/total/dc/outcome
  payload，彻底忽略客户端伪造的 `rollTotal`；客户端 `rollAnimated` 支持传入服务端 natural 骰值呈现真实动画，
  无工具显示警告并阻止伪造；`engine.triggerRoadEncounter` 与 `resolveRoadEncounter` 追踪事件实例与选项、
  严格校验金钱（贿赂 10 GP/献祭 5 GP）、执行检定与发奖并落库，支持幂等去重防重复领奖（`alreadyResolved: true`）
  与老旧 outcome 向后映射；新增第 21 套件 `tests/integration/server-checks.test.mjs`（14 场景 72 断言全绿）
  与真实 Edge/Chrome CDP 验收套件 `tests/e2e/t7-browser-acceptance.mjs`（11 断言全绿）；`balance-sim` 确认数值平衡
  （crypt normal 64% 存活，vault 86%）。T5/T7 并行交接见 [并行交接指南](docs/T5_T7_PARALLEL_HANDOFF.md)。**T5/T7 整合已完成（2026-10-01）**：两增量逐段合并共存，整合后 `npm run verify` 全绿（22 套件 + smoke）；真实浏览器共同流程全走通（双预设快速创建 → 准备/出发 → 教学四步 → T7 开锁/撬门/路遇选择与骰面演出 → 路遇幂等与 boon 带入 → 圣物 → 营火胜利故事推进 → 结算 → 首页下一目标）；过程中发现并修复三个预存 bug（crypt 圣物因与祭坛同格在 UI 中不可点击——主线第一幕此前在浏览器里无法完成；自然 1 死亡使 deathSaves.fail=4 导致地牢视图白屏；侧栏复活不重置 summaryShown 导致下一次终局无法弹出结算），详见 ARCHITECTURE §7 与整合记录。**T5a/T7a 补修已完成（2026-10-02，独立复核 docs/T5_T7_REVIEW_2026-10-01.md 的三处问题全部关闭，T5/T7 随之 done）**：T5a 为两个推荐预设补齐职业 skillPicks（guardian +insight/survival，arcane +investigation/religion，含专精加成经引擎 skillMod 验证）；T7a 将路遇收敛为持久化实例生命周期（trigger 复用存活实例不重掷不耗 RNG、status 恢复、start 对未处理实例 409、已选择实例开局一次性消费、客户端全程防重/失败重试/迟到响应丢弃）并以只读预览端点 +api/game/:id/preview 消除客户端自算加值（含专精），panels 改渲染服务端预览；新增第 23 套件 t7a-road-lifecycle CDP e2e（32 断言：连续点击/刷新恢复/丢失响应重试/迟到响应），server-checks 扩至 108 断言，smoke 适配新生命周期；整合后 verify 全绿。T6、T8 状态见下表。
- 评估复现的四个问题：准备页设置被忽略（**T1 已修**）；慢 AI 描述覆盖新移动、旁白未持久化
  （**T2 已修**）；同批边界（旧轮询回退、并发对话覆盖，**T2a 已修**）；同一局重复结算增加
  次数（**T3 已修**）。
- T7a 补完轮实测基线（2026-10-02）：隔离 `npm run verify` 的 eslint、tsc、23 套件（含 5 个 CDP）与 smoke 全绿；T7a 生命周期 CDP e2e 50 断言、server-checks 108、quick-start 66；smoke 独立两跑结果一致（确定性覆盖伏击胜→神社）。当时两项写死 data 路径的磁盘检查未验证；本次 Docker 环境任务已修正为 DATA_DIR，缺文件明确失败，尸体移除与升级徽章回归在最终 24 套件中真实通过。
  T7 单独 CDP 的 11/11 与 balance-sim 属此前开发记录，前者不在完整 runner 内；旧 balance 记录中的 60%/86% 差异仍未作独立比较。
- 独立复核：[旧报告](docs/T2A_T3_REVIEW_2026-09-30.md) 发现的三处结算边界已由
  [T3a 补修](tasks/t3a-settlement-boundaries.md) 全部修复并经本轮再次复测（done，2026-10-01），含
  真实浏览器四态与键盘/鼠标验收。旧代码已造成的 endSeq=1 双重结束档不做时间戳启发式修复
  （会误伤正常重开），基线建立后不会再产生该形状。[T3/T4 报告](docs/T3_T4_REVIEW_2026-10-01.md)
  记录 T3 通过和 T4 两处复现；两处已由 [T4a](tasks/t4a-guidance-outcomes.md) 修复并验收（2026-10-01），
  此前独立复测再次确认两处原场景通过。T5/T7 原三处问题已补修；但最新复核仍有 T7a 两条客户端边界与冒烟基线待补完，见 [后续报告](docs/T5A_T7A_REVIEW_2026-10-02.md)。
  [并行交接指南](docs/T5_T7_PARALLEL_HANDOFF.md) 保留为此前基线、分工和整合记录。
- 项目拥有者操作与复制提示词：[`docs/AGENT_HANDOFF.md`](docs/AGENT_HANDOFF.md)。

下方版本功能段落与版本历史用于回顾；当前任务以本摘要、下表和 `tasks/README.md` 为准。

## ⚡ AI 协作地面规则

**规则正本在仓库根目录 `AGENTS.md`**（AI 编码工具默认自动加载它；`CLAUDE.md` 一行指向它）——
内容包括：不主动 commit/push/发版、引擎是唯一裁判、服务端唯一事实来源、
禁 bash heredoc / `node -e` 改模板字符串文件（用 Edit 或 Write 写 .cjs 补丁）、
完整验证命令清单、e2e 不依赖 RNG 具体值与中途坐标。**改规则只改 AGENTS.md**，本文件不再重复维护。

## 📋 待办清单（优先级排序）

> 每次只做用户指定的一项；完整状态与依赖见 [`tasks/README.md`](tasks/README.md)，
> 新任务模板见 `tasks/TEMPLATE.md`。完成时同步规格、队列表和本摘要。

| 优先级 | 任务 | 说明 |
|---|---|---|
| 1 / 高 | [T1 开局入口与接口类型](tasks/t1-start-options.md) | **done（2026-09-30）**；选择与实际地图/难度/同伴一致 |
| 2 / 高 | [T2 状态更新与 AI 持久化](tasks/t2-state-and-ai.md) | **done（2026-09-30）**；修竞态与旁白保存，定义写入边界 |
| 2a / 高 | [T2a 状态采纳与 NPC 记忆补修](tasks/t2a-state-boundaries.md) | **done（2026-09-30）**；旧轮询不回退画面，并发对话不丢记忆 |
| 3 / 高 | [T3 一次结算与回城](tasks/t3-settlement.md) | **done（2026-09-30）**；结算可重试且不重复处理 |
| 3a / 高 | [T3a 结算边界补修](tasks/t3a-settlement-boundaries.md) | **done（2026-10-01）**；旧档 endSeq 基线、过期镜像自愈、键盘/脚本导航锁定 |
| 4 / 高 | [T4 全程目标与下一步](tasks/t4-player-guidance.md) | **done（2026-10-01，T4a 验收通过）**；引导全流程无 LLM 依赖 |
| 4a / 高 | [T4a 完成动作与继续入口](tasks/t4a-guidance-outcomes.md) | **done（2026-10-01）**；目标取得→营火胜利引导对齐引擎，活动存档优先继续 |
| 5 / 中 | [T5 快速开始与首次体验](tasks/t5-first-adventure.md) | **done（2026-10-02，T5a 关闭）**；快速开始 + 教学 + 预设技能补齐 |
| 5a / 中 | [T5a 推荐英雄职业技能](tasks/t5a-preset-skills.md) | **done（2026-10-02）**；guardian +insight/survival，arcane +investigation/religion |
| 6 / 中 | [T6 有记忆与后果的遭遇](tasks/t6-remembered-encounter.md) | **done（2026-10-03）**；山谷哨门两路线与持久回应，27 套件/smoke/balance 全绿 |
| 支持 / 中 | [T7 引擎统一检定裁决](tasks/t7-server-checks.md) | **done（2026-10-02，T7a 补完后关闭）**；锁箱/陷阱/路遇服务端裁决 + 完整生命周期 |
| 支持 / 中 | [T7a 路遇恢复与检定提示](tasks/t7a-road-and-check-feedback.md) | **done（2026-10-02）**；离页注销、原地重试、权威基线与单发计数 |
| 支持 / 中 | [T8 内容包校验](tasks/t8-content-validation.md) | **done（2026-10-03）**；25 套件/smoke/balance 全绿，51 场景/180 断言 |
| 持续 | 保持文档同步 | 每项实现后更新任务结果与架构；不用等待发版 |
| 不做 | 引擎物理拆分 | 循环依赖太深（combat ↔ world ↔ interaction ↔ progression），拆了反而更难；等 JSDoc 类型全覆盖后再评估 |
| 不做 | React/Vue/打包器 | 无构建 + 离线是核心设计；ES modules 原生够用 |
| 不做 | AI 生成场景插图 | Google key 的图片配额不稳定；头像已覆盖视觉识别 |

PWA、原 ASI 特长批次、CDP 已知闪红、MCP 和存档版本化已实现，旧 tasks 文件仅供参考，不再列为待实现。当前评估依据见 `docs/PROJECT_REVIEW_2026-09-30.md`。

## T3 一次结算与回城（2026-09-30，未发版）

- **问题**：同一 retreat 存档调两次 sync-delve，`delvesCompleted` 从 1 变 2；openSummary 每次打开
  都发 sync-delve 且吞掉失败；旧快照同步会覆盖结算后的购买/升级；无存档时还接受客户端上报的
  goldGained/xpGained/newItems（无可信度）。
- **结算契约（详见 ARCHITECTURE §7）**：结算 id = `<saveId>#<endSeq>`——engine 在三个终局转换点
  （死亡 / checkVictory / retreat action）打 `state.endSeq`，respawn 不清零（第二次死亡以 `#2`
  再结算）；旁白只递增 rev，绝不产生新结算。收据（mode/map/gold/xp/level/delveNumber/
  campaignAdvanced/weeklyWin）存 `char.settlements`（上限 100，**权威，先写**；写失败零落盘，
  重试重算）并镜像 `state.settled`（尽力而为，后写）。重复请求返回同一收据 `duplicate:true`
  零写入；档案丢收据从镜像去重并自愈，镜像缺失由重复路径补写。
- **校验前置**：非本人存档 403 / 不存在 404 / 未结束 400 / 缺 delveStateId 400 / 残缺档 400，
  全部在任何写入前。**移除无存档增量入参路径**（grep 确认零使用者）。XP/金币/背包/HP/忠诚/
  weekly/endless/图鉴/精华/主线的既有入账逻辑原样保留，只是被收据门禁包住。
- **客户端（play/panels.js openSummary）**：保存中/成功（+收据行）/失败（+重试）；返回链接与
  回营地恢复在确认前锁定（`.btn.locked`），✕/Review 只读查看始终可用；重开已结算摘要显示
  "Already settled"（服务端去重，不重放旧背包）。
- **测试**：新增第 19 套件 `tests/integration/settlement.test.mjs`（进程内真实路由，61 断言：
  同收据 + rev 无关、购买/升级保留、档案写失败 500→重试恰好一次、镜像写失败自愈、镜像反救
  档案、五类错误零写入、死亡→respawn→再死两次结算、weekly 一次）；progression 双结算断言
  扩充 + gamble 段落改先置终局；CDP Check 10（注入一次网络失败 → 锁定 → 重试成功 → 服务端
  恰好一次 → 重开只读）；`tests/fixtures/saves/settled-delve.json` 迁移 fixture。
  `npm run verify` 全绿；真实浏览器截图三态（失败/成功/重开）人工确认。数值表未动。

## T2a 状态采纳与 NPC 记忆补修（2026-09-30，未发版）

- 完成后复核（[T1_T2_REVIEW](docs/T1_T2_REVIEW_2026-09-30.md)）复现的两个边界，本轮修复：
- **P1 旧轮询回退**：4s 轮询此前"rev 不等就直接赋值"，被扣住的旧 GET 在新移动落库后返回，
  页面整体回退到旧 rev/旧坐标（服务端无损）。现在 play.js 的 `adoptState` 是唯一采纳
  gate——存档身份（`next.id !== game.id` 拒绝）+ rev 不低于已展示版本（等于允许）；轮询、
  升级后的 GET、动作与辅助响应全部走它；新增 `viewToken`/`viewAlive`——视图结束后在途
  GET 丢弃，初始化 GET 是唯一直接赋值点（明确初始化边界）。
- **P2 并发 NPC 对话覆盖**：chat 的 apply 曾把提示词快照的整段 `npcChat[npcId]` 写回，
  A 扣住、B 先完成、A 再返回时 B 的问答从历史中消失（模型会"忘记"）。现在按本次动作的
  actionId 只追加这一对问答（带 aid 去重、完成顺序排列、24 条上限），后续对话的提示词
  仍包含完整历史（测试用 mock 捕获请求体验证）。
- **测试**：state-and-ai 套件修正旁白标记用例（标记改为开局后才入队，断言动作前不存在、
  aid 独立于开局、POST/GET 恰好一次），新增并发同 NPC 对话回归（47 项断言）；mock LLM
  支持请求体捕获。`npm run verify` 全绿；真实浏览器按评审复现序列验证：扣住 rev2 轮询 →
  移动采纳 rev5 → 释放后页面保持 rev5/(5,4)，服务端一致；新轮询照常采纳；describe 等待卡
  → 外观卡不受影响。

## T2 状态更新与 AI 结果持久化（2026-09-30，未发版）

- **问题一（快照回退）**：describe/chat/recap 等在 action 处理中 `await` 模型，持有开局时
  的整份状态快照；期间普通移动已落盘，模型返回后 `saveGame(旧快照)` 把玩家位置/资源整体
  回退。**问题二（旁白不持久）**：动作先 saveGame 后 narrate，narrate 只改内存 log——POST
  响应里有旁白，重新 GET 没有。
- **修复（写入契约，详见 ARCHITECTURE §7）**：`saveGame` 递增 `state.rev`；新增
  `store.withSaveLock`。action 路由改为三段式——机械段（同步读改写最新档，零 await，7 个
  模型调用全部改为 pending 队列）→ 模型段（锁外，用已落盘快照做提示词）→ 合并段（锁内重读
  最新档，只写自己的字段）。日志条目盖 `aid`，narrate 在最新档上按 aid 去重合并并落盘；
  响应统一从落盘后的最新档构建。POST 响应协议不变（仍同步等待旁白），无消息队列/SSE。
- **前端（play.js）**：`adoptState` 按 rev 拒绝旧快照（辅助结果照常展示）；describe 等待
  显示 spinner 卡片；轮询按 rev 刷新；portrait 缓存提升为模块级 `portraitCache`（修掉
  状态采纳即清空头像卡的既有缺陷）；`__dndDebug` 增加 rev/portraits/appearance 访问器。
- **测试**：新增第 18 套件 `tests/integration/state-and-ai.test.mjs`——进程内真实路由 +
  mock LLM（hold/error/never 模式按信号控制顺序）28 断言：并发 describe+move 不回退、
  旁白 GET 恰好一次、模型错误/超时/关闭兜底、双存档不串流。`npm run verify` 全绿。
  浏览器确认：旁白刷新后仍在、点击怪物出现等待卡→外观文案卡（headless Edge 截图）。

## T1 开局入口修复（2026-09-30，未发版）

- **根因**：`play.js` 准备页把 `{ bringAlly, difficulty, mapId }` 对象传进 `api.startGame` 的
  第 2 个位置参数 `bringAlly`，difficulty/mapId 两个位置实参没传——POST body 里 bringAlly
  是嵌套对象（truthy，engine 对非字符串回落 `'bram'`），difficulty/mapId 缺省回落
  normal/crypt。选什么都是 crypt/normal/bram。
- **修复**：`api.startGame(characterId, options)` 单一显式 options 对象 + `StartGameOptions`
  JSDoc typedef（options 必填，tsc 探针验证三种传错形式都会报错）；全部 3 个调用点统一
  （play 准备页 / overworld 区域出发 / districts weekly 出发）；POST 字段与服务端契约不变。
  Descend 按钮加 busy 守卫（请求中禁用、失败恢复，防双击重复开局）。
- **顺带修活每周试炼入口**：v1.9.7 的公会厅每周试炼卡、英雄殿堂周榜卡、hallData 解构在
  后续改动中丢失（只剩事件处理器活着，按钮从未渲染，weekly 入口实际不可达）——按原补丁
  内容用 Edit 补回三处渲染，无数值改动。T1 验收"每周试炼入口正常"由此达标。
- **验证**：`gameplay-refinements-cdp.test.mjs` 新增 Check 9（真实准备页两场景 × POST 网络请求体
  + 服务端最终存档双断言，34→44 断言）；headless Edge CDP 截图人工确认（准备页默认值、
  howling-hills+hard+solo 的地图/Hard 徽章/无队友/Potion(1)、weekly_5 2026-W40、区域
  drowned-vault 出发含路遇弹窗）；`npm run verify` 全绿 ×2（weekly UI 补丁前后各一次）。

## play.js / overworld.js 拆分（v1.9.2 已发布）
- play.js **1843 → 1326 行**，overworld.js **1739 → 540 行**。新模块（无构建 ES modules，工厂 + ctx 显式依赖，live 状态走 getter）：
  - `public/js/views/play/panels.js`——商店/日志/检定弹窗/结算面板，`createPanels(ctx)`
  - `public/js/views/play/ribbon.js`——战术先攻条，`renderInitiativeRibbon(game, onSelectTarget)`
  - `public/js/views/play/delve-inventory.js`——背包装备弹窗，`createDelveInventory(ctx)`
  - `public/js/views/overworld/districts.js`——六城区渲染器 + 事件 + 赌桌状态，`createDistricts(ctx)`（gamble 五个状态变量已 grep 验证仅拆出集使用，整体移入；`hallFilter` 由 attachHeaderEvents 写、renderHallOfHeroes 读，留在 overworld.js 按引用传递）
  - `public/js/views/overworld/road-encounter.js`——路上遭遇弹窗，直接导出 `showRoadEncounterModal`（无工厂，只用自身参数 + imports）
- **有意保留在 play.js 的**：renderSide / combatHud / wireSide 侧栏子系统——wireSide 的升级处理器直接写 `game.character` / 重赋 `game`，与核心状态是控制器级耦合，抽出 = 搬运 12 个依赖而非消除。未来要拆，先给 game 状态做显式 setter 层。
- 顺手修的可疑点：creator.js 额外技能上限改读 feat 的 `extraSkillPicks` + 死三元删除；play.js difficulty 单选读取加 `|| 'normal'` 兜底；play.js 删除三块死代码（`personaQuickSelect`、`data-useitem`、`data-equip-slot`/`data-unequip-slot`——真实功能走 `data-delve-inv-*`，改属性名时的遗留）；overworld.js 路遇弹窗按钮判空。

## 路遇落库修复 + 队友忠诚度（v1.9.2 已发布）
- **路遇落库**：新端点 `POST /api/characters/:id/road-encounter`（固定结果表
  `ROAD_ENCOUNTER_OUTCOMES`：ambush_win / ambush_wound / bribe / sneak_wound / shrine_pray /
  shrine_offer）。客户端弹窗只负责骰点和演出，结果由服务端写进档案——原实现里奖励/扣血
  全部只改内存（v1.5.0 起，路上遇到的东西白遇）。神殿两项 boon 走 `char.pendingRoadBoons`
  （镜像 pendingDelveItems 约定）：`POST /api/game/start` 时施加（+5 临时生命 / blessed
  buff 480 回合）并清空。货郎购买本来就走 cityBuy（已落库），未改。冒烟测试断言了
  落库 + 开局施加。
- **队友忠诚度**：`char.companionLoyalty[allyId]` 持久化在档案上（0-100，缺省 50），
  `startGame` 读它刷 ally 实体，sync-delve 写回。变化：倒下 -10、地牢胜利 +5（活着的）、
  营地长休 +3（rest 文案追加 "takes the second watch"）。跨过 30/80 阈值推 canned 吐槽
  事件（type 'companion'，narrate: true，DM 可配音）；引擎 helper `adjustLoyalty(state,
  delta, events, entity?)`。侧栏队友 chip 显示 😊/😐/😠 + hover 忠诚度；dm.js 旁白提示词
  加一行队友状态（alive/downed + 心情，允许 DM 给 TA 一句台词）。战斗集成测试 3 条
  （种子 / 倒下扣分 / 长休回涨）。

## 深渊楼层变异 + 远征榜（v1.9.3 已发布）
- `endless.js`：从第 2 层起每层掷一个**楼层变异**（纯数据旋钮）：`champions 精英横行`
  （map def 带 `eliteChance: 0.4`，引擎 `generateMapState` 读它替代默认 18%——非精英怪在
  hydrate 时套 `applyMonsterAffix`，视觉/战斗全走既有精英系统）、`swarm 群涌暗潮`
  （房间怪数 ×1.6）、`gilded 鎏金之层`（宝箱金币/药水/物品概率上调）。变异写进 map def
  （`mutation` 字段 + 名称后缀 `· 精英横行`，下潜横幅自动显示）。
- **队友深层台词**：`routes/game.js` 的 endless 楼梯下降处，按忠诚度心情推
  `companion` 事件（narrate: true，DM 可配音）——第三档深度语音。
- **深渊远征榜**：sync-delve 把 `delve.endlessDepth` 最大值写回 `char.endlessDepth`
  （**顺带救活了 endless_delver 成就**——它一直在读这个字段但从未有人写）；
  `/api/city/hall-of-heroes` 新增 `endlessRunners`（≥2 层的角色按深度排序 top10）；
  殿堂页在主线进度卡下方渲染 🕯️ 深渊远征榜。progression 套件新增生成器测试
  （分支条件断言，RNG 安全）+ 殿堂断言。

## MCP server + 存档版本化（v1.9.3 已发布）
- **MCP server**（`mcp/server.mjs`，零依赖手写 stdio JSON-RPC）：四个只读工具——
  `run_verify`（完整验证）/ `run_balance_sim`（bot 胜率）/ `query_rules`
  （查引擎数据表，无 id 返回 id 列表）/ `recent_failures`（读 data/last-verify.log 的失败行）。
  `npm run mcp` 启动；客户端配置与边界（只读 + 跑既有脚本，无写档工具）见 AGENTS.md。
  第 14 套件 `tests/unit/mcp-server.test.mjs` 走完整协议握手。
- **verify 落盘**：`scripts/verify.mjs` 把全部步骤输出 tee 到 `data/last-verify.log`
  （recent_failures 的数据源）。
- **存档版本化**：`store.js` 写入打 `saveVersion`（当前 2），读取走 `migrateSave`
  迁移链（只增不删、失败降级可用、未来版本原样放行）；第 17 套件
  `tests/unit/store-versioning.test.mjs` 用临时 DATA_DIR 做真实读写测试。
  **测试套件总数现为 17**（文档里的 13/14/15/16 已全部同步；含事件契约与回放机器人）。
- **存档迁移 fixture 集**（AI 防错路线图收官）：`tests/fixtures/saves/` 存代表性旧档形状
  （legacy-character / legacy-delve），store-versioning 套件逐 fixture 断言「迁移不丢任何原字段 +
  版本打标 + 真实 store 裸写旧档后读取迁移端到端」。将来每次加迁移步骤，先在 fixtures 加旧样本。

## PWA + 新特长 + CDP 诊断（v1.9.4 已发布）
- **PWA**：public/sw.js（HTML/JS/CSS network-first、vendor/icons cache-first、/api 永不缓存——
  本地改代码刷新即见，断网有壳）+ manifest + 占位图标（node zlib 生成 PNG）+ index.html 注册。
- **新 ASI 特长 4 个**：Observant（被动察觉 +5，passivePerception 纯计算）、Speedy
  （速度 +10，applyClassAndSpecies 全新赋值故重算安全）、Chef（短休全队 prof 临时 HP）、
  Musician（长休全队 blessed buff）。升级向导选项来自 API 的 FEAT_CHOICES，加行即生效。
- **CDP 瞬挂根治完成**：启动前清 profile（killStaleBrowser）+ 17 处固定 sleep 改条件轮询
  （tests/e2e/_cdp-helpers.mjs：pollUntil / clickUntil，点击撞 busy 自动重点）。断言零改动，
  任务文件记录全部 17 处的映射表。

## 回放机器人（v1.9.4 已发布）
- `scripts/replay-bot.mjs`（`npm run replay`）：headless bot 走 REST 打完整冒险，每 tick 校验
  **游戏级不变量**（玩家 HP 边界/实体有限性/边界内/ID 唯一/金币经验合法/背包条目/回合数上限/
  事件流类型健全），卡死检测 60 动作无进度（进度 = 位置/击杀/门/宝箱状态）。
  自动起服（BASE_URL/PORT 可指向 Docker 容器），跑完自动 sync-delve 并清理 bot 角色/存档。
  策略会学玩家真实流程：上锁宝箱走 skillCheckObject（客户端骰子契约），拿圣物后回家触发胜利。
- 第 17 套件（REPLAY_QUICK=1 两局快跑进 test-all；test-all 现支持 per-suite env）。
- **首跑即战果**：抓出 NPC 无 hp 字段（校准不变量）、bot 对着开着的门/上锁宝箱空转（策略修掉）——
  上锁宝箱的 pick/force 是客户端骰子，属设计而非 bug。

## 事件契约测试 + run_replay MCP 工具（v1.9.5 已发布）
- **事件契约测试**（第 17 套件 `tests/unit/event-contract.test.mjs`）：扫描 engine/routes/referee
  发射的每个 `type: '...'`，必须被归类——play.js SFX_MAP（有音效）/ 测试内 NARRATION_ONLY
  清单（只走日志旁白管线）/ NOT_EVENTS（伤害骰子类型等假阳性）。反向断言 SFX_MAP 每个键
  都有发射点（顺带清掉了 parry 死音效映射）。**新事件类型不分类就挂 CI**，强制做声音/旁白决策。
- **MCP 第五工具 `run_replay`**：远程触发回放机器人（runs 上限 20，20 分钟超时）。

## 套装物品（v1.9.5 已发布）
- `affixes.js` 新增 `ARMOR_SETS`（余烬锻造 / 渊守）：护甲池 roll 出的部件 25% 概率携带
  套装标记（保留原词缀加成，套装叠加其上）。**套装跨槽位**：护甲 + 披风 + 戒指——
  基础池新增 cloak / ring 两个基础（共享目录 GEAR 同步补录，可解析名字、有卖价）。
- **2 件 +1 AC，3 件 +2 AC 且先攻 +2**：AC 走 `currentAc` 活计算（`setAcBonus`，天然重算安全，
  不碰 acBase）；先攻走 `char.initBonus`（applyClassAndSpecies 盖章时叠加 `setInitBonus`）。
- **顺手修活一个死字段**：`char.initBonus` 此前全引擎只写不读（startCombat 只用 d20+dexM）——
  Alert/Feral Instinct/套装的先攻加成现在真正生效。战斗开局玩家先攻会因此略变，属修正非回归。
- forge `isForgeable` 认 cloak/ring 类型（套装件可熔解/重铸）；词缀套件 516→533 断言。
- 设计注：套装件只从战利品 roll 出（商店不上架散件）；混合套装分开计数不叠加。

## Companion 支线（v1.9.6/v1.9.7 已发布）
- `server/game/companions.js`：三人各一条**忠诚度门槛触发的个人任务线**——
  Bram「旧伤·猎犬」（60，crypt_hound ×4）、Valeria「守誓者之骸」（65，skeleton ×4）、
  Aldous「药师的老鼠账」（55，giant_rat ×4）。忠诚度变化时 `offerPersonalQuest` 检查门槛
  （每次只开一条线，roster `char.companionQuests[allyId]` 记 offered/done，永不重复）。
- 进度挂在杀怪点（applyDamage monster 分支，checkQuest 之后）：`progressPersonalQuest`
  计数到需要即完成——+60 gp、+15 忠诚、卷一个稀有礼物件（Bram 武器 / Valeria·Aldous 护甲）。
  上锁宝箱式技能骰不涉及；目标怪是 crypt 系（其他地图的局自然等待，档案持久化跨局有效）。
- sync-delve 把 `companionQuests` 写回档案；事件复用 quest_offer / quest_done（SFX 已有）。
- 侧栏任务区（展开态）在支线激活时显示个人线卡片：任务名、队友、进度 x/need（thread 携带 targetName）。
- **沉浸模式 v2**（玩家反馈：面板太小）：日志/聊天变左下半透明悬浮层（▼ 收起后只留聊天条，
  仿小地图的收展交互）；顶栏变 ESC/☰ 暂停菜单（Characters/Overworld/Create/Settings/退出沉浸，
  ESC 优先级 = 先关弹窗再开关菜单）；地图拉到 ~100vh-132px 近全屏；退出地牢时 cleanup 清 body.immersive。
- 战斗套件 +2 测试（门槛触发与一次性 / 完成奖励流 / 门槛下不触发）。
- 设计注：目标怪锁定 crypt 系是有意为之——支线跨局等待而非全图通杀。

## 存档迁移 fixture 集 + 每周 seed 挑战（v1.9.7 已发布）
- **确定性 RNG 流**：engine 的骰子全部汇聚 `die()`，新增 mulberry32 流（`rand()`）——
  `beginSeed`/`beginRng(state)`/`persistRng(state)`：动作派发入口恢复流、出口写回
  `state.rngState`，多存档交替各自独立（rules 套件有流续接测试）。未 seed 的局照旧 Math.random。
  engine 9 处游戏随机点（精英/游荡/任务候选/吐槽/掉落概率）+ endless 生成 + rollMagicItem
  的选择全部接流；存档 ID 与任务 ID 仍是真随机（故意）。
- **每周流**：`engine.weeklyInfo()` = ISO 周 label（如 2026-W40）→ FNV 哈希种子；
  `POST /api/game/start mapId: 'weekly'` → 种子化 boss 层程序地牢（depth 5/10 逐周交替），
  `state.weeklyLabel` 标记。本周所有英雄同一地牢同一怪物；两次开局实测逐字节一致。
- **排行**：sync-delve 在 weekly 局胜利时写 `char.weekly`（label/wins/best）；
  殿堂端点 + 殿堂页加 🏅 本周试炼榜；公会厅加每周试炼卡（种子标签/深度/本周战绩/接取按钮，
  直接起 weekly 局）。/api/city/info 暴露 `weekly`。

## Boss 绝境阶段 + 三只新怪（v1.9.7 已发布）
- **Boss 绝境阶段**：`processMonsterTurn` 重构出 `swingAt`（返回是否挥击，不挥则走移动），
  25% HP 以下 boss 进入 `desperate` 阶段——**每回合两次攻击**（50% 狂暴之上叠第二阶段）。
  事件类型 `desperate` 已入事件契约 NARRATION_ONLY。
- **新怪 ×3**（shared/monsters.json，自动进入 endless/weekly 怪物池）：
  Ghoul（200xp，5d8，Undead Fortitude）、Dire Wolf（200xp，3d10+6，40ft，Pack Tactics——
  复用 hound 四足 rig 的灰色放大变体）、Barrow Wight（450xp，4d8+8，necrotic/piercing/
  slashing 抗性）。crypt 游荡表加入 ghoul/dire_wolf。
- 战斗套件改为 6 回合统计断言（绝望 ≈2 挥/回 vs 健康 1 挥/回）——nat1 必失手使精确断言
  偶发失败，规则 9 的又一个案例。

## Crusher/Slasher/Piercer 特长（v1.9.8 已发布）
- **Crusher**（钝击命中，once/turn）：目标被推离 5 ft（复用 shove 的格子校验，无豁免）。
- **Slasher**（挥砍命中，once/turn）：目标获得 `slowed` buff（速度 -10，2 回合自然过期——
  currentSpeed 本来就读这个 buff id，零改动）。
- **Piercer**（穿刺命中，once/turn）：`damageRoll` 新增 `piercer` 选项——重骰**最低**一颗伤害骰
  取高，返回 `piercerRerolled` 标记驱动 once-per-turn 旗标（crit 加骰在其后结算，次序正确）。
- 旗标 `used_crusher/slasher/piercer` 在 beginPlayerTurn 重置；向导选项来自 FEAT_CHOICES
  （+3 行）。三特长只对 `unlockedFeats` 持有者生效，balance-sim 机器人不受影响。
- 战斗套件 +1（推位/减速/once-per-turn/新回合恢复，5 连绿），rules 套件 +1（Piercer 种子化
  不变量：同种子重骰不低于原值）。

## Boss 专属机制 + 每周奖励（v1.9.8 已发布）
- **Boss 专属 gimmick**（数据驱动：monster def 的 `gimmick` 字段，水合时带上）：
  Grubnik/Depth Guardian → `summon_undead`（狂暴时召唤 Risen Vault Guard，加入战斗序列，仅一次）；
  Tomb Warden → `ground_slam`（每 3 回合对 2 格内玩家+队友 1d8+2 钝击，DC 13 力豁免减半）；
  Yzmerith → `fire_breath`（每 3 回合对 3 格内 2d6 火焰，DC 13 敏豁免减半）。
  三个机制挂在水合后的状态检查**之后**（睡眠/麻痹/魅惑的 boss 不施放）。事件类型
  ground_slam/fire_breath/summon 已入事件契约。
- **每周试炼奖励**：weekly 局胜利时 `checkVictory` 授予一件强制套装的稀有件（rollMagicItem
  新增 `opts.set`），delve 旗标防重复；sync-delve 的 wins/best 照旧。
- **balance-sim v3**：新增 endless-5 normal / endless-10 hard / weekly（种子局 ×3）三个配置，
  per-config runs。基线：endless-5 normal 生存 40%（试炼模式确实更难）、endless-10 hard 70%、
  weekly 67%——作为后续调参基准记录。
- 战斗套件 +1（四 gimmick 场景：触发/伤害/睡眠封印/召唤一次性）。

## 项目概况
- 路径：`G:\ai_DND`；GitHub：`Jianjun99/AI_DND5e`（main 分支，CI + GHCR 自动发布）
- 单人 D&D 2024 网页游戏，Node 20 + Express + 原生 JS SPA（无框架、无构建步骤）
- Docker 镜像：`ghcr.io/jianjun99/ai_dnd5e:{latest,1.10.0,…}`（多架构 amd64+arm64）
- 存档：容器卷 `ai-dnd-data` → `/app/data`（characters.json / saves/ / settings.json）
- 本地运行：`npm start`（端口 3000）；Node 在 `C:\Program Files\nodejs`（git bash 需 export PATH）
- 测试：**`npm run verify`**（一键：自动起服务 → eslint + tsc + 19 套件 + 冒烟 + 收尾）；手动等价：`npx eslint .` + `npx tsc --noEmit` + `node scripts/smoke-test.mjs` + `node scripts/test-all.mjs`（19 套件）；平衡模拟：`scripts/balance-sim.mjs`（改数值必跑）
- 架构文档：`ARCHITECTURE.md`（Mermaid 图）；模组指南：`MODDING.md`

## 功能记录说明

当前代码版本与任务状态见顶部摘要；下方保留历史发布记录和已有能力，不代表本轮待办。

## v1.9.1 发布内容（原「进行中」段落，转正）
- **AI 协作入口**：根目录新增 `AGENTS.md`（地面规则正本 + 验证命令 + 硬约束速记 + 文档地图），
  `CLAUDE.md` 一行指向它。PROJECT_STATE 顶部的规则列表已改为指针，不再两处维护。
- **`dmgType` → `damageType` 统一**：角色攻击字段与 `applyDamage` 参数全部改为 `damageType`，
  与怪物/法术攻击一致。老存档里的旧 `dmgType` 键是惰性残留——attacks 在加载时由
  `applyClassAndSpecies` 重建（characters.js:95 / game.js:366、392），无需迁移。
  ARCHITECTURE §7 对应坑位说明已改写。
- **tsc 全量覆盖（server/ + public/js）**：`tsconfig.json` include 改 glob `public/js/**/*.js`
  （新文件自动被检查），加 `lib: ["es2022","dom","dom.iterable"]`；`public/js/globals.d.ts`
  集中声明 window/document 上的共享扩展名（`__rules` / `__dndDebug` / `webkitAudioContext`…）；
  three.js 的 `/vendor/three.module.js` import 由 `paths` 映射到 `public/js/vendor-three.d.ts`
  permissive stub——ambient `declare module` 对根相对路径不生效。修掉客户端 77 个历史 DOM cast
  错误（纯 JSDoc 注解，零行为变更）后全仓 0 错误。
- **修掉活动铠甲 3D 手办构建崩溃**（models3d.js）：`createHeaterShield` 签名早已改为只收
  `track` 一个参数，`buildAnimatedArmorMiniature` 仍按旧签名传色值——阳光峡谷扩展包
  roost/mill 图刷出活动铠甲时渲染必炸 `track is not a function`。e2e 用核心地图所以从未暴露。
- **堵住 4 个测试套件的假绿**（rules / map-entities / models3d / affixes-and-loot）：
  `test()` 的 catch 静默吞掉裸异常——裸 throw 既不计失败也不打印，套件照样 `0 failed` 退出 0。
  统一换成 gambling 套件的 `before = failed` 守卫。修复后立即现形并顺手修掉 rules 套件里
  3 条读旧 API 的断言（`char.scores`→`char.abilities`、`char.spellSlots`→`char.slots`、
  `char.passivePerception`→`engine.passivePerception()`）——引擎早已改名，测试坏了没人知道。
- **顺手修**：tooltip.js 触摸设备的 tooltip 一直在读 `container.__rules`（无人设置，恒为空目录），
  已对齐鼠标路径改读调用方传入的 `rulesCatalog`。

## 已实现功能清单（勿重复实现）
- 角色创建：10 种族 / 12 职业 / 16 背景 / 属性（数组/4d6/点购）/ 法术 / 装备
- 等级 1-12：XP 表、法术位表、PB 成长、4 级和 8 级 ASI、子职业（12 个，3 级觉醒）、
  5 级额外攻击、武僧拳骰/野蛮人先知/游侠漫游/圣武士灵光/游荡者闪避/战士不屈
- **交互式升级向导 (`levelup.js`)**：
  XP 达标即亮起金标徽章，支持投骰 Roll HP vs 稳妥均值、3 级 12 职业子职业选择（如冠军 19-20 暴击、战斗大师、塑能师、盗贼等）、
  4/8 级特长与属性提升（选项来自服务端 FEAT_CHOICES，含 Observant/Speedy/Chef/Musician 与 Crusher/Slasher/Piercer 等）、新法术位解锁。
- **逼真 3D 手办模型与步态动画 (`models3d.js`)**：
  复合几何体手办造型（战士阔剑盾牌、游侠兜帽箭袋弓矢、法师长袍水晶权杖、游荡者双刺、野蛮人战斧、NPC 与骷髅僵尸哥布林巨鼠地牢怪物、Boss 狂暴战甲）；
  关节步态循环（交替迈步、摆臂、垂直起伏、转向朝向平滑插值、驻留自然呼吸）。
- **战术战斗先攻条 Ribbon (`play.js`)**：
  顶部横向战斗者队列、动态双层迷你血条（危急 <25% 闪红、预警 <50% 橙黄）、活跃回合光环、阵亡骷髅蒙版、点击怪物 Token 直接锁定目标。
- **地牢内实时换装 (`game.js` / `engine.js`)**：
  包裹内直接装配武器、盾牌（+2 AC）、护甲及调谐物品，即时重算 AC 与攻击检定并播放金属音效与日志记录。
- **多层地下城楼梯下潜体验**：
  石阶交互下潜、电影感全屏地牢副标题 Banner、沉重石阶足音与环境音自然过渡。
- **Oakhaven 第五城区：英雄殿堂与战利品室 (`city.js` / `overworld.js`)**：
  包含怪物图鉴（怪物背景、属性与累计击杀数）、远征战利品展柜、英杰荣誉榜。
- **多轨音频混音器与统合设置弹窗 (`settings.js`)**：
  顶栏一键打开设置面板，整合主音量、环境音轨、程序合成音效、TTS 语音与 AI DM 选项。
- 6 张静态地图：crypt / drowned-vault / howling-hills / sewers / mill / roost；
  stairs 连通 crypt↔drowned-vault；另有无尽深渊与每周程序试炼。地图推荐等级以各 map 定义为准。
- 战斗：先攻/d20/重击/优势/法术/专注/死亡豁免/Boss 半血狂暴+拴绳(6格)/游荡怪物(22%/6步/上限2)
- 掉落表（金币骰子+概率物品）、锁箱(pickDc/forceDc)、卷轴、商店（Marla/Perra/城镇三区）
- Overworld：`#/overworld`（SVG 大地图 + Oakhaven 五城区：酒馆休息/传闻/招募同伴
  Bram+Valeria+Aldous(治疗AI)、军械库买卖、药房、公会悬赏、英雄殿堂）
- 撤退：campfire/入口 1 格内 → mode 'retreat' → /api/city/sync-delve 同步（撤退结算弹窗提供显式关闭与侧边栏随时重开，彻底杜绝悬挂弹窗）
- AI DM：旁白/NPC对话/自由动作 referee/支线任务/日志回顾/生物肖像（Google图→SD→程序符文链）
  /5 种 DM 人格预设（settings.llm.persona，游戏内顶栏快捷切换）
- 音频：合成音效 + 主题环境音 + 音量滑块（localStorage dnd_vol）；TTS：浏览器合成 +
  可选 Piper HTTP（localStorage dnd_piper，settings 页有地址栏）
- 装备纸娃娃：char.equipped 6 槽，/api/characters/:id/equip（AC 由引擎 applyClassAndSpecies
  recompute 重算——勿改回 ad-hoc 计算！equipped 护甲会 reorder 到 inventory 首位）
- 存档槽：每英雄多地牢；首页列表 ⚔/✕；顶栏「⚔ Continue」金按钮（app.js refreshContinue）
- 游戏内 DM Settings 是弹窗（点顶栏 settings 被拦截 preventDefault），不离开冒险画面

## 关键架构事实（防踩坑）
- engine 是唯一裁判：LLM 只旁白不改变结果；`server = referee` 全部状态在 server 端
- **bash 转义坑**：改 play.js 等含模板字符串的文件时，不要用 bash heredoc/`node -e` 包
  反引号——用 Write 工具写补丁文件（.cjs，单引号字符串+join）或直接用 Edit 工具
- 新版 three.module.js 依赖 three.core.js——两个都要在 public/vendor/（已提交）
- 地图 JSON 行宽必须 == width；content.js scan 会校验并在首页显示警告
- engine 内部函数直接用 `manhattan()`，不是 `engine.manhattan()`
- applyClassAndSpecies 每次调用会加一层 HP——重算时传第 5 参 recomputeOnly=true
- hint(state,key,npc,text,events) 教学提示必须传 events（漏传会 crash）

## 环境备注
- 用户的 Google AI Studio key 曾发到对话里：已提醒轮换。settings.json 内的 key 在
  data/ 卷里（gitignore ✓，备份导出已剔除 apiKey ✓）
- Docker Desktop 快捷方式：`C:\Users\xu991\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`
  （容器有时被 OOM 杀掉 exit 137——重启 `docker start ai-dnd` 即可）
- 镜像验证流程：`docker build -t ai-dnd:review .` → `docker run -d --name ai-dnd-review -p 3101:3000 -v ai-dnd-review-data:/app/data ai-dnd:review`
  → 所有测试用 `BASE_URL=http://localhost:3101` 直连容器（冒烟 + 两套 e2e 均可）。镜像里没有 tests/，
  想在容器里跑 node 测试要先 `docker cp tests ai-dnd-review:/app/tests`（容器是 Node 20，宿主是 Node 24）。
  Git Bash 下 `docker exec … ls /app/…` 会被路径转换破坏，需加 `MSYS_NO_PATHCONV=1`
- GitHub release 创建：完整流程已正式化为 **`docs/RELEASE.md`**（token 在 bash 层取后传
  GH_TOKEN、notes 写成 .cjs 脚本、tag 剥 v、双架构 manifest 验证）——发版照它走。

## 测试体系
- `node scripts/smoke-test.mjs`：端到端基础链路健康度探针（CI 每次推送必跑，自动侦测 3000/3100 端口）
- `node scripts/test-all.mjs` / `npm test`：全套 18 大测试套件，包含 D&D 2024 规则单元测试、
  3D 手办步态测试（含火龙/蜘蛛/史莱姆/火元素/活动铠甲）、精英词缀与战利品稀有度单元测试、
  地图棋盘可见性与镜头数学单元测试、移动/寻路/视野集成测试、战斗/动作集成测试、
  战术对抗（借机攻击/夹击/推撞）、角色升级（1-12 级与 6 环法术位）/地牢装备换装/楼层下潜/拓展地图集成测试、
  Headless Chrome CDP 端到端浏览器渲染与动作测试（3 套，含回合经济 HUD、出口光柱、镜头绑定与设备适配）。
- e2e 测试必须给浏览器 `--user-data-dir` 独立档案目录：Windows 上浏览器是分离进程树，
  清理时按档案目录名 PowerShell 杀进程，否则残留进程占住 CDP 端口导致下一次运行超时。
- e2e 里不要断言「走路中途」的镜头坐标：headless 下 rAF 帧率不稳，中途采样会随机失败。
  已改为「最终收敛到角色」+ 单元测试断言 `stepCameraTowards` 不会瞬移 + 源码守卫（render 里的 snap 有 guard）。
  另外镜头偏好存在 localStorage，复用 profile 会串味 —— 测试开头要把 `dnd_cam_follow` 重置为 on。

## 锻造台 / 图鉴 / 主线战役 / 设备适配（v1.9.0 已发布）
- `server/game/forge.js`：**余烬精华**货币（熔解魔法/稀有/传奇 = 1/2/4，精英 +1、Boss +2）。
  重铸词缀 60/150/400 gp + 1/2/3 精华；升阶 200/600 gp + 2/4 精华。
  **词缀组装唯一入口是 `affixes.buildAffixItem`**（战利品与锻造共用）→ 改词缀规则只改一处。
  `uniqueId` 永不改变（装备槽引用不失效）；装备中的东西必须先脱下；改完 `applyClassAndSpecies` + `syncCharToDelves` 写透活动地牢。
- `server/game/campaign.js`：四幕状态机（圣物→地窟钥匙→**三条线索任选**→烬后）。`advance()` 顺序校验 + 幂等 + 乱序忽略；
  `actDone()` 注意 clues 是对象（`!!acts.clues` 永远为真 —— 这个坑已修）；`currentAct()` 给大地图标记用。
  推进点在 `sync-delve`（`delve.mode === 'victory'`），奖励 XP/金币并写 `campaignLog`；结局面板 `#/campaign/:id` 用 LLM 写收场词（缓存到 `char.campaign.epilogue`，有兜底文案）。
- 图鉴：`char.bestiaryElite`（按怪种 × 词缀计数）、`char.bestiaryRewarded`（首杀奖励只发一次，XP 通过 `state.flags.pendingBestiaryBonus` 在击杀后一起结算）。
  殿堂条目新增 traits/attacks/resistances/vulnerabilities/immunities/boss/loot/eliteVariants + `bestiaryProgress`，UI 有筛选与 `???` 占位。
- 设备适配：`.creator-layout` 从内联样式搬进 CSS（390px 溢出 36px 的元凶）；`#map3d` 高度改 `clamp(260px,52vh,560px)`
  （**play.js 里原来的内联 height:560px 会压过 CSS，已删除**）；小地图在手机上 140px（原本占屏宽 64%）；
  顶栏允许换行（所有页面横向滚动的根源）；3D 图支持**双指拖动平移** + `touch-action:none`；提示气泡支持 tap 显示/4 秒后自动隐藏。
- `tests/e2e/responsive-cdp.test.mjs`：CDP 模拟 390×844 与 820×1180，逐页断言
  `max(scrollWidth, innerWidth) <= 设备宽度`（**用设备宽度而不是 window.innerWidth** —— 手机遇到溢出会自动撑大布局视口，用 innerWidth 会假通过）。
- 多架构：`docker-publish.yml` 加 QEMU + `platforms: linux/amd64,linux/arm64`。

## 赌桌 & 实验性魔药（v1.8.0 已发布）
- `server/game/gambling.js`：轮盘 / 骰宝 / 老虎机。**每张表都拆成纯函数求值器 + 掷骰器**，
  所以赔付率能被穷举验算（测试里就是穷举的：轮盘 36/37、骰宝 97.2%、老虎机 88.8% / 恶魔契约 84.3%）。
  所有赔率/注码/奖表都是模块顶部的表，改数字不用碰逻辑；`slotsRtp()`/`rouletteRtp()` 会告诉你改完的庄家优势。
  结算约定：**每个游戏都返回净额 `delta`**（输了是 -注，赢了是 +注×赔率），路由只加一次 `char.gold += result.delta`。
- `server/game/potions.js`：三档魔药（thin/standard/fine 15/40/90 gp，好/中/坏 55-25-20 → 75-20-5），
  **买下的瞬间就掷好效果并藏起来**（实例带 uniqueId，和词缀装备同一套约定），
  用「智力（奥秘）」检定揭晓（DC 12/14/16，**每瓶只有一次机会**）。
  效果全部复用引擎已有的 buff id（longstrider / altar_blessed / blessed / brew_fortune /
  divine_favor / poisoned 条件）+ `engine.adjustTempHp`（本场最大生命增减）+ `engine.blockRest`（少一段休息）。
- **仅限本场地牢的道具**（赌场奖品 token）：赌到 → 存在 `char.pendingDelveItems` → `POST /api/game/start`
  时带进地牢并标记 `delveOnly` → `sync-delve` **过滤掉**，没用掉的随场作废。
  诅咒走 `char.pendingCurses`，同样在开局时施加。
- 引擎新增：`engine.levelUpInfo`（上一节）、`adjustTempHp`、`blockRest`、`brew_fortune` 优势读取、
  `startGame` 接受 `carryItems`、`applyCondition` 现在有导出（potions.js 需要它）。
- **顺手修的**：`longRest` 以前调 `applyClassAndSpecies` 时漏了 `recomputeOnly=true`，
  **每次长休最大生命白涨一个生命骰**（平衡模拟里 bot 一直在偷吃这个）。修完普通单人 55-60%、困难 50-53%。
- **顺手修的**：`/api/city/buy` 现在会写透到该角色所有活动地牢存档（`addItemForCharacter`）——
  以前在城里买了东西再继续一局更早的地牢，结算时 `sync-delve` 会用快照背包覆盖档案，刚买的直接消失。

## 经验 / 升级（v1.8.0 已发布）
- **升级就绪状态只有一个来源**：`engine.levelUpInfo(char)` → `{ currentLevel, nextLevel, currentXp, xpNeeded, canLevelUp }`。
  它挂在 `/api/characters`、`/api/characters/:id`、`/api/city/info` 的 `character.levelUp`，
  以及地牢视图的 `state.levelUp`（地牢视图取**角色档案**而不是地牢快照 —— 否则「在城里升级后再继续旧地牢」
  会让徽章显示可以升级、点开却被 `/level-up` 拒绝，这就是用户报的 bug）。
- 客户端**不要再写 XP 表**：play.js / overworld.js 以前各自复制了一份 `XP_THRESHOLDS`（还漏了 11、12 级），
  已删除，徽章只读 `levelUp.canLevelUp`。新增等级段时只改 `engine.XP_THRESHOLDS` 一处。
- e2e 里有该 bug 的回归测试（改 characters.json 造出「档案 Lv3/1000xp + 快照 Lv2/950xp」的错配）。

## 视角与棋盘（v1.8.0 已发布）
- `public/js/entity-visibility.js`：纯函数 `isEntityOnBoard`（死亡/逃跑离开棋盘，玩家永不隐藏）、
  `stepCameraTowards`（帧率无关的镜头缓动）、`clampToMap`。2D/2.5D 共用。
- 尸体会留在场上的老 bug：`layoutEntities` 里 `if (!disc.has(key) || (e.alive === false && …)) return;`
  只跳过*更新*，没删掉已有 node → 尸体模型永久留在场景里。现在按 `isEntityOnBoard` 移除节点。
- 镜头绑定：`createMap3D(…, { follow, onFollowChange })` → `setFollow(v)` / `isFollowing()`；默认跟随，
  右键（或中键）拖拽即解绑并能平移到地图任意处，滚轮缩放；点 HUD 的 🎥 按钮（或按 F）切回跟随并归位。
- 镜头不再瞬移：`render()` 只在换图/首次/超远传送时 snap，其它帧由 rAF 循环 `stepCameraTowards` 缓动跟随
  *手办模型*的位置（模型沿 waypoint 走，约 4.6 格/秒）。
- rAF 循环里每帧调用 `animateFrom(currentGame)`：走路被打断（连续两次移动）时手办不会卡在少一格的位置。
- `window.__dndDebug` 是 e2e 用的测试缝（camera / follow / boardCount / playerTile / modelState）。

## 精英怪物 & 战利品稀有度（v1.8.0 已发布）
- `server/game/affixes.js`：5 种精英词缀（炽炎/石肤/嗜血/剧毒/狂雷）+ 武器/护甲词缀 + `rollMagicItem()`
- 精英生成：`generateMapState` 与 `rollWanderingMonster` 里非 boss 怪物 18% 概率；boss 永不为精英
- 精英词缀：HP ×1.15~1.4、XP ×1.5、掉落保底 1 件魔法/稀有装备 + 15-30 gp；boss 保底稀有/传奇 + 50-100 gp
- 战斗实现：`monsterAttack` 附加元素骰/吸血/中毒（`applyCondition` 1 回合，攻击劣势），
  `applyDamage(state,target,amt,type,events,{magical})` 支持怪物抗性 + 石肤「非魔法武器」豁免
- 装备实现：稀有物品带 `uniqueId`，装备/解析一律用 `engine.invEntry` / `engine.equippedBonus`；
  `atk.dmgMod`（能力调整值）现在真正计入伤害；魔法武器加值只算一次（勿在 attackMods 里重复加）
- 客户端：`play.js` 背包弹窗按稀有度着色 + `[🔵魔法/🟣稀有/🟠传奇]` 标签；tooltip 支持
  `data-item-tooltip` 传 JSON（程序化生成的装备）；3D 里精英有彩色名牌 + 光环点光源 + 1.15 倍体型

## 版本历史
v1.0.0 首发 → v1.2.0 连通地牢+模组+任务 → v1.3.0 UI 修复 → v1.4.0 等级6-10+嚎叫丘陵+音频
→ v1.5.0 Overworld+Oakhaven+纸娃娃+路上遭遇+撤退+审查修复
→ v1.6.0 3D模型与步态动画 + 升级向导 + 战术先攻条 + 局内换装 + 楼层过渡 + 英雄殿堂图鉴 + 全套测试
→ v1.7.0 等级上限 12 + 阳光峡谷 3 大新地图 + 无尽深渊程序化地牢 + 5 大新怪 3D 手办 + 传奇成就
→ v1.8.0 精英词缀怪物 + 战利品稀有度/词缀系统 + 视角解绑与平滑跟随 + 尸体移除修复 + 升级徽章一致性修复 + 酒馆赌桌 + 实验性魔药
→ v1.9.0 锻造台（余烬精华/重铸/升阶）+ 图鉴精英变体与首杀奖励 + 四幕主线战役与 AI 结局 + arm64 多架构镜像 + 手机/平板全站适配
→ v1.9.1 AI 协作基建（AGENTS.md/CLAUDE.md 入口）+ dmgType→damageType 统一 + tsc 全仓覆盖（含 public/js）+ 活动铠甲 3D 渲染崩溃修复 + 4 个测试套件假绿修复
→ v1.9.2 视图模块拆分（play/panels·ribbon·delve-inventory，overworld/districts·road-encounter）+ 路遇落库修复 + 队友忠诚度（持久化心情 + 吐槽 + DM 台词）
→ v1.9.3 深渊楼层变异（精英横行/群涌暗潮/鎏金之层）+ 队友深层台词 + 殿堂深渊远征榜 + 仓库自带 MCP server（四只读工具）+ 存档 schema 版本化
→ v1.9.4 PWA 离线缓存 + 新特长 Observant/Speedy/Chef/Musician + CDP 瞬挂根因修复 + 回放机器人（REST API 打完整冒险 + 游戏级不变量，17 套件）
→ v1.9.5 事件契约 + run_replay MCP + 套装物品
→ v1.9.6 / v1.9.7 同伴支线与沉浸模式 + 每周种子挑战 + Boss 绝境阶段与新怪
→ v1.9.8 Crusher/Slasher/Piercer + Boss 专属机制 + 每周奖励
→ v1.10.0 快速开始与教学 + 全程目标/下一步 + 状态与一次结算可靠性 + 引擎检定/路遇恢复 + 内容包校验/导入回滚 + 山谷哨门两路线与持久 NPC 记忆 + Docker 完整验证与 agent 交接（当前代码版本）
