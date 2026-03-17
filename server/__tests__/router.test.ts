import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { PATHS, SECURITY } from "../config";
import { handleRequest, __resetRouterForTests } from "../router";
import { createDefaultMainState } from "../storage";
import { DEFAULT_AGENTS } from "../utils";

type BackupEntry = {
  exists: boolean;
  content: string | null;
};

const BACKUP_TARGETS = [
  PATHS.stateFile,
  PATHS.agentsStateFile,
  PATHS.joinKeysFile
];

const backups = new Map<string, BackupEntry>();
const originalOpenclawBin = process.env.OPENCLAW_BIN;
const originalSkillsSource = process.env.OPENCLAW_SKILLS_SOURCE_URL;
const originalUsageSource = process.env.OPENCLAW_USAGE_SOURCE_URL;
const originalRequireHealthySource = process.env.OPENCLAW_REQUIRE_HEALTHY_SOURCE;

async function backupFile(filePath: string) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    backups.set(filePath, { exists: true, content });
  } catch {
    backups.set(filePath, { exists: false, content: null });
  }
}

async function restoreFile(filePath: string) {
  const snapshot = backups.get(filePath);
  if (!snapshot) return;
  if (!snapshot.exists) {
    await fs.rm(filePath, { force: true });
    return;
  }
  await fs.writeFile(filePath, snapshot.content || "", "utf-8");
}

async function seedRuntimeFiles() {
  await fs.writeFile(PATHS.stateFile, JSON.stringify(createDefaultMainState(), null, 2), "utf-8");
  await fs.writeFile(PATHS.agentsStateFile, JSON.stringify(DEFAULT_AGENTS, null, 2), "utf-8");
  await fs.writeFile(PATHS.joinKeysFile, JSON.stringify({
    keys: [
      { key: "ocj_test_1", used: false, reusable: true, maxConcurrent: 3, usedBy: null, usedByAgentId: null, usedAt: null },
      { key: "ocj_test_2", used: false, reusable: true, maxConcurrent: 3, usedBy: null, usedByAgentId: null, usedAt: null }
    ]
  }, null, 2), "utf-8");
}

async function requestJson(pathName: string, init?: RequestInit) {
  const headers = new Headers(init?.headers || {});
  if (pathName.startsWith("/agent-skills/") && SECURITY.apiToken && !headers.has("authorization")) {
    headers.set("Authorization", `Bearer ${SECURITY.apiToken}`);
  }
  const req = new Request(`http://local.test${pathName}`, { ...init, headers });
  const resp = await handleRequest(req);
  const text = await resp.text();
  return {
    status: resp.status,
    body: text ? JSON.parse(text) : null
  };
}

beforeAll(async () => {
  for (const filePath of BACKUP_TARGETS) {
    await backupFile(filePath);
  }
});

beforeEach(async () => {
  __resetRouterForTests();
  process.env.OPENCLAW_BIN = originalOpenclawBin;
  process.env.OPENCLAW_SKILLS_SOURCE_URL = originalSkillsSource;
  process.env.OPENCLAW_USAGE_SOURCE_URL = originalUsageSource;
  process.env.OPENCLAW_REQUIRE_HEALTHY_SOURCE = originalRequireHealthySource;
  await seedRuntimeFiles();
});

afterAll(async () => {
  for (const filePath of BACKUP_TARGETS) {
    await restoreFile(filePath);
  }
  process.env.OPENCLAW_BIN = originalOpenclawBin;
  process.env.OPENCLAW_SKILLS_SOURCE_URL = originalSkillsSource;
  process.env.OPENCLAW_USAGE_SOURCE_URL = originalUsageSource;
  process.env.OPENCLAW_REQUIRE_HEALTHY_SOURCE = originalRequireHealthySource;
  __resetRouterForTests();
});

describe("router high-risk flows", () => {
  test("join-agent rejects duplicate names unless reconnecting with the same agentId", async () => {
    const first = await requestJson("/join-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dup-name", joinKey: "ocj_test_1" })
    });

    expect(first.status).toBe(200);
    expect(first.body?.ok).toBe(true);
    expect(typeof first.body?.agentId).toBe("string");

    const second = await requestJson("/join-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dup-name", joinKey: "ocj_test_2" })
    });

    expect(second.status).toBe(409);
    expect(second.body?.ok).toBe(false);
    expect(String(second.body?.msg || "")).toContain("名字已被占用");
  });

  test("leave-agent supports self-service leave and keeps tokens out of /agents", async () => {
    const joined = await requestJson("/join-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "self-leave", joinKey: "ocj_test_1" })
    });

    expect(joined.status).toBe(200);
    expect(joined.body?.ok).toBe(true);
    expect(typeof joined.body?.agentId).toBe("string");
    expect(typeof joined.body?.leaveToken).toBe("string");

    const leave = await requestJson("/leave-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: joined.body.agentId,
        leaveToken: joined.body.leaveToken
      })
    });

    expect(leave.status).toBe(200);
    expect(leave.body?.ok).toBe(true);
    expect(leave.body?.mode).toBe("self-service");

    const agents = await requestJson("/agents");
    expect(agents.status).toBe(200);
    expect(Array.isArray(agents.body)).toBe(true);
    expect(agents.body.some((agent: any) => agent.name === "self-leave")).toBe(false);
    expect(JSON.stringify(agents.body)).not.toContain("selfLeaveToken");
    expect(JSON.stringify(agents.body)).not.toContain("joinKey");
  });

  test("skills and usage endpoints expose degraded metadata when only fallback data is available", async () => {
    process.env.OPENCLAW_BIN = "definitely-missing-openclaw-bin";
    delete process.env.OPENCLAW_SKILLS_SOURCE_URL;
    delete process.env.OPENCLAW_USAGE_SOURCE_URL;
    __resetRouterForTests();

    const skills = await requestJson("/openclaw/skills");
    expect(skills.status).toBe(200);
    expect(skills.body?.ok).toBe(true);
    expect(skills.body?.degraded).toBe(true);
    expect(skills.body?.source).toBe("local-catalog-fallback");
    expect(Array.isArray(skills.body?.warnings)).toBe(true);
    expect(skills.body.warnings.length).toBeGreaterThan(0);

    const usage = await requestJson("/openclaw/usage");
    expect(usage.status).toBe(200);
    expect(usage.body?.ok).toBe(true);
    expect(usage.body?.degraded).toBe(true);
    expect(usage.body?.mode).toBe("estimated");
    expect(Array.isArray(usage.body?.warnings)).toBe(true);
    expect(usage.body.warnings.length).toBeGreaterThan(0);
  });

  test("strict mode rejects degraded skills and usage responses", async () => {
    process.env.OPENCLAW_BIN = "definitely-missing-openclaw-bin";
    delete process.env.OPENCLAW_SKILLS_SOURCE_URL;
    delete process.env.OPENCLAW_USAGE_SOURCE_URL;
    process.env.OPENCLAW_REQUIRE_HEALTHY_SOURCE = "1";
    __resetRouterForTests();

    const skills = await requestJson("/openclaw/skills");
    expect(skills.status).toBe(503);
    expect(skills.body?.ok).toBe(false);
    expect(skills.body?.code).toBe("DEGRADED_OPENCLAW_SOURCE");
    expect(skills.body?.kind).toBe("skills");
    expect(skills.body?.strict).toBe(true);

    const usage = await requestJson("/openclaw/usage");
    expect(usage.status).toBe(503);
    expect(usage.body?.ok).toBe(false);
    expect(usage.body?.code).toBe("DEGRADED_OPENCLAW_SOURCE");
    expect(usage.body?.kind).toBe("usage");
    expect(usage.body?.strict).toBe(true);
  });

  test("agent-push updates the joined agent state when joinKey matches", async () => {
    const joined = await requestJson("/join-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "pusher", joinKey: "ocj_test_1" })
    });

    expect(joined.status).toBe(200);
    expect(joined.body?.ok).toBe(true);

    const pushed = await requestJson("/agent-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: joined.body.agentId,
        joinKey: "ocj_test_1",
        state: "writing",
        detail: "syncing notes",
        name: "pusher"
      })
    });

    expect(pushed.status).toBe(200);
    expect(pushed.body?.ok).toBe(true);

    const agents = await requestJson("/agents");
    const hit = agents.body.find((agent: any) => agent.agentId === joined.body.agentId);
    expect(hit?.state).toBe("writing");
    expect(hit?.detail).toBe("syncing notes");
  });

  test("agent-skills/execute updates main state through the skill API", async () => {
    const result = await requestJson("/agent-skills/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skill: "openclaw.set-main-state",
        input: {
          state: "syncing",
          detail: "running skill"
        }
      })
    });

    expect(result.status).toBe(200);
    expect(result.body?.ok).toBe(true);

    const status = await requestJson("/status");
    expect(status.status).toBe(200);
    expect(status.body?.state).toBe("syncing");
    expect(status.body?.detail).toBe("running skill");
  });
});
