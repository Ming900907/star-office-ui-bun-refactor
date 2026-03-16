import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");

export const PATHS = {
  projectRoot: PROJECT_ROOT,
  serverRoot: path.resolve(PROJECT_ROOT, "server"),
  frontendRoot: path.resolve(PROJECT_ROOT, "frontend"),
  memoryDir: path.resolve(PROJECT_ROOT, "memory"),
  stateFile: path.resolve(PROJECT_ROOT, "state.json"),
  agentsStateFile: path.resolve(PROJECT_ROOT, "agents-state.json"),
  joinKeysFile: path.resolve(PROJECT_ROOT, "join-keys.json"),
  assetPositionsFile: path.resolve(PROJECT_ROOT, "asset-positions.json"),
  assetDefaultsFile: path.resolve(PROJECT_ROOT, "asset-defaults.json"),
  assetsDir: path.resolve(PROJECT_ROOT, "assets"),
  homeFavoritesDir: path.resolve(PROJECT_ROOT, "assets", "home-favorites"),
  homeFavoritesIndexFile: path.resolve(PROJECT_ROOT, "assets", "home-favorites", "index.json"),
  assetsTemplateZip: path.resolve(PROJECT_ROOT, "assets-replace-template.zip"),
  identityFile: path.resolve(process.env.HOME || "", ".openclaw", "workspace", "IDENTITY.md")
};

export const SERVER = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 19000),
  assetDrawerPass: process.env.ASSET_DRAWER_PASS || "1234"
};

export const FLAGS = {
  autoRotateHomeOnOpen: ["1", "true", "yes", "on"].includes((process.env.AUTO_ROTATE_HOME_ON_PAGE_OPEN || "0").toLowerCase()),
  autoRotateMinIntervalSeconds: Number(process.env.AUTO_ROTATE_MIN_INTERVAL_SECONDS || 60)
};

export const VALID_AGENT_STATES = new Set(["idle", "writing", "researching", "executing", "syncing", "error"]);
export const WORKING_STATES = new Set(["writing", "researching", "executing"]);
export const STATE_TO_AREA_MAP: Record<string, string> = {
  idle: "breakroom",
  writing: "writing",
  researching: "writing",
  executing: "writing",
  syncing: "writing",
  error: "error"
};
