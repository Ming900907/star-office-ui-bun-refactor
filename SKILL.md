---
name: star-office-ui-bun
description: Star Office UI（Bun 重构版）一键化 Skill：快速启动办公室看板、切换 Agent 状态、接入多 Agent 推送。
---

# Star Office UI Bun Skill

本 Skill 面向在本仓库协作的 Agent，目标是：
- 用 Bun 版本快速跑起看板
- 用统一命令切换状态（idle/writing/researching/executing/syncing/error）
- 为访客 Agent 提供接入与状态推送

## 1. 快速启动

```bash
~/.bun/bin/bun install
cp state.sample.json state.json
cp join-keys.sample.json join-keys.json
~/.bun/bin/bun run server/index.ts
```

打开：`http://127.0.0.1:19000`

## 2. 切换状态（重构后的标准方式）

推荐通过 Bun 脚本调用 `/set_state`：

```bash
~/.bun/bin/bun run scripts/set-state.ts writing "正在整理文档"
~/.bun/bin/bun run scripts/set-state.ts syncing "同步进度中"
~/.bun/bin/bun run scripts/set-state.ts error "发现问题，排查中"
~/.bun/bin/bun run scripts/set-state.ts idle "待命中"
```

或使用 package.json 快捷命令：

```bash
~/.bun/bin/bun run state:writing
~/.bun/bin/bun run state:syncing
~/.bun/bin/bun run state:error
~/.bun/bin/bun run state:idle
```

## 3. 访客 Agent 接入（Join + Push）

- 接入指引文档：`frontend/join-office-skill.md`
- 推送脚本（JS 版）：`frontend/office-agent-push.mjs`
- 接口：`/join-agent` + `/agent-push`

## 4. 安全与配置

- 生产环境必须设置强密码：`ASSET_DRAWER_PASS`
- 环境变量模板：`.env.example`
- 不要提交运行态文件：`state.json`、`join-keys.json`、`agents-state.json`

## 5. 验收最小清单

- `GET /health`
- `GET /status`
- `POST /set_state`
- `GET /agents`
- `/join-agent` + `/agent-push`
