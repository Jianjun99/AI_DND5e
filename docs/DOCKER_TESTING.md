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
- 容器内 verify 另持有原子文件锁，`docker exec` 再启动同一容器的 verify 也返回 73。

MCP 的 `run_replay` / `run_balance_sim` 也走同一容器入口，在完整验证后追加指定检查，
不连宿主游戏服务。命令行等价方式（仍执行完整 verify）：

```powershell
npm run verify -- --replay-runs=4
npm run verify -- --balance-runs=50
```

## 数据与 AI

每轮的 `DATA_DIR=/tmp/ai-dnd-test-data` 位于全新容器层，初始化为关闭 LLM 和肖像服务的空配置；部分集成测试另建自己的临时目录。镜像使用源码白名单，构建上下文排除 `data/`、凭据、本地工具目录、宿主依赖和旧验证产物。**绝不挂载玩家存档、模型配置、生产卷或 Docker socket**。

唯一宿主机挂载是本轮 `artifacts/verify/<时间>-<随机 ID>/` → `/test-artifacts`，只存日志与诊断。`--network none` 阻断外部网络；服务端、浏览器和确定性 HTTP 模型 mock 只在容器 loopback 通信。AI 持久化回归仍使用本地 mock，不接真实模型。

## 完整验证和失败

容器真正执行 `npm run verify`：eslint → tsc → `test-all` 全部套件（含六个 Chromium CDP e2e）→ smoke。缺浏览器、WebGL2 不可用或渲染失败都必须退出非零。WebGL2 检查包括清屏和像素读回；尸体移除与升级徽章磁盘回归读取服务端同一个 `DATA_DIR`，缺文件/测试英雄/怪物时失败，不跳过。T6 新增山谷哨门两条路线的真实 canvas/按钮、刷新与回城检查；balance 另含这两条路线的目标完成模拟。

默认整轮执行时限 900 秒，每套件 180 秒，首次镜像构建另限 20 分钟。容器内监督进程在超时/信号时先采集当前页面，再终止验证；Docker `--init` 回收子进程，`--rm` 自动移除容器。宿主机 `finally` 仅按本轮容器 ID 检查并兜底 stop/rm，绝不按名字误删后续轮次。Docker daemon 不可达等导致无法确认清理时必须报告 `cleanupComplete=false`，不能宣称成功。

```powershell
# 验证超时路径；这是一次预期失败的诊断运行
npm run verify -- --timeout=1
```

退出码：0 全部通过；1 验证/环境失败；73 锁被占用；124 超时；130/143 中断；137 OOM/被强杀。Docker 自身的其他失败码保留。失败不重试到全绿，先修复真实原因。

每轮保留：`host.log`（构建与运行）、`container.log`、`last-verify.log`、`container-result.json`、`result.json`、`screenshots/*.png` 与页面 DOM/诊断 JSON。没有可连接浏览器时保留原因，不能伪造截图。`artifacts/verify/latest.json` 指向最近一轮；MCP `recent_failures` 从此处找日志，不写玩家 `data/`。即使失败/超时，产物也保留，日志目录已被 Git 与 Docker 忽略。

Docker 参数依据：[资源限制](https://docs.docker.com/engine/containers/resource_constraints/)和[容器选项](https://docs.docker.com/reference/cli/docker/container/create/)。
