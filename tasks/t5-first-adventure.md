# T5 — 快速开始与首次体验

- 状态：done（2026-10-02，T5a 补齐预设职业技能后关闭；见 tasks/t5a-preset-skills.md 与 docs/T5_T7_REVIEW_2026-10-01.md，未发版）
- 更新：2026-10-02
- 前置：T4。
- 类型：降低第一次开始游戏的负担。

## 玩家问题与已有能力

现有七步创建完整，适合研究角色；第一次进入的玩家要先理解许多选项才能开始。已有 buildCharacter、职业装备选项、角色 CRUD 和出发流程，不需要再造创建器。

## 代码入口

- `server/game/engine.js` 的 buildCharacter 与角色规则表。
- `server/routes/characters.js`、`server/index.js` 的 rules。
- `public/js/views/home.js`、creator.js、T4 的准备与指导。
- `tests/unit/rules.test.mjs`、创建/出发的 browser 流程。

## 第一版范围

提供两个易理解的推荐英雄（例如近战与施法），使用服务端规则生成，客户端只选择 presetId。给出玩法差异说明，允许命名；自定义创建保持可用。

快速英雄创建后沿同一个准备入口开始当前主线。最小按需教学覆盖移动、交互、一次战斗、返回与结算；可以跳过，不让教程改变判定结果。

先验证现有地图上的指导是否足够。只有试玩确实需要时才加一张小教学地图，复用现有实体/渲染，设计目标约 10–15 分钟。不要把这个目标写成未经实测的已达成结果。

默认玩家文案简体中文，专有名保留。推荐配置必须真能通过现有创建和战斗，不追求复杂 build。

## 本次不包含

新增职业/种族、重新平衡全游戏、收费/账号系统、遥测平台、全量翻译或新的创建向导框架。

## 验收标准

- [x] 玩家无需完整七步也能创建、命名并开始冒险。
- [x] 两个预设来自服务端现有规则，配置合法、装备与技能真实生效（T5a 独立复核通过，2026-10-02）。
- [x] 原自定义创建、升级与已有角色读档仍可用。
- [x] 教学可跳过，不重复弹出干扰，不以未发现内容给提示。
- [x] 桌面/手机能完成创建 → 准备 → 行动 → 目标 → 结算 → 下一目标（开发/整合记录；独立复核范围见下方报告）。
- [x] 记录一次实际试玩的时间/卡点与仍需调整的部分，勿用测试结果替代体验观察。

## 验证

预设需规则/HTTP 验证及真实浏览器开始流程，教程检查关键一次性行为；完整 verify。若调整数值或新增数值表，按 AGENTS 跑 balance-sim。

## 交接结果

- 完成范围（2026-10-01，T5/T7 并行分支，本目录）：
  - **服务端两个推荐英雄**：新增 `server/game/presets.js`（近战 `guardian`＝矮人战士/guard/defense
    风+剑盾，HP 13 / AC 19；施法 `arcane`＝人类法师/sage，HP 8 / AC 12 / INT 17，Fire Bolt+Light
    戏法、魔法飞弹/盾/燃烧之手、免费 Mage Armor）。预设 draft 只存在于服务端，经真实
    `engine.buildCharacter` 构建；客户端经 `/api/rules` 的 `presets` 只拿展示元数据，
    创建只提交 `{ presetId, name }`（名字可空 → 预设默认名）。`POST /api/characters`
    中 preset 覆盖客户端同名字段、未知 presetId 400；响应附 `guidance`（与 GET / 同形）。
  - **快速命名创建**：首页快速开始卡（无英雄时突出显示、有英雄时为紧凑卡）→ 两个预设瓦片 +
    名字输入 + 「创建并准备出发」。创建后跳 `#/overworld?char=<id>&node=<guidance.primary.mapId>`
    ——即 T4 引导的同一主线准备入口，不自动出发（难度/同伴/Embark 仍由玩家操作）。
    七步自定义创建入口保留（空状态与卡片右上链接均可达）。
  - **首次教学**：新增 `public/js/views/play/tutorial.js`（悬浮引导卡：移动→互动→战斗→结算）。
    play.js 仅 6 行挂接（创建/maybeStart/两处 observe/destroy）。步骤只由服务端状态与动作响应
    推进（玩家位移、`mode`、`stats.kills`、`settled` 镜像、interact 无 error 事件）——不读客户端
    骰值、不发任何动作、不改任何结果。localStorage `aiDnd.tutorial.v1` 记录 done/skipped 与
    已完成步骤（刷新原地恢复、完成后/跳过后永不再弹）；战斗可从前面步骤前跳，结算步在地牢结束
    时接管。文案简体中文、无未发现内容泄露。
  - **必要修复（T5 范围内）**：`engine.buildCharacter` 从未把背景 origin feat 传入
    `finalizeSpells`（读的是不存在的 `draft.feat`）——三个 magic-initiate 背景（acolyte/sage/
    guide）的赠礼戏法与免费法术对所有新角色都静默丢失。现传 `feat: bg.feat`，自定义创建与
    预设一致受益（见 ARCHITECTURE §7）。
- 验证：新增 `tests/integration/quick-start.test.mjs`（55 断言：预设经真实引擎构建合法、HTTP
  创建/改名/默认名/未知 presetId/preset 优先、旧七步路径不变、两预设均能出发并行动）与
  `tests/e2e/quick-start-cdp.test.mjs`（24 断言，CDP 端口 9227/独立 profile：首页快速开始卡、
  预设切换与默认名联动、创建直达准备页、Embark 按钮存在、教学出现/推进/断点恢复/跳过后不再弹）。
  `npm run verify` 全绿（隔离 DATA_DIR）：eslint、tsc、20 套件（新增 2 个）、smoke。
- 试玩记录（真实 Edge/Chrome 内核浏览器 + 真实 HTTP，隔离 DATA_DIR，关闭 AI）：
  - 全流程亲手走通：首页快速开始（默认名）→ 准备页确认 → Embark → 教学 1/4 移动（WASD 一步即进）
    → 2/4 互动（点击房门开锁）→ 3/4 战斗提示 → 击杀僵尸 → 路遇两只大鼠追进营火区、1 级英雄被打倒
    → 死亡豁免稳定 → 撤退 → 结算面板（+8 gp、+174 XP，收据 `<saveId>#1` 入档案、镜像入地牢档）
    → 教学 4/4 完成 ✅。快速创建到准备页 <2.5s；教学四步各自即时响应；含一次自动化驾驶造成的
    意外阵亡在内全程约 19 分钟。纯引导路径的 10–15 分钟仅为估计，设计目标尚未通过独立计时试玩证实。
  - 试玩发现并已修复：**教学战斗步无法完成**——击杀与战斗结束常发生在同一次动作（响应 state 的
    mode 已回 explore），旧判定 `mode==='combat' && kills>base` 永假；已改为「击杀数超过基准即完成」，
    基准持久化（`killsBase`），断点恢复后仍正确。
  - 试玩观察（未在本任务处理）：① 营火/入口"安全区"会被游走怪追入，1 级角色在此死亡挫败感强
    （数值/游走设计，超出 T5 范围，建议后续评估营地格安全或游走怪不追进入口厅）；② 教学卡浮在
    聊天条左上，视觉可接受但略有遮挡，如需优化再调 CSS。
- 与 T7 的接口/整合备注（交整合者）：① 本轮会话中 T7 的引擎统一检定/路遇增量被合入本目录
  （engine.js、characters.js 路遇段、api.js、dice.js、panels.js、game.js、road-encounter.js、
  replay-bot.mjs）——两任务改动已共存且全部验证通过；② **smoke-test.mjs 的路遇段已按 T7 两段式
  协议（trigger → resolve，等待 shrine 出现）改写**，此文件属于 T7 语义，请 T7 负责人复核；
  ③ `/api/rules` 新增 `presets` 键、`POST /api/characters` 响应新增 `guidance` 键（均为增量，
  T7 客户端不读不受影响）。
- 整合结论（2026-10-01）：T5 与 T7 已在最终工作目录逐段合并；整合后完整 verify 全绿（22 套件 + smoke），真实浏览器共同流程全走通（含 T7 开锁/路遇与 boon 带入、圣物→营火胜利→下一目标）。整合轮修复的三个预存 bug（圣物不可点击、自然 1 死亡白屏、侧栏复活卡结算）已同步 ARCHITECTURE §7 与 docs/T5_T7_PARALLEL_HANDOFF.md 整合记录——其中圣物不可点击此前让主线第一幕在 UI 内无法完成，属本项目长期潜伏问题。
- 未完成项：预设职业技能问题已由 [T5a](t5a-preset-skills.md) 修复并独立复核通过。教学地图未新增，按规格先使用现有地图。
- 下一建议：补完 T7a 后建议 T8 → T6，需用户另行指派。

## 独立复核补记（2026-10-01）

[本轮报告](../docs/T5_T7_REVIEW_2026-10-01.md)：完整 verify 22 套件全绿，真实 Edge 两种预设命名创建/准备及受控营火胜利→结算→下一目标通过；骰面与引擎结果一致。另查出 guardian 只含背景技能、arcane 未另补职业技能，现有“合法”测试未检查职业配额。主体实现保留，配置完整性待 T5a 关闭；前面开发与整合结果作为历史记录，不表示独立验收已全部通过。

[2026-10-02 后续复核](../docs/T5A_T7A_REVIEW_2026-10-02.md) 确认 T5a 技能补齐通过，原配置问题关闭；T7a 两条客户端边界及冒烟测试仍待补完，不属于 T5 的重复开发范围。
