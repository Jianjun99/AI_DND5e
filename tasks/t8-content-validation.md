# T8 — 内容包校验与扩展准备

- 状态：done
- 更新：2026-10-03
- 前置：无；T6 扩展格式时继续补相关检查。
- 类型：支持任务，在 T6 前单独指派。

## 目标与已有能力

内容包已有地图/怪物/装备加载、基础字段检查、重名忽略和导入导出。补足“成功加载但无法玩”的检查，让后续 agent 和作者通过明确错误修正内容。

## 代码入口

- `server/game/content.js` 的 scan/validateBundle 与纯检查模块 `server/game/content-validation.js`。
- `server/routes/content.js` 的导入、导出、reload。
- `shared/maps/`、`content/`、地图水合和 stairs/victory；MODDING。
- 现有 progression、smoke 的内容包用例和 map-entities 测试。

## 第一版范围

- 尺寸与 rows 一致，出生/出口/实体坐标有限且在边界内，关键位置是可用地形。
- monster/item/npc/stairs 引用存在，胜利类型与对应目标存在；确认所有 pack 的注册之后再检查跨地图引用。
- 检查必要实体 id 重复、非法骰子表达式与关键数值字段；保留现有合法字段和旧模组默认行为。
- 按需要做静态可达性检查，解释门/锁/楼梯的假设，不把暂时被锁挡住等同于地图不可玩。
- 错误带 pack、文件与字段路径；区分致命错误、重复内容被忽略、可选提示。
- 为作者提供可运行的检查入口或复用现有工具；MODDING 示例实际能加载与完成。

已有首页会出现核心与 howling-hills 的 dire_wolf 重名提示。先记录哪些定义实际生效，勿直接删除核心或改平衡来消除 warning。

此任务不扩职业/种族，不引入脚本插件沙箱，不提前实现通用剧情语言。T6 对最小 scene 协议新增的引用/后果检查在 T6 同步扩充。

## 验收标准

- [x] 已有核心/发行内容仍可加载，兼容默认值有说明。
- [x] 坏尺寸、越界坐标、断引用、错误目标给出可定位错误，不静默变成另一张地图。
- [x] 跨 pack 合法引用和楼梯可用；忽略重名的结果可解释。
- [x] 一个完整最小示例能导入、游玩、导出再导入。
- [x] 错误示例和合法示例受自动验证；新格式说明与实现一致。

## 验证与交接结果

以 fixture 验证内容输入与完整引用检查，复用 HTTP 导入导出用例；涉及 UI 错误展示则真实浏览器查看。完整 verify；若涉及数值调整按 AGENTS 处理。

- 完成范围：字段与跨包引用两阶段校验；error/warning 结构化诊断带 pack/file/field 与重名 winner；预检 API 和只读作者 CLI；坏导入不落盘、完整替换、失败回滚、删除旧文件；明确拒绝未知地图和坏楼梯到达位置；最小包真实 HTTP 导入→取圣物→营火胜利→导出→删除→重新导入→再次胜利。
- 新代码：`server/game/content-validation.js`、`scripts/check-content.mjs`、`tests/integration/content-validation.test.mjs`、`tests/fixtures/content/minimal-pack.json`；现有 content/game 路由与引擎作必要接线，未拆引擎或引入依赖。
- 发行内容修复：howling-hills 的 hh_chest2 从墙格 (20,3) 移到 (20,4)；sewers 出生 (3,7)→(3,8)、sw_c1 (22,11)→(21,11)；mill 出生/营火 y13→14、ml_c2 y10→11、三个墙内怪物 y13→14；roost 出生/营火 y19→20。三张 Sunlit Vale 地图营火 ID 修为 campfire。sewers 已声明的实体 boss:true 原先被水合忽略，现在与校验/精英资格一致生效。NPC marker 补 npcId，合法 NPC 实际交互不再 crash。怪物属性/掉落数值表未改，core dire_wolf 仍优先。
- 验证（2026-10-03）：`npm run verify -- --balance-runs=50` 在专用 Docker 中退出 0，eslint/tsc/25 套件（5 个 Chromium CDP e2e）/smoke/balance 全绿；T8 51 场景、180 断言。五张 Boss 地图在受控的已击败 Boss 状态下，以真实移动触发营火胜利；没有以此声称测试过每场实际战斗。`cleanupComplete=true`。
- 证据：`artifacts/verify/2026-10-03T04-33-08-214Z-da34e8a3/result.json`、同目录 last-verify.log。前几轮失败日志保留：首轮揭露发行坏坐标，后两轮修正重名测试对文件夹优先级的错误假设；最终无失败。
- 平衡记录：50 次/常规配置，crypt normal solo 存活 62%、vault normal solo 72%，胜利计数均 0。该机器人探索/战斗而不执行完整圣物回营火流程，且未覆盖本轮修复的三个 Sunlit Vale 地图；随机非配对历史结果不能推断胜率提升/下降。
- 兼容：缺尺寸从 rows 推导；legacy victoryTile、缺 victory.type、缺 entities/npcs/chest.loot 保留默认；其他作者字段保留。致命输入不再静默默认；几何可达性仅提示，门可开、障碍可毁、怪物可击败，不验证战斗平衡/动态剧情/NPC 占位。修复用于新开局，旧存档的地图快照不重写。
- 试玩：按 MODDING 的 minimal-pack.json 五步导入、取圣物、回营火与重导流程。T8 当前范围无未完成项；用户已授权检查完成后继续 T6，scene 协议的引用/后果检查由 T6 扩充。
