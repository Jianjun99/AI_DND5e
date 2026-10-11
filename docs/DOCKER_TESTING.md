# 专用 Docker 验证环境

自动验证统一使用 Docker Desktop 的 Linux containers 模式。服务端、测试代码和 Chromium 全部在测试容器内运行。

在仓库根目录执行一条命令：

```powershell
npm run verify
```

宿主机只需 Node.js >=20、npm 和可访问的 Docker CLI/引擎，无需安装开发依赖或浏览器。入口自动构建 `Dockerfile.test`，缓存镜像名为 `ai-dnd-verify:local`；依赖未变化时复用构建层，代码改动自动进入新镜像。构建通过 `npm ci --include=dev` 使用现有 lockfile，包含全部 scripts、tests、fixtures、MCP、Chromium 与中文字体。游戏生产镜像与测试镜像独立。

Windows 支持系统安装路径和 `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe`。其他安装位置可在当前会话设置 `$env:DOCKER_BIN = '实际的 docker.exe 完整路径'`。遇到 PATH、沙箱权限、Linux containers、盘符共享或浏览器环境问题先报告并失败；禁止回退到宿主机起服务/浏览器，也禁止改成跳过 e2e。

## 资源和互斥

- 每轮测试固定 **2 CPU、4 GiB RAM、4 GiB memory-swap（无额外 swap）**；共享内存 512 MiB、进程上限 512。Chromium 使用 ANGLE/SwiftShader 软件 WebGL2，不需要宿主机 GPU。
- 同一 Docker 引擎的固定容器名 `ai-dnd-verify` 是原子锁，所有 agent、工作目录和 CI 调用统一走入口。已有容器时第二轮返回 **73**；等当前轮结束再执行，不自动重跑，也不停止或删除其他 agent 的容器。构建可以并发，完整验证不能并发。
- 不手动运行 `docker run ai-dnd-verify:local`、不换容器名/Docker context 绕过互斥。`scripts/test-all.mjs` 也拒绝在宿主机直接运行。MCP 的 `run_verify` 和 CI 使用同一入口。
- 容器内 verify 另持有原子文件锁，`docker exec` 再启动同一容器的 verify 也返回 73；`npm run check` 的容器内运行共用同一把锁，快速检查与完整验证不会在同一容器内交错。

## 快速开发检查（部分验证，不是验收）

```powershell
npm run check                                  # eslint + tsc + 全部单元/集成套件，失败立即停止
npm run check -- --browsers=companion-story-cdp,hud-stability # 显式追加选中的 CDP 浏览器套件
npm run check -- --list                        # 列出可选浏览器套件 id
```

- ⚠️ **部分验证**：无冒烟、无完整截图轮、无失败清点，输出与 `result.json` 都带
  `kind: quick-check` / PARTIAL 标记；完成验收仍然只有 `npm run verify`，报告不得混称。
- 与 verify 共用同一镜像、同一容器名互斥、2 CPU / 4 GiB、`--network none`、独立 DATA_DIR、
  容器清理与产物落盘；证据在 `artifacts/check/<时间>-<随机 ID>/`（`timings.json` 记录构建、
  各步骤、各套件、截图数、清理与总耗时），不污染 `artifacts/verify/` 的验收证据。
- fail-fast 是设计行为：第一个红步骤/红套件立即停止，修完再跑；不许靠重试换绿。
  退出码契约（Q1a）：eslint/tsc/服务启动/任一套件/**证据保存失败**全部非零退出，
  任何失败路径都不得打印 PASSED 横幅。
- 套件清单单一来源 `scripts/test-suites.mjs`（`id` + unit/integration/browser 分层），
  test-all 与 dev-check 共同消费；浏览器套件默认不跑，`--browsers=` 按 id 精确选择
  （未知 id 直接报错）。选中浏览器套件时与 verify 一样先启动隔离游戏服务器。
- 故障注入回归（Q1a）：`tests/integration/dev-check-faults.test.mjs` 在容器内通过
  `AI_DND_CHECK_FAULT=<eslint|tsc|server|suite|artifact-save>` seam 驱动 dev-check 的
  真实失败路径并断言实际退出码；该套件在完整 verify 中全量运行，在 check 内自跳过
  （防止嵌套递归），因此默认 check 列出的 **31 个套件**（unit 11 + integration 20）中它显示为
  0 秒的 SKIP、**实际执行 30 个**；`--browsers=` 选中的浏览器套件按实际选择追加。
- 实测（日志口径）：默认 check 容器 29.69s / 宿主 33.49s（构建 2.17s，镜像缓存命中）；
  镜像重建轮（2026-10-09 独立复核，`--browsers=hud-stability`，H1 CDP 32/0）构建 61.81s、
  容器 50.98s、宿主 114.06s；完整 verify ≈21.5 分钟（`--timeout=1500`）。

MCP 的 `run_replay` / `run_balance_sim` 也走同一容器入口，在完整验证后追加指定检查，
不连宿主游戏服务。命令行等价方式（仍执行完整 verify）：

```powershell
npm run verify -- --replay-runs=4
npm run verify -- --balance-runs=50
```

## 数据与 AI

每轮的 `DATA_DIR=/tmp/ai-dnd-test-data` 位于全新容器层，初始化为关闭 LLM 和肖像服务的空配置；部分集成测试另建自己的临时目录。镜像使用源码白名单，构建上下文排除 `data/`、凭据、本地工具目录、宿主依赖和旧验证产物。**绝不挂载玩家存档、模型配置、生产卷或 Docker socket**。

Linux/CI 保留宿主 UID/GID，以便日志挂载可写；这个 UID 不必出现在镜像的 passwd 中。浏览器的 `HOME=/tmp/ai-dnd-test-home` 与 XDG config/cache 由容器入口创建在临时层，避免未知 UID 默认 home 为 `/` 时 Chromium crashpad 无法启动。环境回归检查实际 UID 的写入能力，所有正常 CDP 与 WebGL 失败探针仍必须运行。

唯一宿主机挂载是本轮 `artifacts/verify/<时间>-<随机 ID>/` → `/test-artifacts`，只存日志与诊断。`--network none` 阻断外部网络；服务端、浏览器和确定性 HTTP 模型 mock 只在容器 loopback 通信。AI 持久化回归仍使用本地 mock，不接真实模型。

## 完整验证和失败

2026-10-07 Q1/Q1a 扩展后，完整 runner 为 **49 套件（unit 11 + integration 20 + browser CDP 18）**（2026-10-04 M1/L1/V1 两段扩展后曾为 45 套件、16 CDP——历史记录见下）。M1/L1/V1a/V1b 的端口为 9237/9238/9239/9240；V1b 使用本地 GLB/内嵌 PNG，覆盖原生文件导入下载、真实 3D 命中、动画/骨架隔离、禁用删包与迟到/失败资源释放。以下早期套件规模保留为历史记录；新增检查不替代旧套件。最终命令是 `npm run verify -- --timeout=1500`（2026-10-07 实测全量约 20–21 分钟，1200 秒预算在高负载时段可能不足），规则数值变化才同容器追加 `--balance-runs=50`。

容器真正执行 `npm run verify`：eslint → tsc → `test-all` 全部套件（当前 **49 个**：unit 11 + integration 20 + browser CDP 18）→ smoke。缺浏览器、WebGL2 不可用或渲染失败都必须退出非零。WebGL2 检查包括清屏和像素读回；尸体移除与升级徽章磁盘回归读取服务端同一个 `DATA_DIR`，缺文件/测试英雄/怪物时失败，不跳过。T6 有山谷哨门两路线的 canvas/按钮、刷新与回城检查；T9a 验收中英文切换、未保存表单/地图实例保留、刷新与手机截图（9231）；T9b 覆盖七步创建、两语言连续冒险、pending 创建/出发/结算、六页设置、城镇/角色/主线与手机截图（9232）。T10 覆盖四尺寸/双语言地图比例、真实触点遮挡、单抽屉/焦点/输入、2D/3D resize 点击、离页资源释放与结算返回锁（9233）；9224 另记录同镜头布局尺寸、20 次 rAF 帧间隔及截图/DOM。T9c 加入内容 canonical 哈希/T8 roundtrip/并发 AI 与知识边界集成，以及中英文两路线、词缀/长任务/历史日志和 TTS 的真实 Chromium 验收（9234）。T11 覆盖故事包有限效果/引用校验、三处选择/检定失败推进、真实资源与永久记忆、结算重试/迟到模型，并在两语言以真实 canvas/按钮走完公开和保护路线、刷新、手机摘要/回城和正常出发入口（9235），保存加速试玩计时。9230 留给负 WebGL 探针。balance 另含山谷哨门两路线的目标完成模拟。

Chromium 使用自己的进程组与临时 profile；关闭发送 Browser.close，同时观察实际进程退出。进程已经退出时不再等待可能丢失的 CDP 回执；回执先到仍等待进程。随后按原边界回收本测试的进程组并清理 profile。清理失败计入失败，不能忽略 ENOTEMPTY 或杀其他测试/容器。验证环境套件中的两个受控顺序探针覆盖“退出早于回执”和“回执早于退出”，不额外启动浏览器。

2026-10-04 复核补修新增 HP 创建/重算/升级/API 一致性集成和确定性路由响应屏障/动态 descriptor CDP（9236），该次扩展后为 **37 套件、12 个正常 Chromium CDP**。新增 CDP 排在原浏览器套件前，全部套件仍必跑；屏障等待真实请求/导航完成，不用固定 sleep。失败记录包含具体场景/协议或浏览器异常、PNG/DOM。9236 也纳入超时采集；下方 35/11 为 T11 主体开发时的历史规模。

固定 2 CPU 下软件 WebGL 的 PNG 捕获最多等待 20 秒，DOM 采集最多等待 10 秒；超时仍失败并保留诊断，不能把缺截图当通过。公共采集并行请求快速无损 PNG 和 DOM，记录 captureMs；只读截图连接不订阅未使用的 Page 通知。正常测试需要的事件订阅保持。清理先等待浏览器退出，再短暂重试移除临时 profile（应对子进程最后写入），清理错误也计入失败。

默认整轮执行时限：完整验收 1800 秒（30 分钟），快速检查 900 秒（15 分钟），命令行可通过 `--timeout=<秒数>` 显式覆盖；普通套件 180 秒；重型浏览器套件按实测单独放宽（唯一来源是
`scripts/test-suites.mjs` 的 `timeoutMs`）：T9c/T11/T12a/H1 各 300 秒，L1 420 秒——L1 走
8 视口 × 双语言的全屏/焦点/截图路线，历史全绿 204–290 秒，2026-10-09 一轮在 302 秒、
全部断言仍通过时被原 300 秒上限以 exit 124 终止（预算不足，非断言失败），故提高预算。
所有套件上限仍受整轮时限约束，首次镜像构建另限 20 分钟。完整验收直接运行 `npm run verify` 即默认使用 1800 秒预算（高负载宿主亦充裕），不改变 2 CPU / 4 GiB、互斥或必跑项。容器内监督进程在超时/信号时先采集当前页面（包括 9234/9235），再终止验证；Docker `--init` 回收子进程，`--rm` 自动移除容器。宿主机 `finally` 仅按本轮容器 ID 检查并兜底 stop/rm，绝不按名字误删后续轮次。Docker daemon 不可达等导致无法确认清理时必须报告 `cleanupComplete=false`，不能宣称成功。

```powershell
# 验证超时路径；这是一次预期失败的诊断运行
npm run verify -- --timeout=1
```

退出码：0 全部通过；1 验证/环境失败；73 锁被占用；124 超时；130/143 中断；137 OOM/被强杀。Docker 自身的其他失败码保留。失败不重试到全绿，先修复真实原因。

每轮保留：`host.log`（构建与运行）、`container.log`、`last-verify.log`、`container-result.json`、`result.json`、`screenshots/*.png` 与页面 DOM/诊断 JSON。没有可连接浏览器时保留原因，不能伪造截图。`artifacts/verify/latest.json` 指向最近一轮；MCP `recent_failures` 从此处找日志，不写玩家 `data/`。即使失败/超时，产物也保留，日志目录已被 Git 与 Docker 忽略。

Docker 参数依据：[资源限制](https://docs.docker.com/engine/containers/resource_constraints/)和[容器选项](https://docs.docker.com/reference/cli/docker/container/create/)。
