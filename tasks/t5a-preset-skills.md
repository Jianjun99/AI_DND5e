# T5a — 推荐英雄职业技能补齐

- 状态：done（2026-10-02）。
- 更新：2026-10-02。
- 前置：当前 T5/T7 整合实现。
- 类型：T5 独立复核的小范围补修；[证据](../docs/T5_T7_REVIEW_2026-10-01.md)。
- 授权范围：用户指派本任务后，只补推荐英雄的职业技能及必要验证/交接。

## 问题与入口

guardian 只拥有 guard 背景的 athletics/perception，预设没有 fighter 的两个职业技能；arcane 只覆盖 sage 背景与 human versatility，没有另外补齐 wizard 职业选择。引擎能构建不代表配额完整。

先按 START_HERE 阅读规则和状态，再读 T5、复核报告。入口：`server/game/presets.js`、`shared/classes.json`、`shared/species.json`、`shared/backgrounds.json`、engine.buildCharacter/skillMod、`tests/integration/quick-start.test.mjs`。

## 范围

- 根据仓库现有职业规则，为两个预设选择足量、允许且不浪费在已有背景/种族技能上的职业技能。例如卫士可选 insight/survival；法师保留原人类技能并另选 investigation/religion。具体技能可自行判断，按规则解释。
- 复用当前 buildCharacter；它目前合并背景与 draft.skills，未自动合并 speciesChoices 技能，因此预设仍需保证所有选择真实进入最终 skills。保持客户端只提交 presetId/name。
- 新建英雄采用新配置；既有英雄保留已有存档，不自动补档或改变档案。
- 补预设验证，按各来源检查数量、职业允许集合、去重与最终熟练生效。不能只检查背景技能存在；以引擎计算的修正证明新增技能有效。
- 记录自定义创建器的旧技能缺口，避免继续将“整个创建规则已完整验证”写成结论。

## 不包含

重做七步创建器、补齐全部职业/种族实现、改变属性/HP/AC/装备/奖励数值、迁移外部规则版本、玩家旧档批量修复、路遇生命周期修复。

## 验收标准

- [ ] guardian 与 arcane 各自补齐当前职业 skillPicks；背景与种族的既有技能保留，没有重复占用配额。
- [ ] 从真实引擎及 POST presetId 创建的英雄，最终 skills 和技能修正正确。
- [ ] `/api/rules` 仍仅公开预设展示元数据；客户端无法用伪造 draft 覆盖预设。
- [ ] 两个预设快速命名 → 准备 → 出发保持可用，自定义创建及读旧档回归不受影响。
- [ ] 真实浏览器查看创建后的角色技能；完整 `npm run verify` 全绿，文档同步。

测试使用独立 DATA_DIR、不使用真实模型配置，不依赖 RNG 具体值。如果另行修改数值表，按 AGENTS 跑 balance-sim；本任务无此必要。

## 交接结果

- 完成范围（2026-10-02）：`server/game/presets.js` 两个预设补齐当前职业规则的 skillPicks——
  guardian（fighter 2 选）：guard 背景已有 athletics/perception，另选 **insight/survival**（均在
  fighter skillList 内，不与背景/种族重复）；arcane（wizard 2 选）：保留 sage 背景的 arcana/history
  与人类 versatility 的 perception/insight，另选 **investigation/religion**（均在 wizard skillList
  内）。draft 经 `buildCharacter` 的 bg.skills + draft.skills 合并去重落地；客户端仍只提交
  presetId/name，`/api/rules` 仍只公开展示元数据（draft 不出服务端）。
- 验证：`tests/integration/quick-start.test.mjs` 扩展到 67 断言（0 失败）——按来源检查数量
  （guardian 4 项 / arcane 6 项）、唯一性、职业允许集合、不占用既有背景/种族技能，并以
  `engine.skillMod` 证明新增技能真实生效（guardian insight/survival = +2；arcane
  investigation/religion = +7，含引擎当前 wizard 规则对二者的专精加成——属既有引擎行为，
  断言按实际值锁定）；另断言 POST presetId 响应携带完整技能表。既有自定义创建、旧档、
  出发回归不受影响（快照对比 + 套件全绿）。
- 浏览器：真实创建 guardian 后角色卡技能列表显示 4 项熟练（含 Insight/Survival）。
- 文档同步：T5 任务与 PROJECT_STATE/队列/START_HERE 的 T5 状态随本轮一并更新；自定义创建器的
  旧技能缺口（职业 skillPicks 在七步创建器中从未落地、种族技能选择服务端不读取）已在
  ARCHITECTURE §7 与 presets.js 注释中记录为已知缺口，未在本任务重做创建器。
- 未完成项：无。**T5 状态由 in_progress 改为 done（2026-10-02，T5a 补齐后）**。

## 独立复核补记（2026-10-02）

[最新报告](../docs/T5A_T7A_REVIEW_2026-10-02.md)：两个预设经真实首页命名创建、进入角色页检查，guardian 4 项、arcane 6 项技能完整，新增职业技能在允许集合且不重复，服务端修正及页面熟练/专精行一致。T5a 技能补齐通过，不重做。首轮完整 verify 的 23 套件通过但 T7a 冒烟基线失败，整体验收不能称全绿；T7a 的剩余工作另行保留。
