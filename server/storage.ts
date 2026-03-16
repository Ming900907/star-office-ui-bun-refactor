import { promises as fs } from "node:fs";
import path from "node:path";
import { PATHS } from "./config";
import type { Agent, AssetDefaults, AssetPositions, JoinKeysFile, MainState } from "./types";

const writeQueue: Record<string, Promise<void>> = {};

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  await fs.writeFile(tmp, payload, "utf-8");
  await fs.rename(tmp, filePath);
}

async function enqueueWrite(filePath: string, data: unknown) {
  const prev = writeQueue[filePath] || Promise.resolve();
  const next = prev.then(() => writeJsonAtomic(filePath, data));
  writeQueue[filePath] = next.catch(() => undefined);
  return next;
}

export async function loadState(): Promise<MainState> {
  const fallback: MainState = {
    state: "idle",
    detail: "等待任务中...",
    progress: 0,
    updated_at: new Date().toISOString()
  };
  const loaded = await readJson<MainState>(PATHS.stateFile);
  if (!loaded || typeof loaded !== "object") return fallback;
  return { ...fallback, ...loaded };
}

export async function saveState(state: MainState) {
  await enqueueWrite(PATHS.stateFile, state);
}

export async function loadAgentsState(defaultAgents: Agent[]): Promise<Agent[]> {
  const loaded = await readJson<Agent[]>(PATHS.agentsStateFile);
  if (Array.isArray(loaded)) return loaded;
  return [...defaultAgents];
}

export async function saveAgentsState(agents: Agent[]) {
  await enqueueWrite(PATHS.agentsStateFile, agents);
}

export async function loadJoinKeys(): Promise<JoinKeysFile> {
  const loaded = await readJson<JoinKeysFile>(PATHS.joinKeysFile);
  if (loaded && Array.isArray(loaded.keys)) return loaded;
  return { keys: [] };
}

export async function saveJoinKeys(data: JoinKeysFile) {
  await enqueueWrite(PATHS.joinKeysFile, data);
}

export async function loadAssetPositions(): Promise<AssetPositions> {
  const loaded = await readJson<AssetPositions>(PATHS.assetPositionsFile);
  if (loaded && typeof loaded === "object") return loaded;
  return {};
}

export async function saveAssetPositions(data: AssetPositions) {
  await enqueueWrite(PATHS.assetPositionsFile, data);
}

export async function loadAssetDefaults(): Promise<AssetDefaults> {
  const loaded = await readJson<AssetDefaults>(PATHS.assetDefaultsFile);
  if (loaded && typeof loaded === "object") return loaded;
  return {};
}

export async function saveAssetDefaults(data: AssetDefaults) {
  await enqueueWrite(PATHS.assetDefaultsFile, data);
}

export async function ensureHomeFavoritesIndex() {
  await ensureDir(PATHS.homeFavoritesDir);
  try {
    await fs.access(PATHS.homeFavoritesIndexFile);
  } catch {
    await enqueueWrite(PATHS.homeFavoritesIndexFile, { items: [] });
  }
}

export async function loadHomeFavoritesIndex(): Promise<{ items: any[] }> {
  await ensureHomeFavoritesIndex();
  const loaded = await readJson<{ items: any[] }>(PATHS.homeFavoritesIndexFile);
  if (loaded && Array.isArray(loaded.items)) return loaded;
  return { items: [] };
}

export async function saveHomeFavoritesIndex(data: { items: any[] }) {
  await enqueueWrite(PATHS.homeFavoritesIndexFile, data);
}
