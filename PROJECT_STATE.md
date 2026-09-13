# PROJECT STATE（AI Dungeon — 给后续会话的状态快照）

> 本文件是给 AI 助手/开发者看的项目状态快照。更新版本后请同步更新此文件。

## 项目概况
- 路径：`G:\ai_DND`；GitHub：`Jianjun99/AI_DND5e`（main 分支，CI + GHCR 自动发布）
- 单人 D&D 2024 网页游戏，Node 20 + Express + 原生 JS SPA（无框架、无构建步骤）
- Docker 镜像：`ghcr.io/jianjun99/ai_dnd5e:{latest,1.0.0,1.2.0,1.3.0,1.4.0,1.5.0}`
- 存档：容器卷 `ai-dnd-data` → `/app/data`（characters.json / saves/ / settings.json）
- 本地运行：`npm start`（端口 3000）；Node 在 `C:\Program Files\nodejs`（git bash 需 export PATH）
- 测试：`scripts/smoke-test.mjs`（CI 每次推送跑）；平衡模拟：`scripts/balance-sim.mjs`
- 架构文档：`ARCHITECTURE.md`（Mermaid 图）；模组指南：`MODDING.md`

## 当前版本：v1.6.0（待发布 / 3D 手办动画 + 升级向导 + 战术先攻条 + 换装 + 英雄殿堂）

## 已实现功能清单（勿重复实现）
- 角色创建：10 种族 / 12 职业 / 16 背景 / 属性（数组/4d6/点购）/ 法术 / 装备
- 等级 1-10：XP 表、法术位表、PB 成长、4 级和 8 级 ASI、子职业（12 个，3 级觉醒）、
  5 级额外攻击、武僧拳骰/野蛮人先知/游侠漫游/圣武士灵光/游荡者闪避/战士不屈
- **交互式升级向导 (`levelup.js`)**：
  XP 达标即亮起金标徽章，支持投骰 Roll HP vs 稳妥均值、3 级 12 职业子职业选择（如冠军 19-20 暴击、战斗大师、塑能师、盗贼等）、
  4/8 级特长与属性提升（Tough, Alert, Lucky, Healer, Savage Attacker）、新法术位解锁。
- **逼真 3D 手办模型与步态动画 (`models3d.js`)**：
  复合几何体手办造型（战士阔剑盾牌、游侠兜帽箭袋弓矢、法师长袍水晶权杖、游荡者双刺、野蛮人战斧、NPC 与骷髅僵尸哥布林巨鼠地牢怪物、Boss 狂暴战甲）；
  关节步态循环（交替迈步、摆臂、垂直起伏、转向朝向平滑插值、驻留自然呼吸）。
- **战术战斗先攻条 Ribbon (`play.js`)**：
  顶部横向战斗者队列、动态双层迷你血条（危急 <25% 闪红、预警 <50% 橙黄）、活跃回合光环、阵亡骷髅蒙版、点击怪物 Token 直接锁定目标。
- **地牢内实时换装 (`game.js` / `engine.js`)**：
  包裹内直接装配武器、盾牌（+2 AC）、护甲及调谐物品，即时重算 AC 与攻击检定并播放金属音效与日志记录。
- **多层地下城楼梯下潜体验**：
  石阶交互下潜、电影感全屏地牢副标题 Banner、沉重石阶足音与环境音自然过渡。
- **Oakhaven 第五城区：英雄殿堂与战利品室 (`city.js` / `overworld.js`)**：
  包含怪物图鉴（怪物背景、属性与累计击杀数）、远征战利品展柜、英杰荣誉榜。
- **多轨音频混音器与统合设置弹窗 (`settings.js`)**：
  顶栏一键打开设置面板，整合主音量、环境音轨、程序合成音效、TTS 语音与 AI DM 选项。
- 3 张地图（stairs 连通 crypt↔vault；hills 独立）：crypt(1-5) / drowned-vault(1-5) /
  howling-hills(5-10，户外主题 'hills'，双渲染器配色已适配)
- 战斗：先攻/d20/重击/优势/法术/专注/死亡豁免/Boss 半血狂暴+拴绳(6格)/游荡怪物(22%/6步/上限2)
- 掉落表（金币骰子+概率物品）、锁箱(pickDc/forceDc)、卷轴、商店（Marla/Perra/城镇三区）
- Overworld：`#/overworld`（SVG 大地图 + Oakhaven 五城区：酒馆休息/传闻/招募同伴
  Bram+Valeria+Aldous(治疗AI)、军械库买卖、药房、公会悬赏、英雄殿堂）
- 撤退：campfire/入口 1 格内 → mode 'retreat' → /api/city/sync-delve 同步（撤退结算弹窗提供显式关闭与侧边栏随时重开，彻底杜绝悬挂弹窗）
- AI DM：旁白/NPC对话/自由动作 referee/支线任务/日志回顾/生物肖像（Google图→SD→程序符文链）
  /5 种 DM 人格预设（settings.llm.persona，游戏内顶栏快捷切换）
- 音频：合成音效 + 主题环境音 + 音量滑块（localStorage dnd_vol）；TTS：浏览器合成 +
  可选 Piper HTTP（localStorage dnd_piper，settings 页有地址栏）
- 装备纸娃娃：char.equipped 6 槽，/api/characters/:id/equip（AC 由引擎 applyClassAndSpecies
  recompute 重算——勿改回 ad-hoc 计算！equipped 护甲会 reorder 到 inventory 首位）
- 存档槽：每英雄多地牢；首页列表 ⚔/✕；顶栏「⚔ Continue」金按钮（app.js refreshContinue）
- 游戏内 DM Settings 是弹窗（点顶栏 settings 被拦截 preventDefault），不离开冒险画面

## 关键架构事实（防踩坑）
- engine 是唯一裁判：LLM 只旁白不改变结果；`server = referee` 全部状态在 server 端
- **bash 转义坑**：改 play.js 等含模板字符串的文件时，不要用 bash heredoc/`node -e` 包
  反引号——用 Write 工具写补丁文件（.cjs，单引号字符串+join）或直接用 Edit 工具
- 新版 three.module.js 依赖 three.core.js——两个都要在 public/vendor/（已提交）
- 地图 JSON 行宽必须 == width；content.js scan 会校验并在首页显示警告
- engine 内部函数直接用 `manhattan()`，不是 `engine.manhattan()`
- applyClassAndSpecies 每次调用会加一层 HP——重算时传第 5 参 recomputeOnly=true
- hint(state,key,npc,text,events) 教学提示必须传 events（漏传会 crash）

## 环境备注
- 用户的 Google AI Studio key 曾发到对话里：已提醒轮换。settings.json 内的 key 在
  data/ 卷里（gitignore ✓，备份导出已剔除 apiKey ✓）
- Docker Desktop 快捷方式：`C:\Users\xu991\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`
  （容器有时被 OOM 杀掉 exit 137——重启 `docker start ai-dnd` 即可）
- GitHub release 创建：bash 层 `git credential fill` 取 token → 传 GH_TOKEN 环境变量 →
  node 脚本 POST /releases（execSync 里跑不了 bash 管道）

## 测试体系
- `node scripts/smoke-test.mjs`：端到端基础链路健康度探针（CI 每次推送必跑）
- `node scripts/test-all.mjs` / `npm test`：全套 6 大测试套件，包含 D&D 2024 规则单元测试、
  3D 手办步态测试、移动/寻路/视野集成测试、战斗/动作集成测试、角色升级/地牢装备换装/楼层下潜集成测试、
  Headless Chrome CDP 端到端浏览器渲染与动作测试（295 项断言 100% 通过）。

## 版本历史
v1.0.0 首发 → v1.2.0 连通地牢+模组+任务 → v1.3.0 UI 修复 → v1.4.0 等级6-10+嚎叫丘陵+音频
→ v1.5.0 Overworld+Oakhaven+纸娃娃+路上遭遇+撤退+审查修复
→ v1.6.0 3D模型与步态动画 + 升级向导 + 战术先攻条 + 局内换装 + 楼层过渡 + 英雄殿堂图鉴 + 全套测试（当前）
