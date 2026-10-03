# Docker Desktop 专用自动验证环境

状态：done（2026-10-02，最终完整容器验证通过）。不涉及游戏版本或发布。

## 验收

- 独立 `Dockerfile.test`，含 lockfile 安装的开发依赖、完整测试代码/fixtures、Chromium。
- 统一 `npm run verify`，服务端和浏览器在容器内；MCP 与 CI 复用入口。
- 固定 2 CPU / 4 GiB RAM，固定 Docker 容器名原子互斥，所有 agent 同时最多一轮完整验证。
- 独立临时测试数据、真实 AI 关闭、network none；不挂载真实存档/模型配置/生产卷。
- 成功/失败/超时都清理容器，保留日志、失败截图与退出码。
- 缺浏览器/WebGL2 必须失败；磁盘回归使用 DATA_DIR，禁止缺文件时静默跳过。
- Windows 问题先报告，不回退宿主机浏览器；更新交接文档，不 commit/push/改版本/发版。

## 实施与已验证结果

入口为 `scripts/verify.mjs` → `scripts/docker-verify.mjs` → 测试镜像内
`scripts/container-verify.mjs` → 完整 `npm run verify`。产物目录独立挂载，
`--rm` + 按本轮 ID 的 finally stop/rm 兜底。整轮 900 秒、单套件 180 秒时限。
规则见 [Docker 测试指南](../docs/DOCKER_TESTING.md)、AGENTS 和 AGENT_HANDOFF。

Windows 用户目录安装的 CLI 已定位；用受限授权访问已运行的 Docker Desktop Linux 引擎。
真实 Docker inspect 确认了 2 CPU / 4 GiB、network none、仅产物目录挂载。
并发第二入口返回 73 且原轮继续；1 秒超时运行返回 124、timeout=true、cleanupComplete=true。
首轮真实容器测试暴露源码目录临时文件权限问题，两个单元套件已改用系统临时目录。
第二轮暴露旧词缀伤害测试随机均值偶发失败，已改为注入相同 RNG、穷举 d8/d4，保留并收紧伤害断言；未改游戏数值。

新增环境回归进入完整 runner：缺浏览器子进程非零、拒绝绕过专用容器门禁、
真实 Chromium 禁用 WebGL2 后失败且 PNG/页面诊断有效、外部网络接口与玩家数据缺席，
同一容器的第二次 verify 也必须返回 73（五项环境场景）。
尸体移除/升级徽章使用测试 DATA_DIR 且缺前置失败；不再写死玩家 data/ 路径。

MCP 的 run_replay / run_balance_sim 也改走统一验证入口，分别在完整验证后追加回放/模拟，
共用容器锁、限额、临时测试数据和清理规则。`--replay-runs` / `--balance-runs` 为命令行等价参数。
45 秒超时诊断已保存真实游戏 3D 页面的 PNG 与 DOM，退出 124 且清理成功。

最终源码实测 `npm run verify -- --replay-runs=1 --balance-runs=2`：eslint、tsc、24 套件
（五个正常 CDP e2e、五项环境场景）、smoke、追加 replay、追加 balance 全绿，退出 0，
`cleanupComplete=true`。五个正常 e2e 均真实通过 WebGL2 清屏/像素读回；尸体移除和徽章磁盘回归实际执行。
追加 replay 为 unfinished、0 anomalies；2 次/配置的 balance 仅验执行路径，不据此评估胜率变化，游戏数值未改。

最终产物：`artifacts/verify/2026-10-03T03-37-58-659Z-5fcf50f2/`；
超时真实游戏截图：`artifacts/verify/2026-10-03T03-36-43-100Z-389b0235/screenshots/timeout-9225-0.png`。
成功、真实测试失败、超时均已实测移除容器；外层并发拒绝和内层文件锁拒绝都为 73。
Docker Desktop 用户路径自动检测已实测，无需另设 DOCKER_BIN；全程未启动宿主机浏览器。
CI 配置已切换统一命令与 always 上传产物，未推送触发远端 CI。未 commit/push/改版本/发版。
