# Task: 排查 CDP e2e 偶发闪红

> 技术债。`npm run verify` 上线后三跑一闪红（Device Adaptation 套件，复跑即绿），
> CI 上未表现。别让它养成「红了就重跑」的习惯。

## 现象

- 失败套件：`tests/e2e/responsive-cdp.test.mjs`（0.11s 即失败——像连接/启动层，不是断言层）。
- 环境：Windows + Edge/Chrome 分离进程树 + CDP 端口 9224/9225。
- 已知背景（PROJECT_STATE 测试体系节）：浏览器残留进程按 `--user-data-dir` 档案目录名
  PowerShell 杀；localStorage 串味要在测试开头重置键。

> 🔍 **排查记录**（v1.9.4 批次）：瞬挂根因 = 残留浏览器进程占着本套件的 profile——三个套件启动前现已强制清理自己的 profile（killStaleBrowser），连接失败时报出端口与 profile 路径。**剩余偶发**：点击撞上 busy 窗口（固定 sleep 竞态，如 retreat 弹窗偶发缺失，复跑即绿）——根治要把固定 sleep 改成条件轮询，工程量在三个套件的时序重构，留作后续。

## 疑点清单（按概率）

1. 三个浏览器套件背靠背跑，前一套的 Edge 进程树没死透，下一套抢 9225 超时。
2. `npm run verify` 的服务器是随机高端口——套件里有没有写死 3000/3100 的残余
   （已 grep 过 BASE 逻辑，但 CDP 端口与 profile 路径可能有别处写死）。
3. verify 的 finally `taskkill /T` 与下一套的浏览器启动竞态（不太可能，服务器 ≠ 浏览器）。

## 目标

找到根因并修掉；至少给套件加「启动重试一次 + 明确报出 CDP 端口与 profile 路径」，
让下一次闪红自带诊断信息。

## 动哪些文件

- `tests/e2e/*.test.mjs`（共用启动逻辑若重复，可抽到 `tests/e2e/_cdp-helpers.mjs`）

## 验收标准

- 连跑 `npm run verify` 5 次全绿（本任务的核心验收）。
- 失败路径下日志能看出：哪个端口、哪个 profile、杀了哪些进程。

## 验证

`npm run verify` ×5。
