#!/usr/bin/env bash
# ============================================================================
# Timeline — VPS deploy step (run BY the CI/CD workflow over SSH, from ~/timeline).
#
# Expects in the environment:
#   IMAGE_TAG      git SHA to deploy (tag pushed to GHCR by CI)
#   GHCR_USER      GHCR username, for pulling images
#   GHCR_TOKEN     token with read:packages (the workflow's own GITHUB_TOKEN works)
#   GITHUB_TOKEN   optional — authenticates `git fetch` if the repo goes private
#
# Flow: sync the repo to the SHA -> preflight -> pull -> recreate api+web ->
# poll the health endpoint -> on failure, roll back to the last good SHA.
# ============================================================================
set -euo pipefail

: "${IMAGE_TAG:?IMAGE_TAG is required}"

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.deploy.yml"
LAST_GOOD_FILE=".deployed_tag"
HEALTH_RETRIES=30   # 30 * 4s = up to 2 minutes for migrations + boot
HEALTH_DELAY=4

log() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m==> %s\033[0m\n' "$*" >&2; exit 1; }

read_env() { grep -E "^$1=" .env 2>/dev/null | head -n1 | cut -d= -f2- || true; }

# Fail in a second with a clear reason rather than after a two-minute health
# timeout plus a rollback. setup.sh --check already knows what "unsafe" means
# (placeholder secrets, missing docker, ports), so reuse it instead of
# duplicating those rules here.
preflight() {
  [ -f .env ] || die ".env not found in $(pwd) — run ./setup.sh --domain <host> first."
  [ -x ./setup.sh ] || die "setup.sh is missing or not executable."
  ./setup.sh --check >/dev/null || die "setup.sh --check failed — run it directly to see why."

  docker network inspect "${PROXY_NETWORK:-izyah}" >/dev/null 2>&1 ||
    die "the Traefik network '${PROXY_NETWORK:-izyah}' does not exist on this host."

  [ -n "$(read_env APP_DOMAIN)" ] ||
    die "APP_DOMAIN is empty in .env — Traefik has no hostname to route."
}

APP_DOMAIN="$(read_env APP_DOMAIN)"
WEB_PORT="$(read_env WEB_PORT)"
HEALTH_URL="https://${APP_DOMAIN}/api/health"

if [ -n "${GHCR_TOKEN:-}" ]; then
  log "Logging in to GHCR as ${GHCR_USER:-?}"
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
fi

# Bring the working tree exactly to the deployed commit (compose files, scripts,
# migrations). .env is gitignored, so the box keeps its own secrets.
log "Syncing repo to ${IMAGE_TAG}"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  git -c http.https://github.com/.extraheader="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')" \
    fetch --all --prune --quiet
else
  git fetch --all --prune --quiet
fi
git checkout --force "$IMAGE_TAG"

PREV_TAG="$(cat "$LAST_GOOD_FILE" 2>/dev/null || true)"

deploy_tag() {
  local tag="$1"
  log "Deploying ${tag}"
  # Backing services first: no-ops when their spec has not changed, and the
  # bucket bootstrap must have finished before the API boots.
  IMAGE_TAG="$tag" $COMPOSE up -d --no-build db minio minio-init
  IMAGE_TAG="$tag" $COMPOSE pull api web
  IMAGE_TAG="$tag" $COMPOSE up -d --no-build api web
}

health_ok() {
  log "Health-checking ${HEALTH_URL}"
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      echo "  healthy after ${i} attempt(s)"
      return 0
    fi
    # Traefik or DNS could be the fault rather than the app, so make the
    # difference visible instead of guessing from a single failure.
    if [ "$i" = 3 ] && [ -n "$WEB_PORT" ]; then
      if curl -fsS --max-time 5 "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then
        echo "  note: the app answers on 127.0.0.1:${WEB_PORT} but not through ${APP_DOMAIN}"
        echo "        → routing/TLS problem, not the deploy. Check Traefik and DNS."
      fi
    fi
    sleep "$HEALTH_DELAY"
  done
  return 1
}

preflight
deploy_tag "$IMAGE_TAG"

if health_ok; then
  echo "$IMAGE_TAG" > "$LAST_GOOD_FILE"
  log "Deploy OK: ${IMAGE_TAG}"
  docker image prune -f >/dev/null 2>&1 || true
else
  log "Health check FAILED for ${IMAGE_TAG}"
  if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$IMAGE_TAG" ]; then
    # Honest limitation: this rolls back code and images, not the database.
    # Migrations run at API boot and are forward-only, so a bad migration needs
    # a hand-written down-migration — the rollback alone will not undo it.
    log "Rolling back to ${PREV_TAG}"
    git checkout --force "$PREV_TAG" || true
    deploy_tag "$PREV_TAG"
    health_ok && echo "  rollback healthy" || echo "  !! rollback also unhealthy — needs manual attention"
  else
    echo "  no previous good tag recorded — leaving as-is for inspection"
  fi
  exit 1
fi
