#!/usr/bin/env bash
#
# Timeline — one-shot setup for a live server (or a laptop).
#
# Writes .env with strong generated secrets, picks host ports that are actually free, and can build
# and start the stack. Safe to re-run: existing secrets are preserved, not regenerated, because
# rotating a database password or an object-store key behind a live volume is a one-way door that
# needs deliberate steps (see --rotate).
#
#   ./setup.sh --check                          audit only, write nothing
#   ./setup.sh                                  configure for localhost
#   ./setup.sh --domain timeline.example.com --start
#   ./setup.sh --rotate --start                 replace weak/placeholder secrets in place
#
set -euo pipefail

# Compose honours COMPOSE_PROJECT_NAME too, so a second deployment on one host still works.
PROJECT="${COMPOSE_PROJECT_NAME:-timeline}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env"
API_ENV_FILE="$ROOT/apps/api/.env"
STAMP="$(date +%Y%m%d-%H%M%S)"

DOMAIN=""
MODE="local"
WANT_WEB_PORT=""
DO_START=0
DO_SEED=0
DO_ROTATE=0
DRY_RUN=0
CHECK_ONLY=0
ALLOW_WEAK=0
RESERVED=""
WEAK_KEYS=""
CHANGED_PORTS=""

# --------------------------------------------------------------------------------------- output
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; YEL=$'\033[33m'; GRN=$'\033[32m'; OFF=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; YEL=""; GRN=""; OFF=""
fi
say()  { printf '%s\n' "$*" >&2; }
step() { printf '\n%s==>%s %s\n' "$BOLD" "$OFF" "$*" >&2; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$OFF" "$*" >&2; }
info() { printf '  %s·%s %s\n' "$DIM" "$OFF" "$*" >&2; }
warn() { printf '  %s!%s %s\n' "$YEL" "$OFF" "$*" >&2; }
die()  { printf '\n%serror:%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  # Print the header comment block, however long it grows, and stop at the first code line.
  awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); print; next } NR > 2 { exit }' "${BASH_SOURCE[0]}"
  cat <<'EOF'

Options
  --domain HOST       Public hostname. Implies HTTPS upstream: sets WEB_ORIGIN, COOKIE_SECURE=true,
                      and binds the web container to 127.0.0.1 for a reverse proxy to front.
  --web-port PORT     Preferred host port for the app (default 4280, auto-shifted if taken).
  --start             Build the images and bring the stack up when configuration is done.
  --seed              Load the demo couple. Refused when --domain is set (run 'npm run seed' there).
  --rotate            Regenerate placeholder/weak secrets and apply them to the running services.
  --allow-weak        Proceed even though placeholder secrets remain (never do this in production).
  --check             Report what would change and exit non-zero if the setup is not production-safe.
  --dry-run           Print the .env that would be written, write nothing.
  -h, --help          This text.
EOF
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a hostname}"; MODE="server"; shift 2 ;;
    --web-port) WANT_WEB_PORT="${2:?--web-port needs a number}"; shift 2 ;;
    --start) DO_START=1; shift ;;
    --seed) DO_SEED=1; shift ;;
    --rotate) DO_ROTATE=1; shift ;;
    --allow-weak) ALLOW_WEAK=1; shift ;;
    --check) CHECK_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

# ----------------------------------------------------------------------------------- preflight
step "Checking the machine"

have docker || die "docker is not installed. See https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 || die "the docker daemon is not reachable as $(id -un). Try: sudo usermod -aG docker $(id -un), then re-login."
docker compose version >/dev/null 2>&1 || die "docker compose v2 is missing (the 'docker-compose' script is not enough)."
ok "docker $(docker version --format '{{.Server.Version}}') · compose $(docker compose version --short)"

for file in docker-compose.yml apps/api/Dockerfile apps/web/Dockerfile infra/minio/bootstrap.sh; do
  [ -f "$ROOT/$file" ] || die "missing $file — run this from a complete checkout."
done
ok "project files present"

if have df; then
  free_kb="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
  free_gb=$((free_kb / 1024 / 1024))
  if [ "$free_gb" -lt 3 ]; then
    warn "only ${free_gb}G free on this filesystem — images plus photos want a few gigabytes"
  else
    ok "${free_gb}G free for images, database and photos"
  fi
fi

if ! have openssl; then
  info "openssl not found — falling back to /dev/urandom for secrets"
fi

# --------------------------------------------------------------------------------------- helpers
gen_secret() { # gen_secret <length>
  local len="${1:-48}"
  # Alphanumeric only, deliberately: POSTGRES_PASSWORD is interpolated into a postgres:// URI and
  # every value lands in a .env read by compose. No quoting or percent-encoding traps.
  (
    set +o pipefail
    if have openssl; then
      openssl rand -base64 $((len * 3)) | tr -dc 'A-Za-z0-9' | head -c "$len"
    else
      LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$len"
    fi
  )
  printf '\n'
}

# A VAPID keypair for web push: an ordinary P-256 pair in base64url. Sets VAPID_PUBLIC_KEY and
# VAPID_PRIVATE_KEY, or leaves both empty when it cannot — push is optional everywhere, so a host
# without openssl gets an app that simply does not offer notifications rather than a failed setup.
gen_vapid() {
  VAPID_PUBLIC_KEY=""
  VAPID_PRIVATE_KEY=""
  have openssl || return 0
  local tmp priv pub
  tmp="$(mktemp -d)"
  openssl ecparam -genkey -name prime256v1 -noout -out "$tmp/k.pem" 2>/dev/null || { rm -rf "$tmp"; return 0; }
  # Fixed offsets in the DER encodings: the 32-byte scalar after the SEC1 header, and the 65-byte
  # 0x04||X||Y point after the SPKI algorithm identifier.
  priv="$(openssl ec -in "$tmp/k.pem" -outform DER 2>/dev/null |
    dd bs=1 skip=7 count=32 status=none | base64 -w0 | tr '+/' '-_' | tr -d '=')"
  pub="$(openssl ec -in "$tmp/k.pem" -pubout -outform DER 2>/dev/null |
    dd bs=1 skip=26 count=65 status=none | base64 -w0 | tr '+/' '-_' | tr -d '=')"
  rm -rf "$tmp"
  # Wrong lengths mean this openssl laid the DER out differently; empty keys are safe, wrong ones
  # would fail silently at send time on every device.
  [ "${#priv}" -eq 43 ] && [ "${#pub}" -eq 87 ] || return 0
  VAPID_PRIVATE_KEY="$priv"
  VAPID_PUBLIC_KEY="$pub"
}

read_env_value() { # read_env_value <KEY>
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1
}

is_placeholder() {
  case "${1:-}" in
    ""|change-me*|dev-only*|*CHANGEME*|timeline-root|timeline-api) return 0 ;;
    *) return 1 ;;
  esac
}

port_in_use() { # port_in_use <PORT>
  local port="$1"
  if have ss; then
    ss -Htln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}\$" && return 0
    return 1
  fi
  if have netstat; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}\$" && return 0
    return 1
  fi
  if have python3; then
    python3 -c 'import socket,sys
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("0.0.0.0", int(sys.argv[1])))
except OSError:
    sys.exit(0)
finally:
    s.close()
sys.exit(1)' "$port" && return 0
    return 1
  fi
  (exec 3<>"/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1 && return 0
  return 1
}

# A port held by *this* project is not a conflict — it is where we already live.
owned_by_project() {
  docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Ports}}' 2>/dev/null |
    grep -q ":$1->"
}

reserved_here() {
  case " $RESERVED " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

PICKED=""
pick_port() { # pick_port <PREFERRED> <LABEL> — result in $PICKED
  local want="$1" label="$2" port="$1" limit=$(($1 + 80))
  while [ "$port" -le "$limit" ]; do
    if reserved_here "$port"; then
      :
    elif owned_by_project "$port"; then
      RESERVED="$RESERVED $port"
      ok "$label: $port already published by this stack — keeping it"
      PICKED="$port"
      return 0
    elif ! port_in_use "$port"; then
      RESERVED="$RESERVED $port"
      if [ "$port" != "$want" ]; then
        CHANGED_PORTS="$CHANGED_PORTS $label:$want->$port"
        warn "$label: $want is taken, using $port"
      else
        ok "$label: $port free"
      fi
      PICKED="$port"
      return 0
    fi
    port=$((port + 1))
  done
  die "could not find a free port for $label near $want"
}

# Preferred value from .env when it is a sane number, otherwise the built-in default.
resolve_port() { # resolve_port <LABEL> <ENV_KEY> <DEFAULT>
  local want
  want="$(read_env_value "$2")"
  case "$want" in ''|*[!0-9]*) want="$3" ;; esac
  pick_port "$want" "$1"
}

has_data_volumes() {
  docker volume ls --format '{{.Name}}' 2>/dev/null | grep -qE "^${PROJECT}_(db-data|minio-data)\$"
}

RESOLVED=""
resolve_secret() { # resolve_secret <KEY> <LENGTH> — result in $RESOLVED
  local key="$1" len="$2" current
  current="$(read_env_value "$key")"

  if [ -n "$current" ] && ! is_placeholder "$current"; then
    if [ "$DO_ROTATE" -eq 1 ]; then RESOLVED="$(gen_secret "$len")"; else RESOLVED="$current"; fi
    return
  fi
  # A placeholder with live data behind it: keeping it is unsafe, replacing it silently breaks
  # the running service. Flag it and let the operator choose --rotate.
  if [ "$HAS_DATA" -eq 1 ] && [ "$DO_ROTATE" -eq 0 ]; then
    WEAK_KEYS="$WEAK_KEYS $key"
    RESOLVED="${current:-change-me}"
    return
  fi
  RESOLVED="$(gen_secret "$len")"
}

# ------------------------------------------------------------------------------------- decisions
HAS_DATA=0
if has_data_volumes; then HAS_DATA=1; fi

step "Ports"
if [ -n "$WANT_WEB_PORT" ]; then
  pick_port "$WANT_WEB_PORT" web
else
  resolve_port web WEB_PORT 4280
fi
WEB_PORT="$PICKED"
resolve_port api API_PORT 4281;                    API_PORT="$PICKED"
resolve_port db DB_PORT 55433;                     DB_PORT="$PICKED"
resolve_port minio-s3 MINIO_API_PORT 9400;         MINIO_API_PORT="$PICKED"
resolve_port minio-console MINIO_CONSOLE_PORT 9401; MINIO_CONSOLE_PORT="$PICKED"
info "only the web port is published by the base stack; the rest belong to docker-compose.dev.yml"

step "Secrets"
if [ "$HAS_DATA" -eq 1 ]; then
  info "existing data volumes found — secrets already in use will be preserved"
fi
POSTGRES_DB="$(read_env_value POSTGRES_DB)";   POSTGRES_DB="${POSTGRES_DB:-timeline}"
POSTGRES_USER="$(read_env_value POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-timeline}"
S3_BUCKET="$(read_env_value S3_BUCKET)";       S3_BUCKET="${S3_BUCKET:-timeline-photos}"
MINIO_ROOT_USER="$(read_env_value MINIO_ROOT_USER)"; MINIO_ROOT_USER="${MINIO_ROOT_USER:-timeline-root}"
S3_ACCESS_KEY_ID="$(read_env_value S3_ACCESS_KEY_ID)"; S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-timeline-api}"

OLD_POSTGRES_PASSWORD="$(read_env_value POSTGRES_PASSWORD)"
resolve_secret POSTGRES_PASSWORD 40;    POSTGRES_PASSWORD="$RESOLVED"
resolve_secret SESSION_SECRET 64;       SESSION_SECRET="$RESOLVED"
resolve_secret MINIO_ROOT_PASSWORD 40;  MINIO_ROOT_PASSWORD="$RESOLVED"
resolve_secret S3_SECRET_ACCESS_KEY 40; S3_SECRET_ACCESS_KEY="$RESOLVED"

# Web push keys are carried over verbatim, and generated only when absent. Deliberately NOT
# rotated by --rotate: a browser binds its subscription to the public key it was created with, so a
# new pair silently stops every existing device receiving anything until each turns notifications
# on again. Nothing about these keys grants access to the couple's data.
VAPID_PUBLIC_KEY="$(read_env_value VAPID_PUBLIC_KEY)"
VAPID_PRIVATE_KEY="$(read_env_value VAPID_PRIVATE_KEY)"
VAPID_SUBJECT="$(read_env_value VAPID_SUBJECT)"
if [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY" ]; then
  gen_vapid
fi
if [ -z "$VAPID_SUBJECT" ] && [ -n "$VAPID_PUBLIC_KEY" ] && [ -n "$DOMAIN" ]; then
  # Who a push service contacts about this deployment. Derived from the domain only when there is a
  # real one — 'admin@localhost' is not an address, and inventing one produced keys that looked
  # configured while notifications stayed off. With this empty the API boots and says so.
  case "$DOMAIN" in
    *.*) VAPID_SUBJECT="mailto:admin@$DOMAIN" ;;
  esac
fi

for key in POSTGRES_PASSWORD SESSION_SECRET MINIO_ROOT_PASSWORD S3_SECRET_ACCESS_KEY; do
  case " $WEAK_KEYS " in
    *" $key "*) warn "$key is still a placeholder" ;;
    *)
      value="${!key}"
      ok "$key set (${#value} chars$( [ "$DO_ROTATE" -eq 1 ] && printf ', rotated' ))"
      ;;
  esac
done

if [ "$MODE" = "server" ]; then
  WEB_ORIGIN="https://$DOMAIN"
  COOKIE_SECURE="true"
  WEB_BIND="127.0.0.1"
else
  WEB_ORIGIN="http://localhost:$WEB_PORT"
  COOKIE_SECURE="false"
  WEB_BIND="0.0.0.0"
fi
# Keep whatever domain is already configured when this run did not pass --domain,
# so re-running setup.sh on the server never silently un-routes Traefik.
if [ -z "$DOMAIN" ]; then DOMAIN="$(read_env_value APP_DOMAIN)"; fi

# Compose reads COMPOSE_FILE out of .env, so once this is set every plain
# `docker compose ...` in this directory carries the production overlay. Without it the
# stack comes up with no Traefik labels, no router matches the host, and Traefik answers
# with its self-signed fallback certificate — which looks like a TLS bug and is not one.
COMPOSE_FILE_BLOCK=""
if [ -n "$DOMAIN" ]; then
  COMPOSE_FILE_BLOCK="# Every \`docker compose\` in this directory picks these up (Traefik labels live in the overlay).
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml"
fi

if [ -n "$DOMAIN" ] && ! docker network inspect "${PROXY_NETWORK:-izyah}" >/dev/null 2>&1; then
  warn "the Traefik network '${PROXY_NETWORK:-izyah}' does not exist on this host yet —"
  warn "  the stack will not start until whichever project owns Traefik is up."
fi

if [ -n "$WEAK_KEYS" ]; then
  say ""
  warn "Placeholder secrets remain, and data volumes already exist, so they were not replaced."
  warn "Fix it in one step:  ./setup.sh --rotate${DOMAIN:+ --domain $DOMAIN} --start"
  if [ "$MODE" = "server" ] && [ "$ALLOW_WEAK" -eq 0 ]; then
    die "refusing to configure a public deployment with placeholder secrets (override: --allow-weak)"
  fi
fi

# ----------------------------------------------------------------------------------------- write
render_env() {
  cat <<EOF
# Generated by setup.sh on $(date -Iseconds). Secrets here are real — keep this file out of git.

# --- database ---
POSTGRES_DB=$POSTGRES_DB
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# --- api ---
SESSION_SECRET=$SESSION_SECRET
COOKIE_SECURE=$COOKIE_SECURE
WEB_ORIGIN=$WEB_ORIGIN

# --- photo storage (MinIO) ---
# Root credentials never leave the minio and minio-init services.
MINIO_ROOT_USER=$MINIO_ROOT_USER
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD
# The API gets this key only, scoped to the bucket by infra/minio/bootstrap.sh.
S3_BUCKET=$S3_BUCKET
S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY

# --- notifications (web push) ---
# Optional: without a usable set the app runs as before and says so instead of offering a switch.
# The keys are preserved across runs and never rotated — a browser binds its subscription to the
# public key, so replacing it signs every device out. VAPID_SUBJECT has to be an address that can
# actually reach whoever runs this; set it by hand if it is empty below.
VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY
VAPID_SUBJECT=$VAPID_SUBJECT

# --- routing ---
# Hostname Traefik routes to this app (docker-compose.prod.yml). Empty = no proxy.
APP_DOMAIN=$DOMAIN
PROXY_NETWORK=${PROXY_NETWORK:-izyah}
$COMPOSE_FILE_BLOCK

# --- host ports ---
WEB_BIND=$WEB_BIND
WEB_PORT=$WEB_PORT
# Published only by docker-compose.dev.yml, on 127.0.0.1
API_PORT=$API_PORT
DB_PORT=$DB_PORT
MINIO_API_PORT=$MINIO_API_PORT
MINIO_CONSOLE_PORT=$MINIO_CONSOLE_PORT
EOF
}

render_api_env() {
  cat <<EOF
# Generated by setup.sh — for running the API on the host, against the dev-overlay services.
DATABASE_URL=postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@127.0.0.1:$DB_PORT/$POSTGRES_DB
SESSION_SECRET=$SESSION_SECRET
PORT=$API_PORT
COOKIE_SECURE=false

STORAGE_DRIVER=local
UPLOAD_DIR=./storage/uploads

# Used by \`npm run test:s3\`, which creates its own throwaway bucket.
S3_ENDPOINT=http://127.0.0.1:$MINIO_API_PORT
S3_BUCKET=$S3_BUCKET-test
S3_ACCESS_KEY_ID=$MINIO_ROOT_USER
S3_SECRET_ACCESS_KEY=$MINIO_ROOT_PASSWORD
EOF
}

if [ "$DRY_RUN" -eq 1 ]; then
  step "Would write $ENV_FILE"
  render_env
  exit 0
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  step "Check summary"
  [ -f "$ENV_FILE" ] && ok ".env present" || warn ".env missing — run ./setup.sh to create it"
  if [ -n "$CHANGED_PORTS" ]; then warn "ports would change:$CHANGED_PORTS"; else ok "configured ports are free"; fi
  if [ -n "$WEAK_KEYS" ]; then die "not production-safe: placeholder secrets ($WEAK_KEYS)"; fi
  ok "configuration is production-safe"
  exit 0
fi

step "Writing configuration"
if [ -f "$ENV_FILE" ]; then
  cp -p "$ENV_FILE" "$ENV_FILE.bak.$STAMP"
  info "previous .env saved as .env.bak.$STAMP"
fi
( umask 077; render_env > "$ENV_FILE" )
chmod 600 "$ENV_FILE"
ok "$ENV_FILE (mode 600)"

if [ -d "$ROOT/apps/api" ]; then
  [ -f "$API_ENV_FILE" ] && cp -p "$API_ENV_FILE" "$API_ENV_FILE.bak.$STAMP"
  ( umask 077; render_api_env > "$API_ENV_FILE" )
  chmod 600 "$API_ENV_FILE"
  ok "$API_ENV_FILE (mode 600) — host tooling matches the ports above"
fi

# ----------------------------------------------------------------------------------------- apply
if [ "$DO_ROTATE" -eq 1 ] && [ "$HAS_DATA" -eq 1 ]; then
  step "Applying rotated secrets to existing services"
  docker compose up -d db >/dev/null
  for _ in $(seq 1 30); do
    docker compose exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1 && break
    sleep 1
  done
  # The volume still holds the old password; compose only supplies it at first initialisation.
  docker compose exec -T -e PGPASSWORD="$OLD_POSTGRES_PASSWORD" db \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
    -c "alter user \"$POSTGRES_USER\" with password '$POSTGRES_PASSWORD'" >/dev/null &&
    ok "database password rotated" ||
    warn "could not rotate the database password — do it by hand with ALTER USER"
  FORCE_KEY_ROTATION=true docker compose up -d --force-recreate minio-init >/dev/null
  ok "object-store key rotated (minio-init re-run)"
  warn "SESSION_SECRET changed: everyone is signed out, which is the point of rotating it"
fi

if [ "$DO_START" -eq 1 ]; then
  step "Building and starting"
  docker compose up -d --build
  printf '  waiting for health' >&2
  healthy=0
  for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:$WEB_PORT/api/health" >/dev/null 2>&1; then healthy=1; break; fi
    printf '.' >&2; sleep 2
  done
  printf '\n' >&2
  if [ "$healthy" -eq 1 ]; then
    ok "the stack answers on http://127.0.0.1:$WEB_PORT"
  else
    docker compose ps >&2
    die "the stack did not come up. Logs: docker compose logs -f api"
  fi

  if [ "$DO_SEED" -eq 1 ]; then
    if [ "$MODE" = "server" ]; then
      warn "skipping --seed: this is a public deployment. Run 'npm run seed' by hand if you mean it."
    else
      docker compose exec -T api node dist/db/seed.js >&2 && ok "demo couple loaded"
    fi
  fi
fi

# ---------------------------------------------------------------------------------------- report
step "Ready"
say ""
say "  ${BOLD}App${OFF}            ${WEB_ORIGIN}"
if [ "$MODE" = "server" ]; then
  say "  ${BOLD}Listening${OFF}      127.0.0.1:${WEB_PORT}  (put your TLS proxy in front of this)"
else
  say "  ${BOLD}Listening${OFF}      0.0.0.0:${WEB_PORT}"
fi
say "  ${BOLD}Not published${OFF}  postgres, minio — reachable only inside the compose network"
say ""
if [ "$DO_START" -eq 0 ]; then
  if [ "$MODE" = "server" ]; then
    say "  Start it:      docker compose up -d --build   ${DIM}(COMPOSE_FILE in .env adds the Traefik overlay)${OFF}"
  else
    say "  Start it:      docker compose up -d --build"
  fi
fi
say "  Logs:          docker compose logs -f api web"
say "  Demo data:     npm run seed"
say "  Backups:       docker compose exec db pg_dump -U ${POSTGRES_USER} ${POSTGRES_DB} > dump.sql"
say "                 mc mirror --overwrite minio/${S3_BUCKET} ./photo-backup   (see README)"
say ""
if [ "$MODE" = "server" ]; then
  say "  ${BOLD}Before you point DNS at this:${OFF}"
  say "   1. terminate TLS upstream — COOKIE_SECURE=true means cookies will not survive plain http"
  say "   2. proxy ${DOMAIN} to 127.0.0.1:${WEB_PORT}, forwarding X-Forwarded-Proto"
  say "   3. allow only 80/443 through the firewall; nothing here needs another port open"
  say "   4. keep .env out of backups that leave the machine, or encrypt them"
  say ""
  say "  ${BOLD}If the browser shows a self-signed certificate${OFF}, Traefik matched no router for"
  say "  this host — the app is running unrouted, which is not a TLS problem:"
  say "     docker compose config | grep traefik.http.routers   ${DIM}# labels present?${OFF}"
  say "     docker network inspect ${PROXY_NETWORK:-izyah} | grep timeline-web"
  say ""
fi
if [ -n "$CHANGED_PORTS" ]; then
  say "  ${YEL}Ports moved:${OFF}$CHANGED_PORTS"
  say ""
fi
exit 0
