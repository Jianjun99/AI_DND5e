# 从这里接手 AI Dungeon

这份入口给第一次接触仓库的开发者和 coding agent。维护日期：2026-10-03。

## 项目目标与当前任务

这是一个个人爱好项目：单人 D&D 2024 网页游戏，本地部署，AI 可选，支持内容扩展。用户当前的核心反馈是“功能已经很多，但体验不顺、不知道该玩什么”。

本轮目标：玩家知道当前目标、能顺畅完成一场冒险，并在回城后看出下一步。先修影响状态可靠性的已复现问题，再改玩家流程，之后尝试一个有记忆和后果的 AI 遭遇。

当前代码版本见 `package.json`，为 1.10.0。T1–T4a 已实现并复核；T5/T5a 通过；两轮独立复核（[2026-10-01](docs/T5_T7_REVIEW_2026-10-01.md)、[2026-10-02](docs/T5A_T7A_REVIEW_2026-10-02.md)）发现的问题均由 [T5a](tasks/t5a-preset-skills.md) / [T7a](tasks/t7a-road-and-check-feedback.md) 补修关闭（2026-10-02：离页注销视图身份、恢复后开局失败原地重试、冒烟权威基线与伏击胜→神社覆盖、CDP 包装器单发计数）。本轮 T8/T6 也已完成，用户已授权将这些改动发布为 v1.10.0，见 [发布说明](docs/RELEASE_NOTES_1.10.0.md)。最新进度以 PROJECT_STATE 和任务队列为准。

## 第一次接手的阅读顺序

1. [AGENTS.md](AGENTS.md)：必读硬约束、验证和协作规则。
2. [PROJECT_STATE.md](PROJECT_STATE.md)：先读顶部当前摘要、任务队列和已知问题；后面的版本段落是历史记录。
3. [游戏设计说明](docs/GAME_DESIGN.md)：理解玩家目标和本轮取舍。
4. [任务队列](tasks/README.md)：定位用户指定任务，读取对应完整规格。
5. [ARCHITECTURE.md](ARCHITECTURE.md)：理解请求链路、状态形状、文件定位和历史坑位。
6. 本次任务涉及的实际代码和测试。只有内容任务再读 [MODDING.md](MODDING.md)。

要看建议的依据，读 [项目评估](docs/PROJECT_REVIEW_2026-09-30.md)。历史评估里的文件行号可能随开发变化，以函数名和当前代码定位。

给项目拥有者的逐步操作及复制提示词见 [交接操作指南](docs/AGENT_HANDOFF.md)。

## 已有内容：先复用

- 角色创建、12 职业、10 种族、等级上限 12、升级与特长、装备与词缀、战斗与探索。
- 七张静态地图：crypt、drowned-vault、howling-hills、sewers、mill、roost、vale-gate（山谷哨门）；另有无尽深渊与每周试炼。
- 城镇补给、招募、悬赏、赌桌、魔药、锻造、图鉴与荣誉榜。
- 四幕主线、三位同伴的忠诚度与个人任务、AI 旁白/对话/回顾、语音和 3D/2D 渲染。
- JSON 内容包、存档迁移、seeded RNG、回放机器人、零依赖 MCP、完整验证。

不要重新实现 PWA、存档版本化、Crusher/Slasher/Piercer、同伴忠诚或四幕主线。

## 运行方式

仓库根目录是当前会话的工作区；项目拥有者的电脑上为 `G:\ai_DND`。换机器后使用实际路径。

本地运行游戏需要 Node.js >=20、npm；自动验证另需 Docker Desktop Linux containers，开发依赖与 Chromium 由测试镜像提供。游戏开发已存在 `node_modules` 时先使用现有依赖；需要安装时运行 `npm install` 并检查意外产生的依赖文件改动，不主动升级依赖。

```powershell
Set-Location 'G:\ai_DND'
npm start
```

默认游戏地址 `http://localhost:3000`。自动验证统一在专用 Docker Desktop Linux 测试容器内运行：

```powershell
npm run verify
```

入口自动构建 `Dockerfile.test`（开发依赖、完整测试、Chromium），固定 2 CPU / 4 GiB RAM，
服务端和六个 CDP e2e 都在容器内。固定容器名保证所有 agent 同时最多一轮完整验证；占用返回 73。
玩家 `data/` 与模型配置不进入镜像也不挂载，真实 AI 和外网关闭，测试使用容器独立 `DATA_DIR`。
每轮成功/失败/超时均移除容器；日志、失败截图和退出码保留在 `artifacts/verify/`。
缺浏览器/WebGL2 必须失败；Windows 环境问题先报告，禁止回退宿主机浏览器。
安装路径、时限和故障诊断见 [Docker 测试指南](docs/DOCKER_TESTING.md)。

## 代码导航与重要边界

| 需要处理什么 | 从哪里读起 |
|---|---|
| 浏览器 API 调用与开局选项 | `public/js/api.js`、`views/play.js`、`views/overworld.js`、`views/overworld/districts.js` |
| 开始游戏、行动、AI 结果 | `server/routes/game.js`、`server/game/dm.js`、`server/llm/client.js` |
| 骰子、战斗、地图交互、胜利、升级 | `server/game/engine.js` |
| 档案、地牢存档、迁移 | `server/store.js` |
| 城镇与地牢结算 | `server/routes/city.js`、`public/js/views/play/panels.js` |
| 主线目标与推进 | `server/game/campaign.js`、`public/js/app.js` |
| 内容包与地图 | `server/game/content.js`、`shared/`、`content/` |
| 自动验证与浏览器检查 | `scripts/verify.mjs`、`scripts/test-all.mjs`、`tests/e2e/` |

当前角色档案和 `state.character` 是两份数据；后者是地牢快照。修改一份不等于另一份已同步。结算、城镇修改和异步 AI 请求会涉及这个边界，必须读实际实现。

AI 是可选表达层；未来意图提案也需要引擎验证。T7 已把锁箱/拆陷阱/路遇裁决移入引擎；客户端仍有自算检定预览与路遇生命周期的待修边界，见 T7a，不能复制到新功能。

## 执行与交付

- 先 `git status --short`，保留现有改动。交接文档可能尚未提交，不能清理掉。
- 只做用户指定任务及其必要修复；一般实现选择自行决定，勿停留在计划。
- 基线异常与自己的改动分别记录。完工后 `npm run verify` 必须全绿；数值变化另跑 balance-sim；客户端改动必须真实浏览器查看。
- 更新对应 task 的状态和结果，再更新 PROJECT_STATE。架构/接口变化同步 ARCHITECTURE，模组协议变化同步 MODDING。
- 完成报告要说明玩家可感知变化、验证、手动试玩路径、未完成项。测试未通过时不能标 done。
- commit、push、修改版本、tag 和发版遵守 AGENTS 的授权规则。本轮任务不包含发布。

T8 与用户授权续做的 T6 均于 2026-10-03 完成。最终 Docker 验证 27 套件（6 CDP）/smoke/balance 全绿、容器清理完成；T8 51 内容场景/180 断言，T6 9 场景/210 断言与 39 CDP 断言。山谷哨门有两个真实解法与回城后记忆，试玩步骤和证据见 tasks/t6-remembered-encounter.md；内容扩展见 MODDING。本轮无未完成任务，等待试玩反馈或下一项指派。

此前分工、基线与整合记录见 [并行交接指南](docs/T5_T7_PARALLEL_HANDOFF.md)；最新结论以 2026-10-02 独立复核为准。
