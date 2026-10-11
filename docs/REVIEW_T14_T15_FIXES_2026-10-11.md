# 2026-10-11 独立复核补修记录（T14 / T13a / T15a / T15b 的 R1–R9）

复核来源：`G:\ai_DND_handoffs\release-1.11-20261010\REVIEW_T14_T15_2026-10-11.md`
定向探针：同目录 `review-20261011\review-probes.mjs`、`probe-result.json`、`run-result.json`、
`preservation-result.json`，以及本轮真实浏览器画面 `author-unsaved-before.png`、
`author-after-leaving.png`、`author-moved-door.png`。
本轮范围：只修既有功能与缺失验收，不新增职业/大型内容/框架，不发版。

> 复核的定向探针证明的是"这条失败真实存在"，它不是完整验证。本轮的验收口径见下面
> [验证结果](#验证结果)：开发迭代用专用容器 `npm run check`（部分验证），收尾用 `npm run verify`（完整验收）。

## 状态口径

R1–R9 的代码与回归**已实现并已通过本轮容器验证，待独立复核**；两次真人体验（新玩家走双章、
从克隆改故事/地图后导出导入通关）**仍标待确认**，本轮不声称真人通关，也不声称真实 AI 已联调。

## 保全记录（动手前）

- HEAD 前后一致：`89f78d3ca79a2499f53b8af91930d74de57343d0`（未 commit / 未 push / 未改 `package.json` 版本 / 未打 tag / 未发版）。
- 本轮将改动文件与关键入口在改动前整仓快照到仓库外
  `G:\ai_DND_backups\20261011T051416Z-review-fix-111\`（303 个文件，含 `SHA256SUMS.txt`、
  `git-head-before.txt`、`git-status-before.txt`）。
- 未使用 `git reset` / `git clean` / 批量覆盖；此前 1.11 轮次的全部未提交成果保留。按快照清单逐一比对，
  本轮相对快照改动 **34 个已有文件、删除 0 个**；本轮新建的 `server/game/action-executor.js`（R6）与
  `server/game/content-context.js`（R3）在复核的 `source-manifest.json`（220 个受审文件）里都不存在，
  即它们是本轮新增模块而非"改掉了旧内容"，因此不在快照里也无从丢失。
- 未读写真实玩家 `data/`、模型配置或生产卷：所有套件都在 `DATA_DIR` 临时目录（或 `--network none`
  的专用容器）内运行；测试容器固定名 `ai-dnd-verify`，被占用时返回 73 等待，不删除他人容器。

## 逐项闭环

### R1 草稿路径边界（P1）

复核失败点：草稿 ID 直接拼进文件路径，"草稿容错"被当成任意路径写入的许可证。

现在的实现：
- `server/game/content-authoring.js:25` `draftFileFor(id)` 是唯一构造草稿路径的入口：ID 必须先过
  共享 ID 文法（`[a-z0-9_-]+`，无分隔符、无点段），再 `path.resolve` 后落在 `data/drafts` 根内
  （`path.relative` 为空、以 `..` 开头或绝对路径一律 400 `invalid-draft-id`）。
- 身份与路径一致：`content-authoring.js:46` `identityIssue()` + `saveDraft` 的 409
  `draft-id-mismatch`（`content-authoring.js:124`）；`GET`/列表也带同一诊断，导出/安装/试玩一律拒绝。
- 内容错误只在合法草稿文件内继续容错（T8 诊断照常返回），合法路径不再是任意路径。

回归：新增集成套件 `draft-path-boundary`（8 用例 / 296 断言）。覆盖 URL 层敌意输入（编码分隔符、
双重编码、反斜杠、`%2F`、绝对路径、名字里带点、空格、大小写）、URL 规范层会把 `%2e`/`%2e%2e`
折叠成集合路由这一事实（断言"永远拿不到草稿载荷"而不是某个具体状态码）、直接喂给
`getDraft/saveDraft/deleteDraft/playtestDraft/exitPlaytest` 的处理函数层敌意输入，并在草稿根目录
之外放 5 个哨兵文件，证明 GET/PUT/DELETE 都碰不到它们；删除只删自己那一份。

### R2 克隆真正重映射资源引用（P1）

复核失败点：克隆把 `effect.giveItem` 之类的资源引用留在入门样板的命名域里，第二章三个结局都要求
`custom_*_courier_ledger`，于是全部结局不可达；校验看不见，因为已安装的样板包能解析这个悬空引用。

现在的实现：`content-authoring.js:196` 起，`cloneStarterTemplate` 用 `starterItemIds` 判定归属，
`eachItemRef()` 走遍 `condition.itemId` / `effect.giveItem` / `effect.consumeItem` /
`entities[].loot.items[].id`，只重映射"样板拥有的"道具；全局目录条目（`potion_healing`、武器、护甲）
与语义 ID（`campfire`、`player`）保持原样，`requiresHistory.storyId` 与地图/故事 ID 一并换到克隆命名域。

回归：新增集成套件 `clone-playthrough`（5 用例 / 41 断言），外加真实通关：
1. 独立引用遍历器断言克隆里不再出现任何样板道具 ID，全局/语义 ID 保留；
2. 反向对照：已安装的原版包仍然使用 `courier_ledger`（证明检查不是空转）；
3. 用试玩把克隆打到 `reported`，账册确实被消耗；
4. 跨章承接用 `gameRouter.resolveHistoryBinding` 真实判定：克隆自己的历史可用，样板历史不可用；
5. 导出 → 在**第二个隔离数据环境的子进程**里导入 → 普通英雄（非试玩）实打实打通两章并结算，
   第二章开局断言 `historyBinding.storyId === <pack.id>_story_ch1` 且 `ending === 'reported'`。
   夹具只钉住存活（HP 上限）与一次游说属性，不强制 victory、不手工塞道具。
   子进程夹具：`tests/helpers/dual-chapter-run.mjs`、`tests/helpers/isolated-import-run.mjs`。

### R3 试玩内容隔离（P1）

复核失败点：试玩把未安装的草稿内容塞进共享注册表，正式局可能读到未发布内容，刷新/重启后又丢失。

现在的实现：`server/game/content-context.js` 把草稿的地图/道具/怪物快照挂到存档上随档走
（`snapshotFor/map/monster/gear/ofState`），试玩只读本地上下文，不写共享注册表；未安装的草稿地图
不允许正式开局。

回归：新增集成套件 `playtest-content-isolation`（6 用例 / 36 断言）：试玩全程注册表字节不变（
`content.reload()` 之后仍然不变）；试玩局显示 `UNPUBLISHED DRAFT REVISION`，正式局显示已安装名；
并发"试玩 + 正式开局"互不污染；只存在于草稿里的道具与怪物在**刷新与重启后**仍可解析——重启语义由
子进程夹具 `tests/helpers/snapshot-restart-run.mjs` 重新从磁盘读档验证，同时断言注册表从未收到这些条目。

### R4 试玩身份与生命周期（P1）

复核失败点：客户端可以自称 `isPlaytest` 借用试玩通道污染正式英雄；退出/删除的行为不确定。

现在的实现：试玩身份由服务端铸造（`playtestHeroId(draftId)`、`playtestHeroOwnsDraft()`），
专用英雄历史落在草稿自己的英雄上；`settlePlaytestDelve()`（`content-authoring.js:484`）校验
所有权与真实结束态，未完成返回 400 `delve-not-ended`，外来 `charId` 返回 403；
`server/routes/city.js:482` 的试玩分支不再走正式名册；`exitPlaytest` 与 `sweepOrphanPlaytests`
只清理"本次确实拥有"的临时资源，绝不按前缀批量删档。试玩英雄/存档不出现在 `/api/characters`
与 `/api/game` 列表里，但可按 ID 打开。

回归：新增集成套件 `playtest-lifecycle`（7 用例 / 72 断言）：客户端伪造 `isPlaytest` 被忽略且正式
英雄字节不变；真实通关后再用正式 `charId` 结算仍落在草稿英雄上、只有一张收据、重复请求
`duplicate: true`；退出拒绝他人草稿（403）与正式存档（403）；中途退出得到 `settled: null,
abandoned: false`，重复退出 `alreadyExited: true`，已结束未结算的局由退出补结算；删除草稿只删它
自己的英雄与存档（形似 ID 的存档存活）；`sweepOrphanPlaytests` 只回收自身字段指向缺失草稿的资源。

### R5 脏状态与"导出当前稿"（P1）

复核失败点：编辑后点"返回草稿列表"没有确认也没有自动保存，导出下载的是上一次已保存的旧稿。

现在的实现（`public/js/views/author.js`）：
- `savedJson` / `typedSinceSync` / `isDirty()` / `refreshDirtyBadge()`（`:215` 起）构成唯一脏判定；
- 站内离开走 `askBeforeLeaving()`（`:267`）弹出保存 / 放弃 / 留在编辑器三选模态
  （`#draftUnsavedModal`），刷新与关闭走 `beforeunload`（`:325`）；
- 导出（`:529`）先把屏幕上的值同步进缓冲、保存、再向服务端复核校验，只有当前快照合法才下载，
  失败保留现场不下载旧稿；
- 所有异步结果都受 `navigation.isCurrent()` 约束，迟到的保存/校验/安装/试玩结果不会把用户带回旧页面。

本轮在真实浏览器里发现并修掉五个真实缺陷（不是测试口径问题）：新打开的草稿被误报未保存、
切标签页时 `condition_itemId`/`condition_ending` 把历史门槛改写成道具门槛、机制面板把
decision/passage 选项强行转成 check 并写入 skill/DC/失败字段、机制面板把战斗选项盖上
`costGold: 0`（`combat` 效果只允许 `type`/`loyalty`，导出会带走 3 个校验错误），
以及 `Number('') === 0` 让空的 DC 输入被写成 0。

回归：新增 CDP 浏览器套件 `authoring-review`（8 个真实步骤 / 82 断言，1280×800 横向，WebGL2 实测）：
未保存编辑→离开→三选模态（留在编辑器保留缓冲、保存后离开只写入可见值）；导出携带可见编辑
（先证明服务端仍是旧稿，保存后导出内容一致）；坏草稿（DC 为负）留在屏幕上并禁用导出/安装/试玩；
门移动同步瓦片与实体且撤销/重做成对还原；墙/擦除刷对场景引用的门给出解释性 toast；
试玩横幅退出后服务端 `GET /api/game/<id>` 为 404 且名册无试玩英雄、重复退出 `alreadyExited`；
标签页往返保存不得偷偷重写故事门槛。既有 `story-authoring-cdp`（T15a，24 项）与
`map-authoring-cdp`（T15b，27 项）同轮全绿。

### R6 文字与按钮共用同一个权威执行器（P1）

复核失败点：freeform"喝药水"复制了一份扣药+掷治疗骰的逻辑，绕过附赠动作限制（按钮按不动，句子能喝）。

现在的实现：`server/game/action-executor.js` 是唯一执行器（`actionBlocker`、`useItem`、
`attack`、`drinkPotion`、`resolveItemEntry`、`resolveMentionedItem`），按钮路由
`server/routes/game.js`、有界提案 `server/game/bounded-actions.js` 与旧裁判 `server/game/referee.js`
都调它；句子不再自己扣库存或掷骰，指定物品名也走同一个实例/数量解析
（`drinkPotion(state, ref, events, sentence)`）。旧英文命令保留，一句话只兑现一个核心动作。

回归：新增集成套件 `action-authority-parity`（8 用例 / 68 断言），全部用真实战斗夹具（旁边放真怪物、
按 `monsterActs` 决定非玩家回合）：按钮与"喝药水"/"quaff a potion"结果一致且 `messageKey` 相同；
点名药水（`喝强效治疗药水` / "quaff the greater healing potion"）拿到正确的那一瓶；空背包不会变成负数；
重复提交只消耗一瓶；复合句（`and then` / `然后`）只执行一个核心动作，`actionUsed` 未被二次扣减、
怪物 HP 不变；攻击按钮与攻击句子共用同一个 `content.actionUsed` 阻塞原因；旧英文命令
（quaff/use/heal/drink my healing potion）仍可用。

### R7 候选上下文复用服务端可见性规则（P1）

复核失败点：喂给模型的白名单只看"地格已探索 + 距离"，未侦测陷阱的 id/类型/名称/坐标被原文交给模型。

现在的实现：`bounded-actions.js` 用 `engine.isObjectVisibleToPlayer()`（未 revealed/triggered 的陷阱
不可见）**且** `engine.isTileDiscovered()` 过滤候选；迷雾外的怪物、超出 4 格的 NPC、尚未满足的
`history_ending` 门槛选项一律不进上下文；`validateProposal` 与 `executeProposal` 同样拒绝点名隐藏陷阱，
并回一条当前语言的错误 toast（`story.error.investigate_invisible`）。通用搜查仍允许引擎"撞见"附近未知陷阱。

回归：新增集成套件 `action-context-visibility`（7 用例 / 32 断言）：已探索格上的未侦测陷阱在
`buildAuthorizedContext` 里连 id/名称/类型/坐标都不出现，揭示后才出现；未探索格上的任何对象都隐藏；
怪物受迷雾/视线限制，NPC 受 4 格限制；未达成的 `history_ending` 选项在英雄真正拿到结局前不可见；
`executor.searchArea`（把感知钉到 +50，不赌 RNG）仍能发现那个陷阱。

### R8 地图瓦片与实体一致（P2）

复核失败点：在编辑器里把剧情桥门从 (8,7) 移到 (7,5)，只改了实体坐标，`rows` 原格仍是 `D`、
新格仍是 `.`，T8 仍判 ok，导出带走这组矛盾数据。

现在的实现：
- 编辑器：`public/js/views/author.js:920` 移动门实体时先清旧格再写新格，实体 ID 不变，
  `scene.doorId/guardIds/npcId` 因此继续指向同一实体；营火移动同步 `victory.campfire`（`:927`）；
  门刷（`:823`）与擦除（`:957`）保持瓦片/实体成对；
- 保护：墙刷/地板刷/擦除对"被场景引用的实体"（`scene.npcId`、`scene.doorId`、`guardIds`，
  `author.js:772`）拒绝并 toast 说明（`:789`、`:809`、`:950`）；营火与起点格同样受保护；
- 校验：`server/game/content-validation.js:172` 新增 `door-tile-mismatch`——门实体必须站在 `D` 瓦片上，
  单独出现的 `D` 装饰字仍合法；不合法的地图无法导出/安装/试玩，也不会进注册表。
- 仍是 25×15 桌面横向，未新增尺寸或布局框架。

回归：新增集成套件 `map-tile-entity-sync`（7 用例 / 45 断言）走真实引擎而不只看图标：只移实体会被
`door-tile-mismatch` 拒绝，同步移动则干净；关着的门挡住去路，付过桥金后引擎把它当作被打开的运行时
对象，英雄能走过去；安装并导出后的包里网格与实体仍一致；场景 `doorId/guardIds` 因实体 ID 稳定而存活。
浏览器侧由 `authoring-review` 的门移动 + 撤销/重做 + 刷保护两步（经 `#rawJsonText` 校验真实缓冲）与
`map-authoring-cdp` 共同覆盖。

配套修正：既有 T8 夹具"Locked doors are optimistic"原本把门实体直接塞在一个 `.` 格上——它测的是
"上锁不致命"，不是"瓦片可以矛盾"。现在该夹具先把它自己画的那一格改成 `D` 再断言（`ok: true` 的
断言原样保留）。

### R9 承诺过的无代码选择表单 + 界面语言 + 文档口径（P2）

复核失败点：T15a 声称表单能改技能/DC、金币、物品效果、失败分支与终局，实际只生成 label/response；
英文界面还残留硬编码中文（标题、连通性提示、按钮说明、错误、实体名强制读 zh-CN）。

现在的实现：
- 机制面板（`public/js/views/author.js:1462` 起）按既有 schema 提供：效果类型、技能、DC、金币价、
  失败扣金、给予/消耗道具、条件类型（always / has_item / history_ending）及其道具与结局、结局 ID、
  失败分支的 response/memory/ending——全部是标量字段，没有引入脚本语言或任意状态写入；
- `syncInputsToDraft()`（`:965` 起）只做类型正确的写入：check-only 字段只落在 check 上，价格/道具
  只落在非战斗选项上，条件类型只在真正改变时重建，清空数字框不再被 `Number('')===0` 误当 0；
- 固定界面文字全部来自目录：本轮新增的按钮、错误与连通性提示都有中英两条条目，实体名片段
  （`renderEntityChipsHtml`，`:1589`）与地图标题（`renderMapEditorSection`）按当前语言取名，
  zh/en 两套目录键完全对齐且英文目录里不再残留汉字或全角标点；中英内容仍在同一屏并排编辑（内容不是界面）。

实际查看本轮 PNG 又暴露两个只有画面才能看见的缺陷，均已修并补断言：连通性角标在首屏渲染成
`✅ undefined`（静态标记读了 `conn.message`，而 `computeConnectivity` 只返回 `key`/`params`），
以及英文界面下地图标题仍是中文原名（标题只读 `mapDef.name`，没有走 `localized`）。
新增的两条断言分别检查"屏幕上不出现 `undefined`/`NaN`/`[object `"与"英文界面下标题必须是英文图名、
且不回落成中文原名"——这两类问题既不是 CJK 也不是裸 i18n 键，原来的检查看不见。

回归：`localization` 套件新增 3 项——英文目录零 CJK（含全角标点）；扫描整个 `public/js`，
每一条静态 `t('…')`/`label('…')` 引用的键在中英两套目录都存在；扫描整个 `server/`，
每一条静态 `key: 'story.…'`/`messageKey` 显示描述符（52 条）也双语齐备——漏一条就红。
第三条立刻抓出两个真实缺口：本轮新加的 `story.error.investigate_invisible`，以及 T15a 就存在、
一直没人补的 `api.draftNotFound`（缺条目时玩家看到的是裸键名），两者已补进两套目录。
界面双语与横向画面由 `authoring-review` 在真实 Chromium 里核对中英两向并留 PNG/DOM。

## 本轮改动文件

按快照逐一比对，本轮相对 `20261011T051416Z-review-fix-111` 改了 34 个已有文件、删除 0 个。

服务端：`server/game/content-authoring.js`、`content-validation.js`、`bounded-actions.js`、
`referee.js`、`engine.js`、`presentation.js`、`server/routes/{content,city,game,characters}.js`、
`server/store.js`、`server/index.js`；本轮新建的服务端模块：`server/game/action-executor.js`（R6 唯一执行器）、
`server/game/content-context.js`（R3 内容快照）。
客户端：`public/js/views/author.js`、`public/js/views/play.js`、`public/js/api.js`、
`public/js/localization/{en,zh-CN}.mjs`。
测试与清单：`scripts/test-suites.mjs`、7 个新集成套件 + `tests/e2e/authoring-review-cdp.test.mjs` +
3 个夹具，以及 `tests/integration/{content-validation,map-authoring,localization}.test.mjs`、
`tests/unit/event-contract.test.mjs`、`tests/e2e/story-authoring-cdp.test.mjs` 的口径修正。
文档：本记录 + `START_HERE.md`、`PROJECT_STATE.md`、`tasks/README.md`、四个 tasks 文件、
`ARCHITECTURE.md`、`MODDING.md`、`docs/AGENT_HANDOFF.md`、`docs/NEXT_VERSION_1.11_HANDOFF.md`。

> 保全缺口需知悉：未跟踪文件 `server/game/history-binding.js` 与 `public/js/authoring-defaults.mjs`
> 不在这轮开始前的快照清单里，而复核的 `source-manifest.json`（220 个受审文件）与交接文档也都没有提到它们，
> 因此最可能是本轮新建的模块；但无法从快照逐字节证明它们"改前"的状态。若独立复核认为它们在本轮之前就已存在，
> 请以功能回归与本记录的行为描述为准，必要时从会话记录里回捞。

既有套件口径修正（三处语义纠正，不是删断言换绿；断言强度只增不减）：
1. `tests/integration/content-validation.test.mjs`：锁门夹具补画它自己的 `D` 瓦片（R8 要求），
   "上锁不致命"与"割裂几何只告警"两条断言原样保留；
2. `tests/integration/map-authoring.test.mjs`：第 8 例原来对**未结束**的试玩直接结算并断言成功，
   与 T3/R4"只有一次结算、未结束不结算"的契约冲突。现在断言未结束被 400 拒绝且没写任何英雄记录，
   再在营火处真实撤退结束后结算，断言收据落在草稿试玩英雄上、名册英雄拿不到它；
3. `tests/e2e/story-authoring-cdp.test.mjs`：跨章历史横幅原来断言硬编码中文子串"自闭环"，R9 本地化后
   它只在中文界面成立。现在改为按 `data-i18n` 元素断言"当前语言渲染了固定界面文字"，并新增一条
   "横幅引用的必须是本克隆的第一章 storyId"（信息量更强）；
4. `tests/unit/event-contract.test.mjs`：把 `chat`/`interact` 记入 `NOT_EVENTS`（它们是有界提案的
   **动作**标记，不是事件），并把 `potion` 记入非事件道具类型，事件词汇表本身未放宽。

### F1 失败文本双语同步与空框语义（P1）

- **复核问题**：清空英文侧失败文本时误将中文侧失败文本一并抹除；清空单侧语言时缺乏双语桶隔离；
  以及表单 DOM 渲染时未区分 `localized` 存在与否，导致回退文本反向污染单语言输入框。
- **修复实现**（`public/js/views/author.js`）：
  1. 在 `syncInputsToDraft()` 中将 `failure_response` 与 `failure_memory` 按语言独立划入 `bucket`（`en` / `zh-CN`），
     清空一侧仅清理该语言桶并在另一侧仍有值时将其设为合法 canonical 回退；
  2. `cleanupFailure()` 严格保留 `fact`、`reactions`、`ending`、`loyalty` 等扩展字段；
  3. 表单渲染（`labelZh`, `respZh`, `memZh`, `failRespZh`, `failMemZh`, `nameZh`, `personaZh`, `knowZh`, `cannedZh`）
     优先检测 `localized` 对象是否存在：若存在则取当前语言值（不跨语言回退造成中文框显示英文），仅无 `localized`
     的旧包才读取根字段作为回退。
- **回归覆盖**：`tests/e2e/authoring-review-cdp.test.mjs` 覆盖单语言录入、切页持久化、双语保存、清空英文侧不影响中文侧、
  清空中文侧不影响英文侧、保留 `reactions`/`fact`/`ending`，以及清空 ending 后完整清理。

### F2 高级 JSON 保存与离开捕获当前屏幕文本（P1）

- **复核问题**：在高级 JSON 页签（`raw`）直接打字修改后，点击工具栏保存或通过离开模态保存，未应用到草稿对象，
  导致屏幕上的合法修改丢失；且若输入非法 JSON，离开或切页会静默覆盖丢文本。
- **修复实现**（`public/js/views/author.js`）：
  1. 统一 `syncInputsToDraft()` 对 `currentTab === 'raw'` 的处理：从 `#rawJsonText` 读取实时屏幕文本并 `JSON.parse`；
     合法 JSON 更新 `draftData` 并清除 dirty；
  2. 若 JSON 语法非法，弹出错误 toast 并返回 `false`，安全阻止切页、工具栏保存及离开保存；
  3. `renderFullEditor()` 首行检查 `!syncInputsToDraft()` 提前退出，保证语法错误时屏幕输入文本不被旧缓冲覆盖。
- **回归覆盖**：`tests/e2e/authoring-review-cdp.test.mjs` 覆盖 raw 直接打字后工具栏保存入库、离开模态保存入库、
  保留未知合法字段与资源引用、非法 JSON 阻止切页与离开并 toast 报错且完整保留原文。

### F3 未保存模态恢复原定目标路由（P2）

- **复核问题**：`app.js` 派发的 `ui:route-leave` 事件其 `detail` 直接为目标 hash 字符串（如 `#/` 或 `#/settings`），
  `author.js` 误读 `detail?.hash` 导致回退至 `#/author`；且原 `targetHash === location.hash` 比较因浏览器预先更新 hash
  而误拦截离开模态。
- **修复实现**（`public/js/views/author.js`）：
  1. `onRouteLeave` 正确接收字符串 `detail`；
  2. 将 `targetHash` 与当前草稿编辑路由 `#/author?draft=${draftId}` 比较：仅当目标属于同一草稿时才放行，
     离开草稿去往任何外部路由（包括 `#/author`、`#/`、`#/settings`）均触发未保存拦截并恢复原定目标；
  3. 放弃离开或保存离开后，准确导航至原定目标 hash；点击留在编辑器则保持在当前草稿。同时覆盖浏览器后退键（`history.back()`）。
- **回归覆盖**：`tests/e2e/authoring-review-cdp.test.mjs` 覆盖导航至 `#/` 后 Stay 留在原处、Discard 准确前往 `#/`、
  导航至 `#/settings` 后 Save 准确前往 `#/settings` 并保存数据、以及浏览器 `history.back()` 的未保存保护。

### F4 点名缺失药水拒绝偷偷换喝（P2）

- **复核问题**：玩家使用自然语言命令明确点名特定药水（如“喝强效治疗药水”/“drink a potion of greater healing”），
  但背包中该药水数量为 0 或未持有时，系统偷偷自动替换为普通治疗药水并喝掉。
- **修复实现**（`server/game/action-executor.js` & `server/game/bounded-actions.js`）：
  1. 区分明确点名特定药水与泛用“喝药水”短语：仅“喝药水 / drink a potion / take a potion”等泛用指令允许回退选择；
  2. 采用由长至短的候选名匹配算法（避免短名称子串抢匹配），准确识别出点名药水定义（如 `potion_greater`）；
  3. 若明确点名但背包无该物品或数量为 0，返回本地化明确报错（如“背包中没有可用的强效治疗药水。”），
     **不扣除任何道具、不消耗动作/附赠动作**；
  4. 保持已有唯一实例 `uniqueId`、旧英文命令与神秘药水识别逻辑不变。
- **回归覆盖**：`tests/integration/action-authority-parity.test.mjs` 覆盖点名已有药水正常饮用、点名缺失药水明确拒绝
  （0 药水消耗、0 动作消耗）、背包全空拒绝、以及动作经济性一致性。

## 验证结果

- 开发迭代：专用容器 `npm run check -- --browsers=authoring-review,story-authoring-cdp,bounded-natural-actions-cdp`
  （eslint + tsc + 全部单元/集成 + 明确选中的浏览器套件，全部 0 失败通过）。
- 套件注册真实数量：`scripts/test-suites.mjs` 现登记 **65** 套 = **11 unit / 31 integration / 23 browser**。
- 收尾完整 `npm run verify -- --timeout=2100`：**退出 0**，容器内 eslint 2.25s、tsc 2.96s、
  test-all 1399.03s、smoke 0.49s，总计 **1405.28s**（cleanup 0s）；
  **实际执行 65 套件 = 11 unit + 31 integration + 23 browser，全部退出码 0**，
  `container-result.json` 为 `{exitCode: 0, timeout: false, seconds: 1405.34}`，
  专用容器已移除、未删除他人容器、未使用宿主机浏览器兜底。
  证据目录：`artifacts/verify/2026-10-11T18-39-09-469Z-eefc3d13/`。
- 本轮 F1–F4 回归在同一份 verify 里的真实结果：
  `authoring-review` 11 步/130 断言全绿（涵盖 F1 双语失败同步、F2 高级 JSON 实时保存与语法校验防护、F3 目标路由恢复与浏览器后退保护）、
  `action-authority-parity` 9 用例/86 断言全绿（涵盖 F4 点名药水授权与缺失拒绝）、
  既有 `bounded-natural-actions-cdp` 24/0、`story-authoring-cdp` 24/0、`map-authoring-cdp` 27/0、`clone-playthrough` 5/41、
  `playtest-content-isolation` 6/36、`playtest-lifecycle` 7/72 全绿。
- 浏览器证据：`artifacts/verify/2026-10-11T18-39-09-469Z-eefc3d13/screenshots/`，新增/验证的真实视觉产物包含：
  `review-bilingual-failure-sync-9241-0.png` / `review-bilingual-failure-sync-9241-0.json`（F1 双语同步与空框保留视觉与 DOM）、
  `review-raw-json-typed-edits-9241-0.png` / `review-raw-json-typed-edits-9241-0.json`（F2 高级 JSON 编辑与保存视觉与 DOM）、
  `review-target-hash-recovered-9241-0.png` / `review-target-hash-recovered-9241-0.json`（F3 目标路由恢复与后退保护视觉与 DOM）、
  `review-author-en-9241-0.png` / `review-author-zh-9241-0.png`（中英文界面与实体 Chip 视觉）。未回退至宿主机浏览器。

## 真人体验步骤（约 30 分钟，两条路线）

语言先在顶栏右侧切到"简体中文 / English"任一档，两条路线各看一遍双语工具栏是否同语言。

路线 A：新玩家走完整双章（约 12 分钟）
1. `npm start`，浏览器开 `http://localhost:3000`；首页点"创建角色"，选推荐preset（坚盾卫士或奥法学徒），
   难度"简单"，确认进入城镇。
2. 城镇/准备页的公开冒险目录里选《渡口的失踪信使》第一章（渡口），开局。
3. 走到桥门前与守桥人艾芮交谈，按提示付 5 过桥金或做一次游说检定；再走营地/支线，把
   `testimony` 场景的"交出账册"选下去（这会拿到道具并留下事实）。
4. 一路打到营火（🔥）并确认胜利结算，回城；注意结算页只出现一次奖励，重复点击不重发。
5. 再开第二章《河湾哨所的决断》：确认开局能看到"第一章带来的结局"，`show_pass` 这类历史门槛选项
   此刻可用；把三条终局之一打完并结算。
6. 顺手验证 R7：战斗里输入"调查那个陷阱"，在没搜出陷阱前，DM 应当拒绝而不是报出陷阱名字。

路线 B：从克隆改内容并导出导入（约 15 分钟）
1. 首页点"冒险创作"（Author Studio）→ 填 slug、名称、作者 → "复制为我的冒险"。
2. 第一章页签：改艾芮的性格（中/英两栏都在），展开某个选项的"机制"，把 DC 改成 14、给价格填 5，
   保存草稿；状态徽标应保持"校验通过 / Valid"。
3. 不保存随便改一个字段，点"返回草稿列表"：应弹出"保存 / 放弃 / 留在编辑器"；选留在编辑器，
   改动仍在；再选保存后离开，列表里的名字应是改后的名字。
4. 地图页签：选中桥门实体点到一个空格，确认旧格变回地面、新格变门；撤销/重做各按一次，
   瓦片与实体一起回到前后状态；再用墙刷点这门，应被拒绝并给出说明 toast。
5. 故意把 DC 填成 -99（高级 JSON 或表单），保存后应停在编辑器，导出/安装/试玩三个按钮全禁用、
   徽标显示问题数；改回合法值后恢复可用。
6. 点"试玩"：横幅标出试玩模式；打一章到营火结算，回编辑器点"退出试玩"，确认正式英雄
   的 HP/金币/道具没变，草稿英雄拿到收据；再点一次退出应提示已退出而不是报错。
7. 点"导出"（应先自动保存并校验），下载 JSON；"安装到游戏"，回首页"内容包"能看到该包，
   新开一个正式英雄从第一章打到第二章，验证跨章承接与结局；全程 AI 关闭即可。

待确认项：以上两条路线的**真人手感**（节奏、可读性、误触成本）仍需要人跑一遍并反馈；
本轮的自动化证据只覆盖行为正确性，不覆盖体验。真实 AI（外部 LLM）联调不在本轮范围。

## 剩余边界（有意不做）

- 不做通用脚本编辑器/条件语言：机制面板只暴露 schema 里已有的标量字段。
- 不拆引擎模块、不引入 React/Vue/打包器，不加手机专用布局（延续既有决策）。
- 不改规则数值表，故本轮不追加 balance-sim；若后续改数值需 `npm run verify -- --balance-runs=50`。
- 不动玩家 `data/`、模型配置与生产卷；不改 `package.json` 版本、不打 tag、不发版。
