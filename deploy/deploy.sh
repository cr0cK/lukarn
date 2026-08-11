#!/usr/bin/env bash
#
# Updates a live instance.
#
#   ./deploy/deploy.sh            pull the published image (default)
#   ./deploy/deploy.sh --build    build from source
#
# Backs up, updates, restarts — and **waits for confirmation** that the
# application came back. A `docker compose up -d` returns as soon as the container
# has started, not when it works: a failed migration or an incomplete `.env`
# leaves a container restarting in a loop while the deployment looks finished.

set -euo pipefail

cd "$(dirname "$0")/.."

build=false
case "${1:-}" in
'') ;;
--build) build=true ;;
*)
  echo "usage: $0 [--build]" >&2
  exit 2
  ;;
esac

# `--ff-only`: an automatic merge has no business happening on an instance. If the
# local copy has diverged, that is worth knowing before updating anything. The
# sources matter even when not building: they are where `docker-compose.yml`, the
# `Caddyfile` and the scripts of this very update come from.
echo "▸ fetching sources"
git pull --ff-only

# Migrations are append-only and never touched again: if one goes wrong, this
# archive is the only way back.
echo "▸ backup"
./deploy/backup.sh --local

if $build; then
  echo "▸ building and restarting"
  docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
else
  # `pull` kept separate from `up` so a failure carries its real name: an
  # unreachable registry or a version that does not exist are then told apart
  # from a container that starts badly, and the live instance is not stopped for
  # nothing.
  echo "▸ pulling the image"
  docker compose pull app
  echo "▸ restarting"
  docker compose up -d
fi

# `start-period` 20s, then a check every 30s and 3 attempts before `unhealthy`:
# 110s at worst for a verdict, rounded up to 150s of margin.
CEILING=150

container=$(docker compose ps -q app)
if [[ -z $container ]]; then
  echo '✗ no app container after the up — see docker compose ps.' >&2
  exit 1
fi

fail() {
  echo "✗ $1" >&2
  echo >&2
  docker compose logs --tail=50 app >&2
  exit 1
}

echo "▸ waiting on the health gate (up to ${CEILING}s)"
start=$SECONDS
while :; do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo missing)

  case $state in
  healthy) break ;;
  unhealthy) fail "the application answers, but /api/health declares it broken." ;;
  missing) fail "container gone, or without a HEALTHCHECK." ;;
  esac

  if ((SECONDS - start >= CEILING)); then
    fail "still \"$state\" after ${CEILING}s."
  fi
  sleep 3
done

echo "✓ deployed — application healthy after $((SECONDS - start))s"
