# Task: T14 完整入门冒险与跨章实际后果

- 状态：done（2026-10-11 复核补修 R2 跨章引用与真实通关回归已实现，待独立复核与真人试玩）
- 复核补修记录：[docs/REVIEW_T14_T15_FIXES_2026-10-11.md](../docs/REVIEW_T14_T15_FIXES_2026-10-11.md)
- 更新：2026-10-10
- 前置：T11（渡口的失踪信使第一章已就绪）、T12a（同伴故事与关系事实已就绪）
- 本次授权范围：完成新手双章入门冒险闭环，承接第一章 reported/protected/accord 结局并产生两处以上真实玩法变化（帮助、代价、合法路线），提供零资源保底推进与确定性终局收束，打磨推荐角色体验，不开启 T13a/T15。

## 玩家问题与已有能力

### 玩家问题
1. 原有第一章虽然具备三种结局，但结束后仅有结算回城，新玩家无法看到选择对后续世界的真实影响；
2. 新玩家在使用奥法学徒或坚盾卫士时，若金币为 0 或法术位耗尽，因检定预检逻辑（`gold >= costGold + failureGold`）容易被卡死在剧情选项之外；
3. 缺少连贯且可审计的跨章资格判定，仅凭 `ending` 字段容易误将中途撤退或战败的未完成局判定为通关。

### 已有能力复用
- 引擎现有场景与选择系统 (`server/game/engine.js`: `sceneViews`, `chooseScene`, `sceneChoiceStatus`)。
- 英雄永久事实与结算收据系统 (`server/routes/city.js`: `mergeEncounterFacts`, `char.encounterFacts`, `char.settlements`)。
- 第一章全部已有 stable ID 与结构 (`content/missing-courier/`): `crossing`, `testimony`, `reckoning`。
- 推荐角色预设 (`server/game/presets.js`: `guardian` [AC 19, HP 13, STR 17], `arcane` [AC 12, HP 8, INT 17, 调查 +7])。
- 地图与公共冒险目录系统 (`server/game/adventure-system.js`, `public/js/adventure-directory.js`)。

## 接手阅读与代码入口

1. 规范与契约：`AGENTS.md`, `START_HERE.md`, `ARCHITECTURE.md`。
2. 本轮设计：`G:\ai_DND_handoffs\release-1.11-20261010\design\SAMPLE_ADVENTURE.md`, `CONTRACTS.md`。
3. 核心代码：
   - `server/game/engine.js`: 场景就绪检查、条件判定、开门与事实记录；
   - `server/game/content-validation.js`: T8 内容校验器，扩展 `history_ending` 支持；
   - `server/routes/game.js`: 探索局启动时的历史绑定 (`state.historyBinding`)，使用权威动作 `type: 'sceneChoice'`；
   - `server/routes/city.js`: 事实合并、结算收据 mode 校验与幂等；
   - `content/missing-courier/maps/`: 第一章 `courier-crossing.json` 及新增第二章 `river-post.json` (固定 25×15, 主题 hills)。

## 复现 / 目标场景

在隔离的 Docker 运行环境中：
1. 创建或选择推荐英雄坚盾卫士或奥法学徒；
2. 从正常准备页入口进入第一章《渡口的失踪信使》，分别走通 `reported`、`protected`、`accord` 三大结局并正常结算；
3. 进入第二章《河湾哨所的决断》：
   - 验证第二章初始条件已正确冻结为第一章拥有胜利收据的最新结局；
   - 验证在大门处与货栈处观察到至少两处机制差异（免检通行/绕行、盟友出场/信物留存、检定 DC 差异）；
   - 验证在 0 GP、0 药水、0 法术位且检定全失败时，依然能顺利推进至三大终局（`lawful_order`、`free_haven`、`shared_covenant`）；
   - 验证无第一章历史时，提供清晰的中立基准提示与通关路线。

## 范围与实现约定

1. **地图与故事定义**：
   - 在 `content/missing-courier/` 中新增第二章地图 `river-post.json`，尺寸固定为 25×15，主题为 `hills`；
   - 声明 `story.requiresHistory: { storyId: "missing-courier", fallback: "no_history" }`。
2. **通关资格与跨章历史绑定**：
   - 仅在 `POST /api/game/start` 时查询英雄的 `char.settlements` 与 `char.encounterFacts`，必须满足有终局事实且收据 `mode === 'victory'`，按结算时间戳降序与 ID 字典序严格确定最新结局，冻结入 `state.historyBinding`；
   - 在第一章做出终局选择但随后撤退或战败死亡者，严格不计入已完成故事，第二章按 `no_history` 判定；
   - 刷新与读档保持 `historyBinding` 不变，禁止动态覆盖；
   - 严禁影响当前局场景的初始未完成状态，严禁跨英雄泄露。
3. **条件与 T8 校验扩展**：
   - 扩展 `choice.condition.type` 支持 `history_ending`，校验引用的 story 与 ending 真实存在；
   - 纯声明式 JSON，严禁任何形式的动态脚本或 `eval`。
4. **零资源保底路线与失败推进**：
   - 所有必经场景提供 `costGold: 0, failureGold: 0` 的安全分支；
   - 货栈押金统一为 5 GP，杜绝金额矛盾；
   - 终局场景的所有检定失败分支均映射到确定的合法终局。

## 本次不包含

- 不编写自然语言行动解析（交由 T13a）。
- 不制作可视化编辑器或画板（交由 T15a/T15b）。
- 不添加新职业或改动基础 D&D 5e/2024 规则表。
- 不引入外部前端打包器或重构游戏循环。

## 验收标准

- [x] 坚盾卫士与奥法学徒在 AI 关闭时均能从正常入口通关第一章和第二章。
- [x] 第一章的三种结局能各自在第二章激发出至少两处真实的机制差异（通行方式、物资消耗或盟友协助）。
- [x] 四种初始历史（含 `no_history`）在 0 GP、0 药水且检定失败时均能顺利通关。
- [x] 第二章具有三大完整的终结裁决，结算后英雄档案如实记载完整历程，无“未完待续”。
- [x] 在第一章选定结局后撤退或死亡的英雄，进入第二章时判定为 `no_history`；跨英雄互不继承历史。
- [x] 页面刷新、读档与迟到 AI 不改变已确定的剧情分支与事实记录。
- [x] 中英双语文案完整，切换语言不丢失输入草稿或当前聚焦。

## 验证

按 AGENTS 规则运行专用容器完整验证：
```bash
npm run verify
```
如调整了怪物战斗数值，需附加：
```bash
npm run verify -- --balance-runs=50
```
并在容器内捕获真实 Chromium 桌面端（1280×800）与移动端正常入口游玩截图及 DOM 快照。

## 交接结果

- 完成范围：完成新手双章入门冒险（第一章保持 `missing-courier`/`courier-crossing.json` 三种结局；第二章新增 `river-post.json` 与 `missing-courier-chapter-2`，通过 `requiresHistory` 读取第一章胜利结局）；提供基于第一章结局的机制与叙事分歧（Scene 1: show_pass/dock_bypass/accord_notice，Scene 2: cite_records/refugee_token/accord_advocacy）及 `no_history` 基准；零资源保底推进（0 GP, 0 药水，检定失败安全向前推进，costGold: 0, failureGold: 0）；三大确定性最终结局（lawful_order、free_haven、shared_covenant）；T14 集成套件（7 cases, 177 assertions）与 CDP 浏览器套件（70 assertions, 15 截图）。
- 修改文件：
  - `content/missing-courier/maps/river-post.json`
  - `server/game/content-validation.js`
  - `server/game/engine.js`
  - `server/routes/game.js`
  - `server/game/content.js`
  - `public/js/views/play.js`
  - `public/js/localization/zh-CN.mjs`
  - `public/js/localization/en.mjs`
  - `scripts/test-suites.mjs`
  - `tests/integration/adventure-directory.test.mjs`
  - `tests/integration/content-localization.test.mjs`
  - `tests/integration/starter-adventure-t14.test.mjs`
  - `tests/e2e/starter-adventure-cdp.test.mjs`
  - `tests/e2e/adventure-directory-cdp.test.mjs`
- 验证：
  - 专用 Docker 容器完整验证 `node scripts/verify.mjs` 退出 0：
    - eslint: 0 error
    - tsc: 0 error
    - 50 套件（13 unit, 18 integration, 19 browser CDP）全部 PASS，0 失败
    - smoke test PASS (exit 0)
    - 证据目录：`artifacts/verify/2026-10-10T22-09-19-673Z-4c247fc9/`
- 试玩步骤：
  1. 打开首页，创建推荐英雄坚盾卫士（guardian）或奥法学徒（arcane）；
  2. 选《渡口的失踪信使》，走不同选择（支付过路费/交回失物/达成协定）完成第一章并胜利结算；
  3. 回到准备页，选择《河湾哨所的决断》（如英雄未通关第一章，准备页提示未完成前置；如已通关，提示自动隐藏）；
  4. 启动冒险，在哨所大门和货栈体验基于第一章结局的免检通行/绕行及检定分支；
  5. 面对治安官选择三种终局（恢复秩序/收容难民/公议盟约），返回营火胜利结算，英雄历史完整记录。
- 存档/接口变化：
  - `content.json` / `adventures` 增加 `river-post`，带 `requiresHistory: { storyId: "missing-courier", fallback: "no_history" }`。
  - 探索局状态新增 `historyBinding: { storyId: string, ending: string, completedTs: number, sourceSaveId: string }`。
- 复核状态与后续任务：
  - T14 实现已完成；2026-10-11 独立复核指出"克隆后跨章道具/结局引用不可达"这一真实缺陷，已按 R2 补修并新增 `clone-playthrough` 回归（试玩真实打到 `reported` + 导出 → 隔离数据环境导入 → 普通英雄两章实际通关），**待独立复核与真人试玩确认**，不声称已真人通关。
  - 遵守地面规则：未 commit、未 push、未修改 `package.json` 版本号。
  - T13a、T15a、T15b 已于 2026-10-10/11 完成实现，其复核补修（R1/R3–R9）见 [复核补修记录](../docs/REVIEW_T14_T15_FIXES_2026-10-11.md)。
