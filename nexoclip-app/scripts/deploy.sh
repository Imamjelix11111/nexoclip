#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."

compose=(docker compose --env-file .env.production -f docker-compose.prod.yml)

show_failure_logs() {
  local exit_code=$?
  echo "Deployment failed at line $LINENO." >&2
  "${compose[@]}" ps >&2 || true
  "${compose[@]}" logs --tail=100 >&2 || true
  exit "$exit_code"
}
trap show_failure_logs ERR

[[ "$(uname -m)" == "x86_64" ]] || { echo "This deployment requires x86_64/AMD64." >&2; exit 1; }
[[ -f .env.production ]] || { echo "Copy .env.production.example to .env.production first." >&2; exit 1; }

mode=$(stat -c '%a' .env.production)
(( 10#$mode <= 600 )) || { echo ".env.production must be chmod 600." >&2; exit 1; }

set -a; . ./.env.production; set +a; NODE_ENV=production npm run config:check
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
