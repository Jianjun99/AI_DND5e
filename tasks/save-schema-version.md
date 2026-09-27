# Task: 存档 schema 版本号 + 迁移钩子

> ✅ **已实现**（v1.9.3 批次）：`server/store.js` 的 `SAVE_VERSION`/`migrateSave` +
> `tests/unit/store-versioning.test.mjs`。本文件保留作为「迁移步骤怎么写」的参考。

> 技术债。改存档形状的改动已经发生过多次（road boons、companionLoyalty、essence、
> pendingDelveItems…），目前全靠宽容读取混过去；将来一次破坏性改动就会踩坑。

## 背景

- 角色档案：`data/characters.json`（store.getCharacters / saveCharacters）。
- 地牢存档：`data/saves/*.json`（store.getSave / saveSave）。
- 两者都没有版本号字段；读旧档时靠 `|| 默认值` 和 `typeof x === 'number'` 防御。

## 目标

1. 两类存档写入时带 `saveVersion: N`（常量放 store 模块顶部，当前 = 2，代表引入本机制时的形状）。
2. 读取时若无版本号按 1 处理；`migrateSave(obj, fromVersion)` 链式迁移到当前版本
   （第一版迁移内容可以为空——机制先落地）。
3. 迁移只增不改不删（保守策略）；迁移失败（抛错）时返回原对象 + console.error，**不要让玩家档打不开**。

## 动哪些文件

- `server/store.js`（或 store 所在文件）：常量 + migrate 函数 + get* / save* 挂钩
- `tests/unit/`：新增一个小测试文件（旧形状样本 → 迁移后字段齐全；坏 JSON 不崩）

## 验收标准

- 旧样本（手工构造一个缺新字段的 JSON）读入后带正确版本号且功能正常。
- `npm run verify` 全绿；冒烟测试照常读写存档。

## 验证

`npm run verify`。
