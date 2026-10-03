# T3a — 旧档恢复、结算镜像与键盘边界补修

- 状态：done（2026-10-01）。
- 更新：2026-10-01。
- 前置：T2a/T3 现有实现。
- 类型：完成后独立复核发现的三处小范围补修；[证据](../docs/T2A_T3_REVIEW_2026-09-30.md)。

## 代码入口与问题

1. `server/routes/city.js` 按 `endSeq || 1` 结算旧终局档，却不建立计数基线。真实 respawn 后再 retreat，计数又为 1，新结局被错误去重，新战利品不入账。读 store 迁移与 engine 三个终局转换点，不只修改字符串拼接。
2. 同路由 duplicate 分支仅在 `!delve.settled` 时修镜像。已有 #1 镜像、#2 镜像写失败时，重试不会修复；后续档案收据缺失可能重复结算。
3. `public/js/views/play/panels.js` 的返回链接只用 `.locked` + pointer-events:none 禁用。结算失败时真实 Enter 仍可导航；必须按保存确认状态控制导航事件与可访问性。

相关现有测试：`tests/integration/settlement.test.mjs`、`tests/unit/store-versioning.test.mjs` 与 fixtures、CDP gameplay-refinements。扩展既有套件，避免为几条断言再增加新套件。

## 范围约定

- 保留收据 `<saveId>#<endSeq>` 与角色档权威、地牢镜像的设计，标识继续独立于 rev。
- 为缺计数的旧终局档建立稳定基线；真实恢复后下一次结束使用下一序号。镜像写入失败也不能使计数基线丢失。考虑已由当前 T3 结算、仍缺 endSeq 的旧档形状。
- 根据当前结算身份修复缺失或过期镜像；只补收据，不重放奖励，不覆盖之后的购买、装备或升级。
- 保存中/失败不能通过鼠标、键盘、程序触发的导航 click 离开结算返回入口；成功后启用。Review/关闭保持原规格。金额文案在确认前不要宣称已入账。
- 不重做多存档经济、不改数值、不实施 T4。所需旧档字段与迁移说明保持真实。

## 验收标准

- [x] 真正删除 endSeq 的旧死亡 fixture：首次 #1 结算 → 真实 respawn → 真实 retreat/死亡；第二次为 #2、duplicate=false，新金币/物品入账，重复 #2 恰好一次。
- [x] 旧档首次镜像写入失败后的恢复也不会复用 #1；既有新档两个终局与晚到旁白回归保持通过。
- [x] 先有 #1 镜像，#2 的角色收据成功/镜像失败 → 重试修成 #2；移除角色收据后仍从正确镜像去重，计数/奖励不再增加。
- [x] 角色权威写失败仍不产生成功收据，重试恰好一次；重复处理后的购买/升级仍保留。
- [x] 真实浏览器保存中和失败状态聚焦返回链接并按 Enter，不跳转；尝试 `.click()` 也不跳转。成功后鼠标与键盘能正常返回，失败可重试。
- [x] 真实旧档迁移/回归与完整 `npm run verify` 通过，说明首次失败/重跑情况，记录接口/迁移与试玩步骤。

## 验证与交接结果

独立 DATA_DIR，本地故障注入。并发按信号控制，不依赖固定 sleep 或 RNG 具体值；浏览器检查最终页面/服务端状态。若意外改数值，依 AGENTS 跑 balance-sim。

- 完成范围：三处边界全部修复。**P1**：`server/store.js` 的 `migrateSave` 在读取时为缺 endSeq 的旧终局档（victory/retreat/over）补 `endSeq = 1` 基线——迁移只增字段、每次读取都重新兜底，镜像写失败也丢不掉基线；下一次真实结束从 2 起算，`settleId` 不再与旧收据碰撞。**P2 镜像**：`server/routes/city.js` 的 duplicate 分支在镜像缺失**或过期**（`delve.settled.id !== settleId`）时都修成当前收据，仍只补记录、不重放奖励。**P2 键盘**：`public/js/views/play/panels.js` 的结算面板用 `navLocked` 点击守卫 + `aria-disabled` + `tabindex="-1"` 在保存中/失败时封锁真实 Enter、辅助技术和脚本 `.click()`（`.btn.locked` 的 pointer-events 继续挡鼠标）；金额行确认前显示 "Gold this delve"，服务端确认后才改为 "Gold banked"。
- 验证：
  - `tests/integration/settlement.test.mjs` 新增 3 条 T3a 回归（旧死亡档 #1→真实 respawn→真实 retreat→#2 且金币/物品入账；旧档镜像写失败后恢复仍得 #2；过期 #1 镜像修成 #2、收据丢失后仍去重、之后购买不被回滚），`tests/unit/store-versioning.test.mjs` 新增基线单测，fixture 语料新增 `legacy-death-delve.json`（真正缺 endSeq 的旧死亡档）。
  - `tests/e2e/gameplay-refinements-cdp.test.mjs` Check 10 扩展：锁定态断言 `aria-disabled="true"` / `tabindex="-1"`、脚本 `.click()` 不跳转、真实 CDP Enter 键不跳转；确认后链接恢复可聚焦并真实导航（5 条新断言全过）。
  - 完整 `npm run verify`（隔离 DATA_DIR）：**首轮即全绿**，eslint、tsc、19 套件（含 3 个 CDP e2e）、smoke 全过；settlement 103 断言、store-versioning 103 断言、gameplay-refinements e2e 59 断言 0 失败。未出现复核报告中的词缀随机波动；未改任何数值表，无需 balance-sim。
  - 真实浏览器验收（独立 Edge headless + 隔离 DATA_DIR + 独立端口，信号控制故障注入，20 项全过）：保存中/失败/成功/重开四态截图核验；保存中与失败态聚焦返回链接按真实 Enter、脚本 `.click()`、真实鼠标点击均不跳转；服务端在锁定期间 0 落盘；重试成功后 `#1` 收据一次入账、链接解锁后真实鼠标点击正常返回 Oakhaven；重开显示 "Already settled" 且不再入账。证据截图：`C:\Users\xu991\AppData\Local\Temp\ai-dnd-t3a-accept-evidence`（summary-saving/failed/saved/reopened.png）。
  - 已由旧代码造成、磁盘上已是 endSeq=1 且收据为 #1 的"双重结束"存档未做时间戳启发式修复（会误伤正常重开）；本补修保证基线建立后不再产生这种形状，如需处理已有此类档需另行指派。
- 手动试玩路径：开始任意地牢 → 走到营火 `retreat`（或死亡）→ 结算面板出现后立刻观察 "Gold this delve" 与灰锁链接 → 断网/停服务观察失败态与重试 → 恢复后重试确认 "Gold banked" 与收据 → 点 Return to Oakhaven 回城。
- 未完成项：无（本规格范围内）。
- 下一建议：T4 已实现，最新复核建议先完成 T4a；需用户另行指派。

## 独立复核补记（2026-10-01）

[T3/T4 独立复核](../docs/T3_T4_REVIEW_2026-10-01.md) 再次跑真实旧死亡档恢复、#2 镜像故障与备份恢复、浏览器保存四态和 Enter/程序点击锁定，三处原问题均通过；T3a 继续为 done。完整 verify 首轮全绿，未改游戏代码或数值。
