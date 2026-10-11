# T9c 发行内容双语覆盖与迁移清单

维护：2026-10-03。完整验收结果、日志和试玩入口见 [任务交接](../tasks/t9c-content-log-ai-localization.md)。此清单只记录显示文字；不是第二份规则表。

## 内容覆盖

| 原定义文件 | 带两语言文本的节点数 |
|---|---:|
| `shared/backgrounds.json` | 28 |
| `shared/classes.json` | 132 |
| `shared/equipment.json` | 60 |
| `shared/maps/crypt.json` | 35 |
| `shared/monsters.json` | 31 |
| `shared/species.json` | 46 |
| `shared/spells.json` | 37 |
| `content/drowned-vault/gear.json` | 1 |
| `content/drowned-vault/maps/drowned-vault.json` | 16 |
| `content/drowned-vault/monsters.json` | 4 |
| `content/drowned-vault/pack.json` | 1 |
| `content/howling-hills/gear.json` | 3 |
| `content/howling-hills/maps/howling-hills.json` | 12 |
| `content/howling-hills/maps/vale-gate.json` | 12 |
| `content/howling-hills/monsters.json` | 8 |
| `content/howling-hills/pack.json` | 1 |
| `content/sunlit-vale-expansion/gear.json` | 2 |
| `content/sunlit-vale-expansion/maps/mill.json` | 12 |
| `content/sunlit-vale-expansion/maps/roost.json` | 12 |
| `content/sunlit-vale-expansion/maps/sewers.json` | 10 |
| `content/sunlit-vale-expansion/monsters-gear.json` | 14 |
| `content/sunlit-vale-expansion/monsters.json` | 11 |
| `content/sunlit-vale-expansion/pack.json` | 1 |

合计 23 份 JSON、489 个文字节点，含七张地图、房间、物件、NPC 人设/知识/兜底、当前遭遇的选项与已确认记忆。只有服务器允许的已发现文字进入 API；模组导出仍为作者 bundle，不混入 Display。

| 代码中定义的文字 | 覆盖 |
|---|---|
| `engine.js` | 商店特品、路遇标题/货品 |
| `campaign.js` | 四幕名称/目标/简介、三条线索、阶段记录、无模型终章 |
| `companions.js` | 三位同伴的个人任务、交付/完成台词、士气分支 |
| `affixes.js` | 五种精英词缀、基础装备、武器/护甲词缀、装备套装 |
| `potions.js` | 三种未知药瓶外观/线索、全部药效、八种奖品令牌 |
| `gambling.js` | 两种诅咒、轮盘/骰宝/老虎机真实结果 |
| `routes/city.js` | 五城区、区域地点、悬赏、货架、服务结果与酒馆兜底传闻 |
| `presets.js` | 沿用 T9b 推荐英雄 ID + display 契约 |
| `tooltip*.mjs` / `details*.mjs` | 原 tooltip 名称/说明/背景/武器专精/装备特性、战斗风格与背景工具 |
| `content*.mjs` | 技能、伤害/状态/增益名称、主线/任务/掉落与历史原文标记 |

## 事件创建点迁移

`events-en.mjs` / `events-zh-CN.mjs` 保留 461 个显式模板键（包含空/复数等小分支）。下表按原创建函数分组；每次从真实结果填 params，原 text 也在同一次计算中保留。新动态分支使用 `content.monsterHit`、`content.slots.*`、`content.loyalty.*`、任务/主线/掉落 typed descriptor。不使用旧日志文字识别或替换。

| 键前缀（源文件/创建函数） | 模板数 |
|---|---:|
| `event.engine.monsterAttack` | 10 |
| `event.engine.playerAttack` | 25 |
| `event.engine.maybeOpportunityAttack` | 1 |
| `event.engine.triggerTrap` | 7 |
| `event.engine.disarmTrap` | 4 |
| `event.engine.unlockChest` | 7 |
| `event.engine.detonateBarrel` | 7 |
| `event.engine.triggerSpores` | 4 |
| `event.engine.useFont` | 2 |
| `event.engine.pullLever` | 3 |
| `event.engine.triggerHazard` | 1 |
| `event.engine.startGame` | 2 |
| `event.engine.travelTo` | 2 |
| `event.engine.hint` | 1 |
| `event.engine.startCombat` | 3 |
| `event.engine.tickBuffs` | 1 |
| `event.engine.checkPlayerDeath` | 4 |
| `event.engine.rollDeathSave` | 4 |
| `event.engine.beginPlayerTurn` | 1 |
| `event.engine.applyDamage` | 8 |
| `event.engine.healEntity` | 2 |
| `event.engine.attackMods` | 1 |
| `event.engine.fiendBlessing` | 1 |
| `event.engine.castSpell` | 32 |
| `event.engine.shoveTarget` | 6 |
| `event.engine.noticeTrapsNearby` | 1 |
| `event.engine.movePlayer` | 2 |
| `event.engine.rollWanderingMonster` | 1 |
| `event.engine.checkRoomEntry` | 1 |
| `event.engine.checkQuest` | 1 |
| `event.engine.checkVictory` | 6 |
| `event.engine.processMonsterTurn` | 12 |
| `event.engine.checkCombatEnd` | 3 |
| `event.engine.awardXp` | 1 |
| `event.engine.levelUp` | 5 |
| `event.engine.adjustTempHp` | 5 |
| `event.engine.shortRest` | 10 |
| `event.engine.longRest` | 7 |
| `event.engine.offerPersonalQuest` | 1 |
| `event.engine.progressPersonalQuest` | 2 |
| `event.engine.lootChest` | 17 |
| `event.engine.rollLoot` | 3 |
| `event.engine.applyPickupEffects` | 1 |
| `event.engine.alertForcedNoise` | 1 |
| `event.engine.interactDoor` | 7 |
| `event.engine.interactObject` | 17 |
| `event.engine.resolveRoadEncounter` | 9 |
| `event.engine.chooseScene` | 2 |
| `event.game.requireAlive` | 2 |
| `event.game.requireConscious` | 1 |
| `event.game.handler` | 60 |
| `event.game.buyFromMarla` | 5 |
| `event.game.respawnAtCamp` | 1 |
| `event.game.handleClassAction` | 46 |
| `event.referee.resolveFreeform` | 41 |
| `event.potions.handler` | 27 |
| `event.potions.drinkMysteryPotion` | 5 |
| `event.potions.identifyPotion` | 2 |
| `event.potions.useToken` | 1 |
| `event.gambling.evalRoulette` | 6 |
| `event.gambling.evalSicBo` | 5 |
| `event.gambling.evalSlots` | 1 |
| `event.gambling.handler` | 2 |
| `event.forge.rerollAffix` | 1 |
| `event.forge.upgradeRarity` | 1 |

补充边界：场景 response/memory 通过 scene ID + choice ID 取已确认译文；随机物品通过 base ID + affix ID + rarity/set 拼显示名；uniqueId 不改；旧日志或旧 AI 不补译。引擎机械日志、检定骰值、伤害/掉落/奖励只取当次既有结果，没有二次掷骰。

## 术语表

| Canonical ID / 英文 | 简体中文 |
|---|---|
| `crypt` / The Sunless Crypt | 无光墓穴 |
| `drowned-vault` / The Drowned Vault | 淹没地窟 |
| `howling-hills` / The Howling Hills | 嚎叫丘陵 |
| `vale-gate` / Vale Gate | 山谷哨门 |
| `mill` / The Abandoned Mill | 废弃磨坊 |
| `roost` / The Sun Dragon’s Roost | 日龙巢穴 |
| `sewers` / Oakhaven Sewers | 橡树镇下水道 |
| Dungeon Master | 地下城主 |
| Oakhaven | 橡树镇 |
| Ember Queen | 余烬女王 |
| Ember Essence | 余烬精华 |
| Rarity: Magic / Rare / Legendary | 品质：魔法 / 稀有（精良词缀）/ 传奇 |
| Class / Species / Background | 职业 / 种族 / 背景 |
| Action / Bonus Action / Reaction | 动作 / 附赠动作 / 反应 |
| Armour Class (AC) / Difficulty Class (DC) | 护甲等级 / 难度等级 |
| HP / Temporary HP / XP | 生命值 / 临时生命 / 经验值 |
| Saving Throw / Advantage / Disadvantage | 豁免检定 / 优势 / 劣势 |
| Concentration / Attunement | 专注 / 同调 |
| Bludgeoning / Piercing / Slashing | 钝击 / 穿刺 / 挥砍 |
| Necrotic / Radiant / Force | 暗蚀 / 光耀 / 力场 |
| Poison Damage / Poisoned | 毒素伤害 / 中毒状态 |
| Confirmed memory / Original historical text | 已确认记忆 / 历史原文 |

## 请求、历史与语音

每个模型任务固定使用请求入口的 en/zh-CN；生成文字保存 language + aid，迟到只合并该任务的文字。描述缓存按 locale:type ID 分隔并保留旧字段别名；切换语言不触发 AI、行动或存档写入。检索只包含已发现房间/敌人、已持有物品、该 NPC 的知识及本局已记录事实；汉字使用二字片段匹配。TTS 按正文 language 匹配 voice；Piper 只在显式配置的语言一致时启用，缺 voice 静默，切换取消迟到音频。

## 兼容回退

单语言第三方包和旧存档保持原文；内容包信息说明 availableLocales。玩家输入/自取名、旧聊天、旧日志、既有模型生成正文保留原文。真实 AI 的表述质量和操作系统/Piper 安装的声音不属于本地 mock 的质量保证；新任务 T11 尚未领取。
