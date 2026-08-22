#!/usr/bin/env bash
# ============================================================================
# Timeline — generate a VAPID keypair for web push.
#
#   ./scripts/vapid-keys.sh            print three lines to paste into .env
#   ./scripts/vapid-keys.sh --write    append them to .env if it has none yet
#
# A VAPID key is an ordinary P-256 keypair in base64url, so openssl is enough —
# no npm install, nothing to run inside a container. That matters because the
# place this is usually needed is a server whose .env predates push.
#
# Rotating the pair invalidates every existing subscription: browsers bind a
# subscription to the public key it was created with, and every device has to
# turn notifications on again. Generate once and keep it.
# ============================================================================
set -euo pipefail

SUBJECT="${VAPID_SUBJECT:-mailto:admin@example.com}"
WRITE=0
for arg in "$@"; do
  case "$arg" in
    --write) WRITE=1 ;;
    --subject=*) SUBJECT="${arg#*=}" ;;
    -h|--help) sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

b64url() { base64 -w0 2>/dev/null || base64 | tr -d '\n'; }
url_safe() { tr '+/' '-_' | tr -d '='; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
openssl ecparam -genkey -name prime256v1 -noout -out "$TMP/key.pem" 2>/dev/null

# The raw scalar and the uncompressed point, at their fixed offsets in the DER
# encodings of a prime256v1 key: 32 bytes of private key after the SEC1 header,
# and the 65-byte 0x04||X||Y point after the SPKI algorithm identifier.
PRIVATE="$(openssl ec -in "$TMP/key.pem" -outform DER 2>/dev/null |
  dd bs=1 skip=7 count=32 status=none | b64url | url_safe)"
PUBLIC="$(openssl ec -in "$TMP/key.pem" -pubout -outform DER 2>/dev/null |
  dd bs=1 skip=26 count=65 status=none | b64url | url_safe)"

# 32 bytes and 65 bytes, base64url. A different length means the offsets above
# did not match this openssl's DER output, and the keys would be silently wrong.
[ "${#PRIVATE}" -eq 43 ] || { echo "private key came out ${#PRIVATE} chars, expected 43" >&2; exit 1; }
[ "${#PUBLIC}" -eq 87 ] || { echo "public key came out ${#PUBLIC} chars, expected 87" >&2; exit 1; }

if [ "$WRITE" -eq 1 ]; then
  [ -f .env ] || { echo ".env not found — run from the repo root" >&2; exit 1; }
  if grep -qE '^VAPID_PUBLIC_KEY=.+' .env; then
    echo ".env already has a VAPID_PUBLIC_KEY — refusing to replace it."
    echo "Rotating would sign every device out of notifications; delete the three lines by hand if"
    echo "that is really what you want."
    exit 1
  fi
  # Replace the empty placeholders if they exist, otherwise append.
  if grep -qE '^VAPID_PUBLIC_KEY=$' .env; then
    sed -i.bak \
      -e "s|^VAPID_PUBLIC_KEY=$|VAPID_PUBLIC_KEY=$PUBLIC|" \
      -e "s|^VAPID_PRIVATE_KEY=$|VAPID_PRIVATE_KEY=$PRIVATE|" \
      -e "s|^VAPID_SUBJECT=$|VAPID_SUBJECT=$SUBJECT|" .env
    rm -f .env.bak
  else
    printf '\n# --- notifications (web push) ---\nVAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\nVAPID_SUBJECT=%s\n' \
      "$PUBLIC" "$PRIVATE" "$SUBJECT" >> .env
  fi
  echo "Written to .env. The api has to be recreated to pick them up."
  if [ -f .deployed_tag ]; then
    # A deployed host runs the image CI pushed, not a local build. Recreating without the deploy
    # overlay would quietly rebuild the api from source on this box.
    echo "  IMAGE_TAG=\$(cat .deployed_tag) docker compose \\"
    echo "    -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.deploy.yml \\"
    echo "    up -d --force-recreate api"
  else
    echo "  docker compose up -d --force-recreate api"
  fi
else
  printf 'VAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\nVAPID_SUBJECT=%s\n' "$PUBLIC" "$PRIVATE" "$SUBJECT"
fi
