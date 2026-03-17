#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
STATE_FILE="$ROOT_DIR/state.json"
STATE_SAMPLE="$ROOT_DIR/state.sample.json"
JOIN_KEYS_FILE="$ROOT_DIR/join-keys.json"
JOIN_KEYS_SAMPLE="$ROOT_DIR/join-keys.sample.json"
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

if [[ ! -f "$STATE_FILE" && -f "$STATE_SAMPLE" ]]; then
  cp "$STATE_SAMPLE" "$STATE_FILE"
  echo "✅ Initialized state.json from sample"
fi

if [[ ! -f "$JOIN_KEYS_FILE" && -f "$JOIN_KEYS_SAMPLE" ]]; then
  cp "$JOIN_KEYS_SAMPLE" "$JOIN_KEYS_FILE"
  echo "✅ Initialized join-keys.json from sample"
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

echo "== Running validation checks =="
check_endpoint "/health"
check_endpoint "/status"
check_endpoint "/openclaw/skills"
check_endpoint "/openclaw/usage"

short_token="${STAR_OFFICE_API_TOKEN:0:6}***"
skills_source_label="${OPENCLAW_SKILLS_SOURCE_URL:-openclaw-cli-or-local-fallback}"
usage_source_label="${OPENCLAW_USAGE_SOURCE_URL:-openclaw-cli-or-local-fallback}"
echo ""
echo "==== OpenClaw bootstrap summary ===="
echo "env: production"
echo "host: ${HOST_VAL}"
echo "port: ${PORT_VAL}"
echo "skills source: ${skills_source_label}"
echo "usage source: ${usage_source_label}"
echo "api token: ${short_token}"
echo "ready: yes"
