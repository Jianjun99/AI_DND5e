# AGENTS.md — AI 协作入口

本文件是 AI 编码工具（ZCode / Claude Code / Cursor / Codex…）的默认加载入口。
项目状态与待办见 `PROJECT_STATE.md`，架构手册见 `ARCHITECTURE.md`，模组格式见 `MODDING.md`，
发版流程见 `docs/RELEASE.md`。

## 地面规则（每次会话必须遵守）

1. **不要主动 commit / push / 发版**——用户明确说发版才动 `package.json` 与 tag
   （GHCR tag 形如 `1.9.0`，无 v 前缀）。
2. **引擎是唯一裁判**——骰子/伤害/XP/掉落/锻造/赌桌/魔药全部在引擎里掷，LLM 只拿结果写旁白。
3. **服务端是唯一事实来源**——客户端禁止复制引擎的数据表（重复的 XP 表造成过一次发布 bug）。
4. **含模板字符串的文件禁用 bash heredoc / `node -e` 包反引号**——用 Edit 工具直接改，
   或用 Write 写 .cjs 补丁文件（单引号字符串 + join）。这是本项目最大的 AI 踩坑来源。
5. **每次改完跑完整验证**：`npm run verify`（自动起服务跑 eslint + tsc + 13 套件 + 冒烟），
   全绿才算完成。改了战斗/掉落/赌桌/魔药等数值表，还必跑 `node scripts/balance-sim.mjs`
   并在总结里报告胜率变化。
6. **测试不依赖 RNG 具体值**（注入 rng / 穷举 / 宽松区间）；e2e 不断言走路中途的坐标
   （rAF 帧率不稳），断言最终收敛状态。自定义 test runner 必须计数并打印失败——
   禁止 catch 后静默吞掉（四个套件曾因此假绿，藏了两个真 bug）。

## 完整验证命令

**一条命令**（自动起服务 → eslint → tsc → 13 套件 → 冒烟 → 收尾杀进程，端口自动挑空闲的）：

```bash
npm run verify
```

手动等价流程（调试单个环节时用；直接跑套件不起服务会 ECONNREFUSED，那不是代码 bug）：

```bash
export PATH="/c/Program Files/nodejs:$PATH"   # git bash 找 node
PORT=3100 node server/index.js &              # 先起服务——套件连这个端口
npx eslint .
npx tsc --noEmit
PORT=3100 node scripts/test-all.mjs           # 13 套件（含 3 个 headless CDP e2e）
PORT=3100 node scripts/smoke-test.mjs
```

- e2e 需要 Edge/Chrome 与空闲 CDP 端口（9224/9225）；Windows 下浏览器是分离进程树，
  残留进程按 `--user-data-dir` 档案目录名用 PowerShell `Stop-Process` 杀，别只 kill pid。
- 客户端改动必须在真实浏览器里看过（CDP 截图 / DOM dump）——引擎与集成测试抓不到渲染/模板 bug。

## 硬约束速记（完整版见 ARCHITECTURE.md §7）

- `applyClassAndSpecies` 每次调用会加一层 HP——重算时传第 5 参 `recomputeOnly=true`。
- 词缀组装唯一入口 `affixes.buildAffixItem`；`uniqueId` 永不改变（装备槽引用不失效）。
- `state.character` 是深拷贝不是档案本体——同步靠 `sync-delve` 或显式 write-through。
- 升级徽章唯一来源 `engine.levelUpInfo`——客户端禁止自建 XP 表。
- `hint(state, key, npc, text, events)` 必须传 events（漏传会 crash）。
- 引擎模块循环依赖深：**不做**物理拆分；**不引** React/Vue/打包器（已决策，别再提）。
- tsc 已覆盖 server/ 与 public/js 全部（`tsconfig.json` include 用 glob，新文件自动被检查；
  three.js vendor import 经 `paths` 映射到 `public/js/vendor-three.d.ts` stub）。
  改完 `npx tsc --noEmit` 必须 0 错误。
