---
name: Bug report
about: 游戏行为与预期不符
title: '[bug] '
labels: ''
assignees: ''
---

**描述**
一句话说清发生了什么、你期望发生什么。

**复现步骤**
1. 创建角色：职业/种族/背景
2. 进入哪里、做了什么
3. 出现了什么

**环境**
- 浏览器 / Docker 镜像版本（`/api/health` 会报版本号）：
- 是否开启 AI DM：

**日志或截图**
浏览器控制台报错、服务器日志、截图均可。

> 给 AI 协作者的备注：修复前请读根目录 `AGENTS.md`（地面规则与验证命令）；
> 涉及数值的改动必须跑 `node scripts/balance-sim.mjs` 并报告胜率变化。
