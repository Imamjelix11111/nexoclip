#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Deployment failed at line $LINENO." >&2' ERR
cd "$(dirname "$0")/.."

[[ "$(uname -m)" == "x86_64" ]] || { echo "This deployment requires x86_64/AMD64." >&2; exit 1; }
[[ -f .env.production ]] || { echo "Copy .env.production.example to .env.production first." >&2; exit 1; }

mode=$(stat -c '%a' .env.production)
(( 10#$mode <= 600 )) || { echo ".env.production must be chmod 600." >&2; exit 1; }

compose=(docker compose --env-file .env.production -f docker-compose.prod.yml)
"${compose[@]}" config --quiet
[[ "${1:-}" != "--pull" ]] || "${compose[@]}" pull --ignore-buildable
"${compose[@]}" build
"${compose[@]}" up -d redis
"${compose[@]}" run --rm nexoclip-migrate
"${compose[@]}" run --rm spite-realtime-migrate
"${compose[@]}" run --rm spite-ownership-migrate
"${compose[@]}" run --rm scheduler-migrate
"${compose[@]}" up -d --remove-orphans
"${compose[@]}" ps
