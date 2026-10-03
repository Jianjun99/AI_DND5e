# 本轮开发任务队列

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
T1、T2、补修 T2a 与 T3 已实现（2026-09-30），T3a 完成并通过独立复核（2026-10-01）；T4 与 T4a 已复核。T5/T5a 通过；T7/T7a 已补完 2026-10-02 复核剩余项并关闭。T8 与 T6 已于 2026-10-03 验证完成。本轮队列已完成，等待试玩反馈或新任务；不重开 T5a 或新增 T7b。

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
