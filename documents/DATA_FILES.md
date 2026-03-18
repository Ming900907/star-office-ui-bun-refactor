# 数据文件与目录（精简）

## JSON
- `state.json`：主状态（`state/detail/progress/updated_at/ttl_seconds?`）
- `agents-state.json`：多 Agent 状态（含 `agentId/name/isMain/state/detail/updated_at/area/source/joinKey/authStatus/authExpiresAt/lastPushAt`）
- `join-keys.json`：访客 key 列表（`keys[{key,used,reusable,maxConcurrent,usedBy,usedByAgentId,usedAt,expiresAt?}]`）
- `openclaw-skills-cache.json`：OpenClaw 技能缓存（`source/skills/count/degraded/warnings/note/syncedAt`）
- `openclaw-usage-cache.json`：OpenClaw 用量缓存（`mode/summary/byModel/byChannel/degraded/warnings/note/syncedAt`）
- `asset-positions.json`：资产当前位置（`{key:{x,y,scale?,updated_at}}`）
- `asset-defaults.json`：资产默认位置（同上）
- `runtime-config.json`：Gemini 配置（本重构忽略）

## Sample / 测试初始化文件
- `state.sample.json`
- `join-keys.sample.json`
- `runtime-config.sample.json`

说明：
- 这些文件用于初始化或测试，不应直接视为生产配置。
- 当前 Bun 服务启动时，如果 `join-keys.json` 缺失，会自动复制 `join-keys.sample.json` 作为兜底。
- 生产环境建议在启动前显式准备真实 `state.json` 与 `join-keys.json`。
- OpenClaw 技能与用量面板现由 OpenClaw 在本地采集后调用 `POST /openclaw/sync` 写入本地缓存文件，前端只读缓存。

## 目录
- `frontend/`：静态资源（替换会生成 `.bak/.default`）
- `assets/home-favorites/`：背景收藏（`index.json`）
- `memory/*.md`：/yesterday-memo 来源
- `~/.openclaw/workspace/IDENTITY.md`：可选 officeName
