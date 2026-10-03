# T4a — 目标完成动作与多存档继续入口补修

- 状态：done（2026-10-01）。
- 更新：2026-10-01。
- 前置：T3/T3a、T4 现有实现。
- 类型：T4 独立复核发现的两处小范围补修；[复核证据](../docs/T3_T4_REVIEW_2026-10-01.md)。
- 授权范围：用户指派本任务后，只修正这两处引导及其回归和交接文档。

## 玩家问题与已有能力

T4 已有服务端确定性 guidance、首页主行动、地图预选、地牢目标和结算下一步。无需重新做整套引导。

但取得目标后，提示允许玩家从入口撤退；实际 retreat 不推进主线。另有“较旧进行中、较新已结算”两局时，首页主按钮推荐重开，忽略已有冒险。这两种行为都偏离“知道下一步该做什么”的目标。

## 接手阅读与代码入口

按 START_HERE 阅读规则、状态和架构，再读 T4 原规格和复核报告。相关入口：

- `server/game/guidance.js`：delve、pickLiveSave、isSettled、journey。
- `server/game/engine.js`：checkVictory、movePlayer、campfireOf；引擎唯一裁决。
- `server/routes/game.js`：retreat 与 sanitize；`server/routes/city.js`：sync-delve 的主线推进。
- `public/js/views/play.js`：HUD、任务卡、返回城镇按钮；`play/panels.js`：结算和下一步。
- `server/routes/characters.js` 与 `public/js/views/home.js`：首页主行动及存档状态。
- `tests/unit/forge-and-campaign.test.mjs`、`tests/integration/settlement.test.mjs`、`tests/e2e/gameplay-refinements-cdp.test.mjs`。

## 复现场景

使用隔离 DATA_DIR，关闭 LLM。通过受控 fixture 省略随机战斗，保持真实移动、撤退、结算路由，不直接给 fixture 填 victory 或主线线索。

1. 第三幕英雄开丘陵，置首领已败、mode=explore，玩家留入口。当前 guidance 要求“营地或入口撤退”；真实撤退后 mode=retreat、campaignAdvanced=false、hills 线索缺失。对照移动到营火则 victory、线索入账、推荐转下水道。
2. 同一英雄 A 为较旧 explore，B 为较新 retreat 且已结算。目前选 B，journey 变 preparing；预期主按钮继续 A。把 A 改为 combat 同样应可继续。

具体坐标从现有地图读取；测试只断言最终收敛和服务端结果，不断言动画中途位置。

## 范围与实现约定

- 提示准确区分“目标已取得，尚需回营完成”与 victory、区域清空、主动撤退、已结算。按现有引擎规则指导玩家走到营火完成，不再把入口/邻格 retreat 说成完成主线。
- 提前撤退可以保留，需要说明它结算已有收获的结果；HUD、默认 hint、任务卡及返回按钮的主要文案不能互相矛盾。不添加强制自动行走，不暴露隐藏坐标。
- pickLiveSave 按“待结算终局 → 进行中（explore/combat）→ 准备/自由探索”选择；组内沿用更新时间。已结算档不遮住活动局，仍保留查看入口。
- 继续以角色权威收据或匹配镜像判断已结算；镜像写失败时，正确收据应足以让位给活动局。不得削弱 T3/T3a 的重复处理与镜像恢复。
- 首页、城镇与结算响应采用一致规则；响应字段与已有存档保持兼容。服务端选择、客户端映射链接，客户端不复制胜利/奖励表。
- 修正 T4 原规格交接里的错误试玩步骤，补完整目标变化到真实主线入账的验收记录。

## 本次不包含

改变 retreat/victory 的奖励规则、修复多存档经济模型、改数值、重新设计 guidance 协议、实施 T5 或引入新框架。

## 验收标准

- [x] 目标取得后，玩家看到正确完成动作；尚未完成胜利时不宣称主线完成。
- [x] 丘陵取得目标→跟随引导移动到营火→真实 victory→结算，hills 线索入账、故事推进、下一推荐转为未取得线索地图。
- [x] 提前入口撤退仍为 retreat，其提示/结算不宣称主线已完成；fetch_relic 地图也使用符合实际完成规则的提示。
- [x] 区域清空但目标未取得时，不把清空当胜利；死亡、战斗、已结算等状态保持有效引导。
- [x] 较旧 explore/combat + 较新已结算终局时，首页主按钮正确继续活动局，点击确实恢复该存档。
- [x] 新旧顺序反转、多个活动局、较旧未结算终局、仅已结算档、不同英雄等组合选择正确；组内最新且待结算仍优先。
- [x] 角色收据存在但镜像缺失/过期时，活动局继续不受影响；结算回归全过。
- [x] AI 关闭可用；桌面和手机普通/沉浸模式真实浏览器查看；完整 verify 全绿，交接文档同步。

## 验证

在既有套件补行为用例：不能只断言文案含”回营”或 stage=objective，要检查真实移动/撤退后的 mode、收据和主线；选档测试必须覆盖已结算档更新时间更大的情形。

真实浏览器检查首页主按钮点击后的 saveId、完成动作到故事/下一目标的全过程。按 AGENTS 执行完整 `npm run verify`；不依赖具体 RNG 值或固定 sleep。

## 交接结果

- 完成范围：两处补修全部完成，未改奖励数值与结算架构。
  - **P1 目标取得文案对齐引擎**（`server/game/guidance.js` 的 delve）：goalReached（stage 仍叫 `objective`）文案改为”走回营地（营火）完成胜利，主线才会推进”，hint 说明提前撤退只结算已有收获；`cleared`（区域清空但目标未取得）改为”区域已安全——目标还未完成：继续探索，或主动撤退”，`returnPrompt: false`；`retreat` 模式文案明示”主线不推进”。客户端 `play.js` 同步：HUD 模式药丸区分”✅ 目标已到手”与”🛡️ 区域安全”（不再一律显示 Delve Cleared），返回按钮标签按状态改为”🏃 提前撤退（走回营火才算完成）”/”🏃 主动撤退（只结算已有收获）”，退出光柱（beacon）在目标已到手时让位于营火引导。
  - **P2 pickLiveSave 优先级**：待结算终局 → 进行中（explore/combat）→ 最近存档（仅已结算时返回最新，journey 视为 preparing）；组内按 updatedAt。权威收据存在即视为已结算（镜像缺失/过期不影响）；镜像与收据都不匹配的终局仍按待结算优先。首页/城镇/结算响应共用同一实现。
- 修改文件：`server/game/guidance.js`、`public/js/views/play.js`、`tests/unit/forge-and-campaign.test.mjs`、`tests/integration/settlement.test.mjs`、`tests/e2e/gameplay-refinements-cdp.test.mjs`、`tasks/t4-player-guidance.md`（试玩步骤更正）及状态文档。
- 验证：
  - 单测（forge-and-campaign，128 断言）：新增”较新已结算不再挡住较旧进行中”（含 combat、多活动局取最新、仅已结算→preparing、他人存档不泄漏、旧待结算仍最优先）与”权威收据在镜像缺失时足以让位/过期镜像不算已结算”；更新 goalReached/cleared/retreat 文案断言（含”不把入口撤退说成完成””清空不宣称胜利”）。
  - 集成行为回归（settlement，129 断言，真实 HTTP 路由 + 受控 fixture——预败首领/解除陷阱/封随机遭遇，移动与裁决全真实）：第三幕英雄丘陵取得目标→**真实移动到营火→真实 victory→真实结算**：hills 线索入账、receipt.campaignAdvanced=true、gains 记录真实增量（+27 gp/+100 XP）、下一推荐转下水道；同一 fixture **在入口真实撤退**：mode=retreat、结算不推进主线、线索为 false、下一推荐诚实重试丘陵；crypt 清空但未取圣物：真实走到营火**不触发胜利**，retreat 仍可用且结算不推进。
  - e2e（gameplay-refinements，73 断言）：新增 Check 12 多存档恢复——较旧 explore + 较新已结算，首页主按钮 href 指向旧局、文案”继续冒险”，点击真实进入该局（无结算面板）。
  - 完整 `npm run verify`（隔离 DATA_DIR）：**首轮即全绿**——eslint、tsc、19 套件（含 3 个 CDP）、smoke（settlement 129、campaign 128、gameplay-refinements 73、responsive 22）。未改数值表，未跑 balance-sim。
  - 真实浏览器验收（独立 Edge headless + 隔离 DATA_DIR，17 项全过，证据 `C:\Users\xu991\AppData\Local\Temp\ai-dnd-t4a-accept-evidence`）：丘陵目标到手态 HUD/按钮文案截图→**真实移动到营火→真实 victory→结算面板自动弹出**：故事推进”线索 1/3 已确认：嚎叫丘陵的酋长”、下一目标”还差：下水道的母巢、磨坊的守卫”、准备出发：下水道，服务端收据/线索/日志同步核对→多存档恢复：首页主按钮”继续冒险”指向较旧进行中存档，真实点击进入该局。截图 t4a-goal/t4a-victory-summary/t4a-resumed。
- 手动试玩路径（更正版）：打完首领/拿到目标后，跟随”✅ 目标已到手”提示**走回营火格**（不是入口撤退）→ 胜利自动弹出结算 → 看故事推进与下一目标 → 回首页；如需提前离开，用”🏃 提前撤退”并知晓主线不推进；多局时首页主按钮始终指向”待结算 > 进行中 > 下一目标”中最该做的一局。
- 存档/接口变化：无新协议；`journey`/`delve` 字段形状不变（cleared 的 `returnPrompt` 语义修正为 false）。
- 未完成项：无（本规格范围内）。
- 下一任务：T5，需用户另行指派。

## 独立复核补记（2026-10-01）

按上次原场景重新建立隔离数据并使用真实 Edge：入口的目标取得文案与提前撤退按钮准确，营火最后一步真实移动触发 victory、结算后丘陵线索和下一推荐正确；较旧活动局不再被新已结算档遮住，首页主按钮真实点击恢复该局。原两处问题均未再出现，截图及证据见 [T5/T7 接手安排](../docs/T5_T7_PARALLEL_HANDOFF.md)。本次没有修改游戏代码。
