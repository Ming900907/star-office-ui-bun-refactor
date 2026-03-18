---
name: star-office-ui-bun
description: Star Office UI（Bun 重构版）一键化 Skill：帮助主人快速部署办公室看板、统一状态同步、接入多 Agent 推送，并完成上线前安全检查。
---

# Star Office UI Bun Skill

本 Skill 面向在本仓库协作的 Agent（龙虾），目标是：
- 尽量少打扰主人，优先“先跑起来，再优化”
- 用 Bun + JS 工作流统一状态同步与多 Agent 接入流程
- 提供标准化的状态切换、多 Agent 接入与 OpenClaw 技能/用量面板方法
- 部署时默认由 OpenClaw 自动完成项目配置

---

## 0. 一句话告诉主人这是什么

你可以先和主人说：
> 这是一个多人协作的像素办公室看板，AI 助手会根据状态自动移动，还能展示昨日小记和多人在线状态。

---

## 1. 30 秒一键启动（建议先帮主人跑一遍）

在项目根目录执行：

```bash
# 1) 下载仓库并进入目录（如当前已在仓库目录，可跳过）
git clone git@github.com:Ming900907/star-office-ui-bun-refactor.git
# 如果 SSH key 不可用，改用：
# git clone https://github.com/Ming900907/star-office-ui-bun-refactor.git
cd star-office-ui-bun-refactor

# 2) 安装依赖
~/.bun/bin/bun install

# 3) 初始化配置与状态文件
cp .env.example .env
# 本地体验可从 sample 初始化；生产部署请优先使用 bootstrap:prod
cp state.sample.json state.json
cp join-keys.sample.json join-keys.json

# 4) 生产环境务必设置安全项（OpenClaw 面板走 sync/cache）
export ASSET_DRAWER_PASS="replace_with_strong_password"
export STAR_OFFICE_API_TOKEN="replace_with_long_random_token"
export STAR_OFFICE_ENV=production
export OPENCLAW_BIN="openclaw"
export OPENCLAW_CACHE_STALE_SECONDS=120
export OFFICE_PANEL_SYNC_INTERVAL_SECONDS=60

# 5) 启动 Bun 服务
~/.bun/bin/bun run server/index.ts
```

完成后告诉主人：
> 现在打开 http://127.0.0.1:19000 就能看到像素办公室。

如果是生产部署，优先直接执行：

```bash
~/.bun/bin/bun run bootstrap:prod
```

该命令会由 OpenClaw 自动完成配置与最小验收，不需要主人手动逐项编辑。

### 1.0 生产部署时，OpenClaw 的默认执行策略

如果主人说的是“部署到服务器 / 重新部署 / 上线新版本”，默认按下面策略执行，不要退回到旧的手工模式：

1. 优先执行 `~/.bun/bin/bun run bootstrap:prod`
2. 默认使用 `degraded-tolerant` 策略
3. 只有主人明确要求“不能接受 fallback / 必须真实连上 OpenClaw / 降级也算失败”时，才设置：

```bash
export OPENCLAW_REQUIRE_HEALTHY_SOURCE=1
```

4. 如果主人没有特别要求 strict，就保持：

```bash
export OPENCLAW_REQUIRE_HEALTHY_SOURCE=0
```

5. 验收时不仅看 HTTP 200，还要看：
   - `POST /openclaw/sync` 的结果是否为真正成功
   - `/openclaw/skills` 与 `/openclaw/usage` 的 `syncedAt`
   - 是否存在 `stale: true`
   - 是否存在 `degraded: true`
   - `warnings` 是否为空

给主人的一句话总结可以直接说：
> 我已经按新的部署流程完成初始化，并检查了 skills/usage 当前缓存是否已同步、是否过期、是否处于降级模式。

### 1.1 部署默认策略：由 OpenClaw 自动完成配置（必须执行）

部署时，Agent 默认按以下顺序自动执行，不要把配置步骤丢给主人手工做：

1. 自动创建/更新 `.env`
2. 自动准备 `state.json`、`join-keys.json`（缺失时以生产安全默认值初始化，不使用 sample）
3. 若 `STAR_OFFICE_ENV=production`：
   - 强校验 `ASSET_DRAWER_PASS`、`STAR_OFFICE_API_TOKEN`
   - OpenClaw 通过 `POST /openclaw/sync` 触发服务端执行 `openclaw skills list --json` 与 `openclaw status --usage --json`
   - `POST /openclaw/sync` 是“拉取与刷新缓存”的唯一入口，`GET /openclaw/skills` 与 `GET /openclaw/usage` 只是读缓存
   - 若主人要求“必须真实接入 OpenClaw”，则设置 `OPENCLAW_REQUIRE_HEALTHY_SOURCE=1`
4. 自动执行最小验收：
   - `GET /health`
   - `GET /status`
   - `POST /openclaw/sync`
   - `GET /openclaw/skills`
   - `GET /openclaw/usage`
5. 输出一段“已完成配置摘要”（端口、环境、sync 结果、syncedAt/stale/degraded、是否 strict）

原则：
- 能自动推断就自动推断；只在缺少关键密钥时才询问主人。
- 不把“请你手动改配置文件”作为默认方案。
- 主人没特别强调“禁止降级”时，默认使用 degraded-tolerant 模式；只有明确要求时才开 strict。

### 1.2 部署时必须识别的三种结果

#### A. 健康

- `POST /openclaw/sync` 返回 `200`
- skills/usage 都已有 `syncedAt`
- `stale=false`
- `degraded=false`

这是最理想状态，可以直接告诉主人部署完成。

#### B. 可运行但降级

- `POST /openclaw/sync` 返回 `502`，或返回 `200` 但后续读缓存仍带 `degraded: true`
- `source` 含 `fallback`
- 或 `mode=estimated`
- 或返回体里有 `degraded: true`

如果主人没有要求 strict，这种状态可以上线，但必须明确告诉主人当前不是“真实 OpenClaw 数据源”。
如果缓存里之前已经有健康数据，服务端应保留上一份健康缓存，不允许本次降级同步把前端面板覆盖成 fallback。

#### C. 严格模式失败

- 设置了 `OPENCLAW_REQUIRE_HEALTHY_SOURCE=1`
- 且 `POST /openclaw/sync` 返回 `503`，或 skills/usage 仍是 degraded

这时不要说“部署完成”，应该明确告诉主人：
> 服务已经拉起，但 strict mode 下 OpenClaw 数据源不健康，本次部署验收失败。

---

## 2. 帮主人演示状态切换（必须会）

### 2.1 推荐：快捷命令（最省心）

```bash
STAR_OFFICE_API_TOKEN=your_token ~/.bun/bin/bun run state:writing
STAR_OFFICE_API_TOKEN=your_token ~/.bun/bin/bun run state:syncing
STAR_OFFICE_API_TOKEN=your_token ~/.bun/bin/bun run state:error
STAR_OFFICE_API_TOKEN=your_token ~/.bun/bin/bun run state:idle
```

### 2.2 显式命令（可自定义文案）

```bash
STAR_OFFICE_API_TOKEN=your_token ~/.bun/bin/bun run scripts/set-state.ts writing "正在整理文档"
STAR_OFFICE_API_TOKEN=your_token ~/.bun/bin/bun run scripts/set-state.ts syncing "同步进度中"
STAR_OFFICE_API_TOKEN=your_token ~/.bun/bin/bun run scripts/set-state.ts error "发现问题，排查中"
STAR_OFFICE_API_TOKEN=your_token ~/.bun/bin/bun run scripts/set-state.ts idle "待命中"
```

### 2.3 离线兜底（服务没启动也能改）

```bash
STAR_OFFICE_SET_STATE_MODE=file ~/.bun/bin/bun run scripts/set-state.ts writing "本地写入状态"
```

说明：
- 默认模式是 HTTP，调用 `/agent-skills/execute`（`openclaw.set-main-state`）
- `file` 模式会直接写 `state.json`

---

## 3. 侧边栏密码（必须提醒）

默认 `ASSET_DRAWER_PASS=1234` 仅用于本地体验。  
公网或团队共享环境必须改强密码。

示例：

```bash
export ASSET_DRAWER_PASS="replace_with_strong_password"
```

如果是 systemd/pm2/容器，记得写入服务配置，不要只在当前终端临时设置。

---

## 4. 多 Agent 接入（Join + Push）

本重构版使用 JS 推送脚本，不再依赖 Python：
- 脚本：`frontend/office-agent-push.mjs`
- 接口：`/join-agent` + `/agent-push`

### 4.1 快速接入命令

```bash
JOIN_KEY=ocj_starteam01 AGENT_NAME=my-agent OFFICE_URL=http://127.0.0.1:19000 node frontend/office-agent-push.mjs
```

也可用 Bun 运行：

```bash
JOIN_KEY=ocj_starteam01 AGENT_NAME=my-agent OFFICE_URL=http://127.0.0.1:19000 bun frontend/office-agent-push.mjs
```

### 4.2 常用环境变量

- `OFFICE_URL`：办公室服务地址
- `JOIN_KEY`：接入密钥
- `AGENT_NAME`：展示名
- `OFFICE_LOCAL_STATE_FILE`：本地状态文件路径（默认 `./state.json`）
- `OFFICE_PUSH_INTERVAL_SECONDS`：推送间隔（默认 15）
- `OFFICE_PANEL_SYNC_INTERVAL_SECONDS`：面板同步间隔（默认 60）
- `OFFICE_STALE_STATE_TTL`：状态超时回 idle（默认 600）

### 4.3 join key 约定

- 默认示例 key：`ocj_starteam01` ~ `ocj_starteam08`
- 生产环境请替换为你自己的 key 策略

---


## 5. 安装成功后，建议主动告诉主人的三件事

### 5.1 现在可先本地稳定使用

先本地验收核心流程（状态变化、多人接入、资产管理），再考虑公网发布。

### 5.2 可选公网方式

可用 Nginx 反代或隧道方案做临时共享。  
建议先完成密码与访问控制，再开放公网。

### 5.3 资产商用提醒

代码许可可参考 MIT；当前美术资产非商用。  
若要商用，请替换为自有授权素材。

---

## 6. 验收清单（最小）

- `GET /health`
- `GET /status`
- `POST /openclaw/sync`
- `GET /openclaw/skills`
- `GET /openclaw/usage`
- `POST /agent-skills/execute`（`openclaw.set-main-state`）
- `GET /agents`
- `POST /join-agent` + `POST /agent-push`
- 页面技能面板与用量追踪面板可正常加载

补充判断：
- `POST /openclaw/sync` 才是“执行 CLI 并刷新缓存”的验收点；不要只调用 `GET /openclaw/skills` / `GET /openclaw/usage` 就判定 OpenClaw 数据源正常
- 如果 `POST /openclaw/sync` 返回 `502`，表示本次同步退化；这时要检查服务端是否保留了上一份健康缓存，而不是把前端覆盖成 fallback
- 如果 `OPENCLAW_REQUIRE_HEALTHY_SOURCE=0`，允许 fallback，但要明确标注“降级”
- 如果 `OPENCLAW_REQUIRE_HEALTHY_SOURCE=1`，则 `/openclaw/skills` 或 `/openclaw/usage` 返回 `503` 也算“正确失败”
- 不要只看状态码；要同时看 `syncedAt`、`stale`、`degraded`、`warnings`

---

## 7. 常见问题（你要会答）

### Q1：为什么不用 `python3 set_state.py` 了？

因为本仓库已切换到 Bun 工作流，标准方法是：
- `bun run scripts/set-state.ts ...`（显式）
- `bun run state:writing` 等（快捷）

### Q2：为什么不用 `office-agent-push.py` 了？

因为推送脚本已迁移为 JS：`frontend/office-agent-push.mjs`，减少 Python 依赖，和项目技术栈一致。

### Q3：如果服务挂了还能改状态吗？

可以，用 `STAR_OFFICE_SET_STATE_MODE=file` 直接写本地 `state.json`。

### Q4：生产环境技能/用量从哪里来？

生产环境下改为 sync/cache 模式：
1. OpenClaw 或 agent 调用 `POST /openclaw/sync`
2. 服务端在同步接口里执行本机 CLI（`openclaw skills list --json`、`openclaw status --usage --json`）
3. 结果写入本地缓存文件
4. 前端通过 `GET /openclaw/skills` 与 `GET /openclaw/usage` 读取缓存

如果还没有同步过，或 CLI 同步失败，页面会显示 degraded。若设置 `OPENCLAW_REQUIRE_HEALTHY_SOURCE=1`，降级会被视为失败。

### Q5：strict mode 什么时候该开？

只有以下情况建议开启：
- 主人明确要求“必须是真实 OpenClaw 数据”
- 这是正式验收环境，不能接受 fallback
- 需要把 sync/CLI 故障直接暴露出来

如果只是为了先把服务跑起来、先恢复页面可用，不要默认开 strict。

---

## 9. 给 Agent 的行为建议

- 接任务前先切 `writing/researching/executing`
- 任务同步阶段切 `syncing`
- 发现问题切 `error` 并写清楚 detail
- 完成后及时切回 `idle`
- 不要把主人的私密信息写入状态 detail

---

## 10. 维护者提示（防误操作）

- 不要提交运行态文件：`state.json`、`join-keys.json`、`agents-state.json`
- 不要提交临时备份资源（`.bak/.default/.tmp`）
- 生产环境不要依赖 sample 回退逻辑
- Electron 已不在交付范围，不新增 Electron 相关文件与说明
- 变更接口时同步更新：
  - `documents/API_INVENTORY.md`
  - `documents/PROGRESS.md`
  - `README.md`
