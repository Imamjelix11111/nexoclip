#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."

DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-.env.production}"
DEPLOY_COMPOSE_FILE="${DEPLOY_COMPOSE_FILE:-docker-compose.prod.yml}"
DEPLOY_PROJECT_NAME="${DEPLOY_PROJECT_NAME:-nexoclip}"
compose=(docker compose --project-name "$DEPLOY_PROJECT_NAME" --env-file "$DEPLOY_ENV_FILE" -f "$DEPLOY_COMPOSE_FILE")

show_failure_logs() {
  local exit_code=$?
  echo "Deployment failed at line $LINENO." >&2
  "${compose[@]}" ps >&2 || true
  "${compose[@]}" logs --tail=100 >&2 || true
  exit "$exit_code"
}
trap show_failure_logs ERR

if [[ "$(uname -m)" != "x86_64" && "${DEPLOY_ALLOW_NON_AMD64:-0}" != "1" ]]; then
  echo "This deployment requires x86_64/AMD64. Set DEPLOY_ALLOW_NON_AMD64=1 only for local Docker Desktop testing." >&2
  exit 1
fi
[[ -f "$DEPLOY_ENV_FILE" ]] || { echo "Copy .env.production.example to .env.production first." >&2; exit 1; }

if mode=$(stat -c '%a' "$DEPLOY_ENV_FILE" 2>/dev/null); then :; else mode=$(stat -f '%Lp' "$DEPLOY_ENV_FILE"); fi
(( 10#$mode <= 600 )) || { echo "$DEPLOY_ENV_FILE must be chmod 600." >&2; exit 1; }

set -a; . "./$DEPLOY_ENV_FILE"; set +a; NODE_ENV=production npm run config:check
"${compose[@]}" config --quiet

case "${1:-}" in
  "") ;;
  --pull) "${compose[@]}" pull --ignore-buildable ;;
  *) echo "Usage: $0 [--pull]" >&2; exit 2 ;;
esac

"${compose[@]}" build
"${compose[@]}" up -d redis
"${compose[@]}" run --rm nexoclip-migrate
"${compose[@]}" run --rm spite-realtime-migrate
"${compose[@]}" run --rm spite-ownership-migrate

# Compose waits for every service with a healthcheck and fails the deployment
# if any of them becomes unhealthy. Override only for slow first boot builds.
DEPLOY_WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-300}"
"${compose[@]}" up -d --remove-orphans --wait --wait-timeout "$DEPLOY_WAIT_TIMEOUT"
"${compose[@]}" ps

echo "Deployment completed successfully."
