# Star Office UI (Bun Refactor)

A Bun-based backend refactor of **Star Office UI** (pixel-art AI office dashboard). This repo keeps the original frontend and API behavior while removing Gemini image-generation paths.

## Status
- Core non‑gen API + storage layer: **done**
- Frontend entry (non‑gen): **done**
- Regression checks: **done (manual)**
- Electron shell: **on hold (not in current delivery scope)**

## Differences vs Upstream
Upstream project (Flask + Phaser) provides multi-agent status visualization, daily memo, asset customization, desktop pet mode, and optional AI room generation.

This refactor:
- Replaces Flask backend with **Bun** (TypeScript)
- **Removes** Gemini image‑generation endpoints and UI入口
- Keeps JSON state files and API paths compatible
- Keeps frontend assets and pages from upstream

## Runtime Data Notes
- This repo contains several sample files for bootstrap/testing, including `state.sample.json`, `join-keys.sample.json`, and `runtime-config.sample.json`.
- Current Bun backend behavior: if `join-keys.json` is missing at startup, it will auto-copy from `join-keys.sample.json`.
- For production deployment, provide real `join-keys.json` and `state.json` explicitly instead of relying on sample defaults.

## Quick Start (Bun)
```bash
# 1) install deps (bun runtime required)
~/.bun/bin/bun install

# 2) init state files (first run)
cp state.sample.json state.json
cp join-keys.sample.json join-keys.json

# 3) start server
~/.bun/bin/bun run server/index.ts
```
Open: `http://127.0.0.1:19000`

## Environment
- `PORT` (default `19000`)
- `HOST` (default `127.0.0.1`)
- `ASSET_DRAWER_PASS` (default `1234`)

## Data Files
See `documents/DATA_FILES.md`.

## API (Non‑Gen)
See `documents/API_INVENTORY.md`.

## VPS Deployment (OpenClaw)
See `documents/OPENCLAW_INTEGRATION.md` for systemd + Nginx + multi‑agent push guidance.

## Electron Shell (Optional)
Electron shell remains in the repo for future use, but verification is currently paused and not part of this stage's acceptance criteria.

## License & Assets
Upstream code is MIT, art assets are **non-commercial** only. Replace assets for commercial use.
