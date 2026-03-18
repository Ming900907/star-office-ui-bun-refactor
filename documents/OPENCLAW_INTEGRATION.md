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
- `state.json` / `join-keys.json` 生产安全初始化
- 调用 `POST /openclaw/sync`，由服务端执行本机 CLI 并刷新缓存
- `/health`、`/status`、`/openclaw/skills`、`/openclaw/usage` 验收
- 若设置 strict 模式，则在 skills/usage 处于 degraded 时直接失败

## 方案 A：同机（OpenClaw 与 Office 同 VPS）
1. 启动 Bun 后端（systemd）
2. 反代 `/` 到 Bun
3. OpenClaw 通过 `POST /openclaw/sync` 触发服务端执行本机 CLI 并刷新缓存
4. Office 前端通过 `/openclaw/skills` 与 `/openclaw/usage` 读取缓存结果

注意：
- `POST /openclaw/sync` 才是 CLI 拉取入口；两个 GET 面板接口都不会主动执行 CLI。
- 如果本次 sync 退化，服务端会返回失败，并在存在健康缓存时保留上一份有效缓存，避免前端被 fallback 覆盖。

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
Environment=STAR_OFFICE_API_TOKEN=your-long-random-token
Environment=OPENCLAW_BIN=openclaw
Environment=OPENCLAW_CACHE_STALE_SECONDS=120
Environment=OPENCLAW_REQUIRE_HEALTHY_SOURCE=0
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
- `OFFICE_PANEL_SYNC_INTERVAL_SECONDS`：OpenClaw 面板同步间隔（秒，默认 60）
- `OPENCLAW_BIN`：OpenClaw 可执行文件名或路径（默认 `openclaw`）
- `OPENCLAW_CACHE_STALE_SECONDS`：skills/usage 缓存过期阈值
- `OPENCLAW_REQUIRE_HEALTHY_SOURCE`：`1` 时要求 skills/usage 必须是健康 source，fallback 直接视为失败

### 严格模式选择
- degraded-tolerant：`OPENCLAW_REQUIRE_HEALTHY_SOURCE=0`
  适合先把服务跑起来，允许暂时使用 fallback 或未同步缓存。
- strict：`OPENCLAW_REQUIRE_HEALTHY_SOURCE=1`
  适合正式生产验收，要求缓存必须来自健康的 CLI 同步结果。

## 最小验证
- `GET /health` / `GET /status`
- `POST /join-agent` → `POST /agent-push` → `POST /openclaw/sync`
- `GET /openclaw/skills` / `GET /openclaw/usage`（检查 `syncedAt`、`stale`、`degraded`、`warnings`）
- 页面能看到状态变化

验收解释：
- `POST /openclaw/sync=200`：本次 CLI 同步健康
- `POST /openclaw/sync=502`：本次 CLI 同步退化，但 strict 未开启；应继续检查是否保留了旧缓存
- `POST /openclaw/sync=503`：strict 模式下拒绝降级同步
