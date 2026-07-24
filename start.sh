#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"
[[ -f .env ]] || { echo '.env is required' >&2; exit 1; }
migration_override="${ALLOW_SCHEMA_MIGRATION:-}"
set -a
source .env
set +a
[[ -z "$migration_override" ]] || export ALLOW_SCHEMA_MIGRATION="$migration_override"

configure() {
  local name value
  for name in DATABASE_URL JWT_SECRET BACKEND_PORT FRONTEND_PORT OPENROUTER_API_KEY OPENROUTER_MODEL OPENROUTER_BASE_URL; do
    value="${!name:-}"
    [[ -n "$value" ]] || { echo "$name is required" >&2; exit 1; }
  done
  [[ ${#JWT_SECRET} -ge 32 ]] || { echo 'JWT_SECRET must contain at least 32 characters' >&2; exit 1; }
  [[ "$OPENROUTER_BASE_URL" == 'https://openrouter.ai/api/v1' ]] || { echo 'OPENROUTER_BASE_URL is invalid' >&2; exit 1; }
  [[ "$BACKEND_PORT" =~ ^[0-9]+$ && "$FRONTEND_PORT" =~ ^[0-9]+$ ]] || { echo 'runtime ports must be numeric' >&2; exit 1; }
  [[ "$BACKEND_PORT" != "$FRONTEND_PORT" ]] || { echo 'BACKEND_PORT and FRONTEND_PORT must differ' >&2; exit 1; }
}

case "${1:-start}" in
  check)
    configure
    npm run build
    npm run check
    ;;
  migrate)
    configure
    [[ "${ALLOW_SCHEMA_MIGRATION:-0}" == 1 ]] || { echo 'Refusing migration: set ALLOW_SCHEMA_MIGRATION=1 explicitly' >&2; exit 1; }
    npm run migrate
    ;;
  start)
    configure
    [[ -d node_modules ]] || { echo 'dependencies are not installed' >&2; exit 1; }
    for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
      if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "runtime port $port is occupied" >&2; exit 1; fi
    done
    psql "$DATABASE_URL" -Atqc 'SELECT 1' >/dev/null
    echo "Starting Alzheimer's Research & Care Operations Hub API on $BACKEND_PORT and UI on $FRONTEND_PORT; persistent state is unchanged."
    exec node runtime-launcher.js
    ;;
  *) echo "Usage: $0 [check|migrate|start]" >&2; exit 64;;
esac
