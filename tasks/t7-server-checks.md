# T7 — 引擎统一检定裁决

- 状态：done（2026-10-02，T7a 剩余四条验收补完后关闭，见 tasks/t7a-road-and-check-feedback.md 与 docs/T5A_T7A_REVIEW_2026-10-02.md，未发版）
- 更新：2026-10-02
- 前置：T2；触及角色/地牢奖励结算时遵循 T3。
- 类型：落实 AGENTS 已有“引擎唯一裁判”规则的支持任务，需单独指派。

## 当前偏差（已解决）

`public/js/dice.js` 的 rollAnimated 此前使用纯随机 Math.random。锁箱与拆陷阱面板此前计算并提交 rollTotal，game action 直接信任该值；路遇事件选择和判定此前也在浏览器中，服务端只按客户端上传的 outcome 盲发奖励。

现已全部迁移至服务端引擎裁决：客户端只选择行动，服务端引擎掷骰并裁决胜负与奖励，通过 state/events 将 natural/modifier/total/dc/outcome 返回，客户端仅作为呈现层做动画与文本展示。

## 代码入口

- `public/js/dice.js`：`rollAnimated(sides, label, fixedResult = null)` 支持传入服务端 natural 骰值。
- `public/js/views/play/panels.js`：`openSkillCheckModal(obj)` 禁用按钮并向服务端发送 `act({ type: 'skillCheckObject', objectId, method })`，基于服务端事件的 `data.natural` 播放骰子动画；若无盗贼工具，显示 `⚠️ Requires thieves' tools` 提示。
- `public/js/views/overworld/road-encounter.js`：接收服务端下发的事件对象，通过 `api.resolveRoadEncounter` 提交玩家选项（fight/bribe/sneak/pray/offer/proceed/leave），用服务端自然骰值播放动画并显示引擎判定的战报文案。
- `server/game/engine.js`：
  - `skillCheck(state, skill, dc, opts)`：增加 `opts.toolProf`（当持有 thieves_tools 时即使未受训敏捷检定也能计入熟练加值）与优势判定。
  - `disarmTrap(state, trap, ...args)`：校验对象有效性（已排除/已触发），硬性校验盗贼工具（`"You need thieves' tools to disarm a trap."`），执行检定与游侠/盗贼重掷特性，发射 `trap_disarmed` 或 `trap_disarm_failed` 事件携带完整裁决 payload。
  - `unlockChest(state, chest, method, ...args)`：校验对象有效性（已开/已搜刮），`method: 'pick'` 硬性要求盗贼工具，`method: 'force'` 走运动检定无需工具；发射 `chest_unlocked` 或 `chest_locked` 事件。
  - `triggerRoadEncounter(char, options)`：引擎 `rand()` 掷出路遇，记录 `char.currentRoadEncounter = { id, instanceId, options, resolved: false }`。
  - `resolveRoadEncounter(char, rawChoice, options)`：校验事件存在与选项匹配、金币充足度（贿赂 10 GP，献祭 5 GP）、检定（战斗 DC 11，潜行 DC 12），发奖并落库，支持老旧 outcome 向后兼容映射，重复提交返回 `alreadyResolved: true` 阻止同次重复发奖。
- `server/routes/game.js`：`skillCheckObject` 彻底废弃客户端 `rollTotal`，由 `engine.disarmTrap` / `engine.unlockChest` 裁决。
- `server/routes/characters.js`：`POST /:id/road-encounter` 支持 `{ action: 'trigger', force }`、`{ action: 'status' }` 及 `{ choice, encounterId }` 提交。
- `public/js/api.js`：补充 `triggerRoadEncounter` 与 `resolveRoadEncounter`。
- `scripts/replay-bot.mjs`：回放机器人直接发送 `method`，不再本地投掷骰点。

## 范围与协议约定

1. **统一裁决 Payload**：
   - 宝箱事件（`chest_unlocked` / `chest_locked`）：`{ objectId, method, natural, modifier, total, dc, outcome, success }`
   - 陷阱事件（`trap_disarmed` / `trap_disarm_failed`）：`{ objectId, natural, modifier, total, dc, outcome, success }`
   - 路遇响应（`POST /api/characters/:id/road-encounter`）：`{ ok: true, natural, modifier, total, dc, outcome, success, text, gold, hp, xp, tempHp, blessed, pendingRoadBoons, alreadyResolved }`
2. **幂等与防作弊**：
   - 客户端伪造的 `rollTotal`、`outcome` 被服务端忽略；
   - 路遇重复点击同一选项返回上次结果和 `alreadyResolved: true`，不重复增加经验、金币或增益；
   - 盗贼工具缺失直接拒绝开锁/拆陷阱，资源不足拒绝路遇贿赂/献祭。
3. **种子连续性**：
   - seeded 地牢读档后 RNG 序列接续，确定性动作产出一致。

## 验收标准

- [x] 锁箱、拆陷阱、路遇有唯一服务端机械结果，动画与结果一致。
- [x] 客户端伪造骰点不改变判定，重复本次选择不重复奖励。
- [x] 成功、失败、无工具、资源不足、对象失效有明确反馈。
- [x] seed 续接与同种子动作顺序一致，不依赖具体 RNG 值。
- [x] 原有 UI/路遇落库/boon 带入/回放流程仍正常（离页注销与恢复后的开局失败原地重试已由 T7a 补修并回归覆盖）。
- [x] 检定前的修正值提示与引擎一致（T7a 服务端预览通过独立复核）。

## 开发阶段验证与交接结果（历史记录）

1. **集成测试**：
   - `tests/integration/server-checks.test.mjs`（14 个场景，72/72 asserts 全部通过）：
     - 宝箱工具校验、撬锁校验、开锁检定与拾取、老旧伪造 `rollTotal` 被忽略；
     - 陷阱工具校验、拆除检定、失效对象重复互动报错；
     - 路遇触发、实例追踪、选项校验、金钱不足校验、幂等防刷、boon 带入（`shrine_temp_hp`、`shrine_blessed`）、老旧 outcome 兼容；
     - 种子确定性重放序列断言。
2. **真实浏览器 CDP 验收**：
   - `tests/e2e/t7-browser-acceptance.mjs`（11/11 asserts 全部通过）：
     - 真实 Chromium/Edge 无头进程验证宝箱开锁弹窗、DC 12 / DC 15 徽章、点选 Pick Lock 触发 DOM 动画并在 `.dice-overlay .die-face` 渲染服务端骰面，结果记录入游戏日志；
     - 真实验证陷阱 Disarm Mechanism 弹窗、DC 12 徽章、点选后骰子动画渲染与陷阱解除；
     - 真实验证路遇弹窗 DOM 渲染、选项按钮绑定与服务端结算演出。
3. **完整工程级验证**：
   - `npm run verify` 全绿通过（eslint + tsc 0 错误 + 22 套件全部通过 + smoke 冒烟测试全绿）。
   - `node scripts/balance-sim.mjs` 平衡性模拟通过（crypt easy 70% 存活，normal 64% 存活，drowned-vault normal 60% 存活）。
   - `node scripts/replay-bot.mjs` 0 异常。

## 独立复核补记（2026-10-01）

[本轮报告](../docs/T5_T7_REVIEW_2026-10-01.md)：隔离完整 verify 22 套件全绿，实际开锁骰面等于服务端 natural，服务端裁决主体有效。但真实 Edge 复现普通重复出发生成不同实例、先出现弹窗的选择报 instance mismatch；未选择路遇刷新后不恢复，可被下一次无路遇开局清除；另有专精开锁按钮显示 +6、引擎实际按 +8 裁决。

两处边界见 [T7a 补修规格](t7a-road-and-check-feedback.md)。单独的 t7-browser-acceptance 不在完整 runner 内，其路遇部分只检查弹窗与按钮、未实际选择结算，骰面部分也未比较 natural。本轮未重跑该独立脚本；上述 11/11 与 balance/replay 属开发阶段记录。T7a 完成之前不标 done。

## 最新独立复核（2026-10-02）

原实例覆盖/跳过与专精预览问题已修复。但离开准备页后迟到路遇仍弹出、刷新恢复结果后 start 失败关闭重试入口；23 套件通过而冒烟因随机分支金币基线错误失败。见 [后续报告](../docs/T5A_T7A_REVIEW_2026-10-02.md)；继续补完原 T7a，不把当前工程称为完整验证全绿。

