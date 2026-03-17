#!/usr/bin/env node
/**
 * Star Office UI - Agent state push script (JS/Bun/Node)
 *
 * Usage:
 *   1) Set env:
 *      OFFICE_URL=http://127.0.0.1:19000
 *      JOIN_KEY=ocj_starteam01
 *      AGENT_NAME=my-agent
 *   2) Run:
 *      node frontend/office-agent-push.mjs
 *      # or
 *      bun frontend/office-agent-push.mjs
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const OFFICE_URL = (process.env.OFFICE_URL || "http://127.0.0.1:19000").replace(/\/+$/, "");
const JOIN_KEY = (process.env.JOIN_KEY || "").trim();
const AGENT_NAME = (process.env.AGENT_NAME || "").trim();
const PUSH_INTERVAL_SECONDS = Number(process.env.OFFICE_PUSH_INTERVAL_SECONDS || 15);
const PANEL_SYNC_INTERVAL_SECONDS = Number(process.env.OFFICE_PANEL_SYNC_INTERVAL_SECONDS || 60);
const STALE_STATE_TTL_SECONDS = Number(process.env.OFFICE_STALE_STATE_TTL || 600);
const LOCAL_STATE_FILE = process.env.OFFICE_LOCAL_STATE_FILE || path.resolve(process.cwd(), "state.json");
const CACHE_FILE = path.resolve(process.cwd(), "office-agent-state.json");

if (!JOIN_KEY || !AGENT_NAME) {
  console.error("Missing JOIN_KEY or AGENT_NAME.");
  console.error("Example:");
  console.error('  JOIN_KEY="ocj_starteam01" AGENT_NAME="my-agent" node frontend/office-agent-push.mjs');
  process.exit(1);
}

const VALID_STATES = new Set(["idle", "writing", "researching", "executing", "syncing", "error"]);

function normalizeState(state) {
  const s = String(state || "").trim().toLowerCase();
  if (VALID_STATES.has(s)) return s;
  if (["working", "busy", "write"].includes(s)) return "writing";
  if (["run", "running", "exec", "execute"].includes(s)) return "executing";
  if (["research", "search"].includes(s)) return "researching";
  if (["sync"].includes(s)) return "syncing";
  return "idle";
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

function ageSeconds(updatedAt) {
  if (!updatedAt) return null;
  const dt = new Date(updatedAt);
  if (Number.isNaN(dt.getTime())) return null;
  return (Date.now() - dt.getTime()) / 1000;
}

async function getLocalState() {
  const data = await readJson(LOCAL_STATE_FILE, { state: "idle", detail: "待命中" });
  const state = normalizeState(data?.state);
  let detail = String(data?.detail || "");

  const age = ageSeconds(data?.updated_at);
  if (age !== null && age > STALE_STATE_TTL_SECONDS) {
    return {
      state: "idle",
      detail: `本地状态超过${STALE_STATE_TTL_SECONDS}s未更新，自动回待命`
    };
  }

  if (!detail) detail = state === "idle" ? "待命中" : "工作中";
  return { state, detail };
}

async function api(pathname, payload) {
  const res = await fetch(`${OFFICE_URL}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    // no-op
  }
  return { ok: res.ok, status: res.status, data, text };
}

async function ensureJoined(local) {
  if (local.joined && local.agentId) return local;
  const resp = await api("/join-agent", {
    name: AGENT_NAME,
    joinKey: JOIN_KEY,
    state: "idle",
    detail: "刚刚加入"
  });

  if (!resp.ok || !resp.data?.ok) {
    throw new Error(`join failed: status=${resp.status} body=${resp.text}`);
  }

  const next = {
    ...local,
    joined: true,
    agentId: resp.data.agentId
  };
  await writeJson(CACHE_FILE, next);
  console.log(`Joined office: agentId=${next.agentId}`);
  return next;
}

async function pushLoop(local) {
  let lastPanelSyncAt = 0;
  while (true) {
    const status = await getLocalState();
    const resp = await api("/agent-push", {
      agentId: local.agentId,
      joinKey: JOIN_KEY,
      name: AGENT_NAME,
      state: status.state,
      detail: status.detail
    });

    if (!resp.ok || !resp.data?.ok) {
      if (resp.status === 403 || resp.status === 404) {
        throw new Error(`push stopped: status=${resp.status}, key expired or removed`);
      }
      console.error(`push failed: status=${resp.status}, body=${resp.text}`);
    } else {
      console.log(`Pushed: ${status.state} - ${status.detail}`);
    }

    if (PANEL_SYNC_INTERVAL_SECONDS > 0 && (!lastPanelSyncAt || ((Date.now() - lastPanelSyncAt) / 1000) >= PANEL_SYNC_INTERVAL_SECONDS)) {
      const syncResp = await api("/openclaw/sync", {
        agentId: local.agentId,
        joinKey: JOIN_KEY,
        scope: "all"
      });
      if (!syncResp.ok && syncResp.status !== 503) {
        console.error(`panel sync failed: status=${syncResp.status}, body=${syncResp.text}`);
      } else {
        const mode = syncResp.data?.ok ? "ok" : "degraded";
        console.log(`Panel sync: ${mode}`);
        lastPanelSyncAt = Date.now();
      }
    }

    await sleep(PUSH_INTERVAL_SECONDS * 1000);
  }
}

const local = await readJson(CACHE_FILE, {
  joined: false,
  agentId: null
});

try {
  const joined = await ensureJoined(local);
  await pushLoop(joined);
} catch (err) {
  console.error((err && err.message) || String(err));
  process.exit(1);
}
