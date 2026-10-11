# V1 第一段：视觉实例接口与小样

- 状态：done（2026-10-04，用户仅指定第一段；完整验收通过）。
- 前置：保留 T9a–T11/补修、SVG 修复、M1、L1 的全部未提交成果。
- 范围：root / sync / move / update / play / dispose 接口，当前程序模型适配，独立无关节字段小样，真实渲染/点击/动作与资源生命周期验证。
- 第二段未领取：GLB 资源清单/安装/缓存/模型绑定与管理界面；不改引擎、稳定 ID、规则数值、存档/地图包格式；不领取 T12/T13，不提交/推送/改版本/发版。

## 验收

- [x] renderer 不再读程序 rig、血条、动画私有字段；旧模型/步行与相机保持兼容。
- [x] 无关节小样可用于英雄与同种多个怪物；姿态/资源实例独立，真实点击仍对应稳定实体。
- [x] 显式已确认动作触发一次；刷新/切语言/重复结果不重播；缺动作正常回退。
- [x] 移除实体、切图/替换/反复离页释放资源，失效 factory 不影响默认模型，迟到结果不挂旧场景。
- [x] 相同行动的引擎状态/RNG 不受视觉改变影响，保持 T10/L1 面板、2D/3D、resize/fullscreen 生命周期。
- [x] 完整 `npm run verify -- --timeout=1200`，实际查看 PNG/DOM 并点击，确认容器清理。

## 执行与交接

第一段仅提供内置代码小样供接口验证，不新增玩家外观绑定或内容包管理协议；样例通过 renderer 的显式 factory 接口使用。纯视觉预览/替换不产生游戏请求，真正攻击仍等待服务端确认。完整容器验证退出 0，42 套件（15 CDP）/eslint/tsc/smoke 全绿，新增单元 40/0、CDP 44/0；四组 PNG/DOM 已实际查看，真实点击/按键和清理已验证。未 commit/push/改版本/发版。

### 行为与兼容

`visual-instance.js` 包装默认程序模型；`map3d.js` 只持有语义根节点及统一接口，不读取 rig、关节、血条或私有步行字段。原模型造型、旧 `createCharacterModel` / `updateModelAnimation` 导出、地图路径/相机、格子与稳定实体 ID 均保持兼容。模型替换保留当前位置/朝向和同一个 canvas、renderer、观察器；旧视觉释放，新视觉向引擎已确认位置收敛。

`visual-sample.js` 是几何体组成的金色英雄/青色骷髅，无程序关节字段；只覆盖英雄和 skeleton 一种怪物，同伴/NPC/其他怪物保持默认。每个实例有独立的姿态、动作计时、材料与几何体。样例支持 idle/walk/attack/hit；默认支持 idle/walk/attack。未支持的动作返回 false，保留可用的 idle/walk，不影响裁判或移动。死亡/逃跑的实体按既有规则移出棋盘并立即释放，不在第一段增加延迟死亡演出。

显式玩家 `attack` 的已接纳服务端响应有对应 `attack` / `miss` 与 targetId 才启动攻击演出，以 save ID + rev 作去重标记。轮询、切语言、重复响应、读档和离页迟到行动均不启动历史动作；HP/伤害不等待动画。旧事件没有可靠攻击者 ID，因此不根据中英文旁白推断敌方攻击、施法或受击来源。完整动作映射留给第二段的真实资源片段与显式事件契约。

真实 PNG 发现目标行还持选择时的旧实体引用（日志/响应 190/200，目标行仍 200/200）。在现有 adoptState 门内按稳定实体 ID 更新选中引用，让目标 HUD/reticle 和视觉同步使用同一已确认快照；实体机械状态、格子、动作及规则保持服务端裁判，未增加其他模块。

每个视觉拥有私有材料/几何体/纹理；程序模型的 HP/精英/首领贴图也纳入归属。Three.Sprite 的共享 quad 先复制，避免卸载一只影响其他实例。移除实体、换 factory、切地图和视图离开释放资源；dispose 幂等，实例 construction/dispose 故障仍清理其全部登记资源。renderer 拒绝非同步 factory 并回默认；其迟到结果只 dispose，绝不挂场景。无全局模型缓存或共享资源引用协议。

仅客户端代码与测试变更，引擎/RNG/规则数值/职业或怪物 ID 不改；没有新存档字段、包清单、客户端规则表或第三方依赖。公开注册表、M1 内容安装/T8 事务、i18n、T10/L1 与导航生命周期继续走现有入口。第一段没有资源安装请求，第二段须扩展既有 T8 校验/事务而非旁路安装。

### 接口与作者小样

`createMap3D(container, {visualFactory})` 每个实体调用同步 factory；实例必须有 root/sync/move/update/play/motion/state/dispose。root 是 THREE.Object3D，renderer 拥有其格子锚点与朝向；模型在私有子节点内做姿态。`createVisualInstance(entity, buildAdapter)` 的 adapter 提供 root、actions、update，可提供 sync/play/dispose；通过 track 登记私有资源，销毁由 wrapper 统一处理，不在 adapter 再次 dispose 同一资源。资源跨实例共享/异步加载尚不属于第一段接口。

在已打开的 3D 冒险页，作者可从浏览器控制台显式预览；该诊断入口不发游戏请求，也不持久化外观。换页/刷新自动恢复默认。

```js
const { createSampleVisual } = await import('/js/visual-sample.js');
window.__dndDebug.setVisualFactory(createSampleVisual);
window.__dndDebug.visuals();
// 对真实存在的怪物 ID 做一次纯视觉小样动作，随后恢复默认。
window.__dndDebug.playVisual('skel1', 'hit', 'author-demo-1');
window.__dndDebug.setVisualFactory();
```

此诊断 seam 与原有相机/DOM 验收 seam 共用；自动测试额外插入的 “V1 test fixture” 按钮只存在于测试页面，不是正式玩家 UI。玩家外观选择/绑定/禁用与正常内容管理入口属于第二段。

### 验证与清理

最终完整 `npm run verify -- --timeout=1200` **退出 0**。证据目录：[2026-10-04T20-13-01-007Z-864d186f](../artifacts/verify/2026-10-04T20-13-01-007Z-864d186f/result.json)：`containerResult.exitCode=0`、`timeout=false`、`cleanupComplete=true`。eslint/tsc/**42 套件（15 CDP）**/smoke 全绿，没有跳过套件；新增 V1a 单元 **40/0**、CDP **44/0**，M1 **202/0**、L1 **354/0**、T9b **142/0**、T10 **104/0**、T9c **164/0**、T11 **134/0**。

新增单元对真实 Three.js 验证资源归属、同种实例独立、重复/缺动作、路径最终收敛、创建/清理失败和迟到调用。新增 CDP 在专用容器中用真实 WebGL2、实际 pointer/keyboard/fullscreen，保存 PNG/DOM、视觉/资源审计与请求审计。已逐一实际打开四张 PNG，并读取相应 DOM/visuals JSON，详见 [人工复核记录](../artifacts/verify/2026-10-04T20-13-01-007Z-864d186f/v1a-manual-review.md)：

| PNG / DOM（均在该目录 screenshots/ 下） | 实际检查 |
|---|---|
| `v1a-default-en-1280-9239-0` | 英文 1280×720，原程序造型与 HP 条，5 个默认实例 |
| `v1a-sample-zh-1440-9239-0` | 中文 1440×900，金色英雄与两只青色骷髅小样；NPC 默认；attack/hit 各自独立 |
| `v1a-confirmed-attack-9239-0` | 目标/日志同为 190/200，玩家只播放一次；真实请求仍为 skel1 |
| `v1a-move-and-remove-9239-0` | 确认移动/恢复小样后相机与 HUD 可用，skel2 移除，剩 4 个实例 |

`v1a-input-audit.json` 记录一次 attack、一次 move 与既有 describe/portrait 辅助链；没有重试点击。`v1a-engine-control.json` 中攻击 HP 预期/实际 190/190、RNG -631712214/-631712214，断言由引擎控制计算，未依赖具体骰点。迟到结果、切地图、反复进出均检查 owned visual/geometry/material/texture 以及 renderer/observer 归零。测试 finally 删除自己的角色/存档/Chromium profile，本轮固定容器已移除；Docker 仅见原生产 `ai-dnd` healthy，未触碰其容器或玩家数据。仅私有测试夹具调整位置/耐受 HP/种子，不改规则表；本轮没有规则数值变化，无需 balance。接手时 127 项未提交条目全部保留，版本仍为 1.10.0。

首次完整失败证据：`artifacts/verify/2026-10-04T18-22-52-252Z-0d78f14f/`，退出 1、timeout=false、cleanupComplete=true；V1a CDP 在创建夹具时错误读取存档 `visible.includes`（visible 是 API 中 engine.computeVision 派生的字段），浏览器尚未启动。修正为仅更新真实 discovered，继续由服务端推导可见范围；旧 41 套件与 smoke 均跑完并通过，没有跳过。后续审阅补上默认 HP 绘制抛错时贴图提前登记，以及小样对同伴/NPC/其他怪物的默认回退；当前新增单元 40/0。修正后重新完整 verify，不对原样失败碰运气。

第二轮记录：`artifacts/verify/2026-10-04T18-42-24-415Z-cea28fb0/`。V1a 已实际攻击，但断言把既有 describe 辅助请求也算入“只有一个行动请求”，21/1 等待超时；改为按 request.type=attack 定位确认响应，不以请求总数猜完成。全屏退出后的截图 backing surface 还裁边，改为显式完整 viewport clip。该失败轮的同容器定向诊断（单独 `v1a-diagnostic.log` 与 `v1a-diagnostic/`）41/0、四组 PNG/DOM 已实际查看，HP/RNG 与引擎控制一致，迟到/离页/反复进出计数归零；诊断不代替完整验收。同轮额外诊断增加固定 2 CPU 的负载，完整轮次在 T11 整体 1200 秒超时，退出 124、timeout=true、cleanupComplete=true，不能报全绿。下一轮修正目标引用并加入对应断言，完整套件单独运行，不额外启动任何诊断/浏览器/测试，不改 timeout、不跳过套件。

第三轮记录：`artifacts/verify/2026-10-04T19-03-44-967Z-c735302e/`，退出 1、timeout=false、cleanupComplete=true。V1a 单元 40/0、CDP 42/0，四组 PNG/DOM 已逐一实际查看，确认攻击后目标行 190/200 与服务端相符、移除实体无根节点残留；发动同一攻击的 HP/RNG 与引擎控制一致。唯一失败是旧 T9c CDP 的 `attack adopted` 等待，截图仍为攻击待命且无攻击日志；旧断言只观察任意 rev 增长，未记录对应请求。为本轮完整回归，补上按 sceneChoice/attack/endTurn 真实响应同步、单次指针 down/up 连续发送，以及失败时的鼠标目标/请求/响应审计；不重试攻击、不放宽游戏断言、不改 T9c 游戏功能或引擎。其后轮次与最终完整结果见本节记录。

第四轮记录：`artifacts/verify/2026-10-04T19-35-26-330Z-feba1214/`，退出 1、timeout=false、cleanupComplete=true，所有套件和 smoke 跑完。V1a 21/1 的审计只有 describe/portrait，没有 attack；选中地图目标会依次接纳这两项辅助响应并重绘 HUD。新增 CDP 补上等待整条描述/肖像链接纳后才点攻击、从请求发出即记录，以及同一指针手势连续发送，避免在软件渲染的协议往返间换掉按下的按钮。T9c 61/1 则已捕获真实 mousedown/up/click、HTTP 200 攻击和明确 `event.engine.playerAttack.89`：原近战夹具距守卫四格，首击越界消耗行动，随后 endTurn 让守卫靠近，旧测试原本允许该流程。新同步检查纠正为仅在非相邻且已消耗行动时允许这个明确的原有越界结果，其他 error 仍失败，最终强行通行事实断言保留。没有重复点击/随机重跑、修改夹具规则或玩家行为；静态检查再次通过后单独完整验证。

第五轮记录：`artifacts/verify/2026-10-04T19-53-46-501Z-e2cf2eb6/`，退出 1、timeout=false、cleanupComplete=true。旧 41 套件与 smoke 全通过，T9c 164/0、T11 134/0。V1a 29/1：真实攻击/目标 HUD/去重/HP 与 RNG 控制均通过，实际 PNG/DOM 已核对；之后写死的 move(4,5) 在骷髅正常处理后已被 skel2 占据，响应确认玩家仍 (4,4)、movementLeft=30，默认模型正确未走动。改为调用引擎 isBlocked/entityAt 查询当前空邻格，只发一次真实按键，先核对 held move 响应实际目的地，再断言默认模型最终坐标收敛；不改怪物位置、不重试走路、不依赖中途 rAF 坐标。该修正增加两项有效断言，V1a CDP 当前为 44 项；静态检查通过后完整验收。

### 正常试玩与剩余工作

正常试玩：进入既有存档或从 M1 公开目录出发，默认造型如前；移动后看人物与跟随相机最终到达格子，点怪物再攻击，结果即时由服务端给出，人物做短攻击姿态；轮询/切语言不会重复挥动。继续用 T10 人物/背包/日志面板、2D/3D、V 布局与 L1 独立原生全屏，退出再进默认模型继续同档。

第一段无未完成验收或实现项。第二段未领取：匹配 r186 的本地 GLB loader/骨架克隆/AnimationMixer，有限版本化清单、预算与缓存引用、T8 暂存/原子安装和完整资源导入导出、稳定 model ID/怪物绑定/英雄选择、真实片段映射、管理预览/禁用/缺包回退。T12/T13 未领取；不自动执行第二段。
