# Task: T13a 有限中英文自然语言行动

- 状态：done（2026-10-11 复核补修 R6/R7 已实现，待独立复核与真人试玩）
- 复核补修记录：[docs/REVIEW_T14_T15_FIXES_2026-10-11.md](../docs/REVIEW_T14_T15_FIXES_2026-10-11.md)
- 更新：2026-10-10
- 前置：T14（完整入门冒险与场景接口已就绪）
- 本次授权范围：在保留原有英文自由输入命令兼容的前提下，实现五大有限类别（调查、交谈、使用物品、场景选择、基础攻击）的确定性中英文映射与可选模型行动提案，通过服务端权威重验保证规则与动作经济一致。

## 玩家问题与已有能力

### 玩家问题
1. 原有 `server/game/referee.js` 的 `resolveFreeform` 仅支持英文单词正则（如 `search`, `attack`, `drink potion`），输入中文完全无法命中任何机制；
2. 未命中时仅调用 `dm.freeformFlavor` 写出 AI 旁白文本，容易误导玩家以为行动已生效（实际上没有发生任何状态、背包或伤害扣减）；
3. 玩家尝试用自然语言表达剧情选项（如“把药水给里奥”）时无法触发场景，必须寻找对应按钮。

### 已有能力复用
- 动作路由互斥锁与事务生命周期 (`server/routes/game.js`: `store.getSave`, `actionId`, `rev`, 载荷字段 `type: 'freeform'`, 锁外异步模型调用与合并)。
- 现有确定性规则方法 (`server/game/engine.js`: `chooseScene`, `playerAttack`, `skillCheck`, 路由 `useItem`)。
- 现有英文正则命令 (`referee.js`: `stealth`, `listen`, `disarm`, `pray`, `rest`, `dodge`)。
- 双语表述与事件格式 (`server/game/presentation.js`, `server/locale.js`)。

## 接手阅读与代码入口

1. 规范与契约：`AGENTS.md`, `G:\ai_DND_handoffs\release-1.11-20261010\design\CONTRACTS.md`。
2. 核心代码：
   - `server/game/bounded-actions.js`: 核心有限白名单动作解析、授权上下文构建、严格提案验证、代价确认判断与权威执行；
   - `server/game/referee.js`: 有限动作优先分发与原有确定性英文命令兼容兼容；
   - `server/routes/game.js`: `case 'freeform'` 与 `case 'chat'` 锁外模型提案与锁内最新快照重验，澄清/确认事件下发；
   - `public/js/views/play.js`: 自然语言输入框交互、澄清候选卡片与代价确认卡片渲染、错误输入草稿保留；
   - `public/js/localization/zh-CN.mjs` & `en.mjs`: 双语提示与文案支持。

## 复现 / 目标场景

在测试容器内：
1. 玩家站在受伤的信使里奥身旁（曼哈顿距离 <= 1），在自由输入框输入中文“我把治疗药水给里奥”或英文 "give healing potion to lio"；
2. 匹配器将输入映射为提案 DTO，进而转换为权威载荷 `{ type: 'sceneChoice', sceneId: 'testimony', choiceId: 'aid' }`；
3. 服务端权威检查玩家背包确有 `potion_healing`，扣减 1 瓶药水，发放账册并记录事实；
4. 若玩家背包无药水，返回明确的中文/英文错误原因，不扣除金币，不生成虚假旁白；
5. 若输入“攻击”，但视野内存在 2 名敌对目标，返回澄清候选列表让玩家点选，不随意攻击。

## 范围与实现约定

1. **严格限定五大类别与权威距离**：
   - 调查可见对象 (`investigate`)：视野内已探索且距离 `<= 2` 的陷阱、箱子、门；
   - 与 NPC 对话 (`chat`)：视野内已探索且距离 `<= 4` 的存活 NPC；
   - 使用已有道具 (`useItem`)：背包中数量 `> 0` 的道具；
   - 当前场景合法选择 (`sceneChoice`)：与 NPC 距离 `<= 1`、处于 `pending` 状态且满足条件的选项；
   - 基础近战/远程攻击 (`attack`)：射程内可见存活怪物。
2. **确定性优先与可选模型提案 DTO**：
   - 优先通过中英文词典与正则规则确定性解析；
   - 若启用 LLM，模型的 Prompt 仅允许输入当前授权可见的信息（视野内敌人、相邻 NPC、背包、当前选项），严禁传入隐藏地图、未发现陷阱或剧透知识；
   - 模型仅输出类型化提案 DTO，转换后提交给服务端权威执行；未知字段与恶意脚本直接拒绝。
3. **服务端权威重验与单步动作经济**：
   - 模型提案在释放锁的异步阶段生成；
   - 实际提交执行时，必须重新获取锁并加载最新存档快照，权威核验玩家意识状态、当前回合、射程距离、背包库存；
   - 一条玩家输入在机械上至多执行一个标准行动，禁止通过一句话复合多个动作绕过回合规则。
4. **降级与兼容**：
   - AI 关闭、超时或返回格式错误时，所有内置按钮与确定性输入完全正常运作；
   - 保留原有英文 `hide` / `rest` / `shove` 等命令兼容。

## 本次不包含

- 不扩展支持未实现的游戏规则或咒语。
- 不引入无限自然语言剧情发散（严禁脱离五大基础动作）。
- 不绕过服务端权威骰子或背包结算。

## 验收标准

- [x] 中英文同义输入（如“攻击地精”与 "attack goblin"）产生与点击界面按钮完全一致的机械结果与日志。
- [x] 药水不足时输入“喝药水”或“给里奥药水”返回明确失败提示，不虚构成功旁白。
- [x] 面对多个同名怪物输入模糊指令时，返回可见候选澄清，不提前扣减资源。
- [x] 关键金币消耗或不可逆终局选择在执行前呈现明确代价确认，普通动作保持流畅单步执行。
- [x] 无法执行的输入给出友好原因提示，并展示可行替代方案。
- [x] AI 离线或模型崩溃时，确定性中英文输入与全套按钮 100% 正常可用。
- [x] 复合长句（如“先喝药然后连续砍三刀”）仅执行合规的单步动作或请求分步输入。

## 验证

按 AGENTS 规则运行容器完整验证：
```bash
npm run verify
```
在真实 Chromium 下运行中英文自然输入集成与 CDP 套件，检查输入焦点、草稿保留与 DOM 变更。

## 交接结果

- 完成范围：T13a 有限中英文自然语言行动（Bounded Natural Actions in English and Chinese）。
- 修改文件：
  - `server/game/bounded-actions.js`（新增：有限行动核心逻辑、白名单构建、确定性解析、提案校验与执行）
  - `server/game/referee.js`（挂接 boundedActions 解析，保留英文历史命令兼容）
  - `server/routes/game.js`（freeform/chat 动作分支锁外异步模型、锁内最新状态重验、澄清/确认事件）
  - `server/game/engine.js`（导出辅助函数供 bounded-actions 安全消费）
  - `public/js/views/play.js`（澄清/确认卡片挂接、事件监听、草稿保留）
  - `public/js/localization/zh-CN.mjs` & `en.mjs`（本地化字符串）
  - `tests/unit/event-contract.test.mjs`（注册 clarification 与 confirmation 事件）
  - `scripts/test-suites.mjs`（注册 bounded-natural-actions 与 bounded-natural-actions-cdp）
  - `tests/integration/bounded-natural-actions.test.mjs`（新增集成测试：13 个测试项全绿）
  - `tests/e2e/bounded-natural-actions-cdp.test.mjs`（新增 CDP 浏览器测试：24 个断言与 3 组截图全绿）
- 验证：
  - `npm run check -- --browsers=bounded-natural-actions-cdp` 全绿通过（exit 0）。
  - `npm run verify` 全绿通过（eslint, typecheck, test-all 全部 47 套件包括 18 个 CDP 浏览器套件全绿，exit 0）。
  - 真实 CDP 截图与 DOM 记录：`t13a-zh-natural-action-success`, `t13a-zh-clarify-targets`, `t13a-en-confirm-action` 均已保存并视觉核验。
- 试玩步骤：
  1. 启动服务访问 `http://localhost:3000/#/`；
  2. 选择或创建角色进入入门冒险第二章 `courier-crossing`；
  3. 移动至守桥人艾芮身旁，在自由输入框输入中文“说明寻找信使的来意”，渡桥关卡开启；
  4. 移动至信使里奥身旁，输入“我把治疗药水给里奥”，消耗 1 瓶药水获得账册；
  5. 面对多目标输入“攻击地精”，弹出澄清选择卡片，点选候选精确打击；
  6. 面对付费或关键终局（如“支付通行费”），弹出代价确认卡片，确认或取消。
- 存档/接口变化：
  - `events` 载荷扩展支持 `clarification` 与 `confirmation` 纯叙事交互事件；
  - 纯前端与服务端逻辑扩展，无破坏性存档迁移。
- 未完成项与下一个任务：T13a 已全部验收交付完毕；下一个待办任务为 T15a/T15b（等待明确授权）。
