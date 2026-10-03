# T4 — 全程目标与下一步

- 状态：done（2026-10-01；T4a 补修完成并通过独立验收，见下方补记）。
- 更新：2026-10-01。
- 前置：T1–T3。
- 类型：玩家体验改进，现有主线和地图标记必须复用。

## 玩家问题

用户反馈“功能已经很多，但体验不顺、不知道该玩什么”。已有主线横幅、地图标记、hover 提示和任务卡；本任务把它们串成能直接行动的流程。

## 代码入口

- `server/game/campaign.js` 的 objective/currentAct/actForMap。
- `server/routes/city.js` 的 info/campaign；game.js 的 sanitize 和 T2/T3 契约。
- `public/js/views/home.js`、overworld.js、play.js、play/panels.js。
- `public/js/app.js` 的 charObjective/campaignObjective；浏览器 responsive 套件。

## 第一版行为

服务端根据真实状态提供 guidance：当前阶段、目标、一项主要行动、理由及少量可选行动。字段由实现者最小化设计并写进架构，不复制 XP、胜利条件或战斗数值表。

- 首页：可继续存档时显示明确“继续冒险”与目标；没有活动局时显示下一次准备入口。
- 出发：突出当前主线推荐地图与理由，允许查看其他地图；准备按钮不自动花钱/招募。
- 地牢：探索时基于已发现信息提示；战斗时说明可用行动及不可用原因。
- 目标已取得：切换返回营地提示，区别区域安全、目标完成、已结算。
- 结算后：展示实际收获、故事变化与下一目标，统计移入详情。

基础建议全部使用确定性模板，断开 LLM 完整可用。地图坐标与未发现内容不通过提示泄漏。按钮执行时仍重新由服务端校验。

新增默认文案用简体中文，专有名称保留；不展开全量翻译。手机普通/沉浸模式提供可达的目标摘要与常用行动，细节按需展开。

## 本次不包含

新怪物、新主线、职业、经济数值、AI 意图解析、强制自动行走、全量 UI 重做或新框架。

## 验收标准

- [x] 新英雄知道推荐目的地和原因，能直接进入准备流程。
- [ ] 存档恢复能看出当前目标，首页多个存档的继续行为明确（较新已结算档遮住活动局，待 T4a）。
- [ ] 取得目标后提示回营地，回城后显示真实下一幕/可选目标（入口撤退不推进主线，待 T4a）。
- [x] 主线完成、自由地图、战斗、撤退、死亡等情况不显示过期建议。
- [x] 推荐与 UI 不泄漏未知地图/陷阱，不自行改变游戏结果。
- [x] 桌面与手机普通/沉浸模式目标和常用操作可达，AI 关闭时一样可玩。

## 验证

补少量阶段行为断言，复用现有 campaign 用例。真实浏览器查看上述关键页面，完成一次目标变化与回城试玩；完整 verify。若数值变化另按 AGENTS 验证。

## 交接结果

- 完成范围：新增 `server/game/guidance.js`（纯函数、无 LLM/无 RNG、确定性模板）作为"下一步"唯一来源，两个形状都按增量字段挂到既有载荷：
  - `journey(char, { liveSave })` → `/api/characters`（每英雄）、`/api/city/info`、`/api/city/campaign`、`sync-delve` 响应。字段 `stage`（unsettled/in_delve/preparing/complete）、`label`、`objective`、`primary`（kind resume/prepare/map/campaign + mapId/saveId + text + reason）、少量 `options`；已结束未结算的存档优先于更新的进行中存档（先保住战利品）。客户端只把 action 映射成 hash 路由（`#/play/<id>`、`#/overworld?char=…&node=<mapId>`、`#/campaign/<id>`），真实动作仍由各自路由重新校验——引导不会自行改变游戏结果，也不自动花钱/招募。
  - `delve(save)` → `sanitize` 的 `state.guidance`。字段 `stage`（explore/objective/cleared/combat/victory/retreat/defeat）、`objective`（HUD 目标药丸，区分"目标取得→回营"与"区域清空"）、`hint`（悬停栏默认文案）、战斗时 `combat`（yourTurn/movementLeftFt/action/bonus/potions/notes）——经济行明确"哪些行动可用、为什么不可用"，客户端渲染为 `.guidance-combat-line`。
  - 接线：`store.listSaves()` 增量携带 mapId/mode/endSeq/settled（供引导区分进行中/待结算/已结算）；结算收据与响应新增 `gains`（相对结算前角色档的真实增量）；首页卡片（目标 + 主行动 + 理由 + 每存档状态章）、区域地图（`?node=` 预选并强制地图标签、"📜 主线推荐"理由、横幅主行动按钮）、地牢 HUD/悬停、战役视图主行动、结算面板（本次结算/故事推进/下一目标，统计折叠进 `<details>`）。新增文案为简体中文；泄漏规则（只用玩家已见的静态地图元数据与主线目标，无坐标/隐藏实体/陷阱位置）写入 ARCHITECTURE §7。
- 验证：
  - `tests/unit/forge-and-campaign.test.mjs` +5 条引导单测（新英雄→墓穴；四幕推进→地窟/缺线索/龙巢/完成转自由探索；待结算优先与结算后接续；地牢 goal/cleared/combat 与敌方回合；文案无坐标/隐藏信息）。`tests/integration/settlement.test.mjs` +3 断言（收据 `gains` 增量、结算响应带 guidance、重放也带 guidance）。
  - `tests/e2e/gameplay-refinements-cdp.test.mjs` Check 10 +3 断言（结算面板收获/下一目标/统计折叠），新增 Check 11：首页目标与"准备出发：沉没墓穴"主行动、点击后区域地图预选墓穴 + 推荐理由 + 横幅按钮、跟随后端未创建任何地牢（无自动出发）。
  - 完整 `npm run verify`（隔离 DATA_DIR）：**首轮即全绿**——eslint、tsc、19 套件（含 3 个 CDP）、smoke 全过；campaign 112、settlement 106、gameplay-refinements e2e 68、responsive 22，全部 0 失败。未改数值表，未跑 balance-sim。
  - 真实浏览器验收（独立 Edge headless + 隔离 DATA_DIR，25 项全过，截图证据 `C:\Users\xu991\AppData\Local\Temp\ai-dnd-t4-accept-evidence`）：首页目标与主行动→点击进入区域地图（墓穴金环 + 推荐理由，服务端确认未自动建局）→地牢 HUD 目标药丸与探索提示来自服务端→置 `hasRelic` 后药丸切"目标已完成——回营地/入口撤退回城"→走入战斗后经济行"主要动作已用 · 附赠动作可用 · 移动 30 ft"→回城结算"本次结算：+38 gp / 下一目标 / 详细统计折叠可展开"→390px 手机首页与地图无横向溢出、目标与主行动可达→沉浸模式任务追踪浮层显示目标。截图：home/overworld/delve-explore/delve-goal/delve-combat/summary/mobile-home/mobile-overworld/immersive。
- 手动试玩路径：首页看英雄卡的目标与"准备出发"→点击直达区域地图推荐点（看理由，自己按 Embark）→地牢顶部目标药丸随时可读（战斗时右侧面板有行动经济行）→取到圣物/击败首领后药丸提示"走回营地（营火）完成胜利"→**走回营火格触发胜利**→胜利自动弹出结算→面板看本局增量、故事推进、下一目标与折叠统计→回首页/地图看到下一幕推荐。（T4a 更正：原步骤"回营地撤退结算"不推进主线——入口撤退只结算已有收获，完成主线必须站上营火格。）
- 未完成项：无（本规格范围内）。规范外的既有英文界面文案未做全量翻译（spec 明确不展开）。
- 下一建议：先 T4a 补修，完成独立验收后再由用户指派 T5。

## 独立复核补记（2026-10-01）

以上交接保留执行时的实现和测试记录；“未完成项：无”是当时的自验结论。最新 [独立复核](../docs/T3_T4_REVIEW_2026-10-01.md) 通过完整 verify，但新增场景发现两处行为偏差，详见 [T4a](t4a-guidance-outcomes.md)：

1. 取得目标后的提示不能要求玩家“营地或入口撤退”来完成主线；实际须走到营火触发 victory。上方旧试玩步骤中的“回营地撤退结算”应改为“走到营火完成胜利，再确认结算”。
2. 较新的已结算档不能压过较旧的 explore/combat；首页主行动应继续活动局。

T4 主体保留，状态改为 in_progress，以上两项验收重新打开；不要求重做架构。

**T4a 验收通过（2026-10-01）**：两项偏差已按 [T4a 交接结果](t4a-guidance-outcomes.md) 修复并补行为回归（真实移动到营火→victory→结算→线索入账；提前撤退不推进；反向时间戳选档），本任务状态恢复为 done。
