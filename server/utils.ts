import { promises as fs } from "node:fs";
import { PATHS, STATE_TO_AREA_MAP, VALID_AGENT_STATES, WORKING_STATES } from "./config";
import type { Agent, MainState } from "./types";

export function normalizeAgentState(state: string) {
  const s = (state || "").trim();
  if (VALID_AGENT_STATES.has(s)) return s;
  if (s === "busy") return "writing";
  if (s === "thinking") return "researching";
  if (s === "running") return "executing";
  return "idle";
}

export function stateToArea(state: string) {
  return STATE_TO_AREA_MAP[state] || "breakroom";
}

export async function readOfficeNameFromIdentity(): Promise<string | null> {
  try {
    const content = await fs.readFile(PATHS.identityFile, "utf-8");
    const match = content.match(/-\s*\*\*Name:\*\*\s*(.+)/);
    if (!match) return null;
    const name = match[1].trim().replace(/\r/g, "").split("\n")[0].trim();
    if (!name) return null;
    return `${name}的办公室`;
  } catch {
    return null;
  }
}

export function applyAutoIdle(state: MainState): MainState {
  try {
    const ttl = Number(state.ttl_seconds ?? 300);
    const updatedAt = state.updated_at;
    const s = state.state;
    if (!updatedAt || !WORKING_STATES.has(s)) return state;
    const dt = new Date(updatedAt);
    if (Number.isNaN(dt.getTime())) return state;
    const ageSeconds = (Date.now() - dt.getTime()) / 1000;
    if (ageSeconds <= ttl) return state;
    return {
      ...state,
      state: "idle",
      detail: "待命中（自动回到休息区）",
      progress: 0,
      updated_at: new Date().toISOString()
    };
  } catch {
    return state;
  }
}

export const DEFAULT_AGENTS: Agent[] = [
  {
    agentId: "star",
    name: "Star",
    isMain: true,
    state: "idle",
    detail: "待命中，随时准备为你服务",
    updated_at: new Date().toISOString(),
    area: "breakroom",
    source: "local",
    joinKey: null,
    authStatus: "approved",
    authExpiresAt: null,
    lastPushAt: null
  }
];
