# Task: T15a 样板复制与 NPC/故事创作

- 状态：done（2026-10-11 复核补修 R1/R2/R3/R4/R5/R9 已实现，待独立复核与真人试玩）
- 复核补修记录：[docs/REVIEW_T14_T15_FIXES_2026-10-11.md](../docs/REVIEW_T14_T15_FIXES_2026-10-11.md)
- 更新：2026-10-10
- 前置：T14（样板冒险双章已就绪）、T13a（自然语言行动已就绪）
- 本次授权范围：实现基于入门样板的“复制为我的冒险”闭环，支持编辑 NPC、剧情对白、选项与有限代价/跨章条件，通过 T8 服务端校验并导出/导入独立内容包，且试玩与正式存档完全受控隔离。本步不包含地图画板与格子编辑（交由 T15b）。

## 玩家问题与已有能力

### 玩家问题
1. 社区作者或新作者想制作包含 NPC 与剧情选择的 D&D 小故事，但目前必须手写庞大复杂的 JSON 文件并处理复杂的 ID 映射；
2. 缺乏一键克隆现成双章样板的能力，手动复制极易产生 ID 冲突、丢失自有道具或错误继承原作者的历史进度；
3. 编辑过程没有草稿保护，一旦校验出错容易直接清空或丢失未完成的修改。

### 已有能力复用
- 内容包注册、验证与导出/导入系统 (`server/game/content.js`, `server/game/content-validation.js`, `server/routes/content.js`)。
- 现有原子事务导入与回滚机制（T8）。
- 既有设置与作者管理入口 (`public/js/views/settings.js`, `public/js/views/visuals.js`)。
- 双语 descriptor 渲染体系 (`public/js/i18n.js`, `server/game/presentation.js`)。

## 接手阅读与代码入口

1. 规范与契约：`AGENTS.md`, `MODDING.md`, `docs/NEXT_VERSION_1.11_HANDOFF.md`。
2. 核心代码：
   - `server/game/content-authoring.js`: 样板克隆重映射、防碰撞检测、草稿容错存储、一键安装、包导出与孤立沙盒试玩生命周期；
   - `server/routes/content.js`: `/api/content/drafts*` 路由（支持 12MB 大包、草稿暂存、单包导出与沙盒试玩起步）；
   - `server/game/content-validation.js`: T8 字段级校验与诊断生成；
   - `public/js/views/author.js`: 原生作者工作室（模板克隆表单、草稿列表、Manifest / 第一章 / 第二章 / 原始 JSON 选项卡、实时输入同步、即时校验与错误诊断抽屉）；
   - `public/js/views/play.js`: 试玩横幅展示与顶栏操作；
   - `content/missing-courier/`: 供克隆的双章官方起步样板。

## 复现 / 目标场景

在隔离 Docker 环境中：
1. 作者在内容管理界面点击“克隆官方起步样板 (Clone Template)”；
2. 系统自动生成新的独立命名域包（进行实际防碰撞校验，完整重映射地图 ID、故事 ID、包自有道具 `courier_ledger`、场景 ID 与跨章引用，保留语义 ID `campfire` 与全局通用规则）；
3. 作者在表单中修改 NPC 的性格/对白，修改剧情选项及其成功/失败代价；
4. 表单存在未填写项时点击“保存草稿”，草稿安全暂存且错误被准确标出；
5. 修复错误后通过 T8 校验；
6. 导出标准 JSON 包并在新隔离环境中成功导入；
7. 点击“试玩”，服务端以 `isPlaytest: true` 标记启动独立测试局，通关后结算不污染正式英雄的属性与事实表，退出后平滑返回编辑器。

## 范围与实现约定

1. **原子重映射克隆机制与防碰撞**：
   - 复制源包生成目标命名域（如 `custom_<slug>`），对现有包、草稿与保留 ID 做实际防碰撞排重；
   - 内部地图 ID、两章故事 ID、跨章引用 `requiresHistory.storyId`、包内道具 `courier_ledger`、门禁与场景 ID 递归成对重映射；
   - **语义 ID 与规则保留**：`campfire`、`player`、`potion_healing`、`bandit` 等保持标准引用，不添加前缀；
   - **历史绝对隔离**：新故事 ID 保证现有英雄在该命名域下历史事实为空，绝不继承源包进度。
2. **NPC 与剧情可视化编辑**：
   - 支持编辑 NPC 名称、persona、授权知识（knowledge）、固定对白及现有 schema 支持的头像/图标；
   - 支持编辑剧情场景目标、对话、选项、检定技能/DC、金币消耗、物品消耗与给予、双章终局标识；
   - 不提供任意 JavaScript 编写，全部选项效果基于有限安全 schema。
3. **草稿隔离与错误容忍**：
   - 草稿独立存储于 `data/drafts/<packId>.json`，未正式安装前不触碰已安装包文件；
   - 允许保存包含校验错误的半成品草稿；校验错误会阻止安装、发布导出与进入试玩，但绝不截断草稿数据或丢失未知合法字段/GLB 资源。
4. **服务端受控的安全试玩隔离**：
   - 试玩由服务端注入 `state.isPlaytest = true; state.ownerDraftId = draftId;`；
   - 结算路由校验若 `isPlaytest === true`，严格跳过对正式英雄档案的属性回写与事实合并；
   - 退出试玩平滑返回 `#/author?draft=<draftId>`，且仅清理属于该草稿的临时试玩存档。

## 本次不包含

- 不制作瓦片地图画板或地图尺寸编辑（交由 T15b）。
- 不新增 NPC GLB 模型管线或动作编辑器。
- 不引入 React/Vue/Svelte 等前端编译框架。

## 验收标准

- [x] 作者可从 UI 一键复制样板冒险，生成具备独立命名域的完整包草稿，并经过有效防碰撞检测。
- [x] 克隆出的双章故事其内部跨章引用准确自闭环指向新第一章，新游玩时不读取原版历史记录。
- [x] 能修改 NPC 文本、剧情选项与资源代价，表单支持中英文双语独立编辑与单语言合规回退。
- [x] 草稿支持带错误保存，校验错误明确阻止安装/导出/试玩，但不丢失编辑内容。
- [x] 试玩全生命周期由服务端隔离，通关结算后正式英雄的金币、经验与事实完全不受影响。
- [x] 源包文件在整个编辑、测试与导出过程中保持只读不变。

## 验证

按 AGENTS 规则运行容器完整验证：
```bash
npm run verify
```
在真实浏览器中通过 CDP 自动化执行：克隆样板 -> 改 NPC 对白 -> 校验 -> 导出 -> 导入 -> 试玩通关全链路，截取 DOM 与视口快照。

## 交接结果

- **完成范围**：
  1. 后端模组创作与草稿引擎 `server/game/content-authoring.js`：涵盖 `listDrafts`, `getDraft`, `saveDraft`, `deleteDraft`, `cloneStarterTemplate`, `installDraft`, `exportDraftBundle`, `injectDraftToRegistry`, `playtestDraft`；在草稿存储中深度防御剥离 presentation 的 `*Display` 呈现字段，保障合法 Schema。
  2. 路由与服务端接入 `server/routes/content.js` 及 `server/index.js`：提供草稿 CRUD、12MB 限制配置、导出与独立试玩启动。
  3. 前端原生“冒险创作工作室” `public/js/views/author.js`：包含官方样板克隆卡、本地草稿列表、清单/两章分幕/原始 JSON 编辑器、诊断报告展示、一键安装与平滑试玩。
  4. 试玩沙盒生命周期与防遮挡修补 `public/js/views/play.js`：顶栏展示试玩标识，防御性容错类目查找，试玩结束平滑返回草稿；防遮挡增加内边距防止 `#immersiveBtn` 遮挡退出链接。
  5. 国际化与本地化支持：`public/js/localization/zh-CN.mjs` 与 `en.mjs` 原生双语支持。
- **修改文件**：
  - `server/game/content-authoring.js`（新增）
  - `server/routes/content.js`
  - `server/index.js`
  - `server/game/presentation.js`
  - `public/js/views/author.js`（新增）
  - `public/js/views/home.js`
  - `public/js/views/play.js`
  - `public/js/localization/zh-CN.mjs`
  - `public/js/localization/en.mjs`
  - `scripts/test-suites.mjs`
  - `tests/integration/story-authoring.test.mjs`（新增）
  - `tests/e2e/story-authoring-cdp.test.mjs`（新增）
- **验证**：
  - `npm run check -- --browsers=story-authoring-cdp` 容器内退出 0。
  - `npm run verify` 专用容器内退出 0（全部 54 套件，含 13 单元 + 21 集成 + 20 CDP 浏览器套件全部全绿，smoke 通过，证据目录 `artifacts/verify/2026-10-11T02-08-01-257Z-8eafd9c5/`）。
- **试玩步骤**：
  1. 访问首页 `#/`，在“内容包”卡片点击“创作工作室 (Author Studio)”，进入 `#/author`。
  2. 在“克隆官方起步样板”区域输入标识符（如 `my_ferry`）、名称与创作者，点击“立即克隆并编辑”。
  3. 在打开的编辑器中切换至“第一章: 渡口前哨”与“第二章: 守望者之约”，修改对白与选项。
  4. 点击“保存草稿”暂存；点击“孤立试玩”，在沙盒中体验新对白与剧情。
  5. 点击顶栏“退出试玩”平滑返回编辑器，点击“安装到游戏”，返回首页即可在模组列表中直接加载并体验。
- **存档/接口变化**：
  - 新增 REST 端点：`GET/POST /api/content/drafts`、`GET/PUT/DELETE /api/content/drafts/:id`、`GET /api/content/drafts/:id/export`、`POST /api/content/drafts/:id/install`、`POST /api/content/drafts/:id/playtest`。
  - 草稿独立持久化于 `data/drafts/<id>.json`，不影响 `data/content/` 或游戏存档。
- **未完成项与下一个任务**：
  - T15a 已全部验收闭环。下一个待办任务为 T15b（瓦片地图/格子编辑器）。
