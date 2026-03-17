#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
STATE_FILE="$ROOT_DIR/state.json"
JOIN_KEYS_FILE="$ROOT_DIR/join-keys.json"
LOG_FILE="${BOOTSTRAP_LOG_FILE:-/tmp/star-office-bootstrap.log}"

if [[ ! -x "$BUN_BIN" ]]; then
  echo "❌ Bun not found at: $BUN_BIN"
  echo "   Set BUN_BIN or install bun first."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "✅ Created .env from .env.example"
fi

if [[ ! -f "$STATE_FILE" ]]; then
  printf '{\n  "state": "idle",\n  "detail": "等待任务中...",\n  "progress": 0,\n  "updated_at": "%s"\n}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE_FILE"
  echo "✅ Initialized state.json with production-safe defaults"
fi

if [[ ! -f "$JOIN_KEYS_FILE" ]]; then
  printf '{\n  "keys": []\n}\n' > "$JOIN_KEYS_FILE"
  echo "✅ Initialized join-keys.json as empty production inventory"
fi

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*$|${key}=${value}|" "$ENV_FILE"
  else
    printf "\n%s=%s\n" "$key" "$value" >> "$ENV_FILE"
  fi
}

read_env_file() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

rand_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return
  fi
  date +%s | sha256sum | cut -c1-48
}

rand_pass() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20
    return
  fi
  date +%s | sha256sum | cut -c1-20
}

read_env_file

upsert_env "STAR_OFFICE_ENV" "production"

ASSET_PASS="${ASSET_DRAWER_PASS:-}"
if [[ -z "$ASSET_PASS" || "$ASSET_PASS" == "1234" || "$ASSET_PASS" == "replace_with_strong_password" ]]; then
  ASSET_PASS="$(rand_pass)"
  upsert_env "ASSET_DRAWER_PASS" "$ASSET_PASS"
  echo "✅ Generated ASSET_DRAWER_PASS"
fi

API_TOKEN="${STAR_OFFICE_API_TOKEN:-}"
if [[ -z "$API_TOKEN" || "$API_TOKEN" == "replace_with_long_random_token" ]]; then
  API_TOKEN="$(rand_token)"
  upsert_env "STAR_OFFICE_API_TOKEN" "$API_TOKEN"
  echo "✅ Generated STAR_OFFICE_API_TOKEN"
fi

BASE_URL="${OPENCLAW_API_BASE_URL:-}"
SKILLS_URL="${OPENCLAW_SKILLS_SOURCE_URL:-}"
USAGE_URL="${OPENCLAW_USAGE_SOURCE_URL:-}"
STRICT_SOURCE_HEALTH="${OPENCLAW_REQUIRE_HEALTHY_SOURCE:-0}"

if [[ -n "$BASE_URL" ]]; then
  BASE_URL="${BASE_URL%/}"
  if [[ -z "$SKILLS_URL" ]]; then
    SKILLS_URL="${BASE_URL}/skills"
    upsert_env "OPENCLAW_SKILLS_SOURCE_URL" "$SKILLS_URL"
    echo "✅ Derived OPENCLAW_SKILLS_SOURCE_URL from OPENCLAW_API_BASE_URL"
  fi
  if [[ -z "$USAGE_URL" ]]; then
    USAGE_URL="${BASE_URL}/usage"
    upsert_env "OPENCLAW_USAGE_SOURCE_URL" "$USAGE_URL"
    echo "✅ Derived OPENCLAW_USAGE_SOURCE_URL from OPENCLAW_API_BASE_URL"
  fi
fi

read_env_file
STRICT_SOURCE_HEALTH="${OPENCLAW_REQUIRE_HEALTHY_SOURCE:-0}"

echo "== Installing dependencies =="
"$BUN_BIN" install >/dev/null

HOST_VAL="${HOST:-127.0.0.1}"
PORT_VAL="${PORT:-19000}"
BASE_LOCAL_URL="http://${HOST_VAL}:${PORT_VAL}"

server_started_by_script=0
server_pid=""

cleanup() {
  if [[ "$server_started_by_script" -eq 1 && -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! curl -fsS "${BASE_LOCAL_URL}/health" >/dev/null 2>&1; then
  echo "== Starting local service for validation =="
  "$BUN_BIN" run server/index.ts >"$LOG_FILE" 2>&1 &
  server_pid="$!"
  server_started_by_script=1
  for _ in {1..30}; do
    if curl -fsS "${BASE_LOCAL_URL}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

check_endpoint() {
  local path="$1"
  if ! curl -fsS "${BASE_LOCAL_URL}${path}" >/dev/null 2>&1; then
    echo "❌ Validation failed: ${path}"
    echo "   check log: ${LOG_FILE}"
    exit 1
  fi
  echo "✅ ${path}"
}

json_field() {
  local payload="$1"
  local expr="$2"
  printf '%s' "$payload" | "$BUN_BIN" -e '
    const expr = process.argv[1] || "";
    const input = await new Response(Bun.stdin.stream()).text();
    const data = JSON.parse(input || "{}");
    let value = data;
    for (const key of expr.split(".").filter(Boolean)) value = value?.[key];
    if (value === undefined || value === null) process.exit(2);
    if (typeof value === "object") process.stdout.write(JSON.stringify(value));
    else process.stdout.write(String(value));
  ' "$expr"
}

inspect_openclaw_endpoint() {
  local path="$1"
  local label="$2"
  local field="$3"
  local payload
  payload="$(curl -fsS "${BASE_LOCAL_URL}${path}")" || {
    echo "❌ Validation failed: ${path}"
    echo "   check log: ${LOG_FILE}"
    exit 1
  }

  local ok value quality
  ok="$(json_field "$payload" "ok" 2>/dev/null || true)"
  value="$(json_field "$payload" "$field" 2>/dev/null || true)"
  if [[ "$ok" != "true" ]]; then
    echo "❌ Validation failed: ${path} returned ok=${ok:-missing}"
    echo "   check log: ${LOG_FILE}"
    exit 1
  fi

  quality="healthy"
  if [[ -z "$value" ]]; then
    quality="degraded"
  elif [[ "$value" == *fallback* || "$value" == "estimated" ]]; then
    quality="degraded"
  fi

  echo "✅ ${path} (${label}: ${value:-unknown}, quality: ${quality})"
  LAST_ENDPOINT_VALUE="$value"
  LAST_ENDPOINT_QUALITY="$quality"
}

echo "== Running validation checks =="
check_endpoint "/health"
check_endpoint "/status"
inspect_openclaw_endpoint "/openclaw/skills" "source" "source"
skills_source_label="${LAST_ENDPOINT_VALUE:-unknown}"
skills_quality="${LAST_ENDPOINT_QUALITY:-degraded}"
inspect_openclaw_endpoint "/openclaw/usage" "mode" "mode"
usage_source_label="${LAST_ENDPOINT_VALUE:-unknown}"
usage_quality="${LAST_ENDPOINT_QUALITY:-degraded}"

short_token="${STAR_OFFICE_API_TOKEN:0:6}***"
overall_readiness="yes"
if [[ "$skills_quality" == "degraded" || "$usage_quality" == "degraded" ]]; then
  overall_readiness="degraded"
fi
if [[ "$STRICT_SOURCE_HEALTH" == "1" && "$overall_readiness" == "degraded" ]]; then
  overall_readiness="failed"
fi
echo ""
echo "==== OpenClaw bootstrap summary ===="
echo "env: production"
echo "host: ${HOST_VAL}"
echo "port: ${PORT_VAL}"
echo "skills source: ${skills_source_label}"
echo "usage source: ${usage_source_label}"
echo "skills quality: ${skills_quality}"
echo "usage quality: ${usage_quality}"
echo "require healthy source: ${STRICT_SOURCE_HEALTH}"
echo "api token: ${short_token}"
echo "ready: ${overall_readiness}"
if [[ "$overall_readiness" == "degraded" ]]; then
  echo "note: service is reachable, but OpenClaw panels are currently using fallback data."
fi
if [[ "$overall_readiness" == "failed" ]]; then
  echo "note: strict mode is enabled and panel data is degraded."
  exit 1
fi
