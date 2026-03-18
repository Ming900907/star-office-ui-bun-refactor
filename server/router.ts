import { FEATURES, PATHS, SECURITY, SERVER, VALID_AGENT_STATES, getOpenclawCacheStaleSeconds, requireHealthyOpenclawSource } from "./config";
import { applyAutoIdle, DEFAULT_AGENTS, normalizeAgentState, readOfficeNameFromIdentity, stateToArea } from "./utils";
import {
  createDefaultMainState,
  createEmptyJoinKeysFile,
  loadAgentsState,
  loadAssetDefaults,
  loadAssetPositions,
  loadHomeFavoritesIndex,
  loadJoinKeys,
  loadOpenclawSkillsCache,
  loadOpenclawUsageCache,
  loadState,
  saveAgentsState,
  saveAssetDefaults,
  saveAssetPositions,
  saveHomeFavoritesIndex,
  saveJoinKeys,
  saveOpenclawSkillsCache,
  saveOpenclawUsageCache,
  saveState,
  ensureHomeFavoritesIndex
} from "./storage";
import { getYesterdayMemo } from "./memo";
import type { Agent, OpenclawSkillsCache, OpenclawUsageCache } from "./types";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { copyFileSafe, fileExists, isSubPath, readImageSize } from "./fileutils";

let joinLock: Promise<void> = Promise.resolve();
const rateBuckets: Record<string, Map<string, number[]>> = {};
let cachedPackageVersion = "unknown";
let packageVersionLoaded = false;
let cachedOpenclawVersion = "unknown";
let cachedOpenclawVersionAt = 0;

const OPENCLAW_VERSION_CACHE_MS = 5 * 60 * 1000;

async function getPackageVersion() {
  if (packageVersionLoaded) return cachedPackageVersion;
  packageVersionLoaded = true;
  try {
    const raw = await fs.readFile(path.resolve(PATHS.projectRoot, "package.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === "string" && parsed.version.trim()) {
      cachedPackageVersion = parsed.version.trim();
    }
  } catch {
    cachedPackageVersion = "unknown";
  }
  return cachedPackageVersion;
}

function extractVersion(raw: string) {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  const semver = text.match(/\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?/);
  if (semver) return semver[0];
  const tail = text.split(/\s+/).pop();
  return tail || null;
}

async function runVersionCommand(cmd: string, args: string[]) {
  try {
    const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    if (code !== 0) return null;
    const out = await new Response(proc.stdout).text();
    return out.trim() || null;
  } catch {
    return null;
  }
}

async function getOpenclawVersionDynamic() {
  const now = Date.now();
  if (cachedOpenclawVersionAt && (now - cachedOpenclawVersionAt) < OPENCLAW_VERSION_CACHE_MS) {
    return cachedOpenclawVersion;
  }

  const envVersion = (process.env.OPENCLAW_VERSION || "").trim();
  if (envVersion) {
    cachedOpenclawVersion = envVersion;
    cachedOpenclawVersionAt = now;
    return cachedOpenclawVersion;
  }

  const candidates: Array<[string, string[]]> = [
    ["openclaw", ["--version"]],
    ["openclaw", ["version"]],
    ["codex", ["--version"]]
  ];

  for (const [cmd, args] of candidates) {
    const output = await runVersionCommand(cmd, args);
    const parsed = output ? extractVersion(output) : null;
    if (parsed) {
      cachedOpenclawVersion = parsed;
      cachedOpenclawVersionAt = now;
      return cachedOpenclawVersion;
    }
  }

  cachedOpenclawVersion = await getPackageVersion();
  cachedOpenclawVersionAt = now;
  return cachedOpenclawVersion;
}

async function withJoinLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = joinLock;
  let release: () => void = () => undefined;
  joinLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function getClientIp(req: Request) {
  const cf = (req.headers.get("cf-connecting-ip") || "").trim();
  if (cf) return cf;
  const xr = (req.headers.get("x-real-ip") || "").trim();
  if (xr) return xr;
  const xff = (req.headers.get("x-forwarded-for") || "").trim();
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

function hitRateLimit(bucket: string, key: string, maxHits: number, windowMs = 60_000) {
  const now = Date.now();
  if (!rateBuckets[bucket]) rateBuckets[bucket] = new Map();
  const store = rateBuckets[bucket];
  const arr = store.get(key) || [];
  const fresh = arr.filter((ts) => now - ts < windowMs);
  fresh.push(now);
  store.set(key, fresh);
  return fresh.length > maxHits;
}

function textResponse(body: string, status = 200, contentType = "text/html; charset=utf-8") {
  return new Response(body, { status, headers: { "Content-Type": contentType } });
}

async function readBodyJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function withNoCacheHeaders(resp: Response, pathName: string) {
  const headers = new Headers(resp.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (pathName.startsWith("/static/") && resp.status >= 200 && resp.status < 300) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.delete("Pragma");
    headers.delete("Expires");
  } else {
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
  }
  return new Response(resp.body, { status: resp.status, headers });
}

async function serveFile(filePath: string, contentType?: string) {
  try {
    const data = await fs.readFile(filePath);
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": contentType || "application/octet-stream"
      }
    });
  } catch {
    return jsonResponse({ ok: false, msg: "文件不存在" }, 404);
  }
}

function getCookie(req: Request, name: string) {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function isAssetAuthed(req: Request) {
  return getCookie(req, "asset_editor_authed") === "1";
}

function hasValidApiToken(req: Request) {
  if (!SECURITY.apiToken) return false;
  const auth = req.headers.get("authorization") || "";
  const xToken = req.headers.get("x-office-token") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const got = bearer || xToken.trim();
  return got === SECURITY.apiToken;
}

function requireApiToken(req: Request) {
  if (!SECURITY.apiToken) return null;
  if (hasValidApiToken(req)) return null;
  return jsonResponse({ ok: false, code: "FORBIDDEN", msg: "invalid api token" }, 403);
}

function requireAssetAuth(req: Request) {
  if (isAssetAuthed(req)) return null;
  return jsonResponse({ ok: false, code: "UNAUTHORIZED", msg: "Asset editor auth required" }, 401);
}

function featureDisabledResponse(feature: string) {
  return jsonResponse({
    ok: false,
    code: "FEATURE_DISABLED",
    feature,
    msg: "该功能已下线，已迁移到 OpenClaw agent skills 接口"
  }, 410);
}

function degradedSourceResponse(kind: "skills" | "usage", payload: Record<string, unknown>) {
  return jsonResponse({
    ok: false,
    code: "DEGRADED_OPENCLAW_SOURCE",
    kind,
    msg: `OpenClaw ${kind} 数据源当前处于降级状态，strict mode 已拒绝该请求`,
    ...payload,
    strict: true
  }, 503);
}

function makeAgentSessionToken() {
  return `agt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function authenticateSkillCaller(req: Request, data: any): Promise<{ ok: true; agent: Agent | null } | { ok: false; response: Response }> {
  if (!SECURITY.apiToken) return { ok: true, agent: null };
  if (hasValidApiToken(req)) return { ok: true, agent: null };
  const agentId = String(data?.agentId || "").trim();
  const joinKey = String(data?.joinKey || "").trim();
  if (!agentId || !joinKey) {
    return { ok: false, response: jsonResponse({ ok: false, msg: "缺少 agentId/joinKey" }, 400) };
  }

  const keys = await loadJoinKeys();
  const keyItem = keys.keys.find((k) => k.key === joinKey);
  if (!keyItem) {
    return { ok: false, response: jsonResponse({ ok: false, msg: "joinKey 无效" }, 403) };
  }
  if (keyItem.expiresAt) {
    const exp = new Date(keyItem.expiresAt);
    if (!Number.isNaN(exp.getTime()) && new Date() > exp) {
      return { ok: false, response: jsonResponse({ ok: false, msg: "joinKey 已过期" }, 403) };
    }
  }

  const agents = await loadAgentsState(DEFAULT_AGENTS);
  const target = agents.find((a) => a.agentId === agentId && !a.isMain);
  if (!target) {
    return { ok: false, response: jsonResponse({ ok: false, msg: "agent 未注册，请先 join" }, 404) };
  }
  if (target.joinKey !== joinKey) {
    return { ok: false, response: jsonResponse({ ok: false, msg: "joinKey 不匹配" }, 403) };
  }
  const authStatus = target.authStatus || "pending";
  if (authStatus !== "approved" && authStatus !== "offline") {
    return { ok: false, response: jsonResponse({ ok: false, msg: "agent 未获授权" }, 403) };
  }
  return { ok: true, agent: target };
}

async function ensureStateFile() {
  try {
    await fs.access(PATHS.stateFile);
  } catch {
    await saveState(createDefaultMainState());
  }
}

async function ensureJoinKeysFile() {
  try {
    await fs.access(PATHS.joinKeysFile);
  } catch {
    if (SECURITY.isProduction) {
      await fs.writeFile(PATHS.joinKeysFile, JSON.stringify(createEmptyJoinKeysFile(), null, 2), "utf-8");
      return;
    }
    const sample = path.resolve(PATHS.projectRoot, "join-keys.sample.json");
    if (await fileExists(sample)) {
      const raw = await fs.readFile(sample, "utf-8");
      await fs.writeFile(PATHS.joinKeysFile, raw, "utf-8");
    } else {
      await fs.writeFile(PATHS.joinKeysFile, JSON.stringify(createEmptyJoinKeysFile(), null, 2), "utf-8");
    }
  }
}

export function __resetRouterForTests() {
  joinLock = Promise.resolve();
  for (const bucket of Object.keys(rateBuckets)) {
    delete rateBuckets[bucket];
  }
}

type AgentSkill = {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, string>;
  tokenCost: {
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    note?: string;
  };
};

type SkillsSourceResult = OpenclawSkillsCache;
type UsageOverview = OpenclawUsageCache;

function xmlEscape(text: string) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function readNumber(obj: any, keys: string[]) {
  for (const key of keys) {
    const v = Number(obj?.[key]);
    if (Number.isFinite(v)) return v;
  }
  return 0;
}

function summarizeUsageRows(rows: Array<{ key: string; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number }>) {
  const map = new Map<string, { key: string; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number }>();
  for (const row of rows) {
    const key = row.key || "unknown";
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row, key });
      continue;
    }
    prev.inputTokens += row.inputTokens;
    prev.outputTokens += row.outputTokens;
    prev.totalTokens += row.totalTokens;
    prev.estimatedCostUsd += row.estimatedCostUsd;
  }
  return Array.from(map.values());
}

function normalizeUsageFromPayload(payload: any): UsageOverview | null {
  if (!payload || typeof payload !== "object") return null;

  const src = (payload?.usage && typeof payload.usage === "object") ? payload.usage : payload;
  const inputCostPer1k = Number(process.env.OPENCLAW_INPUT_COST_PER_1K || 0.002);
  const outputCostPer1k = Number(process.env.OPENCLAW_OUTPUT_COST_PER_1K || 0.008);

  const modelCandidates =
    (Array.isArray(src?.byModel) && src.byModel)
    || (Array.isArray(src?.by_model) && src.by_model)
    || (Array.isArray(src?.models) && src.models)
    || (Array.isArray(src?.providers) && src.providers)
    || (Array.isArray(src?.usageByModel) && src.usageByModel)
    || [];

  const channelCandidates =
    (Array.isArray(src?.byChannel) && src.byChannel)
    || (Array.isArray(src?.by_channel) && src.by_channel)
    || (Array.isArray(src?.channels) && src.channels)
    || (Array.isArray(src?.usageByChannel) && src.usageByChannel)
    || [];

  const normalizedModels = summarizeUsageRows(
    modelCandidates.map((it: any) => {
      const inputTokens = readNumber(it, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
      const outputTokens = readNumber(it, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
      const totalTokensRaw = readNumber(it, ["totalTokens", "total_tokens"]);
      const totalTokens = totalTokensRaw > 0 ? totalTokensRaw : inputTokens + outputTokens;
      const estimatedCostUsdRaw = readNumber(it, ["estimatedCostUsd", "estimated_cost_usd", "costUsd", "cost_usd", "usd", "cost"]);
      const estimatedCostUsd = estimatedCostUsdRaw > 0
        ? estimatedCostUsdRaw
        : (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k;
      const key = String(it?.model || it?.modelName || it?.provider || it?.name || "unknown");
      return { key, inputTokens, outputTokens, totalTokens, estimatedCostUsd };
    })
  ).map((it) => ({
    model: it.key,
    inputTokens: it.inputTokens,
    outputTokens: it.outputTokens,
    totalTokens: it.totalTokens,
    estimatedCostUsd: Number(it.estimatedCostUsd.toFixed(6))
  }));

  const normalizedChannels = summarizeUsageRows(
    channelCandidates.map((it: any) => {
      const inputTokens = readNumber(it, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
      const outputTokens = readNumber(it, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
      const totalTokensRaw = readNumber(it, ["totalTokens", "total_tokens"]);
      const totalTokens = totalTokensRaw > 0 ? totalTokensRaw : inputTokens + outputTokens;
      const estimatedCostUsdRaw = readNumber(it, ["estimatedCostUsd", "estimated_cost_usd", "costUsd", "cost_usd", "usd", "cost"]);
      const estimatedCostUsd = estimatedCostUsdRaw > 0
        ? estimatedCostUsdRaw
        : (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k;
      const key = String(it?.channel || it?.source || it?.provider || it?.name || "openclaw");
      return { key, inputTokens, outputTokens, totalTokens, estimatedCostUsd };
    })
  ).map((it) => ({
    channel: it.key,
    inputTokens: it.inputTokens,
    outputTokens: it.outputTokens,
    totalTokens: it.totalTokens,
    estimatedCostUsd: Number(it.estimatedCostUsd.toFixed(6))
  }));

  const summaryObj = (src?.summary && typeof src.summary === "object") ? src.summary : src;
  const summaryInput = readNumber(summaryObj, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
  const summaryOutput = readNumber(summaryObj, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
  const summaryTotalRaw = readNumber(summaryObj, ["totalTokens", "total_tokens"]);
  const summaryCostRaw = readNumber(summaryObj, ["estimatedCostUsd", "estimated_cost_usd", "costUsd", "cost_usd", "usd", "cost"]);

  const modelInput = normalizedModels.reduce((sum, it) => sum + it.inputTokens, 0);
  const modelOutput = normalizedModels.reduce((sum, it) => sum + it.outputTokens, 0);
  const modelTotal = normalizedModels.reduce((sum, it) => sum + it.totalTokens, 0);
  const modelCost = normalizedModels.reduce((sum, it) => sum + it.estimatedCostUsd, 0);

  const inputTokens = summaryInput > 0 ? summaryInput : modelInput;
  const outputTokens = summaryOutput > 0 ? summaryOutput : modelOutput;
  const totalTokens = summaryTotalRaw > 0 ? summaryTotalRaw : (modelTotal > 0 ? modelTotal : inputTokens + outputTokens);
  const estimatedCostUsd = summaryCostRaw > 0
    ? summaryCostRaw
    : (modelCost > 0 ? modelCost : (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k);

  if (totalTokens <= 0 && normalizedModels.length === 0 && normalizedChannels.length === 0) return null;

  return {
    ok: true,
    mode: "openclaw-pushed-usage",
    currency: String(src?.currency || "USD"),
    summary: {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(6))
    },
    byModel: normalizedModels,
    byChannel: normalizedChannels,
    costPolicy: { inputCostPer1k, outputCostPer1k },
    note: "来源：OpenClaw 推送的 usage 快照",
    degraded: false,
    warnings: [],
    syncedAt: new Date().toISOString()
  };
}

function getAgentSkillsCatalog(): AgentSkill[] {
  return [
    {
      id: "openclaw.set-main-state",
      name: "Set Main State",
      description: "更新主角色状态（替代 /set_state）",
      inputSchema: { state: "string", detail: "string(optional)" },
      tokenCost: {
        estimatedInputTokens: 35,
        estimatedOutputTokens: 20,
        note: "轻量文本参数，适合高频调用"
      }
    },
    {
      id: "openclaw.restore-reference-background",
      name: "Restore Reference Background",
      description: "恢复 office_bg_small.webp 为参考背景",
      inputSchema: {},
      tokenCost: {
        estimatedInputTokens: 15,
        estimatedOutputTokens: 18,
        note: "无额外业务参数，固定操作"
      }
    },
    {
      id: "openclaw.apply-home-favorite",
      name: "Apply Home Favorite",
      description: "按收藏 ID 应用背景（替代 /assets/home-favorites/apply）",
      inputSchema: { id: "string" },
      tokenCost: {
        estimatedInputTokens: 22,
        estimatedOutputTokens: 22,
        note: "包含收藏 ID 校验与应用结果返回"
      }
    }
  ];
}

function getOpenclawUsageOverview(skills: AgentSkill[]) {
  const totalInputTokens = skills.reduce((sum, s) => sum + Number(s.tokenCost?.estimatedInputTokens || 0), 0);
  const totalOutputTokens = skills.reduce((sum, s) => sum + Number(s.tokenCost?.estimatedOutputTokens || 0), 0);
  const totalTokens = totalInputTokens + totalOutputTokens;
  const inputCostPer1k = Number(process.env.OPENCLAW_INPUT_COST_PER_1K || 0.002);
  const outputCostPer1k = Number(process.env.OPENCLAW_OUTPUT_COST_PER_1K || 0.008);
  const estimatedCost = (totalInputTokens / 1000) * inputCostPer1k + (totalOutputTokens / 1000) * outputCostPer1k;

  return {
    ok: true,
    mode: "estimated",
    currency: "USD",
    summary: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
      estimatedCostUsd: Number(estimatedCost.toFixed(6))
    },
    byModel: [
      {
        model: process.env.OPENCLAW_USAGE_MODEL || "openclaw-default",
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens,
        estimatedCostUsd: Number(estimatedCost.toFixed(6))
      }
    ],
    byChannel: [
      {
        channel: process.env.OPENCLAW_USAGE_CHANNEL || "openclaw",
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens,
        estimatedCostUsd: Number(estimatedCost.toFixed(6))
      }
    ],
    costPolicy: {
      inputCostPer1k,
      outputCostPer1k
    },
    note: "当前为估算视图：基于已加载技能的 prompt 开销估算，不是账单实付值",
    degraded: true,
    warnings: [],
    syncedAt: new Date().toISOString()
  };
}

function getPayloadList(payload: any, keys: string[]) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return null;
}

function buildSkillsFallbackSnapshot(warnings: string[], note?: string): SkillsSourceResult {
  const skills = getAgentSkillsCatalog();
  return {
    ok: true,
    source: "local-catalog-fallback",
    skills,
    count: skills.length,
    degraded: true,
    warnings,
    note: note || (warnings.length ? `已降级到本地技能目录；${warnings.join("；")}` : "未检测到 OpenClaw CLI 或 CLI 不可用，回退本地技能目录"),
    syncedAt: new Date().toISOString()
  };
}

function buildUsageFallbackSnapshot(skills: AgentSkill[], warnings: string[], note?: string): UsageOverview {
  const fallback = getOpenclawUsageOverview(skills);
  fallback.degraded = true;
  fallback.warnings = warnings;
  fallback.note = note || (warnings.length ? `已降级到本地估算；${warnings.join("；")}` : fallback.note);
  fallback.syncedAt = new Date().toISOString();
  return fallback;
}

function normalizePushedSkillsSnapshot(payload: any): SkillsSourceResult | null {
  if (!payload) return null;
  const fallback = getAgentSkillsCatalog();
  const fallbackMap = new Map(fallback.map((s) => [s.id, s]));
  const list = Array.isArray(payload)
    ? payload
    : getPayloadList(payload, ["skills", "items"]);
  if (!Array.isArray(list) || !list.length) return null;

  const skills = list
    .map((it: any) => {
      const id = String(it?.id || "").trim();
      if (!id) return null;
      const ref = fallbackMap.get(id);
      const tokenCost = it?.tokenCost || it?.token_cost || ref?.tokenCost || {
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0
      };
      return {
        id,
        name: String(it?.name || ref?.name || id),
        description: String(it?.description || ref?.description || ""),
        inputSchema: (it?.inputSchema && typeof it.inputSchema === "object") ? it.inputSchema : (ref?.inputSchema || {}),
        tokenCost: {
          estimatedInputTokens: Number(tokenCost?.estimatedInputTokens || tokenCost?.estimated_input_tokens || 0),
          estimatedOutputTokens: Number(tokenCost?.estimatedOutputTokens || tokenCost?.estimated_output_tokens || 0),
          note: typeof tokenCost?.note === "string" ? tokenCost.note : (ref?.tokenCost?.note || "")
        }
      } as AgentSkill;
    })
    .filter(Boolean) as AgentSkill[];

  if (!skills.length) return null;
  return {
    ok: true,
    source: "openclaw-push",
    skills,
    count: skills.length,
    degraded: false,
    warnings: [],
    note: "来源：OpenClaw 推送的 skills 快照",
    syncedAt: new Date().toISOString()
  };
}

function appendCacheHealth<T extends { degraded: boolean; warnings: string[]; note: string; syncedAt: string }>(payload: T) {
  const staleSeconds = getOpenclawCacheStaleSeconds();
  const syncedAtMs = new Date(payload.syncedAt || "").getTime();
  const ageSeconds = Number.isFinite(syncedAtMs) ? (Date.now() - syncedAtMs) / 1000 : Number.POSITIVE_INFINITY;
  const isStale = !Number.isFinite(ageSeconds) || ageSeconds > staleSeconds;
  const warnings = [...(payload.warnings || [])];
  let note = payload.note || "";
  let degraded = !!payload.degraded;

  if (isStale) {
    degraded = true;
    warnings.push(`cached snapshot is stale (${Math.round(ageSeconds)}s old)`);
    note = note ? `${note}；缓存已过期` : "缓存已过期";
  }

  return {
    ...payload,
    degraded,
    warnings,
    note,
    stale: isStale,
    cacheAgeSeconds: Number.isFinite(ageSeconds) ? Math.max(0, Math.round(ageSeconds)) : null
  };
}

function mergePreservedSnapshotWarnings<T extends { degraded: boolean; warnings: string[]; note: string }>(
  cached: T,
  degradedAttempt: T,
  label: string
) {
  const warnings = [
    ...(cached.warnings || []),
    ...(degradedAttempt.warnings || []),
    `retained previous ${label} cache after degraded sync attempt`
  ];
  const note = degradedAttempt.note
    ? `${degradedAttempt.note}；已保留上一份有效缓存`
    : `degraded ${label} sync attempt; retained previous cache`;
  return {
    ...cached,
    warnings,
    note
  };
}

async function syncOpenclawSnapshots(scope: "all" | "skills" | "usage", payload: any) {
  const syncedAt = new Date().toISOString();
  const result: {
    ok: boolean;
    syncedAt: string;
    skills?: SkillsSourceResult;
    usage?: UsageOverview;
  } = {
    ok: true,
    syncedAt
  };

  let skillsSnapshot: SkillsSourceResult | null = null;
  let degradedAttempt = false;

  if (scope === "all" || scope === "skills") {
    const pushedSkillsPayload = payload?.skillsPayload ?? payload?.skills ?? null;
    const pushedSkillsError = String(payload?.skillsError || "").trim();
    const collectedSkills = normalizePushedSkillsSnapshot(pushedSkillsPayload)
      || buildSkillsFallbackSnapshot(
        [pushedSkillsError || "OpenClaw sync request did not include a valid skills payload"],
        pushedSkillsError ? `OpenClaw skills 推送失败；${pushedSkillsError}` : "OpenClaw 未推送有效的 skills 快照"
      );
    collectedSkills.syncedAt = syncedAt;
    if (!collectedSkills.degraded) {
      await saveOpenclawSkillsCache(collectedSkills);
      skillsSnapshot = collectedSkills;
    } else {
      degradedAttempt = true;
      const cachedSkills = await loadOpenclawSkillsCache();
      if (cachedSkills && !cachedSkills.degraded) {
        skillsSnapshot = mergePreservedSnapshotWarnings(cachedSkills, collectedSkills, "skills");
      } else {
        await saveOpenclawSkillsCache(collectedSkills);
        skillsSnapshot = collectedSkills;
      }
    }
    result.skills = skillsSnapshot;
  }

  if (scope === "all" || scope === "usage") {
    const usageSkills = skillsSnapshot?.skills || (await loadOpenclawSkillsCache())?.skills || getAgentSkillsCatalog();
    const pushedUsagePayload = payload?.usagePayload ?? payload?.usage ?? null;
    const pushedUsageError = String(payload?.usageError || "").trim();
    const collectedUsage = normalizeUsageFromPayload(pushedUsagePayload)
      || buildUsageFallbackSnapshot(
        usageSkills as AgentSkill[],
        [pushedUsageError || "OpenClaw sync request did not include a valid usage payload"],
        pushedUsageError ? `OpenClaw usage 推送失败；${pushedUsageError}` : "OpenClaw 未推送有效的 usage 快照"
      );
    collectedUsage.syncedAt = syncedAt;
    if (!collectedUsage.degraded) {
      await saveOpenclawUsageCache(collectedUsage);
      result.usage = collectedUsage;
    } else {
      degradedAttempt = true;
      const cachedUsage = await loadOpenclawUsageCache();
      if (cachedUsage && !cachedUsage.degraded) {
        result.usage = mergePreservedSnapshotWarnings(cachedUsage, collectedUsage, "usage");
      } else {
        await saveOpenclawUsageCache(collectedUsage);
        result.usage = collectedUsage;
      }
    }
  }

  if (degradedAttempt || (result.skills && result.skills.degraded) || (result.usage && result.usage.degraded)) {
    result.ok = false;
  }
  return result;
}

async function readSkillsSnapshot() {
  const cached = await loadOpenclawSkillsCache();
  if (!cached) {
    return appendCacheHealth(buildSkillsFallbackSnapshot(
      ["no cached skills snapshot; OpenClaw must call POST /openclaw/sync first"],
      "尚未收到 OpenClaw 推送的 skills 缓存"
    ));
  }
  return appendCacheHealth(cached);
}

async function readUsageSnapshot() {
  const cached = await loadOpenclawUsageCache();
  if (!cached) {
    const skills = await readSkillsSnapshot();
    return appendCacheHealth(buildUsageFallbackSnapshot(
      skills.skills as AgentSkill[],
      ["no cached usage snapshot; OpenClaw must call POST /openclaw/sync first"],
      "尚未收到 OpenClaw 推送的 usage 缓存"
    ));
  }
  return appendCacheHealth(cached);
}

async function executeAgentSkill(skillId: string, input: any) {
  if (skillId === "openclaw.set-main-state") {
    const state = await loadState();
    if (input?.state && typeof input.state === "string") {
      const normalized = input.state.trim();
      if (VALID_AGENT_STATES.has(normalized)) {
        state.state = normalized;
      }
    }
    if (typeof input?.detail === "string") {
      state.detail = input.detail;
    }
    state.updated_at = new Date().toISOString();
    await saveState(state);
    return { ok: true, state: state.state, detail: state.detail };
  }

  if (skillId === "openclaw.restore-reference-background") {
    const target = path.resolve(PATHS.frontendRoot, "office_bg_small.webp");
    if (!(await fileExists(target))) {
      return { ok: false, status: 404, msg: "office_bg_small.webp 不存在" };
    }
    const refWebp = path.resolve(PATHS.assetsDir, "room-reference.webp");
    const refPng = path.resolve(PATHS.assetsDir, "room-reference.png");
    let ref = refWebp;
    if (!(await fileExists(refWebp))) {
      ref = refPng;
    }
    if (!(await fileExists(ref))) {
      return { ok: false, status: 404, msg: "参考图不存在" };
    }
    await copyFileSafe(target, `${target}.bak`);
    await copyFileSafe(ref, target);
    const st = await fs.stat(target);
    return { ok: true, path: "office_bg_small.webp", size: st.size, msg: "已恢复参考背景" };
  }

  if (skillId === "openclaw.apply-home-favorite") {
    const itemId = String(input?.id || "").trim();
    if (!itemId) return { ok: false, status: 400, msg: "缺少 id" };
    const idx = await loadHomeFavoritesIndex();
    const items = idx.items || [];
    const hit = items.find((it) => String(it.id || "") === itemId);
    if (!hit) return { ok: false, status: 404, msg: "收藏项不存在" };
    const src = path.resolve(PATHS.projectRoot, String(hit.path || ""));
    if (!(await fileExists(src))) {
      return { ok: false, status: 404, msg: "收藏文件不存在" };
    }
    const target = path.resolve(PATHS.frontendRoot, "office_bg_small.webp");
    if (!(await fileExists(target))) {
      return { ok: false, status: 404, msg: "office_bg_small.webp 不存在" };
    }
    await copyFileSafe(target, `${target}.bak`);
    await copyFileSafe(src, target);
    const st = await fs.stat(target);
    return { ok: true, path: "office_bg_small.webp", size: st.size, from: hit.path, msg: "已应用收藏地图" };
  }

  return { ok: false, status: 404, msg: "未知 skill" };
}

export async function handleRequest(req: Request) {
  const url = new URL(req.url);
  const pathName = url.pathname;

  await ensureStateFile();
  await ensureJoinKeysFile();

  if (req.method === "GET" && pathName === "/health") {
    return jsonResponse({
      status: "ok",
      service: "star-office-ui",
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === "GET" && pathName === "/system-info") {
    const appVersion = await getOpenclawVersionDynamic();
    const cpuCount = os.cpus()?.length || 1;
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = Math.max(0, totalMem - freeMem);
    const memoryUsedPercent = totalMem > 0 ? Number(((usedMem / totalMem) * 100).toFixed(1)) : 0;
    const cpuLoadPercentApprox = Number(Math.min(100, (loadAvg[0] / cpuCount) * 100).toFixed(1));
    return jsonResponse({
      status: "ok",
      app: {
        name: "openclaw",
        version: appVersion
      },
      machine: {
        hostname: os.hostname(),
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus()?.length || 0,
        totalMemoryGB: Number((os.totalmem() / (1024 ** 3)).toFixed(1)),
        nodeVersion: process.version,
        bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown"
      },
      metrics: {
        cpuLoad1m: Number(loadAvg[0].toFixed(2)),
        cpuLoad5m: Number(loadAvg[1].toFixed(2)),
        cpuLoad15m: Number(loadAvg[2].toFixed(2)),
        cpuLoadPercentApprox,
        memoryUsedGB: Number((usedMem / (1024 ** 3)).toFixed(1)),
        memoryFreeGB: Number((freeMem / (1024 ** 3)).toFixed(1)),
        memoryUsedPercent,
        uptimeHours: Number((os.uptime() / 3600).toFixed(1))
      },
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === "GET" && pathName === "/openclaw/skills") {
    const resolved = await readSkillsSnapshot();
    if (requireHealthyOpenclawSource() && resolved.degraded) {
      return degradedSourceResponse("skills", {
        source: resolved.source,
        degraded: true,
        stale: (resolved as any).stale,
        cacheAgeSeconds: (resolved as any).cacheAgeSeconds,
        warnings: resolved.warnings || [],
        note: resolved.note || "",
        timestamp: new Date().toISOString()
      });
    }
    return jsonResponse({
      ok: true,
      source: resolved.source,
      skills: resolved.skills,
      count: resolved.skills.length,
      degraded: !!resolved.degraded,
      stale: (resolved as any).stale ?? false,
      cacheAgeSeconds: (resolved as any).cacheAgeSeconds ?? null,
      syncedAt: resolved.syncedAt || null,
      warnings: resolved.warnings || [],
      note: resolved.note || "",
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === "GET" && pathName === "/openclaw/usage") {
    const usage = await readUsageSnapshot();
    if (requireHealthyOpenclawSource() && usage.degraded) {
      return degradedSourceResponse("usage", {
        mode: usage.mode,
        degraded: true,
        stale: (usage as any).stale,
        cacheAgeSeconds: (usage as any).cacheAgeSeconds,
        warnings: usage.warnings || [],
        note: usage.note || "",
        timestamp: new Date().toISOString()
      });
    }
    return jsonResponse({
      ...usage,
      stale: (usage as any).stale ?? false,
      cacheAgeSeconds: (usage as any).cacheAgeSeconds ?? null,
      syncedAt: usage.syncedAt || null,
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === "POST" && pathName === "/openclaw/sync") {
    const data = await readBodyJson(req);
    if (!data || typeof data !== "object") return jsonResponse({ ok: false, msg: "invalid json" }, 400);
    const auth = await authenticateSkillCaller(req, data);
    if (!auth.ok) return auth.response;
    const scope = String(data.scope || "all").trim().toLowerCase();
    const normalizedScope = scope === "skills" || scope === "usage" ? scope : "all";
    const result = await syncOpenclawSnapshots(normalizedScope, data);
    if (requireHealthyOpenclawSource() && !result.ok) {
      return jsonResponse({
        ok: false,
        code: "DEGRADED_OPENCLAW_SOURCE",
        msg: "strict mode 已拒绝写入降级的 OpenClaw 缓存",
        scope: normalizedScope,
        strict: true,
        syncedAt: result.syncedAt,
        skills: result.skills,
        usage: result.usage
      }, 503);
    }
    if (!result.ok) {
      return jsonResponse({
        ok: false,
        code: "DEGRADED_OPENCLAW_SYNC",
        msg: "OpenClaw sync completed with degraded data; existing healthy cache was preserved when available",
        scope: normalizedScope,
        strict: false,
        syncedAt: result.syncedAt,
        skills: result.skills,
        usage: result.usage
      }, 502);
    }
    return jsonResponse({
      ok: result.ok,
      scope: normalizedScope,
      syncedAt: result.syncedAt,
      skills: result.skills,
      usage: result.usage
    });
  }

  if (req.method === "GET" && pathName === "/status") {
    let state = await loadState();
    const applied = applyAutoIdle(state);
    if (applied.updated_at !== state.updated_at || applied.state !== state.state) {
      await saveState(applied);
    }
    state = applied;
    const officeName = await readOfficeNameFromIdentity();
    if (officeName) state.officeName = officeName;
    state.capabilities = {
      stateControl: FEATURES.enableStateControl,
      assetDecoration: FEATURES.enableAssetDecoration,
      agentSkillsApi: FEATURES.enableAgentSkillsApi
    };
    return jsonResponse(state);
  }

  if (req.method === "POST" && pathName === "/set_state") {
    if (!FEATURES.enableStateControl) return featureDisabledResponse("state-control");
    const guard = requireApiToken(req);
    if (guard) return guard;
    const data = await readBodyJson(req);
    if (!data || typeof data !== "object") {
      return jsonResponse({ status: "error", msg: "invalid json" }, 400);
    }
    const state = await loadState();
    if (data.state && typeof data.state === "string") {
      const s = data.state.trim();
      if (VALID_AGENT_STATES.has(s)) {
        state.state = s;
      }
    }
    if (typeof data.detail === "string") {
      state.detail = data.detail;
    }
    state.updated_at = new Date().toISOString();
    await saveState(state);
    return jsonResponse({ status: "ok" });
  }

  if (req.method === "GET" && pathName === "/agents") {
    const agents = await loadAgentsState(DEFAULT_AGENTS);
    const keys = await loadJoinKeys();
    const now = new Date();
    const cleaned: Agent[] = [];

    const ageSeconds = (dtStr?: string | null) => {
      if (!dtStr) return null;
      const dt = new Date(dtStr);
      if (Number.isNaN(dt.getTime())) return null;
      return (now.getTime() - dt.getTime()) / 1000;
    };

    for (const a of agents) {
      if (a.isMain) {
        cleaned.push(a);
        continue;
      }
      const authStatus = a.authStatus || "pending";
      if (authStatus === "pending" && a.authExpiresAt) {
        const exp = new Date(a.authExpiresAt);
        if (!Number.isNaN(exp.getTime()) && now > exp) {
          const key = a.joinKey;
          if (key) {
            const keyItem = keys.keys.find((k) => k.key === key);
            if (keyItem) {
              keyItem.used = false;
              keyItem.usedBy = null;
              keyItem.usedByAgentId = null;
              keyItem.usedAt = null;
            }
          }
          continue;
        }
      }

      if (authStatus === "approved" && a.lastPushAt) {
        const age = ageSeconds(a.lastPushAt);
        if (age !== null && age > 300) {
          a.authStatus = "offline";
        }
      }
      cleaned.push(a);
    }

    await saveAgentsState(cleaned);
    await saveJoinKeys(keys);
    const safe = cleaned.map((a) => {
      const { joinKey: _jk, selfLeaveToken: _slt, ...rest } = a as Agent & { joinKey?: string; selfLeaveToken?: string | null };
      return rest;
    });
    return jsonResponse(safe);
  }

  if (req.method === "POST" && pathName === "/join-agent") {
    const ip = getClientIp(req);
    if (hitRateLimit("join-agent", ip, SECURITY.joinRateLimitPerMinute)) {
      return jsonResponse({ ok: false, msg: "请求过于频繁，请稍后重试" }, 429);
    }
    const data = await readBodyJson(req);
    if (!data || typeof data !== "object" || !data.name) {
      return jsonResponse({ ok: false, msg: "请提供名字" }, 400);
    }
    const name = String(data.name).trim();
    const joinKey = String(data.joinKey || "").trim();
    const requestedAgentId = String(data.agentId || "").trim();
    if (!joinKey) return jsonResponse({ ok: false, msg: "请提供接入密钥" }, 400);

    const state = normalizeAgentState(String(data.state || "idle"));
    const detail = String(data.detail || "");

    return withJoinLock(async () => {
      let keys = await loadJoinKeys();
      let keyItem = keys.keys.find((k) => k.key === joinKey);
      if (!keyItem) return jsonResponse({ ok: false, msg: "接入密钥无效" }, 403);

      if (keyItem.expiresAt) {
        const exp = new Date(keyItem.expiresAt);
        if (!Number.isNaN(exp.getTime()) && new Date() > exp) {
          return jsonResponse({ ok: false, msg: "该接入密钥已过期，活动已结束 🎉" }, 403);
        }
      }

      const agents = await loadAgentsState(DEFAULT_AGENTS);
      const now = new Date();

      const ageSeconds = (dtStr?: string | null) => {
        if (!dtStr) return null;
        const dt = new Date(dtStr);
        if (Number.isNaN(dt.getTime())) return null;
        return (now.getTime() - dt.getTime()) / 1000;
      };

      const existingById = requestedAgentId
        ? agents.find((a) => !a.isMain && a.agentId === requestedAgentId)
        : null;
      const existingNameHolder = agents.find((a) => !a.isMain && a.name === name);
      const existingId = existingById?.agentId;

      for (const a of agents) {
        if (a.isMain) continue;
        if (a.authStatus !== "approved") continue;
        let age = ageSeconds(a.lastPushAt || undefined);
        if (age === null) age = ageSeconds(a.updated_at || undefined);
        if (age !== null && age > 300) {
          a.authStatus = "offline";
        }
      }

      const maxConcurrent = Number(keyItem.maxConcurrent || 3);
      let activeCount = 0;
      for (const a of agents) {
        if (a.isMain) continue;
        if (a.agentId === existingId) continue;
        if (a.joinKey !== joinKey) continue;
        if (a.authStatus !== "approved") continue;
        let age = ageSeconds(a.lastPushAt || undefined);
        if (age === null) age = ageSeconds(a.updated_at || undefined);
        if (age === null || age <= 300) activeCount += 1;
      }

      if (activeCount >= maxConcurrent) {
        await saveAgentsState(agents);
        return jsonResponse(
          { ok: false, msg: `该接入密钥当前并发已达上限（${maxConcurrent}），请稍后或换另一个 key` },
          429
        );
      }

      const nowIso = new Date().toISOString();
      let agentId = existingId || "";
      const leaveToken = makeAgentSessionToken();
      if (existingById) {
        if (existingById.joinKey !== joinKey) {
          return jsonResponse({ ok: false, msg: "agentId 与 joinKey 不匹配" }, 403);
        }
        if (existingNameHolder && existingNameHolder.agentId !== existingById.agentId) {
          return jsonResponse({ ok: false, msg: "该名字已被占用，请使用原名字重连或换一个名字" }, 409);
        }
        existingById.name = name;
        existingById.state = state;
        existingById.detail = detail;
        existingById.updated_at = nowIso;
        existingById.area = stateToArea(state);
        existingById.source = "remote-openclaw";
        existingById.authStatus = "approved";
        existingById.authApprovedAt = nowIso;
        existingById.authExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        existingById.lastPushAt = nowIso;
        (existingById as any).selfLeaveToken = leaveToken;
        agentId = existingById.agentId;
      } else {
        if (existingNameHolder) {
          return jsonResponse({ ok: false, msg: "该名字已被占用，请使用原 agentId 重连或换一个名字" }, 409);
        }
        agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const agent: Agent = {
          agentId,
          name,
          isMain: false,
          state,
          detail,
          updated_at: nowIso,
          area: stateToArea(state),
          source: "remote-openclaw",
          joinKey,
          authStatus: "approved",
          authApprovedAt: nowIso,
          authExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          lastPushAt: nowIso
        };
        (agent as any).selfLeaveToken = leaveToken;
        agents.push(agent);
      }

      keyItem.used = true;
      keyItem.usedBy = name;
      keyItem.usedByAgentId = agentId;
      keyItem.usedAt = nowIso;
      keyItem.reusable = true;

      await saveAgentsState(agents);
      await saveJoinKeys(keys);

      return jsonResponse({
        ok: true,
        agentId,
        leaveToken,
        authStatus: "approved",
        nextStep: "已自动批准，立即开始推送状态"
      });
    });
  }

  if (req.method === "POST" && pathName === "/agent-approve") {
    const guard = requireApiToken(req);
    if (guard) return guard;
    const data = await readBodyJson(req);
    const agentId = String(data?.agentId || "").trim();
    if (!agentId) return jsonResponse({ ok: false, msg: "缺少 agentId" }, 400);
    const agents = await loadAgentsState(DEFAULT_AGENTS);
    const target = agents.find((a) => a.agentId === agentId && !a.isMain);
    if (!target) return jsonResponse({ ok: false, msg: "未找到 agent" }, 404);
    target.authStatus = "approved";
    target.authApprovedAt = new Date().toISOString();
    target.authExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await saveAgentsState(agents);
    return jsonResponse({ ok: true, agentId, authStatus: "approved" });
  }

  if (req.method === "POST" && pathName === "/agent-reject") {
    const guard = requireApiToken(req);
    if (guard) return guard;
    const data = await readBodyJson(req);
    const agentId = String(data?.agentId || "").trim();
    if (!agentId) return jsonResponse({ ok: false, msg: "缺少 agentId" }, 400);
    let agents = await loadAgentsState(DEFAULT_AGENTS);
    const target = agents.find((a) => a.agentId === agentId && !a.isMain);
    if (!target) return jsonResponse({ ok: false, msg: "未找到 agent" }, 404);
    target.authStatus = "rejected";
    target.authRejectedAt = new Date().toISOString();
    const keys = await loadJoinKeys();
    const joinKey = target.joinKey;
    if (joinKey) {
      const keyItem = keys.keys.find((k) => k.key === joinKey);
      if (keyItem) {
        keyItem.used = false;
        keyItem.usedBy = null;
        keyItem.usedByAgentId = null;
        keyItem.usedAt = null;
      }
    }
    agents = agents.filter((a) => a.isMain || a.agentId !== agentId);
    await saveAgentsState(agents);
    await saveJoinKeys(keys);
    return jsonResponse({ ok: true, agentId, authStatus: "rejected" });
  }

  if (req.method === "POST" && pathName === "/leave-agent") {
    const data = await readBodyJson(req);
    if (!data || typeof data !== "object") return jsonResponse({ ok: false, msg: "invalid json" }, 400);
    const agentId = String(data.agentId || "").trim();
    const name = String(data.name || "").trim();
    const leaveToken = String(data.leaveToken || "").trim();
    const isAdmin = hasValidApiToken(req);
    if (!isAdmin && (!agentId || !leaveToken)) {
      return jsonResponse({ ok: false, msg: "自助离开需要 agentId 与 leaveToken" }, 400);
    }
    if (isAdmin && !agentId && !name) return jsonResponse({ ok: false, msg: "请提供 agentId 或名字" }, 400);

    return withJoinLock(async () => {
      const agents = await loadAgentsState(DEFAULT_AGENTS);
      const target = isAdmin
        ? (agentId
          ? agents.find((a) => a.agentId === agentId && !a.isMain)
          : agents.find((a) => a.name === name && !a.isMain))
        : agents.find((a) => a.agentId === agentId && !a.isMain);
      if (!target) return jsonResponse({ ok: false, msg: "没有找到要离开的 agent" }, 404);
      if (!isAdmin && String((target as any).selfLeaveToken || "") !== leaveToken) {
        return jsonResponse({ ok: false, msg: "leaveToken 不匹配，不能代替其他 agent 离开" }, 403);
      }
      const targetJoinKey = target.joinKey;
      const newAgents = agents.filter((a) => a.isMain || a.agentId !== target.agentId);
      const keys = await loadJoinKeys();
      if (targetJoinKey) {
        const keyItem = keys.keys.find((k) => k.key === targetJoinKey);
        if (keyItem) {
          keyItem.used = false;
          keyItem.usedBy = null;
          keyItem.usedByAgentId = null;
          keyItem.usedAt = null;
        }
      }
      await saveAgentsState(newAgents);
      await saveJoinKeys(keys);
      return jsonResponse({ ok: true, agentId: target.agentId, mode: isAdmin ? "admin" : "self-service" });
    });
  }

  if (req.method === "POST" && pathName === "/agent-push") {
    const data = await readBodyJson(req);
    if (!data || typeof data !== "object") return jsonResponse({ ok: false, msg: "invalid json" }, 400);
    const agentId = String(data.agentId || "").trim();
    const joinKey = String(data.joinKey || "").trim();
    const state = String(data.state || "").trim();
    const detail = String(data.detail || "").trim();
    const name = String(data.name || "").trim();
    if (!agentId || !joinKey || !state) {
      return jsonResponse({ ok: false, msg: "缺少 agentId/joinKey/state" }, 400);
    }

    const keys = await loadJoinKeys();
    const keyItem = keys.keys.find((k) => k.key === joinKey);
    if (!keyItem) return jsonResponse({ ok: false, msg: "joinKey 无效" }, 403);

    if (keyItem.expiresAt) {
      const exp = new Date(keyItem.expiresAt);
      if (!Number.isNaN(exp.getTime()) && new Date() > exp) {
        return jsonResponse({ ok: false, msg: "该接入密钥已过期，活动已结束 🎉" }, 403);
      }
    }

    const agents = await loadAgentsState(DEFAULT_AGENTS);
    const target = agents.find((a) => a.agentId === agentId && !a.isMain);
    if (!target) return jsonResponse({ ok: false, msg: "agent 未注册，请先 join" }, 404);

    const authStatus = target.authStatus || "pending";
    if (authStatus !== "approved" && authStatus !== "offline") {
      return jsonResponse({ ok: false, msg: "agent 未获授权，请等待主人批准" }, 403);
    }

    if (authStatus === "offline") {
      target.authStatus = "approved";
      target.authApprovedAt = new Date().toISOString();
      target.authExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }

    if (target.joinKey !== joinKey) {
      return jsonResponse({ ok: false, msg: "joinKey 不匹配" }, 403);
    }

    const normState = normalizeAgentState(state);
    target.state = normState;
    target.detail = detail;
    if (name) target.name = name;
    target.updated_at = new Date().toISOString();
    target.area = stateToArea(normState);
    target.source = "remote-openclaw";
    target.lastPushAt = new Date().toISOString();

    await saveAgentsState(agents);
    return jsonResponse({ ok: true, agentId, area: target.area });
  }

  if (req.method === "POST" && pathName === "/agent-skills/list") {
    if (!FEATURES.enableAgentSkillsApi) return featureDisabledResponse("agent-skills-api");
    const data = await readBodyJson(req);
    const auth = await authenticateSkillCaller(req, data);
    if (!auth.ok) return auth.response;
    const resolved = await readSkillsSnapshot();
    return jsonResponse({
      ok: true,
      skills: resolved.skills,
      count: resolved.skills.length,
      source: resolved.source,
      degraded: !!resolved.degraded,
      warnings: resolved.warnings || []
    });
  }

  if (req.method === "POST" && pathName === "/agent-skills/execute") {
    if (!FEATURES.enableAgentSkillsApi) return featureDisabledResponse("agent-skills-api");
    const data = await readBodyJson(req);
    if (!data || typeof data !== "object") return jsonResponse({ ok: false, msg: "invalid json" }, 400);
    const auth = await authenticateSkillCaller(req, data);
    if (!auth.ok) return auth.response;
    const skill = String(data.skill || "").trim();
    if (!skill) return jsonResponse({ ok: false, msg: "缺少 skill" }, 400);
    const result = await executeAgentSkill(skill, data.input || {});
    if (!result.ok) {
      return jsonResponse({ ok: false, msg: result.msg || "skill 执行失败", skill }, result.status || 400);
    }
    return jsonResponse({ ok: true, skill, result });
  }

  if (req.method === "GET" && pathName === "/yesterday-memo") {
    const result = await getYesterdayMemo();
    return jsonResponse(result);
  }

  if (pathName.startsWith("/assets/") && !FEATURES.enableAssetDecoration) {
    return featureDisabledResponse("asset-decoration");
  }

  if (pathName === "/assets/auth" && req.method === "POST") {
    const ip = getClientIp(req);
    if (hitRateLimit("assets-auth", ip, SECURITY.authRateLimitPerMinute)) {
      return jsonResponse({ ok: false, msg: "认证请求过于频繁，请稍后再试" }, 429);
    }
    const data = await readBodyJson(req);
    const pwd = String(data?.password || "").trim();
    if (pwd && pwd === SERVER.assetDrawerPass) {
      const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
      const secureAttr = SERVER.assetAuthCookieSecure ? "; Secure" : "";
      headers.append("Set-Cookie", `asset_editor_authed=1; Path=/; HttpOnly; SameSite=Lax${secureAttr}`);
      return new Response(JSON.stringify({ ok: true, msg: "认证成功" }), { status: 200, headers });
    }
    return jsonResponse({ ok: false, msg: "验证码错误" }, 401);
  }

  if (pathName === "/assets/auth/status" && req.method === "GET") {
    return jsonResponse({ ok: true, authed: isAssetAuthed(req), drawer_default_pass: SERVER.assetDrawerPass === "1234" });
  }

  if (pathName === "/assets/positions" && req.method === "GET") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    const items = await loadAssetPositions();
    return jsonResponse({ ok: true, items });
  }

  if (pathName === "/assets/positions" && req.method === "POST") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    const data = await readBodyJson(req);
    const key = String(data?.key || "").trim();
    const x = data?.x;
    const y = data?.y;
    let scale = data?.scale;
    if (!key) return jsonResponse({ ok: false, msg: "缺少 key" }, 400);
    if (x === undefined || y === undefined) return jsonResponse({ ok: false, msg: "缺少 x/y" }, 400);
    const nx = Number(x);
    const ny = Number(y);
    scale = scale === undefined ? 1.0 : Number(scale);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(scale)) {
      return jsonResponse({ ok: false, msg: "x/y/scale 必须为有限数值" }, 400);
    }
    const allPos = await loadAssetPositions();
    allPos[key] = { x: nx, y: ny, scale, updated_at: new Date().toISOString() };
    await saveAssetPositions(allPos);
    return jsonResponse({ ok: true, key, x: nx, y: ny, scale });
  }

  if (pathName === "/assets/defaults" && req.method === "GET") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    const items = await loadAssetDefaults();
    return jsonResponse({ ok: true, items });
  }

  if (pathName === "/assets/defaults" && req.method === "POST") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    const data = await readBodyJson(req);
    const key = String(data?.key || "").trim();
    const x = data?.x;
    const y = data?.y;
    let scale = data?.scale;
    if (!key) return jsonResponse({ ok: false, msg: "缺少 key" }, 400);
    if (x === undefined || y === undefined) return jsonResponse({ ok: false, msg: "缺少 x/y" }, 400);
    const nx = Number(x);
    const ny = Number(y);
    scale = scale === undefined ? 1.0 : Number(scale);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(scale)) {
      return jsonResponse({ ok: false, msg: "x/y/scale 必须为有限数值" }, 400);
    }
    const allDefaults = await loadAssetDefaults();
    allDefaults[key] = { x: nx, y: ny, scale, updated_at: new Date().toISOString() };
    await saveAssetDefaults(allDefaults);
    return jsonResponse({ ok: true, key, x: nx, y: ny, scale });
  }

  if (pathName === "/assets/list" && req.method === "GET") {
    const items: any[] = [];
    const allowedExts = new Set([".png", ".webp", ".jpg", ".jpeg", ".gif", ".svg", ".avif"]);
    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          const rel = path.relative(PATHS.frontendRoot, full).replace(/\\/g, "/");
          if (rel.startsWith("fonts/")) continue;
          const ext = path.extname(entry.name).toLowerCase();
          if (!allowedExts.has(ext)) continue;
          const st = await fs.stat(full);
          const sizeInfo = await readImageSize(full);
          items.push({
            path: rel,
            size: st.size,
            ext,
            width: sizeInfo?.width ?? null,
            height: sizeInfo?.height ?? null,
            mtime: new Date(st.mtimeMs).toISOString()
          });
        }
      }
    }
    await walk(PATHS.frontendRoot);
    items.sort((a, b) => a.path.localeCompare(b.path));
    return jsonResponse({ ok: true, count: items.length, items });
  }

  if (pathName === "/assets/template.zip" && req.method === "GET") {
    if (!(await fileExists(PATHS.assetsTemplateZip))) {
      return jsonResponse({ ok: false, msg: "模板包不存在，请先生成" }, 404);
    }
    return serveFile(PATHS.assetsTemplateZip, "application/zip");
  }

  if (pathName === "/assets/upload" && req.method === "POST") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    const form = await req.formData();
    const relPath = String(form.get("path") || "").trim().replace(/^\/+/, "");
    const backup = String(form.get("backup") || "1") !== "0";
    const file = form.get("file");
    if (!relPath || !(file instanceof File)) {
      return jsonResponse({ ok: false, msg: "缺少 path 或 file" }, 400);
    }
    const target = path.resolve(PATHS.frontendRoot, relPath);
    if (!isSubPath(PATHS.frontendRoot, target)) {
      return jsonResponse({ ok: false, msg: "非法 path" }, 400);
    }
    const ext = path.extname(target).toLowerCase();
    const allowedExts = new Set([".png", ".webp", ".jpg", ".jpeg", ".gif", ".svg", ".avif"]);
    if (!allowedExts.has(ext)) {
      return jsonResponse({ ok: false, msg: "仅允许上传图片/美术资源类型" }, 400);
    }
    if (!(await fileExists(target))) {
      return jsonResponse({ ok: false, msg: "目标文件不存在，请先从 /assets/list 选择 path" }, 404);
    }
    if (file.size > SERVER.maxUploadBytes) {
      return jsonResponse({ ok: false, msg: `文件过大，最大允许 ${SERVER.maxUploadBytes} bytes` }, 413);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });

    const defaultSnap = `${target}.default`;
    if (!(await fileExists(defaultSnap))) {
      await copyFileSafe(target, defaultSnap);
    }

    if (backup) {
      await copyFileSafe(target, `${target}.bak`);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(target, buf);
    const st = await fs.stat(target);
    return jsonResponse({ ok: true, path: relPath, size: st.size, msg: "上传成功" });
  }

  if (pathName === "/assets/restore-default" && req.method === "POST") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    const data = await readBodyJson(req);
    const relPath = String(data?.path || "").trim().replace(/^\/+/, "");
    if (!relPath) return jsonResponse({ ok: false, msg: "缺少 path" }, 400);
    const target = path.resolve(PATHS.frontendRoot, relPath);
    if (!isSubPath(PATHS.frontendRoot, target)) {
      return jsonResponse({ ok: false, msg: "非法 path" }, 400);
    }
    if (!(await fileExists(target))) {
      return jsonResponse({ ok: false, msg: "目标文件不存在" }, 404);
    }
    const defaultPath = `${target}.default`;
    if (!(await fileExists(defaultPath))) {
      return jsonResponse({ ok: false, msg: "未找到默认资产快照" }, 404);
    }
    await copyFileSafe(target, `${target}.bak`);
    await copyFileSafe(defaultPath, target);
    const st = await fs.stat(target);
    return jsonResponse({ ok: true, path: relPath, size: st.size, msg: "已重置为默认资产" });
  }

  if (pathName === "/assets/restore-prev" && req.method === "POST") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    const data = await readBodyJson(req);
    const relPath = String(data?.path || "").trim().replace(/^\/+/, "");
    if (!relPath) return jsonResponse({ ok: false, msg: "缺少 path" }, 400);
    const target = path.resolve(PATHS.frontendRoot, relPath);
    if (!isSubPath(PATHS.frontendRoot, target)) {
      return jsonResponse({ ok: false, msg: "非法 path" }, 400);
    }
    const bakPath = `${target}.bak`;
    if (!(await fileExists(bakPath))) {
      return jsonResponse({ ok: false, msg: "未找到上一版备份" }, 404);
    }
    if (await fileExists(target)) {
      await copyFileSafe(target, `${target}.bak.tmp`);
    }
    await copyFileSafe(bakPath, target);
    const st = await fs.stat(target);
    return jsonResponse({ ok: true, path: relPath, size: st.size, msg: "已回退到上一版" });
  }

  if (pathName === "/assets/restore-reference-background" && req.method === "POST") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    const target = path.resolve(PATHS.frontendRoot, "office_bg_small.webp");
    if (!(await fileExists(target))) {
      return jsonResponse({ ok: false, msg: "office_bg_small.webp 不存在" }, 404);
    }
    const refWebp = path.resolve(PATHS.assetsDir, "room-reference.webp");
    const refPng = path.resolve(PATHS.assetsDir, "room-reference.png");
    let ref = refWebp;
    if (!(await fileExists(refWebp))) {
      ref = refPng;
    }
    if (!(await fileExists(ref))) {
      return jsonResponse({ ok: false, msg: "参考图不存在" }, 404);
    }
    await copyFileSafe(target, `${target}.bak`);
    await copyFileSafe(ref, target);
    const st = await fs.stat(target);
    return jsonResponse({ ok: true, path: "office_bg_small.webp", size: st.size, msg: "已恢复参考背景" });
  }

  if (pathName.startsWith("/assets/home-favorites") && req.method === "GET") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    if (pathName === "/assets/home-favorites/list") {
      const idx = await loadHomeFavoritesIndex();
      const items = (idx.items || []).map((it) => {
        const rel = String(it.path || "");
        const fn = path.basename(rel);
        return {
          id: it.id,
          path: rel,
          url: `/assets/home-favorites/file/${fn}`,
          thumb_url: `/assets/home-favorites/file/${fn}`,
          created_at: it.created_at || ""
        };
      });
      items.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      return jsonResponse({ ok: true, items });
    }
    if (pathName.startsWith("/assets/home-favorites/file/")) {
      const filename = pathName.replace("/assets/home-favorites/file/", "");
      const safePath = path.resolve(PATHS.homeFavoritesDir, filename);
      if (!isSubPath(PATHS.homeFavoritesDir, safePath)) {
        return jsonResponse({ ok: false, msg: "非法 path" }, 400);
      }
      return serveFile(safePath);
    }
  }

  if (pathName === "/assets/home-favorites/save-current" && req.method === "POST") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    const src = path.resolve(PATHS.frontendRoot, "office_bg_small.webp");
    if (!(await fileExists(src))) {
      return jsonResponse({ ok: false, msg: "office_bg_small.webp 不存在" }, 404);
    }
    await ensureHomeFavoritesIndex();
    const ts = new Date();
    const tsId = ts.toISOString().replace(/[-:]/g, "").replace("T", "-").split(".")[0];
    const itemId = `home-${tsId}`;
    const filename = `${itemId}.webp`;
    const dst = path.resolve(PATHS.homeFavoritesDir, filename);
    await copyFileSafe(src, dst);
    const idx = await loadHomeFavoritesIndex();
    const items = idx.items || [];
    items.unshift({
      id: itemId,
      path: path.relative(PATHS.projectRoot, dst).replace(/\\/g, "/"),
      created_at: new Date().toISOString().slice(0, 19)
    });

    const max = 30;
    if (items.length > max) {
      const extra = items.slice(max);
      items.length = max;
      for (const it of extra) {
        const p = path.resolve(PATHS.projectRoot, it.path || "");
        if (isSubPath(PATHS.projectRoot, p)) {
          await fs.unlink(p).catch(() => undefined);
        }
      }
    }

    idx.items = items;
    await saveHomeFavoritesIndex(idx);
    return jsonResponse({ ok: true, id: itemId, path: path.relative(PATHS.projectRoot, dst).replace(/\\/g, "/"), msg: "已收藏当前地图" });
  }

  if (pathName === "/assets/home-favorites/delete" && req.method === "POST") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    const data = await readBodyJson(req);
    const itemId = String(data?.id || "").trim();
    if (!itemId) return jsonResponse({ ok: false, msg: "缺少 id" }, 400);
    const idx = await loadHomeFavoritesIndex();
    const items = idx.items || [];
    const hit = items.find((it) => String(it.id || "") === itemId);
    if (!hit) return jsonResponse({ ok: false, msg: "收藏项不存在" }, 404);
    const rel = String(hit.path || "");
    const abs = path.resolve(PATHS.projectRoot, rel);
    if (isSubPath(PATHS.projectRoot, abs)) {
      await fs.unlink(abs).catch(() => undefined);
    }
    idx.items = items.filter((it) => String(it.id || "") !== itemId);
    await saveHomeFavoritesIndex(idx);
    return jsonResponse({ ok: true, id: itemId, msg: "已删除收藏" });
  }

  if (pathName === "/assets/home-favorites/apply" && req.method === "POST") {
    const guard = requireAssetAuth(req);
    if (guard) return guard;
    const data = await readBodyJson(req);
    const itemId = String(data?.id || "").trim();
    if (!itemId) return jsonResponse({ ok: false, msg: "缺少 id" }, 400);
    const idx = await loadHomeFavoritesIndex();
    const items = idx.items || [];
    const hit = items.find((it) => String(it.id || "") === itemId);
    if (!hit) return jsonResponse({ ok: false, msg: "收藏项不存在" }, 404);
    const src = path.resolve(PATHS.projectRoot, String(hit.path || ""));
    if (!(await fileExists(src))) {
      return jsonResponse({ ok: false, msg: "收藏文件不存在" }, 404);
    }
    const target = path.resolve(PATHS.frontendRoot, "office_bg_small.webp");
    if (!(await fileExists(target))) {
      return jsonResponse({ ok: false, msg: "office_bg_small.webp 不存在" }, 404);
    }
    await copyFileSafe(target, `${target}.bak`);
    await copyFileSafe(src, target);
    const st = await fs.stat(target);
    return jsonResponse({ ok: true, path: "office_bg_small.webp", size: st.size, from: hit.path, msg: "已应用收藏地图" });
  }

  // Static file serving for frontend assets
  if (req.method === "GET" && (pathName === "/" || pathName === "/join" || pathName === "/invite")) {
    const fileMap: Record<string, string> = {
      "/": path.join(PATHS.frontendRoot, "index.html"),
      "/join": path.join(PATHS.frontendRoot, "join.html"),
      "/invite": path.join(PATHS.frontendRoot, "invite.html")
    };
    const filePath = fileMap[pathName];
    const html = await fs.readFile(filePath, "utf-8");
    return textResponse(html.replace("{{VERSION_TIMESTAMP}}", new Date().toISOString().replace(/[:.]/g, "_")));
  }

  if (req.method === "GET" && pathName.startsWith("/static/")) {
    const rel = pathName.replace("/static/", "");
    const filePath = path.resolve(PATHS.frontendRoot, rel);
    if (!isSubPath(PATHS.frontendRoot, filePath)) {
      return jsonResponse({ ok: false, msg: "非法 path" }, 400);
    }
    return serveFile(filePath);
  }

  return jsonResponse({ ok: false, msg: "not found" }, 404);
}

export function withCacheHeaders(resp: Response, req: Request) {
  const url = new URL(req.url);
  return withNoCacheHeaders(resp, url.pathname);
}
