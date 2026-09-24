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

## 当前版本：v1.9.0（已发布：锻造台 + 图鉴变体 + 主线战役与结局 + arm64 多架构镜像 + 手机/平板适配）

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
- 镜像验证流程：`docker build -t ai-dnd:review .` → `docker run -d --name ai-dnd-review -p 3101:3000 -v ai-dnd-review-data:/app/data ai-dnd:review`
  → 所有测试用 `BASE_URL=http://localhost:3101` 直连容器（冒烟 + 两套 e2e 均可）。镜像里没有 tests/，
  想在容器里跑 node 测试要先 `docker cp tests ai-dnd-review:/app/tests`（容器是 Node 20，宿主是 Node 24）。
  Git Bash 下 `docker exec … ls /app/…` 会被路径转换破坏，需加 `MSYS_NO_PATHCONV=1`
- GitHub release 创建：bash 层 `git credential fill` 取 token → 传 GH_TOKEN 环境变量 →
  node 脚本 POST /releases（execSync 里跑不了 bash 管道）

## 测试体系
- `node scripts/smoke-test.mjs`：端到端基础链路健康度探针（CI 每次推送必跑，自动侦测 3000/3100 端口）
- `node scripts/test-all.mjs` / `npm test`：全套 13 大测试套件，包含 D&D 2024 规则单元测试、
  3D 手办步态测试（含火龙/蜘蛛/史莱姆/火元素/活动铠甲）、精英词缀与战利品稀有度单元测试、
  地图棋盘可见性与镜头数学单元测试、移动/寻路/视野集成测试、战斗/动作集成测试、
  战术对抗（借机攻击/夹击/推撞）、角色升级（1-12 级与 6 环法术位）/地牢装备换装/楼层下潜/拓展地图集成测试、
  Headless Chrome CDP 端到端浏览器渲染与动作测试（2 套，含回合经济 HUD、出口光柱、镜头绑定）。
- e2e 测试必须给浏览器 `--user-data-dir` 独立档案目录：Windows 上浏览器是分离进程树，
  清理时按档案目录名 PowerShell 杀进程，否则残留进程占住 CDP 端口导致下一次运行超时。
- e2e 里不要断言「走路中途」的镜头坐标：headless 下 rAF 帧率不稳，中途采样会随机失败。
  已改为「最终收敛到角色」+ 单元测试断言 `stepCameraTowards` 不会瞬移 + 源码守卫（render 里的 snap 有 guard）。
  另外镜头偏好存在 localStorage，复用 profile 会串味 —— 测试开头要把 `dnd_cam_follow` 重置为 on。

## 锻造台 / 图鉴 / 主线战役 / 设备适配（v1.9.0 已发布）
- `server/game/forge.js`：**余烬精华**货币（熔解魔法/稀有/传奇 = 1/2/4，精英 +1、Boss +2）。
  重铸词缀 60/150/400 gp + 1/2/3 精华；升阶 200/600 gp + 2/4 精华。
  **词缀组装唯一入口是 `affixes.buildAffixItem`**（战利品与锻造共用）→ 改词缀规则只改一处。
  `uniqueId` 永不改变（装备槽引用不失效）；装备中的东西必须先脱下；改完 `applyClassAndSpecies` + `syncCharToDelves` 写透活动地牢。
- `server/game/campaign.js`：四幕状态机（圣物→地窟钥匙→**三条线索任选**→烬后）。`advance()` 顺序校验 + 幂等 + 乱序忽略；
  `actDone()` 注意 clues 是对象（`!!acts.clues` 永远为真 —— 这个坑已修）；`currentAct()` 给大地图标记用。
  推进点在 `sync-delve`（`delve.mode === 'victory'`），奖励 XP/金币并写 `campaignLog`；结局面板 `#/campaign/:id` 用 LLM 写收场词（缓存到 `char.campaign.epilogue`，有兜底文案）。
- 图鉴：`char.bestiaryElite`（按怪种 × 词缀计数）、`char.bestiaryRewarded`（首杀奖励只发一次，XP 通过 `state.flags.pendingBestiaryBonus` 在击杀后一起结算）。
  殿堂条目新增 traits/attacks/resistances/vulnerabilities/immunities/boss/loot/eliteVariants + `bestiaryProgress`，UI 有筛选与 `???` 占位。
- 设备适配：`.creator-layout` 从内联样式搬进 CSS（390px 溢出 36px 的元凶）；`#map3d` 高度改 `clamp(260px,52vh,560px)`
  （**play.js 里原来的内联 height:560px 会压过 CSS，已删除**）；小地图在手机上 140px（原本占屏宽 64%）；
  顶栏允许换行（所有页面横向滚动的根源）；3D 图支持**双指拖动平移** + `touch-action:none`；提示气泡支持 tap 显示/4 秒后自动隐藏。
- `tests/e2e/responsive-cdp.test.mjs`：CDP 模拟 390×844 与 820×1180，逐页断言
  `max(scrollWidth, innerWidth) <= 设备宽度`（**用设备宽度而不是 window.innerWidth** —— 手机遇到溢出会自动撑大布局视口，用 innerWidth 会假通过）。
- 多架构：`docker-publish.yml` 加 QEMU + `platforms: linux/amd64,linux/arm64`。

## 赌桌 & 实验性魔药（v1.8.0 已发布）
- `server/game/gambling.js`：轮盘 / 骰宝 / 老虎机。**每张表都拆成纯函数求值器 + 掷骰器**，
  所以赔付率能被穷举验算（测试里就是穷举的：轮盘 36/37、骰宝 97.2%、老虎机 88.8% / 恶魔契约 84.3%）。
  所有赔率/注码/奖表都是模块顶部的表，改数字不用碰逻辑；`slotsRtp()`/`rouletteRtp()` 会告诉你改完的庄家优势。
  结算约定：**每个游戏都返回净额 `delta`**（输了是 -注，赢了是 +注×赔率），路由只加一次 `char.gold += result.delta`。
- `server/game/potions.js`：三档魔药（thin/standard/fine 15/40/90 gp，好/中/坏 55-25-20 → 75-20-5），
  **买下的瞬间就掷好效果并藏起来**（实例带 uniqueId，和词缀装备同一套约定），
  用「智力（奥秘）」检定揭晓（DC 12/14/16，**每瓶只有一次机会**）。
  效果全部复用引擎已有的 buff id（longstrider / altar_blessed / blessed / brew_fortune /
  divine_favor / poisoned 条件）+ `engine.adjustTempHp`（本场最大生命增减）+ `engine.blockRest`（少一段休息）。
- **仅限本场地牢的道具**（赌场奖品 token）：赌到 → 存在 `char.pendingDelveItems` → `POST /api/game/start`
  时带进地牢并标记 `delveOnly` → `sync-delve` **过滤掉**，没用掉的随场作废。
  诅咒走 `char.pendingCurses`，同样在开局时施加。
- 引擎新增：`engine.levelUpInfo`（上一节）、`adjustTempHp`、`blockRest`、`brew_fortune` 优势读取、
  `startGame` 接受 `carryItems`、`applyCondition` 现在有导出（potions.js 需要它）。
- **顺手修的**：`longRest` 以前调 `applyClassAndSpecies` 时漏了 `recomputeOnly=true`，
  **每次长休最大生命白涨一个生命骰**（平衡模拟里 bot 一直在偷吃这个）。修完普通单人 55-60%、困难 50-53%。
- **顺手修的**：`/api/city/buy` 现在会写透到该角色所有活动地牢存档（`addItemForCharacter`）——
  以前在城里买了东西再继续一局更早的地牢，结算时 `sync-delve` 会用快照背包覆盖档案，刚买的直接消失。

## 经验 / 升级（v1.8.0 已发布）
- **升级就绪状态只有一个来源**：`engine.levelUpInfo(char)` → `{ currentLevel, nextLevel, currentXp, xpNeeded, canLevelUp }`。
  它挂在 `/api/characters`、`/api/characters/:id`、`/api/city/info` 的 `character.levelUp`，
  以及地牢视图的 `state.levelUp`（地牢视图取**角色档案**而不是地牢快照 —— 否则「在城里升级后再继续旧地牢」
  会让徽章显示可以升级、点开却被 `/level-up` 拒绝，这就是用户报的 bug）。
- 客户端**不要再写 XP 表**：play.js / overworld.js 以前各自复制了一份 `XP_THRESHOLDS`（还漏了 11、12 级），
  已删除，徽章只读 `levelUp.canLevelUp`。新增等级段时只改 `engine.XP_THRESHOLDS` 一处。
- e2e 里有该 bug 的回归测试（改 characters.json 造出「档案 Lv3/1000xp + 快照 Lv2/950xp」的错配）。

## 视角与棋盘（v1.8.0 已发布）
- `public/js/entity-visibility.js`：纯函数 `isEntityOnBoard`（死亡/逃跑离开棋盘，玩家永不隐藏）、
  `stepCameraTowards`（帧率无关的镜头缓动）、`clampToMap`。2D/2.5D 共用。
- 尸体会留在场上的老 bug：`layoutEntities` 里 `if (!disc.has(key) || (e.alive === false && …)) return;`
  只跳过*更新*，没删掉已有 node → 尸体模型永久留在场景里。现在按 `isEntityOnBoard` 移除节点。
- 镜头绑定：`createMap3D(…, { follow, onFollowChange })` → `setFollow(v)` / `isFollowing()`；默认跟随，
  右键（或中键）拖拽即解绑并能平移到地图任意处，滚轮缩放；点 HUD 的 🎥 按钮（或按 F）切回跟随并归位。
- 镜头不再瞬移：`render()` 只在换图/首次/超远传送时 snap，其它帧由 rAF 循环 `stepCameraTowards` 缓动跟随
  *手办模型*的位置（模型沿 waypoint 走，约 4.6 格/秒）。
- rAF 循环里每帧调用 `animateFrom(currentGame)`：走路被打断（连续两次移动）时手办不会卡在少一格的位置。
- `window.__dndDebug` 是 e2e 用的测试缝（camera / follow / boardCount / playerTile / modelState）。

## 精英怪物 & 战利品稀有度（v1.8.0 已发布）
- `server/game/affixes.js`：5 种精英词缀（炽炎/石肤/嗜血/剧毒/狂雷）+ 武器/护甲词缀 + `rollMagicItem()`
- 精英生成：`generateMapState` 与 `rollWanderingMonster` 里非 boss 怪物 18% 概率；boss 永不为精英
- 精英词缀：HP ×1.15~1.4、XP ×1.5、掉落保底 1 件魔法/稀有装备 + 15-30 gp；boss 保底稀有/传奇 + 50-100 gp
- 战斗实现：`monsterAttack` 附加元素骰/吸血/中毒（`applyCondition` 1 回合，攻击劣势），
  `applyDamage(state,target,amt,type,events,{magical})` 支持怪物抗性 + 石肤「非魔法武器」豁免
- 装备实现：稀有物品带 `uniqueId`，装备/解析一律用 `engine.invEntry` / `engine.equippedBonus`；
  `atk.dmgMod`（能力调整值）现在真正计入伤害；魔法武器加值只算一次（勿在 attackMods 里重复加）
- 客户端：`play.js` 背包弹窗按稀有度着色 + `[🔵魔法/🟣稀有/🟠传奇]` 标签；tooltip 支持
  `data-item-tooltip` 传 JSON（程序化生成的装备）；3D 里精英有彩色名牌 + 光环点光源 + 1.15 倍体型

## 版本历史
v1.0.0 首发 → v1.2.0 连通地牢+模组+任务 → v1.3.0 UI 修复 → v1.4.0 等级6-10+嚎叫丘陵+音频
→ v1.5.0 Overworld+Oakhaven+纸娃娃+路上遭遇+撤退+审查修复
→ v1.6.0 3D模型与步态动画 + 升级向导 + 战术先攻条 + 局内换装 + 楼层过渡 + 英雄殿堂图鉴 + 全套测试
→ v1.7.0 等级上限 12 + 阳光峡谷 3 大新地图 + 无尽深渊程序化地牢 + 5 大新怪 3D 手办 + 传奇成就
→ v1.8.0 精英词缀怪物 + 战利品稀有度/词缀系统 + 视角解绑与平滑跟随 + 尸体移除修复 + 升级徽章一致性修复 + 酒馆赌桌 + 实验性魔药
→ v1.9.0 锻造台（余烬精华/重铸/升阶）+ 图鉴精英变体与首杀奖励 + 四幕主线战役与 AI 结局 + arm64 多架构镜像 + 手机/平板全站适配（当前）
