# Star Office UI (Bun Refactor)

A Bun-based backend refactor of **Star Office UI** (pixel-art AI office dashboard). This repo keeps the original frontend and API behavior while removing Gemini image-generation paths.

## Status
- Core non‑gen API + storage layer: **done**
- Frontend entry (non‑gen): **done**
- Regression checks: **done (manual)**
- OpenClaw skills + usage panel: **done**
- Production sync/cache integration: **done**

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
- `bootstrap:prod` no longer seeds production from sample files; it creates production-safe defaults instead.

## Quick Start (Bun)
```bash
# 1) install deps (bun runtime required)
~/.bun/bin/bun install

# 2) init env + state files (first run)
cp .env.example .env
cp state.sample.json state.json
cp join-keys.sample.json join-keys.json

# 3) start server
~/.bun/bin/bun run server/index.ts
```
Open: `http://127.0.0.1:19000`

## Progress Snapshot (2026-03-16)
- Production deploy path is available and validated via `bootstrap:prod`.
- Legacy status/decorate operations are migrated to `agent-skills` workflow.
- Main UI now focuses on OpenClaw skills and usage tracking.
- Skills/usage now use OpenClaw sync -> server cache -> frontend read flow.
- Remaining work focuses on cleanup/hardening and production monitoring.

## OpenClaw Auto Bootstrap (Production)
Use one command to let OpenClaw finish deployment config automatically:

```bash
~/.bun/bin/bun run bootstrap:prod
```

Behavior:
- create/patch `.env`
- initialize `state.json` / `join-keys.json` with production-safe defaults if missing
- enforce production-required settings
- call `POST /openclaw/sync` so the server executes local OpenClaw CLI and refreshes panel cache
- validate `/health`, `/status`, `/openclaw/skills`, `/openclaw/usage`
- report whether the latest sync is healthy or degraded, and whether cached panels are still fresh
- optionally fail bootstrap when degraded panel data is not acceptable (`OPENCLAW_REQUIRE_HEALTHY_SOURCE=1`)

## Environment
- `PORT` (default `19000`)
- `HOST` (default `127.0.0.1`)
- `ASSET_DRAWER_PASS` (default `1234`)
- `STAR_OFFICE_ENV` (`development` or `production`)
- `STAR_OFFICE_API_TOKEN` (required in `production`)
- `ENABLE_STATE_CONTROL` (`0` by default; legacy `/set_state`)
- `ENABLE_ASSET_DECORATION` (`0` by default; legacy `/assets/*`)
- `ENABLE_AGENT_SKILLS_API` (`1` by default; `/agent-skills/*`)
- `OPENCLAW_BIN` (default `openclaw`, used when the server executes CLI during sync)
- `OPENCLAW_CACHE_STALE_SECONDS` (default `120`, panel cache staleness threshold)
- `OPENCLAW_REQUIRE_HEALTHY_SOURCE` (`0` by default; when `1`, degraded skills/usage are treated as failure)
- `OFFICE_PANEL_SYNC_INTERVAL_SECONDS` (default `60`, agent-side panel sync interval)
- See `.env.example` for a full template.

## Agent Skills API
- `GET /openclaw/skills` (read-only catalog for UI)
- `GET /openclaw/usage` (read-only usage snapshot for UI)
- `POST /openclaw/sync` (OpenClaw/agent triggers CLI sync and refreshes cached panel data)
- `POST /agent-skills/list`
- `POST /agent-skills/execute`

Default behavior now disables legacy status/decorate entry points in favor of agent skills.
`/openclaw/skills` and `/openclaw/usage` now read cached snapshots.
OpenClaw refreshes those snapshots through `POST /openclaw/sync`, and the server executes local CLI commands during that sync.

Production policy options:
1. degraded-tolerant: keep `OPENCLAW_REQUIRE_HEALTHY_SOURCE=0` and allow fallback mode
2. strict: set `OPENCLAW_REQUIRE_HEALTHY_SOURCE=1` and fail bootstrap / panel requests when cached panel data is degraded

Sync semantics:
- `POST /openclaw/sync` is the only endpoint that executes local OpenClaw CLI.
- `GET /openclaw/skills` and `GET /openclaw/usage` only read cached snapshots for the UI.
- If a sync attempt is degraded, the server now preserves the previous healthy cache when available and returns a sync failure instead of silently overwriting the panel with fallback data.

## Security Notes (VPS)
- In production mode (`STAR_OFFICE_ENV=production`), startup will fail if `ASSET_DRAWER_PASS` is default or `STAR_OFFICE_API_TOKEN` is missing.
- Sensitive admin APIs (`/set_state`, `/agent-approve`, `/agent-reject`) require `Authorization: Bearer <STAR_OFFICE_API_TOKEN>`.
- `/agents` output is sanitized and no longer exposes `joinKey`.
- Basic in-memory rate limiting is enabled for `/assets/auth` and `/join-agent`.

## Agent State Commands
```bash
~/.bun/bin/bun run state:writing
~/.bun/bin/bun run state:syncing
~/.bun/bin/bun run state:error
~/.bun/bin/bun run state:idle
```

Equivalent explicit command:
```bash
export STAR_OFFICE_API_TOKEN=your_token
~/.bun/bin/bun run scripts/set-state.ts writing "正在整理文档"
```

## Agent Push Script (JS)
Use `frontend/office-agent-push.mjs` for join + periodic push (no Python dependency required).
It also triggers `POST /openclaw/sync` on an interval so skills/usage caches stay fresh.

## Data Files
See `documents/DATA_FILES.md`.

## API (Non‑Gen)
See `documents/API_INVENTORY.md`.

## VPS Deployment (OpenClaw)
See `documents/OPENCLAW_INTEGRATION.md` for systemd + Nginx + multi‑agent push guidance.

## License & Assets
Upstream code is MIT, art assets are **non-commercial** only. Replace assets for commercial use.
