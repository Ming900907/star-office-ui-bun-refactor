# OpenClaw 集成（VPS 指引）

## 目标
- OpenClaw 在 VPS 上运行，状态驱动 Star Office UI
- 多 Agent 通过 `join-agent`/`agent-push` 接入

## 前提
- VPS 已部署本项目（Bun 后端可访问）
- HTTPS 反代（建议）

## 方案 A：同机（OpenClaw 与 Office 同 VPS）
1. 启动 Bun 后端（systemd）
2. 反代 `/` 到 Bun
3. OpenClaw 写入 `state.json`
4. Office 读取 `state.json` 并展示主 Agent

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
每台 OpenClaw 机器运行 `office-agent-push.py`：
1. 设置 `OFFICE_URL=https://office.example.com`
2. 选择 join key：`ocj_starteam01~08`
3. 运行脚本（先 join 后 push）

推荐环境变量：
- `OFFICE_URL`：Office 地址
- `OFFICE_LOCAL_STATE_FILE`：OpenClaw `state.json` 路径
- `OFFICE_STALE_STATE_TTL`：状态过期回 idle（秒）
- `OFFICE_VERBOSE=1`：调试输出

## 最小验证
- `GET /health` / `GET /status`
- `POST /join-agent` → `POST /agent-push`
- 页面能看到状态变化
