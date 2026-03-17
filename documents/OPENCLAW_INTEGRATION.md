# OpenClaw 集成（VPS 指引）

## 目标
- OpenClaw 在 VPS 上运行，状态驱动 Star Office UI
- 多 Agent 通过 `join-agent`/`agent-push` 接入

## 前提
- VPS 已部署本项目（Bun 后端可访问）
- HTTPS 反代（建议）

## 推荐部署方式（自动配置）
优先使用：

```bash
~/.bun/bin/bun run bootstrap:prod
```

该命令会自动完成：
- `.env` 创建与生产字段校验
- `state.json` / `join-keys.json` 初始化
- OpenClaw source/CLI 可用性校验
- `/health`、`/status`、`/openclaw/skills`、`/openclaw/usage` 验收

## 方案 A：同机（OpenClaw 与 Office 同 VPS）
1. 启动 Bun 后端（systemd）
2. 反代 `/` 到 Bun
3. OpenClaw 通过本机 CLI（或可选 source API）提供技能与用量数据
4. Office 通过 `/openclaw/skills` 与 `/openclaw/usage` 展示

### systemd 示例
保存为 `/etc/systemd/system/star-office-ui.service`：
```ini
[Unit]
Description=Star Office UI (Bun)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/star-office-ui-bun-refactor
Environment=PORT=19000
Environment=HOST=127.0.0.1
Environment=ASSET_DRAWER_PASS=your-strong-pass
Environment=STAR_OFFICE_ENV=production
Environment=OPENCLAW_BIN=openclaw
# Optional upstream:
# Environment=OPENCLAW_SKILLS_SOURCE_URL=https://your-openclaw-api.example.com/skills
# Environment=OPENCLAW_USAGE_SOURCE_URL=https://your-openclaw-api.example.com/usage
# Environment=OPENCLAW_SOURCE_TOKEN=your-upstream-bearer-token
ExecStart=/root/.bun/bin/bun run server/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
启动：
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now star-office-ui
```

### Nginx 反代示例
```nginx
server {
  listen 443 ssl;
  server_name office.example.com;

  location / {
    proxy_pass http://127.0.0.1:19000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## 方案 B：多机 / 多 Agent
每台 OpenClaw 机器运行 `office-agent-push.mjs`：
1. 设置 `OFFICE_URL=https://office.example.com`
2. 选择 join key：`ocj_starteam01~08`
3. 运行脚本（先 join 后 push）
```bash
JOIN_KEY=ocj_starteam01 AGENT_NAME=my-agent OFFICE_URL=https://office.example.com node frontend/office-agent-push.mjs
```

推荐环境变量：
- `OFFICE_URL`：Office 地址
- `JOIN_KEY`：接入密钥（如 `ocj_starteam01~08`）
- `AGENT_NAME`：展示名
- `OFFICE_LOCAL_STATE_FILE`：OpenClaw `state.json` 路径
- `OFFICE_STALE_STATE_TTL`：状态过期回 idle（秒）
- `OPENCLAW_BIN`：OpenClaw 可执行文件名或路径（默认 `openclaw`）
- `OPENCLAW_SKILLS_SOURCE_URL`：Office 技能面板上游（可选）
- `OPENCLAW_USAGE_SOURCE_URL`：Office 用量面板上游（可选）
- `OPENCLAW_SOURCE_TOKEN`：上游鉴权 token（可选）

## 最小验证
- `GET /health` / `GET /status`
- `GET /openclaw/skills` / `GET /openclaw/usage`（应返回可用 source，不再强制 upstream）
- `POST /join-agent` → `POST /agent-push`
- 页面能看到状态变化
