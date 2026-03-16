import { promises as fs } from "node:fs";
import path from "node:path";

const VALID_STATES = new Set(["idle", "writing", "researching", "executing", "syncing", "error"]);

const projectRoot = path.resolve(import.meta.dir, "..");
const stateFile = process.env.STAR_OFFICE_STATE_FILE || path.resolve(projectRoot, "state.json");
const baseUrl = (process.env.STAR_OFFICE_URL || "http://127.0.0.1:19000").replace(/\/+$/, "");
const mode = (process.env.STAR_OFFICE_SET_STATE_MODE || "http").toLowerCase();
const apiToken = (process.env.STAR_OFFICE_API_TOKEN || "").trim();

function usage() {
  console.log("Usage: bun run scripts/set-state.ts <state> [detail]");
  console.log(`Valid states: ${Array.from(VALID_STATES).join(", ")}`);
  console.log("");
  console.log("Examples:");
  console.log("  bun run scripts/set-state.ts writing \"正在整理文档\"");
  console.log("  bun run scripts/set-state.ts syncing \"同步进度中\"");
  console.log("  bun run scripts/set-state.ts error \"发现问题，排查中\"");
  console.log("  bun run scripts/set-state.ts idle \"待命中\"");
  console.log("");
  console.log("Modes:");
  console.log("  STAR_OFFICE_SET_STATE_MODE=http  # call POST /set_state (default)");
  console.log("  STAR_OFFICE_SET_STATE_MODE=file  # write state.json directly");
}

async function setByHttp(state: string, detail: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiToken) headers.Authorization = `Bearer ${apiToken}`;
  const res = await fetch(`${baseUrl}/set_state`, {
    method: "POST",
    headers,
    body: JSON.stringify({ state, detail })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  console.log(`State pushed via API: ${state} - ${detail}`);
}

async function setByFile(state: string, detail: string) {
  let current: Record<string, unknown> = {
    state: "idle",
    detail: "待命中",
    progress: 0
  };

  try {
    const raw = await fs.readFile(stateFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") current = parsed;
  } catch {
    // ignore and create the file on save
  }

  const next = {
    ...current,
    state,
    detail,
    updated_at: new Date().toISOString()
  };

  await fs.writeFile(stateFile, JSON.stringify(next, null, 2), "utf-8");
  console.log(`State written to ${stateFile}: ${state} - ${detail}`);
}

async function main() {
  const [stateArg, ...detailParts] = process.argv.slice(2);
  if (!stateArg) {
    usage();
    process.exit(1);
  }

  const state = stateArg.trim();
  const detail = detailParts.join(" ").trim();

  if (!VALID_STATES.has(state)) {
    console.error(`Invalid state: ${state}`);
    usage();
    process.exit(1);
  }

  if (mode === "file") {
    await setByFile(state, detail);
    return;
  }

  try {
    await setByHttp(state, detail);
  } catch (error) {
    console.error(`API mode failed: ${(error as Error).message}`);
    console.error("Tip: set STAR_OFFICE_SET_STATE_MODE=file to write local state.json directly.");
    process.exit(1);
  }
}

await main();
