export type MainState = {
  state: string;
  detail: string;
  progress?: number;
  updated_at: string;
  ttl_seconds?: number;
  officeName?: string;
  capabilities?: {
    stateControl?: boolean;
    assetDecoration?: boolean;
    agentSkillsApi?: boolean;
  };
};

export type Agent = {
  agentId: string;
  name: string;
  isMain?: boolean;
  state?: string;
  detail?: string;
  updated_at?: string;
  area?: string;
  source?: string;
  joinKey?: string | null;
  authStatus?: string;
  authExpiresAt?: string | null;
  authApprovedAt?: string | null;
  authRejectedAt?: string | null;
  lastPushAt?: string | null;
  selfLeaveToken?: string | null;
};

export type JoinKeyItem = {
  key: string;
  used?: boolean;
  reusable?: boolean;
  maxConcurrent?: number;
  usedBy?: string | null;
  usedByAgentId?: string | null;
  usedAt?: string | null;
  expiresAt?: string | null;
};

export type JoinKeysFile = {
  keys: JoinKeyItem[];
};

export type OpenclawSkillsCache = {
  ok: boolean;
  source: string;
  skills: any[];
  count: number;
  degraded: boolean;
  warnings: string[];
  note: string;
  syncedAt: string;
};

export type OpenclawUsageCache = {
  ok: boolean;
  mode: string;
  currency: string;
  summary: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  byModel: Array<Record<string, any>>;
  byChannel: Array<Record<string, any>>;
  costPolicy: {
    inputCostPer1k: number;
    outputCostPer1k: number;
  };
  note: string;
  degraded: boolean;
  warnings: string[];
  syncedAt: string;
};

export type AssetPosition = {
  x: number;
  y: number;
  scale?: number;
  updated_at?: string;
};

export type AssetPositions = Record<string, AssetPosition>;
export type AssetDefaults = Record<string, AssetPosition>;
