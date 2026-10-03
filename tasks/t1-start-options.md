# T1 — 开局入口与接口类型

- 状态：done（2026-09-30，`npm run verify` 全绿后更新）
- 更新：2026-09-30
- 前置：无，推荐作为第一次接手任务。
- 类型：已复现 bug 修复。

## 玩家问题

独立准备页选择的地图、难度与同伴没有真正生效。区域地图出发目前正常，需保持正常。

## 接手阅读与代码入口

按 START_HERE 读取规则、当前状态、设计、架构，然后读：

- `public/js/api.js` 的 api.startGame。
- `public/js/views/play.js` 的 playView/saveRef=new。
- `public/js/views/overworld.js` 的 embarkAction。
- `public/js/views/overworld/districts.js` 的 weekly 出发。
- `server/routes/game.js` 的 POST /start 与 engine.startGame。
- `tests/e2e/`、`tests/integration/progression-systems.test.mjs`。

## 隔离复现

1. 用独立 DATA_DIR 启动服务，创建临时英雄。
2. 打开 `#/play/new?char=<英雄 id>`，选择 howling-hills、hard、none。
3. 点击 Descend，读取实际存档的 mapId、difficulty、allyId。
4. 评估时实际为 crypt、normal、bram。

原因：调用传入 options 对象，API wrapper 接收四个位置参数。对象成为 bringAlly，另外两个选项未发送。

## 范围与实现约定

统一 api.startGame 的调用形式并更新全部调用点；推荐显式 options 对象。补 StartGameOptions 的 JSDoc，让传错形式能被 tsc 发现。类型需表达现有 false/同伴 id、difficulty、mapId；实际兼容值以现有调用确认。

POST 的请求字段与现有服务端契约保持一致。检查默认值与按钮等待/失败恢复，不复制规则表，不更改地图、职业、难度数值和队友强度。

## 验收标准

- [ ] 准备页的非默认地图、hard、solo 正确进入游戏。
- [ ] 选择 Valeria 或 Aldous 时实际带上相应 allyId。
- [ ] 默认设置仍可出发，区域地图、每周试炼入口正常。
- [ ] 所有 api.startGame 调用与显式类型一致，无 any/@ts-ignore 绕过此边界。
- [ ] 浏览器确认准备页行为与网络请求；更新任务与项目状态。

## 验证

补一组经过真实准备页的行为检查，不能仅验证 POST API。可扩充已有 CDP 套件，按条件等待最终存档。按 AGENTS 跑完整 `npm run verify`；本任务不应改数值表。

## 交接结果

- 完成范围（2026-09-30）：
  - `public/js/api.js`：`api.startGame` 从 4 个位置参数改为 `(characterId, options)` 一个
    显式 options 对象，POST 字段（characterId/bringAlly/difficulty/mapId）与服务端契约保持
    不变；新增 `StartGameOptions` JSDoc typedef（`bringAlly: false | 'bram' | 'valeria' |
    'aldous'`、`difficulty: 'easy' | 'normal' | 'hard'`、`mapId: string`，含 endless_1/weekly
    说明）。options 参数必填——用 tsc 探针验证过：旧位置参数形式、字符串当 options、缺
    options 三种错误形式都会产生 tsc 错误（TS2554/TS2559），无 any/@ts-ignore。
  - `public/js/views/play.js`：准备页调用本来就是对象形式，新签名下直接正确（即本 bug
    的修复点）；Descend 按钮加 busy 守卫（请求期间禁用 + 文案变化，失败 toast 后恢复，
    防双击重复开局）。
  - `public/js/views/overworld.js`：区域出发改为 options 对象（UI 值带类型 cast，无表复制）。
  - `public/js/views/overworld/districts.js`：weekly 出发改为 options 对象。
  - **顺手修复既有回归（验收项"每周试炼入口正常"暴露）**：v1.9.7 的每周试炼 UI 只剩事件
    处理器存活，渲染端（公会厅每周试炼卡、英雄殿堂周榜卡、hallData 解构）丢失——按钮
    从未被渲染，weekly 入口实际不可达。按原 v1.9.7 补丁内容用 Edit 补回三处，无数值改动。
- 验证：
  - 扩充 `tests/e2e/gameplay-refinements-cdp.test.mjs` Check 9：经过真实准备页的两个场景
    （howling-hills+hard+solo；valeria+默认）共 12 项断言——既抓 POST 网络请求体（包装
    window.fetch），也按条件等待后读**服务端实际存档**断言 mapId/difficulty/allyId。
    套件 34→44 断言全绿。
  - 真实浏览器人工确认（headless Edge CDP 截图 + DOM dump，独立 DATA_DIR）：准备页默认值
    crypt/normal/bram 正确渲染；选 howling-hills+hard+solo 出发后小地图标题 "The Howling
    Hills"、侧栏 Hard 徽章、无队友 chip、Potion(1)（hard 配给正确）、存档 mapId/difficulty/
    无 ally 与所选一致；公会厅每周试炼卡渲染并一键进入 weekly_5（2026-W40）；区域地图
    drowned-vault 出发正常（含路遇弹窗路径）。
  - `npm run verify` 全绿（eslint / tsc / 17 套件 / smoke，独立 DATA_DIR，跑两次——weekly
    UI 补丁前后各一次）。本任务未改数值表，未跑 balance-sim。
- 未完成项：无。遗留观察：`POST /api/game/start` 服务端仍接受字符串 `'none'` 与 truthy
  兜底（engine 对未知 allyId 回落 bram）——服务端契约保持原样未动，客户端类型已收紧。
- 下一建议：T2，需用户另行指派。
