# T2 — 状态更新与 AI 结果持久化

- 状态：done（2026-09-30，`npm run verify` 全绿后更新）
- 更新：2026-09-30
- 前置：推荐先完成 T1（已完成）；不依赖它的具体接口设计。
- 类型：两个已复现 bug 的修复与必要状态契约。

## 玩家问题与复现

问题一：同一存档的 describe 请求持有旧快照并等待模型；其间普通移动已保存，describe 完成后又保存旧快照，玩家位置回退。

隔离复现：本地 mock 在生物描述请求上延迟；初始玩家 (4,4)，describe 等待期间移动到 (5,4)；释放描述响应后重新 GET，评估时回到 (4,4)。自动回归使用 mock 的“已收到 / 允许回复”信号控制顺序，不依赖固定 sleep。

问题二：开局/普通动作先 saveGame，后 narrate；响应含旁白，但重新 GET 不含。用独立标记回复比较 POST 与 GET，无需真实模型。

## 代码入口

- `server/routes/game.js`：start/action、narrate、describe/portrait/chat/recap/quest。
- `server/store.js`：读改写与保存；`server/game/dm.js`、`server/llm/client.js`。
- `public/js/views/play.js`：act、fetchAppearance、fetchPortrait、poll 与 update。
- 检查 city/characters 中对同一存档的写入，避免留下绕过新契约的路径。
- 测试：store-versioning、rules 的 RNG 续接、HTTP integration 与 CDP。

## 范围与实现约定

1. 定义同一存档修改的顺序和 revision/关联 ID；机械操作读取最新状态并受控提交。
2. 描述、头像和旁白只更新自己的字段/缓存/日志，不能回写等待前的整份 snapshot。
3. 旁白与动作关联，并能持久化；需要再次保存时从最新状态合并，防重复追加。
4. 前端拒绝辅助响应中较旧的整体游戏状态；辅助结果仍按对象/动作标识正常展示。
5. seeded RNG 恢复、机械结算、写回保持连续，多局交替与慢请求不能串流。
6. 模型失败有固定文案，机械操作不回滚；必要的等待应有反馈。

第一版必须解决竞态与持久化。可以保留现有响应协议中的同步旁白等待；若采用先返回机械结果、后取旁白，应保持已有 UI 和 API 兼容，并写清契约。不得为了异步化先引入消息队列、SSE/WebSocket 或重写整个引擎。

不能通过把整局锁一直持有到长模型请求结束来掩盖问题；也不能在 narrate 后直接把旧 state 再保存一次。

## 验收标准

- [ ] 确定性 mock 并发描述/移动后，最新位置、HP、资源不回退，辅助结果保存。
- [ ] 前端较晚动作完成后，旧辅助响应不替换新状态。
- [ ] 开局和普通动作的旁白在 GET/刷新/重连后仍存在且不重复。
- [ ] 模型超时、错误、关闭时固定结果与机械状态仍可用。
- [ ] RNG 续接与多存档交替仍通过；旧存档默认 revision/新字段可用。
- [ ] 记录写入所有权、响应及关联约定，更新 ARCHITECTURE 与迁移 fixture（若形状变化）。

## 验证

mock 只服务测试，使用独立 DATA_DIR，确保端口/进程收尾。新套件要接入 test-all，并同步实际套件数量相关文档；优先在已有合适套件加用例。完整 verify；客户端真实浏览器确认。数值变化另按 AGENTS 验证。

## 交接结果

- 完成范围（2026-09-30）：
  - **写入契约（store.js + routes/game.js）**：`store.saveGame` 每次写盘递增 `state.rev`；
    新增 `store.withSaveLock(id, fn)`（按存档 id 的互斥队列）。action 路由的机械段是同步
    读改写（getSave → 引擎结算 → stampActionLogs → saveGame，中间零 await——用 grep 验证过，
    7 个模型调用全部移出）；模型等待在锁外用已落盘快照做提示词上下文；随后合并相在锁内
    重读最新档、只写自己的字段（describe 的 appearances 缓存、chat 的 npcChat 历史 + npc
    日志行、rest/recap 的 journal、freeform 的 dm 行、quest 的 hook 文案按 quest.id 匹配、
    portrait 只写磁盘缓存无存档字段）。
  - **旁白持久化与关联（narrate 重写）**：动作产生的日志条目统一盖 `aid`（action id）；
    模型在锁外生成文案后，`applyNarration` 在最新档上执行——按 aid 丢弃该动作的 dm_canned
    行、按 aid 去重追加 dm 行、落盘。POST /start 同样走该路径（场景旁白刷新/重连后仍在）。
    响应体统一从落盘后的最新档构建（`sanitize(store.getSave(id))`），POST 与 GET 一致。
  - **RNG 连续性**：beginRng/persistRng 全程在机械段内，机械段原子化后同档并发动作不再
    可能交错骰子流（比修复前更严）。
  - **前端（play.js）**：`adoptState` 按 rev 拒绝旧的整体状态快照（act/describe/portrait
    响应统一走它，辅助结果照常展示）；describe 等待期在侧栏显示 spinner 卡片（"The DM
    studies the creature…"）；4s 轮询从"实体坐标变化才刷新"改为按 rev 刷新（慢旁白落库后
    无移动也能出现）；portrait 缓存从 `game` 对象提升为模块级 `portraitCache`（服务端快照
    不携带客户端缓存，原实现每次采纳状态都会清掉已渲染的头像卡——既有缺陷，本轮一并修）；
    `__dndDebug` 增加 rev/portraits/appearance/loadingAppearance 访问器（e2e 测试缝）。
  - **模型失败路径**：narrateEvents 失败返回 null（canned 行保留）；describe/recap/freeform
    走既有固定兜底文案；chat 走 canned；机械状态在任何模型失败下不回滚（均被测试覆盖）。
- 验证：
  - 新套件 `tests/integration/state-and-ai.test.mjs`（第 18 套件，接入 test-all）：进程内
    express 挂真实路由 + 独立 DATA_DIR + 进程内 mock LLM（auto/hold/error/never 四模式，
    以"已收到请求 / 释放回复"信号控制顺序，无固定 sleep）。7 组 28 断言：并发 describe+move
    位置不回退且 appearance 落库、start/动作旁白 GET 后仍在且恰好一次、LLM 400 错误与
    超时（3s 下限）后兜底可用、LLM 关闭零请求、双存档交错不串流、rev 递增。
  - `npm run verify` 全绿（eslint / tsc / 18 套件 / smoke，独立 DATA_DIR）。数值表未动，
    未跑 balance-sim。旧存档无 rev 字段按 0 处理、首写盖 1，saveVersion 仍为 2，无需迁移。
  - 真实浏览器确认（headless Edge CDP 截图，独立服务 + mock LLM）：开局旁白在日志面板可见
    且刷新后仍在；点击可见怪物触发 describe——侧栏出现等待卡片，释放后显示外观文案卡；
    战斗中同样可用。截图 t2-1~t2-4（临时目录）。
- 接口/迁移记录：POST 响应协议不变（仍同步等待旁白）；`state.rev` 与 `log[].aid` 为新增
  可选字段，旧档缺省可用，saveVersion 不变，无需新迁移 fixture。
- 未完成项：无。
- 下一建议：T3（一次结算与回城），需用户另行指派。

## 完成后复核（2026-09-30）

原问题回归与完整 18 套件 verify 再次通过。独立复核另发现旧轮询 GET 绕过版本守卫、同 NPC 并发历史被整段覆盖，两项已在隔离环境复现。建议先完成 [T2a](t2a-state-boundaries.md)，再开始 T3；详见 [复核证据与交接提示词](../docs/T1_T2_REVIEW_2026-09-30.md)。上面的完成记录保留原实现结果，不代表新增边界问题已修复。
