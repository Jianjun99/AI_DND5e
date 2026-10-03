# T3 — 一次结算与回城

- 状态：done（2026-09-30，`npm run verify` 全绿后更新）
- 更新：2026-09-30
- 前置：T2；T2a 已确认完成（2026-09-30）后才实施本任务。
- 类型：已复现重复结算修复，加明确的结算完成反馈。

## 玩家问题与复现

用同一已 retreat 存档调用两次 POST /api/city/sync-delve，评估时 delvesCompleted 从 1 变 2。主线 advance 有去重，不代表整局结算有去重。

openSummary 每次打开都会发送 sync-delve 且吞掉失败，导航立即可用。旧快照同步还可能覆盖后来购买/升级；这是代码观察，实施时需独立回归验证。

## 代码入口

- `server/routes/city.js`：sync-delve、saveChar、购买/锻造向地牢同步、weekly。
- `server/store.js`：存档版本与两类文件持久化。
- `public/js/views/play/panels.js`：openSummary；`play.js`：结束与重开。
- `server/game/campaign.js`、engine.levelUpInfo 与现有升级流程。
- progression-systems 的重复主线推进测试、store-versioning fixture、CDP summary 流程。

## 范围与实现约定

为一次结束冒险保存稳定结算标识和收据，角色档案记录已处理标识。重复请求只返回已确认收据，不重放旧背包或重复处理次数、金币、XP、weekly、主线。

沿用 T2 的最新状态提交契约。结算标识独立于 `state.rev`：旁白和辅助结果写入也会递增 rev，不能因此产生新结算。完成前复核见 [T1/T2 报告](../docs/T1_T2_REVIEW_2026-09-30.md)。

先检查存档存在、所属英雄与可结算状态。审查现有无存档增量入参的用途，不能把不可信客户端数值当权威奖励；若需保留兼容路径，写明真实使用者与边界。

角色与地牢是两份 JSON 文件：明确重复处理的权威记录及写失败后的恢复方式。结算界面显示保存中/成功/失败，成功后才说明奖励已保存并允许相应返回操作；失败可重试，重开详情只读。

保持已有多地牢存档可继续。写清旧快照对角色后续购买、装备、升级的同步权限，不在本任务强行改成单活动存档，也不重做英雄经济系统。

## 验收标准

- [x] victory/retreat 的重复结算返回同一收据，所有相关计数与奖励只处理一次。
- [x] 先结算，再购买/升级，再打开旧结算，之后的变化被保留。
- [x] 错误归属、不存在或不合适状态有明确错误，不写角色奖励。
- [x] 模拟保存失败/请求失败后可恢复和重试，不出现奖励重复或假成功。
- [x] 回城获取最新角色与主线；死亡恢复流程仍正常。
- [x] 旧档可读，新字段/迁移 fixture 与多存档约定有记录。

## 验证

扩充 HTTP integration 与真实浏览器结算流程，不只断言 campaign.stage。按 AGENTS 完整 verify；若更改经济/数值则 balance-sim 并报告变化。

- 新套件 `tests/integration/settlement.test.mjs`（第 19 套件，进程内真实路由）61 项断言：
  重复结算同一收据且 rev 增长不影响、结算后购买+升级不被旧快照回滚、角色档写失败
  （stub 抛错）→ 500 且零落盘 → 重试恰好一次、镜像写失败不破坏结算且重试自愈、
  档案丢收据从存档镜像去重并自愈、归属/不存在/未结束/缺参/残缺档全部明确报错零写入、
  死亡→respawn→再死两次结算各一次、weekly 只计一次。
- `progression-systems`（HTTP、独立服务）双结算断言扩充：收据 id 稳定、duplicate 标记、
  delvesCompleted 增量恰好 1；gamble 段落改为先置 retreat 终局再结算（匹配新契约）。
- CDP `gameplay-refinements-cdp` 新增 Check 10：真实浏览器注入第一次 sync-delve 网络失败 →
  面板显示保存失败、返回链接全部锁定、提供重试按钮 → 重试成功显示 "Spoils banked" +
  收据 id `save_x#1` 且返回链接解锁 → 服务端恰好一次入账 → 重开摘要显示 "Already
  settled" 只读确认，服务端不再入账。
- `npm run verify` 全绿（eslint / tsc / 19 套件 / smoke，独立 DATA_DIR）。数值表未动，
  未跑 balance-sim（无经济/数值改动——收据只是把既有入账做一次性的门禁）。

## 交接结果

- 完成范围（2026-09-30）：
  - **结算标识独立于 rev**：engine 在三个终局转换点打 `state.endSeq`（engine.js 死亡、
    `checkVictory`、routes/game.js 的 retreat case；respawn 不清零——第二次死亡以 `#2`
    再结算）。结算 id = `<saveId>#<endSeq>`，旁白/辅助写只递增 rev，绝不产生新结算。
    无 endSeq 的旧档按 `#1` 读取（旧档可读，已结算过一次后自然纳入去重）。
  - **收据与去重（city.js sync-delve 重写）**：收据 `{ id, ts, mode, mapId, mapName, gold,
    xp, level, delveNumber, campaignAdvanced, weeklyWin }` 存角色档 `char.settlements`
    （上限 100 条，权威记录，**先写**；写失败则零落盘、重试重算）并镜像到地牢档
    `state.settled`（尽力而为，**后写**，失败不影响结算成功）。重复请求返回同一收据
    `duplicate: true` 且零写入；档案丢收据（如备份还原）时从存档镜像去重并把收据自愈
    回档案；镜像缺失由重复路径补写。全部校验在任何写入前完成。
  - **归属与状态校验**：非本人存档 403、不存在 404、未结束（explore/combat）400、缺
    delveStateId 400、无角色快照的残缺档 400，全部不写任何奖励。**移除无存档增量入参
    兼容路径**（goldGained/xpGained/newItems）——grep 确认无任何真实使用者（客户端、
    replay-bot、测试均只发 delveStateId），不再把不可信客户端数值当权威奖励。
  - **客户端结算反馈（play/panels.js openSummary 重写）**：打开摘要即结算——保存中
    （💾）/成功（✅ Spoils banked + 收据行）/失败（⚠️ + 重试按钮）；返回城镇/大地图/
    主页链接与"回营地恢复"在确认前锁定（新增 `.btn.locked` 锚点禁用样式），✕ 与
    🔍 Review 始终可用（只读查看）；重开已结算摘要走服务端去重，显示 "Already
    settled — receipt confirmed" 只读确认，不会重复入账，也不会用旧快照覆盖之后的购买/
    装备/升级。多存档继续可用：未结算的旧档照常各结各的（endSeq 各自独立）。
  - **文档**：ARCHITECTURE §7 新增结算契约段；AGENTS/RELEASE/PROJECT_STATE 套件数
    18→19；`tests/fixtures/saves/settled-delve.json` 迁移 fixture（含 endSeq/settled，
    store-versioning 自动断言字段在迁移中不丢）。
- 接口/旧档约定：sync-delve 响应新增 `receipt`、`duplicate` 字段（additive），`char`
  仍在；请求体不再接受 goldGained/xpGained/newItems（无使用者）；地牢档新增可选
  `endSeq`/`settled` 字段，旧档缺失视为 `endSeq=1`/未结算；saveVersion 仍为 2（纯增量
  字段，迁移链不变）。响应形状变化对 replay-bot 无影响（其 sync 带 try/catch）。
- 验证：见上节；`npm run verify` 全绿；真实浏览器（headless Edge CDP，Check 10 自动化
  断言 + 截图路径可复跑）。
- 本机证据：临时复跑脚本与三张截图（保存失败/成功/重开只读）在
  `C:\Users\xu991\AppData\Local\Temp\ai-dnd-t3-visual\`（`check.mjs` 自带独立 DATA_DIR
  与浏览器档案，用后可整目录删除；截图在 `shots\` 子目录）。
- 未完成项：无。
- 下一建议：T4（全程目标与下一步），需用户另行指派。

## 完成后独立复核（2026-09-30）

普通重复结算与已有验收用例通过；独立复核另复现缺 endSeq 的旧死亡档恢复后新结局误去重、第二次镜像失败不自愈、失败状态 Enter 导航绕过锁定。原实现记录保留，新发现尚未修复；建议先完成 [T3a](t3a-settlement-boundaries.md)，再开始 T4。[复核报告](../docs/T2A_T3_REVIEW_2026-09-30.md) 含真实路由/浏览器证据和复制提示词。
