---
name: star-office-ui-bun
description: Star Office UI（Bun 重构版）一键化 Skill：帮助主人快速部署办公室看板、统一状态同步、接入多 Agent 推送，并完成上线前安全检查。
---

# Star Office UI Bun Skill

本 Skill 面向在本仓库协作的 Agent（龙虾），目标是：
- 尽量少打扰主人，优先“先跑起来，再优化”
- 用 Bun + JS 工作流统一状态同步与多 Agent 接入流程
- 提供标准化的状态切换与多 Agent 接入方法

---

## 0. 一句话告诉主人这是什么

你可以先和主人说：
> 这是一个多人协作的像素办公室看板，AI 助手会根据状态自动移动，还能展示昨日小记和多人在线状态。

---

## 1. 30 秒一键启动（建议先帮主人跑一遍）

在项目根目录执行：

```bash
# 1) 下载仓库并进入目录
git clone git@github.com:Ming900907/star-office-ui-bun-refactor.git
cd star-office-ui-bun-refactor

# 2) 安装依赖
~/.bun/bin/bun install

# 3) 初始化配置与状态文件
cp .env.example .env
cp state.sample.json state.json
cp join-keys.sample.json join-keys.json

# 4) 生产环境务必设置安全项（本地体验可跳过）
export ASSET_DRAWER_PASS="replace_with_strong_password"
export STAR_OFFICE_API_TOKEN="replace_with_long_random_token"
export STAR_OFFICE_ENV=production

# 5) 启动 Bun 服务
~/.bun/bin/bun run server/index.ts
```

完成后告诉主人：
> 现在打开 http://127.0.0.1:19000 就能看到像素办公室。

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
- 默认模式是 HTTP，调用 `/set_state`
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
- `OFFICE_STALE_STATE_TTL`：状态超时回 idle（默认 600）

### 4.3 join key 约定

- 默认示例 key：`ocj_starteam01` ~ `ocj_starteam08`
- 生产环境请替换为你自己的 key 策略

---

## 5. 当前版本与 upstream 的差异（对外口径）

- 后端从 Flask 重构为 Bun（TypeScript）
- Gemini 生图链路已移除（本项目不实现生图）
- Electron 暂缓，不是本阶段交付条件
- 状态切换与 Agent 推送已改为 Bun/JS 工作流

---

## 6. 安装成功后，建议主动告诉主人的三件事

### 6.1 现在可先本地稳定使用

先本地验收核心流程（状态变化、多人接入、资产管理），再考虑公网发布。

### 6.2 可选公网方式

可用 Nginx 反代或隧道方案做临时共享。  
建议先完成密码与访问控制，再开放公网。

### 6.3 资产商用提醒

代码许可可参考 MIT；当前美术资产非商用。  
若要商用，请替换为自有授权素材。

---

## 7. 验收清单（最小）

- `GET /health`
- `GET /status`
- `POST /set_state`
- `GET /agents`
- `POST /join-agent` + `POST /agent-push`
- `GET /assets/list`
- 基础上传/恢复流程可用

---

## 8. 常见问题（你要会答）

### Q1：为什么不用 `python3 set_state.py` 了？

因为本仓库已切换到 Bun 工作流，标准方法是：
- `bun run scripts/set-state.ts ...`（显式）
- `bun run state:writing` 等（快捷）

### Q2：为什么不用 `office-agent-push.py` 了？

因为推送脚本已迁移为 JS：`frontend/office-agent-push.mjs`，减少 Python 依赖，和项目技术栈一致。

### Q3：如果服务挂了还能改状态吗？

可以，用 `STAR_OFFICE_SET_STATE_MODE=file` 直接写本地 `state.json`。

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
- 变更接口时同步更新：
  - `documents/API_INVENTORY.md`
  - `documents/PROGRESS.md`
  - `README.md`
