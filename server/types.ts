export type MainState = {
  state: string;
  detail: string;
  progress?: number;
  updated_at: string;
  ttl_seconds?: number;
  officeName?: string;
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

export type AssetPosition = {
  x: number;
  y: number;
  scale?: number;
  updated_at?: string;
};

export type AssetPositions = Record<string, AssetPosition>;
export type AssetDefaults = Record<string, AssetPosition>;
