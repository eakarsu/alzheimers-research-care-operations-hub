#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Local/test acceptance uses a real database account and an ephemeral signing
# key. Production remains organization-SSO-only.
if [[ "${NODE_ENV:-development}" == "test" && -z "${ENABLE_LOCAL_PASSWORD_AUTH:-}" ]]; then
  export ENABLE_LOCAL_PASSWORD_AUTH=true
fi

case "${1:-start}" in
  check) exec npm run check ;;
  migrate)
    if [[ "${ALLOW_SCHEMA_MIGRATION:-0}" != "1" ]]; then
      echo "Refusing migration: set ALLOW_SCHEMA_MIGRATION=1 explicitly" >&2
      exit 1
    fi
    exec npm run migrate
    ;;
  start) exec npm start ;;
  *) echo "Usage: $0 [check|migrate|start]" >&2; exit 64 ;;
esac
