---
name: Feature request
about: 新功能或玩法想法
title: '[feature] '
labels: ''
assignees: ''
---

**想解决什么 / 想要什么**
玩家视角的一段话。

**建议的实现方向**
如果知道涉及哪些系统就写（引擎 / 路由 / 前端视图 / 内容包）；不确定就留空，
让接手的 AI 按 `ARCHITECTURE.md` 的 cookbook 找位置。

**验收标准**
怎么算做完？3-5 条可勾选的标准。

**平衡性影响**
是否改动数值（伤害/掉落/概率）？改动的话需要跑 `node scripts/balance-sim.mjs` 并附胜率变化。
