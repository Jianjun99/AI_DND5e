# Task: 仓库自带 MCP server

> AI 协作基建第三档。让任何支持 MCP 的 AI（Cursor / Claude / ZCode / …）接上就能
> 自助跑验证、查规则表、看最近失败——不用读 2500 行 engine.js 或翻 JSON。

## 背景

仓库已有 `npm run verify`、`scripts/balance-sim.mjs`、引擎数据表（CLASSES/SPELLS/
MONSTERS/WEAPONS…）。这些目前只能靠 shell 调用；MCP 化之后所有 MCP 客户端共用一套工具面。

## 目标（第一版四个工具）

1. `run_verify` — 跑 `npm run verify`，返回四步汇总（长任务，注意 MCP 超时：先回「已启动」或用大 timeout）。
2. `run_balance_sim` — 跑 `node scripts/balance-sim.mjs [runs]`，返回胜率摘要。
3. `query_rules` — 入参 `{ table: 'monsters'|'spells'|'weapons'|'classes'|…, id?: string }`，
   从 engine 直接 require 数据表返回 JSON（找不到 id 返回该表全部 id 列表）。
4. `recent_failures` — 读最后一次 `npm run verify` 的落盘日志（约定写到 `data/last-verify.log`，
   由 verify.mjs 顺带写），返回失败套件与错误行。

## 动哪些文件

- 新建 `mcp/server.mjs`（stdio JSON-RPC，**手写协议或用 @modelcontextprotocol/sdk**，
  二选一：零依赖手写 stdio initialize/tools/list/tools/call 三步即可，别引构建步骤）
- `scripts/verify.mjs`：顺带把输出 tee 到 `data/last-verify.log`（data/ 已在 gitignore）
- `package.json`：加 `"mcp": "node mcp/server.mjs"`
- `AGENTS.md`：加一段「MCP 接入」——客户端配置示例（command: node, args: [mcp/server.mjs], cwd: 仓库根）
- `ARCHITECTURE.md` repo map 加 mcp/ 一行

## 硬约束

- **只读 + 跑既有脚本**。不暴露任何写存档/改状态的工具（地面规则：服务端是唯一事实来源）。
- 不引新依赖优先于引 SDK；引 SDK 则放 devDependencies。
- 工具输出截断到 ~4KB，大表返回 id 列表让 AI 二次按 id 查询。

## 验收标准

- 手用 stdio 走一遍 initialize → tools/list → tools/call（query_rules monsters goblin）
  拿到正确 JSON；verify/balance_sim 真跑通。
- `npm run verify` 全绿（server 进程不受 MCP 影响）。

## 验证

stdio 手测 + `npm run verify`。
