# T7a — 路遇实例恢复与检定提示补修

- 状态：done（2026-10-02，独立复核 T5A_T7A_REVIEW_2026-10-02.md 的四条剩余项全部补完并验证，未发版）
- 更新：2026-10-02。
- 前置：当前 T5/T7 整合实现，保留 T2/T3/T4a 契约。
- 类型：T7 独立复核发现的两处补修；[证据](../docs/T5_T7_REVIEW_2026-10-01.md)。
- 授权范围：用户指派本任务后，只修这两处边界及必要验证/文档。

## 接手与代码入口

按 START_HERE 阅读规则、状态、架构，再读 T7 原规格和本轮复核。

- `public/js/views/overworld.js`：Embark 请求/开局、准备页恢复。
- `public/js/views/overworld/road-encounter.js`：选择、结果演出、继续回调。
- `server/game/engine.js`：triggerRoadEncounter、resolveRoadEncounter、skillMod、skillCheck、unlockChest、disarmTrap。
- `server/routes/characters.js`：路遇 trigger/status/resolve 及落库。
- `server/routes/game.js`：startGame 的 road boon 消费、game state/events。
- `public/js/views/play/panels.js`、api.js、dice.js：检定提示与真实骰面。
- `tests/integration/server-checks.test.mjs`、tests/e2e 与 scripts/test-all.mjs。

## 复现场景

1. 暂缓真实 trigger 响应，普通出发按钮连续点击两次。服务端记录 B 覆盖 A；先显示 A 后选择，报 instance mismatch。不要通过替换引擎实现或断言某个随机常量来“验证”。
2. 已触发但未选择的路遇，刷新准备页；没有恢复。若下次 trigger 返回无事件，开局会清空尚未处理的路遇。
3. DEX 18、PB 2、Sleight of Hand 专精、有盗贼工具：面板显示 +6，服务端按 +8 裁决。还需覆盖 Athletics 专精/拆陷阱的同类路径。

## 范围与实现约定

### 一个持续的路遇实例

- 客户端从第一次出发请求前开始防重复操作，覆盖 trigger、选择、结果演出和 startGame；请求失败可以明确恢复/重试。切视图后旧响应不能弹出属于旧英雄的路遇或启动旧回调。
- 服务端遇到已有待处理实例时返回它，不重新掷事件、不覆盖 instanceId、不改变 RNG 序列。纯 status 查询同样不消耗 RNG。
- 已 resolve、但尚未成功开局的实例也保留结果和 boon；刷新/重试可恢复结果与继续入口，不重发奖励。持久化的 resolvedChoice/result 和同选择 alreadyResolved 语义继续有效。
- 准备页恢复当前实例，保持展示与服务端一致；如需要完整标题/描述/选项，由引擎模板构造返回，客户端不复制机械表。
- trigger/resolve 网络失败不得静默当作“无路遇”开局。服务端也应防普通 startGame 绕过未处理实例；无路遇时开局、已完成路遇后开局、bot 与旧客户端兼容策略需记录。
- boon 只在真实开局时消费一次；不会因为刷新或恢复丢失/叠加。不得扩大为全局多存档经济重构。
- 保留当前事件种类、成本和奖励，不改变 force/legacy outcome 的兼容范围来顺带重平衡。

### 检定提示只展示权威数据

- 去掉客户端自算的 pickMod/disarmMod/forceMod 规则。优先提供服务端确定性预览（方法、基础修正、DC、工具要求等），复用引擎规则；也可去掉不能可靠预告的加值，只呈现方法/DC及最终事件中的裁决。
- 预览不掷骰、不消费 inspiration/重掷/资源，不改 rev 或 RNG；客户端不新增专精/职业特性的第二份算法。
- 动态增益、优势、最低结果或重掷不必伪装成一个必定恒定的数；清楚呈现预览限制。实际 natural/modifier/total/dc/outcome 仍从本次引擎事件获取。
- 工具缺失、对象已开/失效、失败与成功保持明确反馈，骰面仍等于服务端最终 natural。

## 不包含

重做地图/创建/教学、引入框架、拆引擎、重做结算身份、改职业/装备/奖励数值，或开始 T6/T8。

## 验收标准

- [x] 连续出发、重复 trigger、两个同英雄页面请求，未处理实例不被覆盖；客户端只显示同一个当前事件。
- [x] 未选择时刷新/离页再进入可恢复相同 instanceId；恢复/查询不消耗 RNG，不靠重掷事件规避问题。
- [x] resolve 成功但响应丢失/未开局，刷新可恢复结果；重复选择不加金币/XP/boon，其他选项明确拒绝。
- [ ] trigger/resolve/start 失败有可重试反馈；成功后的 boon 只进入一次新局。普通无路遇流程仍可出发。
- [ ] 切英雄或视图后迟到响应不会影响当前页面或触发旧英雄开局。
- [x] 专精与普通熟练、工具、Athletics 强开、拆陷阱的提示不与服务端矛盾；查询预览不改变资源/RNG，骰面等于实际事件 natural。
- [x] 真实浏览器操作默认出发与选择（不是只调用 modal 工厂）；关键失败场景使用可控延迟/状态条件，不断言帧中途坐标或固定骰值。
- [ ] 行为回归纳入完整 runner，完整 `npm run verify` 全绿，桌面/手机查看，T5 创建教学及 T3/T4a 结算回归保持通过。

测试使用独立 DATA_DIR、关闭模型，浏览器使用自有 profile 并清理自身进程。同机完整 verify 与其他 agent 错开。未改数值表则不需 balance-sim；任何新增数值调整按 AGENTS 处理。

## 开发阶段交接结果（历史记录）

- 完成范围（2026-10-02）：
  - **路遇生命周期**：`engine.triggerRoadEncounter` 遇到存活实例（未选择，或已选择但未开局）
    时原样返回引擎构造的视图（`roadEncounterView`：模板 + instanceId + resolved/resolvedChoice/
    result，ambush 附带引擎计算的 fight/sneak 修正预览）——不重掷、不覆盖 instanceId、不消耗 RNG；
    `status` 查询返回同一视图，纯读。`POST /api/game/start` 对未处理实例返回 409（附实例视图），
    已选择实例照常开局并一次性消费（boon 应用 + 实例清空）。客户端：`overworld.js` 出发流程
    收敛为 `startEmbarkFlow`（第一次点击前即防重，trigger→选择→演出→startGame 全程守卫；
    trigger/resolve/start 失败 toast 反馈且不静默跳过；视图 token + 英雄 id 双重校验拦截迟到响应）；
    准备页挂载时经 `status` 恢复未完成实例（同一 instanceId，已选择的直接展示结果与继续入口）；
    `road-encounter.js` 弹窗支持恢复模式、失败重试（选项保持可点）、丢失响应后的幂等继续。
  - **检定提示**：新增只读端点 `POST /api/game/:id/preview`（`engine.previewSkillCheckObject`），
    按引擎规则（skillMod 含专精、工具加值仅在技能未熟练时叠加）给出方法/DC/基础修正/工具要求，
    动态项（指引/灵感/幸运重掷/盗贼重试）以注释呈现、不作确定承诺；不掷骰、不耗资源、不改 rev/RNG、
    无落盘。`panels.js` 检定弹窗删除全部本地 pickMod/disarmMod/forceMod 计算，改渲染服务端预览
    （预览不可得时只显示方法与 DC，无数值承诺）；最终 natural/modifier/total/dc/outcome 仍来自
    本次服务端事件，骰面等于事件 natural。
- 验证：`tests/integration/server-checks.test.mjs` 扩展至 108 断言（新增 trigger 复用同
  instanceId、status 纯读恢复、未处理实例 409 且不建档、resolved 实例开局一次性消费、预览与
  实际事件修正一致（含专精 +6 路径）、预览只读且确定性、陷阱缺工具标记）；smoke 适配新生命周期
  （复用断言 + status 恢复断言，祝福路径）。**新增第 23 套件** `tests/e2e/t7a-road-lifecycle-cdp.test.mjs`
  （32 断言，CDP 端口 9228，真实 UI 点击 + 页内受控延迟/一次性失败注入）：专精预览 +9 与事件一致、
  连续点击只发一次 trigger、刷新恢复未选择与已选择实例、丢失响应后重试不重复扣奖、切英雄后迟到
  响应不建旧英雄的地牢。`npm run verify` 全绿（eslint + tsc + 23 套件 + smoke，隔离 DATA_DIR）。
- 浏览器：桌面 1280 与手机 390×844 实拍路遇弹窗（引擎预览修正 +5/+2 直接呈现、无溢出、可操作）；
  连续点击/刷新恢复/失败重试/重复选择由上述 CDP 套件以真实点击覆盖（非仅弹窗工厂断言）。
- 兼容策略（记录）：bot 与旧客户端从不调用 trigger，因此无待处理实例、start 不受 409 影响；
  旧客户端若触发后无法处理 409，属已被本轮修复的损坏路径。boon 仍只在真实开局消费一次。
- 未完成项：无。**T7 状态由 in_progress 改为 done（2026-10-02，T7a 补修后）**。

## 独立复核与剩余工作（2026-10-02）

以上“无未完成项/全绿”是开发 agent 记录；最新独立复核见 [报告](../docs/T5A_T7A_REVIEW_2026-10-02.md)。原实例覆盖、刷新不恢复、加值错误已修，但本规格仍有以下未完成项，T7/T7a 保留 in_progress：

1. **离页请求失效**：Embark 的 trigger 响应等待时返回首页，旧弹窗仍出现。cleanup 没有注销视图身份。补首页/设置导航的迟到响应回归，保留服务端实例供下次恢复。
2. **恢复后的 start 失败重试**：knownEncounter 分支丢掉 embarkAction 的 false 返回值，导致恢复弹窗把 start 失败当作成功而关闭。沿调用链保留结果，失败时继续按钮可在原地重试；不重 resolve/发奖。
3. **冒烟基线**：寻找神社可能先赢伏击，smoke 却按寻找前金币断言献祭。独立完整 verify 的 23 套件通过，smoke 实际失败；按献祭前权威状态或累计增量修正，补“伏击成功→神社”覆盖。不要重跑至绿代替修复。
4. **CDP 请求计数准确性**：patchFetch 当前先后调用两次 orig，只把外层入口记为一次。让测试包装器每次真正只发送一次，并记录实际 HTTP 次数；现行“切英雄/resolve 失败”场景不替代前两项。

这些均在原 T7a 范围内，不新增 T7b、不重做 T5a。只在全部补完、真实浏览器验证及完整 verify 全绿后关闭 T7/T7a，同步全局文档并保留历史复核证据。

### 补完记录（2026-10-02，单 agent）

四条剩余项已全部修复并验证（历史复核报告原样保留）：

1. **离页注销视图身份**：`overworldView` 的 cleanup 递增 `overworldToken` 并复位 `embarkBusy`——离开准备页去首页/设置/任何其他视图后，在途 trigger/status/恢复回调的 `alive()` 立即为假，不再弹旧路遇、不再操作旧页面；服务端实例不被触碰，下次进入照常恢复。真实浏览器验收：Embark（挂起 trigger）→ 点击顶部 Characters → 首页挂载 → 放行响应 → 首页无弹窗、实例仍 pending、重进准备页可恢复。
2. **恢复后 start 失败原地重试**：`startEmbarkFlow` 的 `knownEncounter` 分支改为 `return await embarkAction()`（此前丢弃 `false`），恢复弹窗的 Enter Delve 收到失败即保留弹窗并重置继续按钮；重试直接重发 start（不重 resolve、不重发奖/boon）。真实浏览器验收：祈祷→刷新恢复→注入一次 start 失败→弹窗与继续按钮留在原地（失败 toast 可见、无地牢）→重试开局成功、tempHp 恰好 5。
3. **冒烟金币基线**：寻找神社改为“先记伏击胜、再收神社”的确定性循环（神社若早于胜出现则以 proceed 丢弃重掷），基线改为献祭前服务端权威金币（`goldBeforeOffer`），断言仍为 -5 GP 与 shrine_blessed 落库；两次连续运行结果一致（45 gp）。未删断言、未吞错误。
4. **CDP 包装器单发**：patchFetch 改为每次调用只 `orig.apply` 一次（重写 force 请求体后单发），计数即真实 HTTP 次数，并新增 `resolveCalls`/`startCalls` 计数与可控 hold（`window.__t7aReleaseTrigger`）。e2e 新增两条真实 UI 回归：Check 5（离页到首页）与 Check 6（刷新恢复后 start 失败原地重试、不重 resolve、boon 一次）。

验证：`npm run verify` 全绿（eslint、tsc、23 套件、smoke，隔离 DATA_DIR）；t7a 生命周期 CDP e2e 50 断言全过（verify 内），server-checks 108、quick-start 66、T7a 相关集成全绿；smoke 独立两跑通过。
