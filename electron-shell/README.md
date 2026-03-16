# Star Office UI (Electron Shell)

这个目录是 Electron 版桌面壳，用于在 Bun 后端重构后继续提供桌面壳能力。

## 已接入能力

- 复用前端：`http://127.0.0.1:19000/?desktop=1`
- 优先使用 `desktop-pet/src/minimized.html`，不存在则退化为 `/electron-standalone?mini=1`
- 启动时自动拉起 Bun backend（若未运行）
- 主窗口 / mini 窗口切换
- 托盘（menu bar）常驻菜单
- 通过 preload 注入 `window.__TAURI__` 兼容层，尽量少改现有前端逻辑

## 启动方式

```bash
cd "/path/to/star-office-ui-bun-refactor/electron-shell"
npm install
npm run dev
```

## 可选环境变量

- `STAR_PROJECT_ROOT`：项目根目录（默认自动探测）
- `STAR_BACKEND_BUN`：Bun 可执行路径
- `BUN_BIN`：Bun 可执行路径（备用）
- `STAR_BACKEND_HOST`：后端主机（默认 `127.0.0.1`）
- `STAR_BACKEND_PORT`：后端端口（默认 `19000`）

## 说明

- 当前阶段是“可运行迁移骨架”，目的是先替换桌面容器层。
- 若需要完整 mini 窗口，请补齐 `desktop-pet/src/minimized.html` 资源。
