# Q1：开发检查与完整验收分层

- 状态：done（2026-10-07；含 Q1a 验收补修；最终完整 verify 退出 0，49 套件全零失败）
- 更新：2026-10-07
- 前置：T12a 已完成（全绿基线，清单口径 48 套件）；保留全部未提交成果。
- 授权范围（用户原文约束）：新增 Docker 内快速开发检查入口（eslint + tsc + 全部单元/集成测试，
  失败立即停止，支持明确选择相关浏览器套件）；实现和文档，不只提出方案。快速检查明确标记为部分验证，
  不代替完成验收；保持 `npm run verify` 全部套件、冒烟、截图及失败计数；两种入口共享现有互斥锁、
  2 CPU/4 GiB、数据隔离和容器清理规则；不在宿主机起测试服务或浏览器。输出结构化耗时（构建、检查、
  各套件、截图、清理）；检查已记录的 RNG/动画时序偶发并用确定性条件修复，不靠重试/重跑；测量优化前后
  耗时；最后完成一次完整 verify；更新任务规格、交接和项目状态。不改游戏玩法，不 commit/push/改版本/发版。

## 设计

- **`npm run check`（新）**：宿主侧沿用 `docker-verify.mjs` 的全部管道（构建镜像、固定容器名
  `ai-dnd-verify` 互斥、2 CPU/4 GiB、`--network none`、无能力、独立 DATA_DIR、容器清理、
  `artifacts/check/<时间戳>/` 证据），以 `VERIFY_QUICK=1` 环境变量分流；容器内
  `container-verify.mjs` 据此 spawn `npm run check`，其余入口逻辑（超时、SIGTERM 采集、
  container-result.json）原样共用。
- **`scripts/dev-check.mjs`（新，容器内）**：fail-fast 快速检查——eslint → tsc → 引擎单元套件 →
  集成套件（均从单一套件清单读取），任一红项立即停止并保留日志；默认**不**跑任何浏览器套件，
  `npm run check -- --browsers=<id,..>` 显式选择才跑对应 CDP 套件（支持 `--list` 浏览可用 id）。
  浏览器套件选中时与 verify 一样先启动隔离游戏服务器。全程输出"PARTIAL VERIFICATION"标记。
- **单一套件清单 `scripts/test-suites.mjs`（新）**：把 test-all 内联的套件表抽出为带稳定
  `id` 与 `kind`（unit/integration/browser）的数据模块，test-all 与 dev-check 共同消费，
  顺序与内容不变。
- **verify 不改行为**：全部套件、冒烟、截图、失败计数、fail-slow 汇总保持；仅给每个步骤与
  总时长加结构化耗时记录（`timings.json` + 摘要行 + last-verify.log），满足"输出结构化耗时"。
- **偶发确定性修复**：t7a CDP 的 `ensureEncounterType` 12 次重掷循环（(2/3)^12 ≈ 0.77% 掷空）
  改为按引擎同形实例直接 staged `currentRoadEncounter`（T11/T12a 夹具同款文件写法，无引擎改动）；
  V1b CDP 的"confirmed HP reduction plays hit"立即断言改为条件等待（与 H1 的真实动作同步模式一致，
  断言不弱化）。两者均已记录于既有交接，本轮负责关闭。

## 验收标准

- [x] `npm run check`（无浏览器）在容器内跑 eslint+tsc+全部单元+集成，红项立即停止；输出
      PARTIAL VERIFICATION 标记与结构化耗时（构建/检查/各套件/截图/清理）。
- [x] `npm run check -- --browsers=<id>` 只跑选中浏览器套件；`--list` 列出可选 id。
- [x] `npm run verify` 套件集合、冒烟、截图、失败计数与 fail-slow 行为不变；带结构化耗时。
- [x] 两个入口都拒绝并发（容器名互斥 73 + 容器内同一把文件锁）、都只在容器内跑服务/浏览器、
      都有独立数据目录与清理；check 证据落在独立的 `artifacts/check/`。
- [x] t7a ambush 与 V1b 动画时序偶发按确定性条件修复；不以重试换绿。
- [x] 记录优化前后耗时（见下）；最后一次完整 verify 全绿（清单口径 49 套件全零失败）。
- [x] 任务规格、交接、tasks/README、PROJECT_STATE、START_HERE、AGENTS/DOCKER_TESTING 同步。

## 交接结果

### 交付内容

- **`npm run check`（新命令）**：`scripts/check.mjs` 按宿主/容器分流。宿主侧复用
  `docker-verify.mjs` 全部管道——同镜像构建、同容器名 `ai-dnd-verify` 互斥（占用返回 73）、
  同 2 CPU/4 GiB/`--network none`/无能力/独立 DATA_DIR、同容器清理——仅以
  `AI_DND_QUICK_CHECK=1`/`VERIFY_QUICK=1` 环境变量分流；容器内 `container-verify.mjs`
  据此 spawn `npm run check`（并把 `--browsers=` 转发进去），超时/SIGTERM 采集/
  container-result.json 原样共用。
- **`scripts/dev-check.mjs`（新，容器内）**：eslint → tsc → 启动隔离游戏服务器 →
  全部单元套件 → 全部集成套件 →（仅当选中时）浏览器 CDP 套件。**fail-fast**：第一个红
  步骤/套件立即停止。全程输出 ⚠️ PARTIAL VERIFICATION 横幅，`result.json` 带
  `kind: 'quick-check'`；`--browsers=<id,...>` 精确选择浏览器套件（未知 id 报错并列出可用值），
  `--list` 在宿主机直接打印清单（不触发 Docker）。
- **`scripts/test-suites.mjs`（新）**：套件的单一清单（稳定 `id` + unit/integration/
  browser 分层 + 原有 env/timeoutMs）；Q1 建立时 48 个（unit 11 + integration 19 +
  browser 18），Q1a 加入 dev-check-faults 后 **49 个**（unit 11 + integration 20 +
  browser 18）。`test-all.mjs` 改为消费该清单（执行顺序与内容不变，仍是 fail-slow
  全量汇总），两个入口永不漂移。
- **verify 结构化耗时**：`verify.mjs` 每步（eslint/typecheck/server-boot/test-all/smoke/
  replay/balance）记录秒数，摘要逐行显示并写入 `artifacts/verify/<轮>/timings.json`；
  套件集合、冒烟、截图、失败清点与 fail-slow 行为不变。
- **docker-verify 记录构建耗时**：`result.json` 新增 `buildSeconds`；check 的证据写入
  `artifacts/check/<轮>/`（`result.json` 带 `kind`/`browsers`/`buildSeconds`），不混入验收证据。

### 偶发的确定性修复（均记录于既有交接，本轮关闭）

- **t7a ambush（~0.8%）**：根因是 CDP 夹具 `ensureEncounterType` 用无种子 RNG 12 次重掷，
  (2/3)^12 ≈ 0.77% 概率掷不中目标遭遇即整套件失败。改为按 `triggerRoadEncounter` 写入的
  **同形实例**直接 staged 到 `DATA_DIR/characters.json`（T11/T12a 夹具同款文件写法，
  引擎"存活实例权威返回"路径原样消费）——零 RNG、零重试。未改引擎。
- **V1b 动画时序抖动**：`visual-packs-cdp` 在确认攻击后**立即**读取 skel1 的
  `lastAction==='hit'`，容器高负载时同一回复的逐实例应用尚未落地（第 10 轮实录）。
  改为条件等待（20s 上限的真实状态同步）后再断言，断言不弱化，与 H1 的真实动作同步模式一致。

### 耗时测量（同机 Docker Desktop；数字全部取自 artifacts 日志）

Q1 轮（2026-10-07 凌晨；当时 `result.json` 尚无 `hostWallSeconds` 字段，宿主墙钟按
`finishedAt` − 目录起始时间从日志折算）：

| 路径 | 容器内净耗时 | 构建 | 宿主墙钟 | 证据 |
|---|---|---|---|---|
| `npm run check`（默认，30 个套件） | 29.78s | 8s（镜像层缓存） | ≈39.6s | `artifacts/check/2026-10-07T00-32-51-644Z-8f0bdad4/` |
| `npm run check -- --browsers=hud-stability` | 48.92s（该套件 16.7s） | 1.84s | ≈52.5s | `artifacts/check/2026-10-07T00-37-20-656Z-73c4e8e8/`（screenshots 5） |
| `npm run verify`（Q1 轮最终，48 个套件） | 1237.86s（test-all 1229.85s） | 3.66s | ≈20.6 分钟 | `artifacts/verify/2026-10-07T01-04-51-010Z-858c8ae1/` |

开发迭代收益（日志口径）：默认 check 在镜像缓存命中时宿主 33.5–39.6 秒、镜像重建时
114.06 秒（构建 61.81s），对比全量验收 ≈21.5 分钟；需要看某个浏览器套件时可单选直跑，
不必等全量。Q1a 轮数字见下方“实测耗时”。

### 超时预算（本轮实测记录）

2026-10-06/07 夜间同机负载下 test-all 单步实测 1229.9s，`--timeout=1200` 的一轮在 T12a CDP
进行中触及预算超时（exit 124，其余步骤全绿，证据 `artifacts/verify/2026-10-07T00-44-02-788Z-1c1d12d6/`）。
最终全绿轮使用 `--timeout=1500`（`artifacts/verify/2026-10-07T01-04-51-010Z-858c8ae1/`）。
建议完整验收在负载高的时段使用 `--timeout=1500`；这是资源预算不是测试失败，重跑一次文档命令即可。

### 最终验证与证据

- 命令：`npm run verify -- --timeout=1500`，宿主与容器退出 **0**；eslint/tsc/**48 套件**（Q1 轮清单口径，Q1a 前；Q1a 加入故障注入套件后为 49）/smoke
  全绿；`cleanupComplete=true`、`timeout=false`，容器已移除。证据
  `artifacts/verify/2026-10-07T01-04-51-010Z-858c8ae1/`（`last-verify.log`、`timings.json`、
  `result.json` 保留）。全轮零失败：全部 CDP 计数含 Review 202、M1 202、L1 354、V1a 45、
  **V1b 51（时序修复后）**、T9a 27、T9b 139、T10 107、T9c 164、T11 147、T12a 193、H1 32、
  **T7a 53（staged 夹具后）**，全部 0 failed。
- 快速检查实测证据：`artifacts/check/2026-10-07T00-32-51-644Z-8f0bdad4/`（无浏览器全绿，
  容器内 29.78s）与 `artifacts/check/2026-10-07T00-37-20-656Z-73c4e8e8/`（--browsers=hud-stability，
  容器内 48.92s，screenshots 5）；首轮 fail-fast 演练 `2026-10-07T00-26-22-470Z-eb55901e/`
  （PORT 缺陷当场被红项拦截并修复）。

### 遗留边界

- 快速检查不覆盖 smoke/全量截图/失败清点，永远不能在报告中替代 verify。
- Docker Desktop 容器生命周期开销（宿主墙钟与容器内净耗时之差）属平台成本，不在本仓库控制内。
- 未改游戏玩法/数值/稳定 ID；未 commit/push/改版本/发版；T13 仍未领取。

## Q1a 验收补修（2026-10-07，done）

用户指派的验收补修，四项全部完成并经完整 verify 验证：

### 1. dev-check 退出码契约修复（关键缺陷）

修复前的 dev-check 存在真实缺陷：eslint/tsc 失败与服务器启动失败走 `throw` → catch，
但 catch 只打印失败信息**不设置失败标志**，finally 会打印 "PARTIAL CHECK PASSED" 并以
**exit 0** 结束；证据/计时保存失败也只 console.error 后照常 exit 0。
修复后为统一退出码契约：`failure` 单一标志贯穿 eslint、tsc、服务器健康等待、任一套件与
**证据保存失败**（`timings.json` 写不进去也算失败）；任何失败路径 exit 1 且绝不打印
PASSED 横幅（保存失败打印 INCOMPLETE 替代）；只有全绿且证据落盘才 exit 0。
另顺带把上一轮放错位置的清理计时起点真正移入 finally。

### 2. 容器内故障注入回归（新套件）

`tests/integration/dev-check-faults.test.mjs`（id `dev-check-faults`，清单第 2 位）：
通过容器内 `AI_DND_CHECK_FAULT=<eslint|tsc|server|suite|artifact-save>` seam 驱动
**真实** dev-check 代码路径并断言实际退出码与输出——

- eslint 注入：非零退出、失败信息点名 eslint、无 PASSED 横幅；
- tsc 注入：eslint 通过后 tsc 非零；
- 服务器注入：立即退出的假服务器 + 快速健康等待（用例 <30s，不跑满 20s 预算）；
- 套件注入：必失败的注入套件（exit 7）被如实上报且 fail-fast 提前停止；
- 证据保存注入：timings 写入目录路径（EISDIR）——**全部测试通过但证据丢失仍然 exit 1**；
- 无注入对照：真实全绿一轮打印 PASSED 且 `timings.json` 标记 partial、逐套件全绿。

seam 仅容器内生效；注入子进程用 `AI_DND_CHECK_LOCK` 各自持锁（外层 npm run check 的
共享锁不阻塞回归）；套件带 `AI_DND_QUICK_RUN` 递归守卫——在 check 内自跳过（0 秒 SKIP），
在完整 verify 中全量运行。测试套件总数（清单口径）48 → **49**。此前报告中的 47 系以 grep 统计概要行所得的少计口径，
Q1a 起一律以 `scripts/test-suites.mjs` 清单长度为准：完整 verify **49 个**（unit 11 +
integration 20 + browser 18）；默认 check **列出 31 个**（unit 11 + integration 20，
其中 dev-check-faults 显示 SKIP、**实际执行 30 个**），显式选择的浏览器套件按实际选择追加。

### 3. 文档浏览器 ID 修正

`--browsers=` 示例中的无效 id `t12a` 全部改为合法 id：`companion-story-cdp,hud-stability`
（AGENTS.md、docs/DOCKER_TESTING.md）；历史 artifacts 内的原始记录保留不改。

### 4. 结构化耗时补齐 + 报告数字同步

- `result.json` 新增 `hostWallSeconds`（宿主总时间：构建+容器+清理全程）；
- `container-result.json` 新增 `seconds`（容器内净耗时）；
- `test-all` 落盘 `suite-timings.json`（**49 个套件**逐个 id/kind/秒数/退出码），
  `verify.mjs` 将其合并进 `timings.json` 并加入截图总数——verify 侧首次具备
  宿主总时间、构建、各套件、截图、清理的完整结构化耗时；dev-check 侧原已有。

### 实测耗时（同机 Docker Desktop；数字全部取自 artifacts 日志）

- 默认 `npm run check`（**列出 31 个套件**——unit 11 + integration 20；dev-check-faults
  显示 SKIP、**实际执行 30 个**）：容器内 **29.69s**（containerResult 30.12s），宿主墙钟
  **33.49s**（构建 2.17s，镜像缓存命中）。证据
  `artifacts/check/2026-10-07T01-54-38-601Z-ce6dc487/`。
- 独立快速复核（2026-10-09，追加 `--browsers=hud-stability`、镜像重建）：容器内 **50.98s**
  （containerResult 51.18s），构建 **61.81s**，宿主 **114.06s**；H1 CDP **32/0**，
  screenshots 5。证据 `artifacts/check/2026-10-09T02-02-20-350Z-b5336766/`。
- `npm run verify -- --timeout=1500` 全量（49 个套件）：容器内 1288.13s（test-all 1281.82s），
  宿主 1291.56s（≈21.5 分钟），构建 2.11s——见下方最终验证。

### 最终验证与证据

- 开发流程先跑 `npm run check` 全绿：`artifacts/check/2026-10-07T01-54-38-601Z-ce6dc487/`
  （容器内 29.69s，宿主 33.49s；31 个套件列出、dev-check-faults 自跳过、实际执行 30 个）。
- 独立快速复核（2026-10-09）：`artifacts/check/2026-10-09T02-02-20-350Z-b5336766/`
  （`--browsers=hud-stability`，H1 CDP 32/0，screenshots 5；容器 50.98s、构建 61.81s、
  宿主 114.06s）。
- 最终完整 `npm run verify -- --timeout=1500` 退出 **0**：eslint/tsc/**49 套件**/smoke 全绿；
  `timings.json` 首次包含逐套件明细与截图计数；`cleanupComplete=true`、`timeout=false`，
  容器已移除。证据 `artifacts/verify/2026-10-07T03-11-06-475Z-68fed60a/`（hostWallSeconds 1291.6、构建 2.1s、容器 1288.1s、timings.json 含 49 套件明细与 210 张截图计数；本轮 49 套件全部零失败）。
  未减套件、未靠重跑碰运气；历史原始证据目录全部保留。

## 2026-10-09 复核收尾轮（文档口径同步 + 两处验证稳定性修复）

本轮任务只修正文档、统计口径与命令示例（`scripts/check.mjs` 注释的 `--browsers=` 示例、
`tasks/README.md`、`START_HERE.md`、`PROJECT_STATE.md`、`docs/DOCKER_TESTING.md` 与本文件的
49/31/30 口径、耗时与证据引用）。收尾验证连跑两轮，各暴露一处**既有**验证稳定性问题，
按“先诊断修复，不靠重跑碰运气”处理；未改玩法/数值/稳定 ID。

### 1. L1 CDP 套件预算不足（exit 124，非断言失败）

- 症状：`artifacts/verify/2026-10-09T02-22-43-206Z-739c12ac/` 完整 verify 退出 1，唯一红项是
  `❌ Suite timeout: End-to-End Tests: Landscape Desktop & Native Fullscreen (L1 CDP)`
  （302.10s，套件 exit 124）。日志显示超时发生时该套件正跑在其最后两条断言上，且此前**全部通过**。
- 诊断（全部取自 artifacts 日志）：L1 走 8 视口 × 双语言的全屏/焦点/截图路线，现存 artifacts 内
  45 轮全绿、5 轮失败（4 轮为 10-04 开发期短失败），全绿耗时 203.85–290.25s，配置 `timeoutMs` 恰为
  300000（300 秒）；同轮其他套件仅比 03-11 基线慢
  2–10%，L1 却 +27%，且当轮宿主机上另有他项目容器（`jobsearch-jp008-test`）在跑。结论：预算
  过紧叠加宿主负载，非断言失败、非本轮文档改动引入。
- 修复：`scripts/test-suites.mjs` 中 L1 的 `timeoutMs` 300000 → **420000**（其余预算不变：
  T9c/T11/T12a/H1 = 300 秒，普通套件默认 180 秒）；`docs/DOCKER_TESTING.md` 的预算段落同步为
  与配置一致（原文只提 T9c/T11，且未含 T12a/H1/L1）。
- 验证：2026-10-09T02-49 轮起 L1 连续两轮全绿（354 断言、0 失败；247.67s / 252.31s）。

### 2. T10 CDP 焦点恢复断言改为条件收敛（既有低频时序抖动）

- 症状：`artifacts/verify/2026-10-09T02-49-05-447Z-249fd7bb/` 完整 verify 退出 1，唯一红项是
  `FAIL: Error: closing a factory opened inside character restores that pane and its trigger`
  （T10 CDP 80 passed, 1 failed，套件在 81/107 处中止）。
- 诊断：该套件历史 80 轮中 6 次失败（2026-10-03～10-05 五次在 T10 开发期，均为指针对达/焦点/
  遮挡类；本次是这条“角色抽屉内打开背包工厂再 Escape 恢复面板与触发点”的断言首次失败），属
  既有低频抖动；失败瞬间无状态快照（该套件只在超时路径采集页面），无法进一步定位是“点击被吞”
  还是“恢复未落地”。客户端代码本轮未改，H1 调和器对带 id 的 `#btnOpenDelveInventory` 会复用
  节点，故非轮询重建导致。
- 修复：`tests/e2e/map-first-cdp.test.mjs` 把两步立即读改为**条件收敛等待**（本套件既有的
  `wait()` 模式，与 V1b 修复同形、不弱化）：先等 `#delveInventoryModal` 出现——把“点击被吞”
  与“恢复失败”分开报告；Escape 后等 `panel()==='character' && activeElement.id==='btnOpenDelveInventory'`
  ——吸收同一事件轮内的异步落地。最终断言条件与文案与原状完全一致。
- 验证：单套件 `npm run check -- --browsers=map-first` 全绿（T10 CDP **107/0**，81.95s，
  `artifacts/check/2026-10-09T03-15-00-572Z-6c0d2e52/`），随后全量 verify 中 T10 再次 107/0。

### 最终验证与证据（2026-10-09 复核轮）

- `npm run verify -- --timeout=1500` 退出 **0**：eslint/tsc/**49 套件**/smoke 全绿（套件概要
  49 PASS / 0 FAIL，`timings.json` 49 个套件全部 exit 0、208 张截图）；L1 **354/0**（252.31s，
  新预算内）、T10 **107/0**、其余 CDP 零失败（Review 202、M1 202、V1a 45、V1b 51、T9a 27、
  T9b 139、T9c 164、T11 139、T12a 191、H1 32、T7a 53）。
  `hostWallSeconds` 1286.07（≈21.4 分钟）、容器 1284.5s、构建 2.1s、`cleanupComplete=true`、
  `timeout=false`，`ai-dnd-verify` 容器已移除（该轮 `artifacts/verify/2026-10-09T03-17-02-163Z-85829183/`）。
- 失败轮证据同样全部保留：L1 超时轮 `.../2026-10-09T02-22-43-206Z-739c12ac/`、T10 断言轮
  `.../2026-10-09T02-49-05-447Z-249fd7bb/`（两轮均 `cleanupComplete=true`）。
- 遗留：T10 该断言若再次失败，请从新日志判断是哪种等待超时（两条 `wait()` 标签不同），并补采
  页面状态；L1 若在更高负载下再触 420 秒，按同一方法用日志复核后调整，不靠重跑换绿。
