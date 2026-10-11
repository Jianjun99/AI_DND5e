# H1 — 游戏操作区稳定性收尾

- 状态：done（2026-10-04，最终完整验收通过）
- 前置：V1a/V1b 已完成；保留 T9a–T11、补修、M1/L1/V1a/V1b 全部未提交成果。
- 来源：[V1b 交接 · 剩余边界](v1b-visual-packs.md) —— "既有 HUD 在辅助描述完成时整块重建，
  真实长按中可能丢点击，已有确定性屏障证据"；"移动/死亡截图中部分既有 HUD 文字左缘裁切，
  原因尚未确认"。产品交互修正被 V1b 明确留待另行授权，即本轮 H1。
- 范围：仅 `public/js/views/play.js` 游戏操作区（sidePanel / coreHud / encounterTools /
  questTrackerHost / 先攻条 / 地牢背包弹窗）的重建方式与配套回归；测试镜像 emoji 字体一处。
- 不领取 T12/T13，不动引擎/规则数值/稳定 ID/包格式/版本，不 commit/push/发布。
- 新界面只以横向桌面为目标，不做手机专用优化（保留既有必跑移动回归）。

## 目标（用户指派原文）

1. 辅助描述、画像和轮询返回时，保留仍有效的按钮节点、键盘焦点及正在进行的指针操作。
2. 真实状态变化仍正确更新按钮；动作失效时阻止操作，不补发旧点击，不重复发送行动。
3. 检查已有 HUD 文字裁切证据，区分页面与截图采集问题；确认原因后再修，保留原始证据。
4. 保留地图、相机、输入草稿、浮层、全屏和结算锁。

确定性浏览器回归：鼠标按下 → 释放被拦住的 describe 响应 → 等待 UI 更新 →
鼠标松开，验证一次正确点击和实际结果；同时覆盖焦点、双语、失效按钮、离页和结算锁。
不允许用重复点击或等待所有描述结束来掩盖问题。所有自动测试和 Chromium 在专用 Docker 中执行，
最终 `npm run verify -- --timeout=1200`，实际查看 PNG/DOM。

## 方案

- 新模块 `public/js/views/play/hud-patch.js`：键控 DOM 调和（identity key = 标签 + id +
  data-act/classact/quickslot/scene-open/cast/delve-inv-*/item/target-id/card/hud）。
  匹配到的节点原位保留，只把属性/文本/子树补齐到最新渲染结果；匹配不到的照旧换新。
- **宿主常驻节点原位修补（关键）**：调试发现 Chromium 在按住的节点被 detach 时会丢弃
  click 候选——即使 mouseup 前重新插入也不合成 click。因此 grid/经济条/目标行/场景按钮/
  任务卡这些被布局移入 coreHud/encounterTools/questTrackerHost 的节点，其 fresh 对应子树
  先从模板中摘除、直接在宿主内补齐，**从不移动**；布局切换时才走 `renderSide(true)` 整块重建。
  这是"保留正在进行的指针操作"的充要条件，单靠节点复用不够。
- `renderSide()` 改走调和：顶层卡片加 `data-card`，动作网格/经济条/目标行/快捷栏加 `data-hud`，
  四个宿主容器不再先清空；`wireSide`/背包弹窗监听加 `data-wired` 防重挂（闭包只读活状态，
  保留节点旧监听行为等价）。先攻条与背包弹窗同一调和入口（ribbon 卡片按 data-target-id，
  背包行按 delve-inv-*/item 键）。
- 焦点：保留节点自动存活；被替换节点的焦点按 key 找新节点恢复（disabled 不恢复）。
- 无任何合成点击/补发路径；动作是否可按仍由服务端状态渲染的 disabled 与 `act()` 的
  busy/存活守卫决定。`patchHud` 异常时回退一次整块 innerHTML 并 console.error
  （回退后丢点击会被 CDP 回归当场抓住，不会静默）。
- `window.__dndDebug.target(id)` 新测试 seam：与地图点击相同的
  selectedTarget/update/fetchAppearance 路径，供 e2e 绕开先攻条浮层几何稳定触发 describe
  （2D 全图画布中部条带被先攻条覆盖，真实坐标点击会打在浮层上——round 6/8 失败根因）。
- T11 `proveDescriptionClickSurvival`（原 Race）翻转为修复后断言：describe 返回后按住的
  攻击节点仍连接且被复用，抬起在节点当前位置恰好产生一次 click、恰一次 attack 请求且被
  服务端接受、行动正确耗尽；证据 `t11-description-click-race.json` 改为
  pressedConnectedThroughDescribe / pressedNodeReusedByHud / clicks / newReplies 自洽字段。

## 裁切证据复核结论（2026-10-04）

用零依赖 PNG 解码对比 `artifacts/verify/` 第 7 轮（2026-10-04T23-42-08-484Z）与第 9/10/11 轮
（00-27-50 / 00-47-36 / 01-13-43）同代码截图：

- V1a 移动截图 r7 vs r10 全图 diff：HUD 文字区 0 像素差异（仅 3D 板面 RNG 差异与 7 个
  反锯齿像素）；V1b 动作按钮区 r7 vs r9 区域 diff 0 像素。
- 所谓"左缘裁切"是完整但狭窄的 tofu 空心框：按钮/引导行文案以 emoji 开头
  （🗡 攻击、👣 29 ft、💀 等），测试镜像只装 `fonts-noto-cjk` 无 emoji 字体，
  Chromium 以窄 .notdef 框呈现，人工看图像被裁。
- 结论：页面渲染特性（验证环境字体缺失），不是 CSS 裁切，也不是截图采集问题
  （采集代码在第 6–10 轮多次变更而像素不变；CDP 截图为合成器完整帧）。
  第 7 轮"没有"为观察偏差，第 7/9/10/11 轮像素一致。
- 处理：`Dockerfile.test` 补装 `fonts-noto-color-emoji`，此后截图如实呈现 emoji；
  不改产品文案/规则。最终轮截图已实际核验 emoji 正常渲染。
  原始 PNG/DOM 全部保留在各轮 artifacts 目录，复核脚本在 `artifacts/h1/`
  （png-crop.mjs / png-diff.mjs / png-diff-region.mjs）。

## 执行与交接

### 实现行为

- 辅助 describe/portrait/轮询返回引起的 `update()` 不再整块重建操作区：仍有效的按钮保持
  同一 DOM 节点（监听、焦点、进行中的指针按下全部存活），仅 disabled/文案/标题按最新
  服务端状态补齐；失效按钮随真实状态替换为 disabled 新节点，抬起不产生点击。
- 动作单发不受影响：`act()` 的 viewAlive/token/busy 守卫与 T7a 防重逻辑原样；调和后
  无重复监听（data-wired），无补发路径。结算面板、scene 弹窗、商店、日志、聊天输入草稿、
  相机、渲染器、全屏、panelManager 结算锁均不在调和范围内（原节点/原机制保留）。
- 背包弹窗在轮询刷新下同样保留按钮节点与焦点（原焦点恢复逻辑保留为兜底）。
- 先攻条卡片按 data-target-id 复用；onSelectTarget 为 onclick 赋值，幂等。

### 兼容

- 不改引擎/规则数值/稳定 ID/包格式/存档；`visualEvents`、adoptState、结算锁、
  i18n（data-i18n-* 属性随调和同步，translateDOM 行为不变）全部原样。
- 布局切换（战术 ↔ 地图优先）显式走整块重建；首次挂载宿主为空，调和自然退化为全量创建。
- 真实状态变化（回合切换、行动耗尽、模式切换、目标死亡）仍即时反映：键不匹配的子树
  照旧替换，disabled/文案逐属性补齐。

### 验证与清理

最终完整 `npm run verify -- --timeout=1200` **退出 0**：eslint/tsc/**46 套件（17 个正常 CDP）**
/smoke 全绿。证据 `artifacts/verify/2026-10-05T07-17-18-940Z-aa4d736b/`，
`cleanupComplete=true`、`timeout=false`，完成时间 UTC 2026-10-05 07:35:55；
固定验证容器已移除（`docker ps -a` 无 ai-dnd-verify），生产容器不受影响。
开发期间共 12 轮完整验证：r1 暴露 T11 丢点击、H1 夹具错误与 t7a ambush 偶发；r2–r3 用
点击记录器定位 Chromium "按住节点被 detach 即丢 click"机制并落地 B2 原位修补（r3 起点击
真实落在按住的按钮上）；r4–r9 逐个消除测试侧竞态与坐标/缓存陷阱；r10 只剩一处自建错误
断言与 V1b 时序偶发；r11 首次全绿但证据字段采样点不当；r12 为最终验收。

- **H1 CDP 32/0**（新增 `tests/e2e/hud-stability-cdp.test.mjs`，端口 9241）：
  - 确定性丢点击回归：真实指针按下攻击键 → 被拦住的 describe 响应释放 → 等 UI 稳定 →
    断言按下节点仍连接且被 HUD 复用 → 在节点当前位置抬起 → 恰一次 click（document 级
    click 记录器作证）→ 恰一次 attack 请求、服务端 200 无错误、状态被采纳、行动耗尽。
  - 失效按钮：行动耗尽后攻击键 disabled，真实按下+抬起零请求。
  - 焦点（zh-CN）：焦点置于结束回合键 → 被拦住的 describe 返回 → 同一节点保持焦点 →
    真实 Enter 键盘激活一次 endTurn 被接受。
  - 离页：拦住的 describe 在离开 delve 后释放，视图身份守卫丢弃，零异常。
  - 结算锁：撤退 → 结算写入被活视图采纳（HUD 调和运行）→ 摘要存活 → 再点回城零动作 →
    解锁后返回城镇。四张 PNG（combat-staged / press-survival-en / focus-survival-zh /
    settlement-lock）与对应 DOM 已实际查看，emoji 真实渲染、断言与画面一致。
- **T11 CDP 139/0**：翻转后的竞态证明与两条真实路线（双语×双路线）全绿；
  `t11-description-click-race.json` 现记录 describe 期间连接+复用为 true。
- 其余 CDP 与此前轮次一致：Review 202/0、M1 202/0、L1 354/0、V1a 45/0、V1b 51/0、
  T6 39/0、T9a 27/0、T9b 139/0、T10 107/0、T9c 169/0（T9b/T9c 断言数随套件内条件路径
  在 137–142 / 164–169 间浮动，历史轮次同样如此，本轮 0 失败）。
- 规则数值/稳定 ID/版本未改 → 无需 balance（AGENTS 条款）。

### 试玩

1. `npm start` 打开 `http://localhost:3000`，进入任一地下城（如无光墓穴），2D/3D 皆可。
2. 点击怪物锁定目标（描述/画像返回时注意右侧栏不闪动、按钮不重排）；在其返回前按住
   "攻击"并等待约 1–2 秒再松开——应恰好打出一击（此前会安静地丢掉这一击）。
3. 键盘 Tab 到战斗按钮后点击怪物触发描述——焦点应保持在原按钮上。
4. 行动耗尽后攻击键变灰且按不出；结束回合后敌人行动、轮询刷新不再打断任何按住的操作。
5. 打开背包（B）期间等待 4 秒轮询——按钮不重排、焦点不丢。
6. 入口撤退：结算面板打开、入账、确认返回——全程 HUD 不重建摘要。

### 剩余问题与边界

- **t7a CDP 偶发（本轮第 1 轮遇到，第 2/10 轮复现后第 11/12 轮通过）**：
  `ensureEncounterType` 的路遇类型在无 seed 时走 `Math.random()`
  （`triggerRoadEncounter` → `beginRng(char)`，角色无 seed 字段 → rngState=null），
  12 次重试全非 ambush 的概率约 (2/3)^12 ≈ 0.8%，与 H1 无关（服务端未改、
  该套件浏览器交互全部为非调和弹窗上的程序化点击）。若再红，建议另行指派：
  给角色/trigger 接入种子或提高重试预算。
- **describe 缓存按怪物类型共享键**（locale+monsterId）：同类型两只怪只有 en/zh 两次
  未缓存 describe——测试按此现实编排（按压证明 en、焦点证明 zh）。玩家可感知行为
  （同类型第二只不重新请求描述）为既有设计，未改。
- 焦点恢复仅在"被替换节点有同 key 后继"时生效；模式整体切换（如战斗→探索）时焦点
  落回 body，与改前行为一致。
- `appearanceLoading` 与 `pk` 的比较带 locale 前缀（`en:skeleton` vs `skeleton`），
  "DM 正在观察"转圈卡为既有死代码，本轮未动（不影响任何断言）。
- V1b CDP 在第 10 轮出现一次"confirmed HP reduction plays hit without waiting for
  animation"时序抖动（该轮容器负载较高），第 11/12 轮同代码通过；第 1 轮 t7a 同理。
  两套件断言均为时序敏感型，未改产品代码。
- 手机回归保留必跑（responsive/T9c/T11 手机段全绿）；本轮未新增手机专用布局。

### 未提交成果与授权边界

接手时 133+ 条未提交成果全部保留；本轮新增/修改：
`public/js/views/play/hud-patch.js`（新）、`public/js/views/play.js`、
`public/js/views/play/ribbon.js`、`public/js/views/play/delve-inventory.js`、
`tests/e2e/hud-stability-cdp.test.mjs`（新）、`tests/e2e/branching-adventure-cdp.test.mjs`、
`scripts/test-all.mjs`、`Dockerfile.test`、`tasks/h1-hud-stability.md`（新）、
`tasks/README.md`、`PROJECT_STATE.md`、`START_HERE.md`。
未 commit/push/改版本/发版；T12/T13 未领取。
