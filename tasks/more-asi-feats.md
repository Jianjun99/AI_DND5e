# Task: 更多 ASI 特长（feats）

> ✅ **部分实现**（v1.9.4 批次）：Observant / Speedy / Chef / Musician 四个已落地（安全钩子位 + 测试）；Crusher / Slasher / Piercer 需要挂 playerAttack 命中流，留作后续。

## 背景

升级向导（4/8 级 ASI）现有 5 个特长：Tough / Alert / Lucky / Healer / Savage Attacker。
定义在两处：**引擎** `server/game/engine.js` 的 `FEATS` 表（数值与机制）+
**升级向导** `public/js/views/levelup.js` 的选项列表（展示与挑选）。
规则参照 D&D 2024 PHB；加什么由实现者从下面候选里挑 3-5 个。

## 目标

新增 3-5 个 2024 版特长，全部真实生效（不是只改名字）。

## 候选（按实现成本排序）

- **Crusher / Slasher / Piercer**（近战流派）：命中后附加可控效果——需要挂进
  `playerAttack` 的事件流（击中后 push debuff/buff 或条件），引擎里有 `applyCondition` 可复用。
- **Chef**：短休回临时生命——挂在 `shortRest`。
- **Musician**（Inspiration 类）：长休给队友/自己 buff——挂在 `longRest`。
- **Observant**：被动察觉 +5——`passivePerception` 一行。
- **Speedy**：速度 +10——`applyClassAndSpecies` 的速度计算处。

## 动哪些文件

- `server/game/engine.js`：`FEATS` 表加行 + 各自的机制钩子（都在上述点位）
- `public/js/views/levelup.js`：向导选项列表加行
- `tests/unit/rules.test.mjs`：每个新特长至少 1 条断言

## 硬约束

- 特长效果全部在引擎里结算（地面规则 2），客户端只展示。
- `applyClassAndSpecies` 重算路径（recomputeOnly=true）不得重复叠层——参考现有
  Tough 的实现方式。
- 改了数值 → 跑 `node scripts/balance-sim.mjs` 并报告胜率变化（AGENTS.md 红线）。

## 验收标准

- `npm run verify` 全绿；新特长各有一条真实机制断言；
  升级向导里能选到并立即生效（e2e 或手动 CDP 验证一次）。

## 验证

`npm run verify` + `node scripts/balance-sim.mjs`。
