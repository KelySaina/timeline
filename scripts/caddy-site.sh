#!/usr/bin/env bash
# ============================================================================
# Timeline — render infra/caddy/timeline.caddyfile from .env, and optionally
# install it into the host's Caddy.
#
#   ./scripts/caddy-site.sh                 print the rendered block, write nothing
#   sudo ./scripts/caddy-site.sh --install  install it, validate, reload Caddy
#
# The rendered file carries literal values, so Caddy needs no environment of its
# own — in particular it is never handed this project's .env, which holds the
# database password and the object-store key and has no business in the address
# space of a process that only needs a hostname and a port.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TEMPLATE="infra/caddy/timeline.caddyfile"
SITE_DIR="/etc/caddy/sites"
SITE_FILE="$SITE_DIR/timeline.caddyfile"
MAIN_CADDYFILE="/etc/caddy/Caddyfile"
IMPORT_LINE="import $SITE_DIR/*.caddyfile"
DO_INSTALL=0

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; YEL=$'\033[33m'; GRN=$'\033[32m'; OFF=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; YEL=""; GRN=""; OFF=""
fi
say()  { printf '%s\n' "$*" >&2; }
step() { printf '\n%s==>%s %s\n' "$BOLD" "$OFF" "$*" >&2; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$OFF" "$*" >&2; }
warn() { printf '  %s!%s %s\n' "$YEL" "$OFF" "$*" >&2; }
die()  { printf '\n%serror:%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --install) DO_INSTALL=1; shift ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

[ -f "$TEMPLATE" ] || die "$TEMPLATE is missing — run this from a complete checkout."
[ -f .env ] || die ".env not found in $ROOT — run ./setup.sh --domain <host> first."

read_env() { grep -E "^$1=" .env 2>/dev/null | head -n1 | cut -d= -f2- || true; }

APP_DOMAIN="$(read_env APP_DOMAIN)"
WEB_PORT="$(read_env WEB_PORT)"
WEB_BIND="$(read_env WEB_BIND)"
: "${WEB_PORT:=4280}"

[ -n "$APP_DOMAIN" ] ||
  die "APP_DOMAIN is empty in .env — Caddy has no hostname to answer for.
       Fix it in one step:  ./setup.sh --domain <host> --proxy caddy-host"

# A site block pointing at a port the stack binds to 0.0.0.0 is not wrong, it is
# just pointless: the app stays reachable on :$WEB_PORT from anywhere, and the
# TLS in front of it becomes optional for whoever is looking. Say so loudly.
if [ "$WEB_BIND" != "127.0.0.1" ]; then
  warn "WEB_BIND is '${WEB_BIND:-unset}', not 127.0.0.1 — the app is published to every"
  warn "  interface, so ${APP_DOMAIN}:${WEB_PORT} answers in plain http, around Caddy."
  warn "  Fix:  ./setup.sh --domain ${APP_DOMAIN} --proxy caddy-host"
fi

render() {
  sed -e "s|{\$APP_DOMAIN}|${APP_DOMAIN}|g" \
      -e "s|{\$WEB_PORT:4280}|${WEB_PORT}|g" \
      "$TEMPLATE"
}

if [ "$DO_INSTALL" -eq 0 ]; then
  render
  say ""
  say "  ${DIM}Nothing was written. To install it:  sudo $0 --install${OFF}"
  exit 0
fi

# ------------------------------------------------------------------------ install
step "Installing the Caddy site for ${APP_DOMAIN}"

[ "$(id -u)" -eq 0 ] || die "--install writes under /etc/caddy — re-run it with sudo."
command -v caddy >/dev/null 2>&1 ||
  die "caddy is not installed. See https://caddyserver.com/docs/install#debian-ubuntu-raspbian"

install -d -m 0755 "$SITE_DIR"
render > "$SITE_FILE.new"
chmod 0644 "$SITE_FILE.new"

# Caddy only reads one Caddyfile. A per-app file is worth nothing until the main
# one imports the directory, and a missing import is silent: Caddy reloads fine
# and simply never answers for this host.
if [ ! -f "$MAIN_CADDYFILE" ]; then
  printf '%s\n' "$IMPORT_LINE" > "$MAIN_CADDYFILE"
  ok "created $MAIN_CADDYFILE with the import"
elif ! grep -qF "$SITE_DIR" "$MAIN_CADDYFILE"; then
  printf '\n# Per-app site blocks, one file each.\n%s\n' "$IMPORT_LINE" >> "$MAIN_CADDYFILE"
  ok "added the import to $MAIN_CADDYFILE"
else
  ok "$MAIN_CADDYFILE already imports $SITE_DIR"
fi

mv "$SITE_FILE.new" "$SITE_FILE"
ok "$SITE_FILE"

# Validate before reloading, not after: `systemctl reload caddy` on a bad config
# leaves the old one serving and reports success, so the next restart — days
# later, for an unrelated reason — is what actually takes the site down.
if caddy validate --config "$MAIN_CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
  ok "config validates"
else
  caddy validate --config "$MAIN_CADDYFILE" --adapter caddyfile || true
  die "the Caddyfile does not validate — $SITE_FILE is in place but Caddy was NOT reloaded."
fi

# `cmd && ok "..."` would hide a failure here: in an && list, only the LAST command
# is subject to `set -e`, so a failed reload let this script carry on and print the
# success steps below. Validation passing does not mean loading will: validate checks
# syntax, not whether the caddy user can open a file or bind a port.
if systemctl reload caddy; then
  ok "caddy reloaded"
else
  say ""
  systemctl status caddy --no-pager --lines=15 >&2 || true
  die "caddy did not reload, and the site is NOT live. $SITE_FILE is installed and the
       import is in $MAIN_CADDYFILE, so fix the cause above and re-run:
         sudo systemctl reload caddy
       The previously running config is still serving, so other sites are unaffected —
       but a 'systemctl restart caddy' would now fail and take them down too."
fi

say ""
say "  ${BOLD}Next${OFF}"
say "   1. point an A/AAAA record for ${BOLD}${APP_DOMAIN}${OFF} at this host — ACME needs it"
say "      to resolve here before it will issue a certificate."
say "   2. open 80 and 443 only. Port ${WEB_PORT} must stay closed; it is on loopback."
say "   3. watch the first certificate being issued:"
say "      ${DIM}journalctl -u caddy -f${OFF}"
say "   4. confirm the whole chain end to end:"
say "      ${DIM}curl -fsS https://${APP_DOMAIN}/api/health${OFF}"
say ""
