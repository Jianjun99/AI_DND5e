# 🚢 RELEASE — 发版手册（给 AI 和人类）

> 本仓库的发版流程曾是会话记忆里的部落知识，现在正式化于此。
> 每次发版照着本清单从头走到尾即可；流程有过两次实战验证（v1.9.1 / v1.9.2）。

## 0. 前提

- **必须用户明确说发版才发**（AGENTS.md 地面规则 1）。不要主动发版。
- 完整验证全绿：`npm run verify`（自动起服务 → eslint → tsc → 14 套件 → 冒烟 → 收尾）。
- 工作区干净（`git status`），待发内容已全部 commit。

## 1. 版本号：只改 `package.json`

- `"version"` 是唯一版本源，`/api/health` 读它。**别改别处**（没有别的硬编码版本）。
- 版本选择：玩家可见修复/新功能升 minor 或 patch，按内容自定（例：1.9.1 → 1.9.2）。

## 2. 同步 PROJECT_STATE.md

- 「当前版本」行改为新版本 + 一句话摘要。
- 各「进行中/未发布」段落标题改成「（vX.Y.Z 已发布）」。
- 「项目概况」的 Docker 镜像 tag 示例更新。
- 「版本历史」末尾追加一行。

## 3. 提交、推送、打 tag

```bash
export PATH="/c/Program Files/nodejs:$PATH"   # git bash 找 node
git add -A && git commit -m "vX.Y.Z"
git push origin main
git tag -a vX.Y.Z -m "AI Dungeon vX.Y.Z — <headline>"
git push origin vX.Y.Z
```

push tag 即触发 `.github/workflows/docker-publish.yml`（多架构 amd64+arm64）。
**tag 命名陷阱**：git tag 是 `vX.Y.Z`，但 docker/metadata-action 会剥掉 `v`——
镜像 tag 是 `X.Y.Z` + `latest` + `sha-*`。查 `:vX.Y.Z` 返回 404 是**设计使然**，不是发布失败。

## 4. 创建 GitHub Release

token 与管道的坑（两次实战经验）：

- `execSync` 里跑不了 bash 管道——**先在 bash 层取 token 存进环境变量，再跑 node 脚本**：

```bash
export GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n' | git credential fill | grep '^password=' | cut -d= -f2-)
node /tmp/ai-dnd-create-release.cjs
```

- **Release 正文用 Write 工具写成 .cjs 脚本**（单引号字符串数组 + join），绝不内联进
  heredoc/`node -e`——正文里的反引号代码块会炸。脚本是一次性临时文件，用完即删（放
  系统临时目录，别提交进仓库）。
- 端点：`POST https://api.github.com/repos/Jianjun99/AI_DND5e/releases`，
  body `{ tag_name: 'vX.Y.Z', name, body, draft: false, prerelease: false }`，返回 201 + html_url。
- notes 风格（v1.5.0 起）：英文正文；标题 `AI Dungeon vX.Y.Z — <headline>`；按功能域分
  `##` 段；末尾一个 `▶️ Run it` docker 块；最后一句 "Worth trying first: …"。
- Windows 上 node 退出时若打印 `Assertion failed … src\win\async.c`——libuv 的已知怪癖，
  HTTP 201 已成功，无害，忽略即可。

## 5. 发布后验证

- **CI**：`https://api.github.com/repos/Jianjun99/AI_DND5e/actions/runs` 里本次 push 的
  CI 与 Publish Docker image 都是 success（curl 带 Bearer token 查）。
- **镜像 manifest 双架构**：

```bash
GT=$(curl -s "https://ghcr.io/token?scope=repository:jianjun99/ai_dnd5e:pull&service=ghcr.io" | node -e "…JSON.parse(d).token…")
curl -s -H "Authorization: Bearer $GT" \
  -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" \
  "https://ghcr.io/v2/jianjun99/ai_dnd5e/manifests/X.Y.Z"
```

  应列出 `linux/amd64` 与 `linux/arm64`（`unknown/unknown` 两条是 buildx 的 attestation，正常）。

## 6. 已知坑速查

- Docker Desktop 容器偶尔 OOM exit 137——`docker start ai-dnd` 重启即可。
- 镜像验证：`docker build -t ai-dnd:review .` → `docker run -d --name ai-dnd-review
  -p 3101:3000 -v ai-dnd-review-data:/app/data ai-dnd:review` → `BASE_URL=http://localhost:3101`
  直连容器跑冒烟与 e2e。镜像里没有 tests/，要在容器内跑先 `docker cp`（Git Bash 下
  `docker exec … ls /app/…` 需要 `MSYS_NO_PATHCONV=1`）。
- re-point 一个已推的 tag（极少用）：`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z
  && git tag -a vX.Y.Z -m "…" <sha> && git push origin vX.Y.Z`——会重跑 publish，无害。
