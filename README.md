# Star Office UI (Bun Refactor)

A Bun-based backend refactor of **Star Office UI** (pixel-art AI office dashboard). This repo keeps the original frontend and API behavior while removing Gemini image-generation paths.

## Status
- Core non‑gen API + storage layer: **done**
- Frontend entry (non‑gen): **done**
- Regression checks: **done (manual)**
- OpenClaw skills + usage panel: **done**
- Production upstream source integration: **done**

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
- Remaining work focuses on cleanup/hardening and production monitoring.

## OpenClaw Auto Bootstrap (Production)
Use one command to let OpenClaw finish deployment config automatically:

```bash
~/.bun/bin/bun run bootstrap:prod
```

Behavior:
- create/patch `.env`
- initialize `state.json` / `join-keys.json` if missing
- enforce production-required settings
- validate `/health`, `/status`, `/openclaw/skills`, `/openclaw/usage`

## Environment
- `PORT` (default `19000`)
- `HOST` (default `127.0.0.1`)
- `ASSET_DRAWER_PASS` (default `1234`)
- `STAR_OFFICE_ENV` (`development` or `production`)
- `STAR_OFFICE_API_TOKEN` (required in `production`)
- `ENABLE_STATE_CONTROL` (`0` by default; legacy `/set_state`)
- `ENABLE_ASSET_DECORATION` (`0` by default; legacy `/assets/*`)
- `ENABLE_AGENT_SKILLS_API` (`1` by default; `/agent-skills/*`)
- `OPENCLAW_SKILLS_SOURCE_URL` (optional upstream for `/openclaw/skills`)
- `OPENCLAW_USAGE_SOURCE_URL` (optional upstream for `/openclaw/usage`)
- `OPENCLAW_SOURCE_TOKEN` (optional bearer token for upstream calls)
- `OPENCLAW_BIN` (default `openclaw`, used for local CLI fallback)
- See `.env.example` for a full template.

## Agent Skills API
- `GET /openclaw/skills` (read-only catalog for UI)
- `POST /agent-skills/list`
- `POST /agent-skills/execute`

Default behavior now disables legacy status/decorate entry points in favor of agent skills.
`/openclaw/skills` and `/openclaw/usage` resolve by priority:
1. configured upstream URL (if set)
2. local OpenClaw CLI (`openclaw skills list --json`, `openclaw status --usage --json`)
3. local fallback estimation

## Security Notes (VPS)
- In production mode (`STAR_OFFICE_ENV=production`), startup will fail if `ASSET_DRAWER_PASS` is default or `STAR_OFFICE_API_TOKEN` is missing.
- Sensitive write APIs (`/set_state`, `/agent-approve`, `/agent-reject`, `/leave-agent`) require `Authorization: Bearer <STAR_OFFICE_API_TOKEN>`.
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

## Data Files
See `documents/DATA_FILES.md`.

## API (Non‑Gen)
See `documents/API_INVENTORY.md`.

## VPS Deployment (OpenClaw)
See `documents/OPENCLAW_INTEGRATION.md` for systemd + Nginx + multi‑agent push guidance.

## License & Assets
Upstream code is MIT, art assets are **non-commercial** only. Replace assets for commercial use.
