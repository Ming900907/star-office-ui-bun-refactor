# Repository Guidelines

## Project Structure & Module Organization
- `server/` contains the Bun backend (routing, storage, utilities).
- `frontend/` contains the static UI (HTML, JS, and assets referenced by the backend).
- `assets/` stores shared image resources and background references.
- `storage/` is reserved for runtime data if you choose to separate state files from repo root.
- Root JSON files (`state.json`, `agents-state.json`, `join-keys.json`, `asset-positions.json`, `asset-defaults.json`) represent persisted runtime state.
- `documents/` contains planning, progress, and design notes.
- `upstream/` mirrors the original Python project for reference only.

## Build, Test, and Development Commands
- `~/.bun/bin/bun run server/index.ts` runs the backend directly.
- `~/.bun/bin/bun run dev` runs the same entrypoint via `package.json`.
- `PORT=19001 ~/.bun/bin/bun run server/index.ts` runs on a custom port.

## Coding Style & Naming Conventions
- TypeScript, ESM modules, 2-space indentation.
- Filenames use `kebab-case` only when mirroring original assets; otherwise prefer `lowercase` or `camelCase` for TS files.
- Routes should stay API-compatible with the original backend (see `documents/API_INVENTORY.md`).
- Keep file IO in `server/storage.ts` and route logic in `server/router.ts`.

## Testing Guidelines
- No automated tests yet. If you add tests, keep them in `server/__tests__/` and name files `*.test.ts`.
- Minimum manual checks: `GET /health`, `GET /status`, `GET /assets/list`, and basic asset upload/restore flows.

## Commit & Pull Request Guidelines
- No established commit convention in this repo. Use concise, imperative subjects (e.g., "Add assets upload endpoint").
- PRs should include a short summary, affected endpoints, and any new environment variables.
- Include screenshots for UI changes in `frontend/`.

## Security & Configuration Tips
- Set `ASSET_DRAWER_PASS` in your environment for asset editing auth.
- Avoid committing real `join-keys.json` or state files with personal data.
