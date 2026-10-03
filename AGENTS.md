# AGENTS.md — AI 协作入口

本文件是 AI 编码工具（ZCode / Claude Code / Cursor / Codex…）的默认加载入口。
首次接手先读 `START_HERE.md`（项目目标 / 阅读顺序 / 运行与交付），本轮任务队列见
`tasks/README.md`，项目拥有者的交接操作与提示词见 `docs/AGENT_HANDOFF.md`。
项目状态与待办见 `PROJECT_STATE.md`（有详细规格的待办在 `tasks/`），架构手册见
`ARCHITECTURE.md`，模组格式见 `MODDING.md`，发版流程见 `docs/RELEASE.md`。

## 地面规则（每次会话必须遵守）

1. **不要主动 commit / push / 发版**——用户明确说发版才动 `package.json` 与 tag
   （GHCR tag 形如 `1.9.0`，无 v 前缀）。
2. **引擎是唯一裁判**——骰子/伤害/XP/掉落/锻造/赌桌/魔药全部在引擎里掷，LLM 只拿结果写旁白。
3. **服务端是唯一事实来源**——客户端禁止复制引擎的数据表（重复的 XP 表造成过一次发布 bug）。
4. **含模板字符串的文件禁用 bash heredoc / `node -e` 包反引号**——用 Edit 工具直接改，
   或用 Write 写 .cjs 补丁文件（单引号字符串 + join）。这是本项目最大的 AI 踩坑来源。
5. **每次改完跑完整验证**：`npm run verify`（专用 Docker 容器内跑 eslint + tsc + 全部套件 + 冒烟），
   全绿才算完成。改了战斗/掉落/赌桌/魔药等数值表，使用 `npm run verify -- --balance-runs=50` 在同一容器内加跑 balance-sim
   并在总结里报告胜率变化。
6. **测试不依赖 RNG 具体值**（注入 rng / 穷举 / 宽松区间）；e2e 不断言走路中途的坐标
   （rAF 帧率不稳），断言最终收敛状态。自定义 test runner 必须计数并打印失败——
   禁止 catch 后静默吞掉（四个套件曾因此假绿，藏了两个真 bug）。

## 完整验证命令

**一条命令**（自动构建专用测试镜像 → 容器内起服务 → eslint → tsc → 全部套件 → 冒烟 → 移除容器）：

```bash
npm run verify
```

- Docker Desktop 使用 Linux containers；固定 2 CPU / 4 GiB RAM，所有 agent 共享固定容器名
  `ai-dnd-verify` 的互斥锁。占用返回 73，等待后再运行，不删除其他 agent 的容器。
- 独立容器测试数据、真实 AI 关闭、外网关闭；只挂载本轮日志目录，不挂载玩家 data/、模型配置或生产卷。
- 必须跑完整 `npm run verify`；缺 Chromium/WebGL2、数据文件或环境不支持均失败，不能跳过后报全绿。
- 成功、失败、超时都移除本轮容器，保留正确退出码及 `artifacts/verify/` 的日志、失败截图。
- Windows 特有问题先报告，禁止自行回退宿主机启动浏览器。细节和诊断见 [Docker 测试指南](docs/DOCKER_TESTING.md)。

## MCP 接入（可选）

仓库自带零依赖 MCP server（stdio），把验证与规则查询暴露给任何 MCP 客户端：

```bash
node mcp/server.mjs
```

工具：`run_verify`（完整验证）/ `run_replay`（回放机器人打完整冒险）/ `run_balance_sim`（bot 胜率模拟）/
`query_rules`（查引擎数据表：species/classes/feats/weapons/armor/gear/spells/monsters/…）/
`recent_failures`（最近一次容器 verify 的失败行，来自 artifacts/verify/）。
客户端配置：command=`node`，args=`["mcp/server.mjs"]`，cwd=仓库根。
边界：只读 + 跑既有脚本，**没有**任何写存档/改状态的工具。
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
