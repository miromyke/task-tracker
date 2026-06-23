#!/usr/bin/env bash
#
# Clone the production database into the sandbox instance.
#
#   a) dumps the live prod SQLite DB (consistent online backup), then
#   b) loads that dump into the sandbox DB.
#
# Run it ON THE VM, from the directory that holds docker-compose.yml (so the
# `docker compose` service names resolve). Both instances share this compose
# project: `app` (prod, volume reno_data) and `app-sandbox` (volume
# reno_data_sandbox), each with the SQLite file at /data/app.db in WAL mode.
#
# The prod read is a non-blocking online backup — prod keeps serving. The
# sandbox is briefly stopped while its DB is swapped (sandbox downtime only).
#
# Usage:
#   ./scripts/clone-prod-to-sandbox.sh [--with-uploads] [-y]
#
#   --with-uploads  also mirror prod's /data/uploads into the sandbox, so file
#                   assets referenced by the DB actually resolve there.
#   -y              skip the "this overwrites sandbox data" confirmation.
#
set -euo pipefail

PROD_SVC=app
SANDBOX_SVC=app-sandbox
HELPER_IMAGE=alpine:3.20
APP_UID=10001   # the `app` user baked into the runtime image (see Dockerfile)
APP_GID=10001

WITH_UPLOADS=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --with-uploads) WITH_UPLOADS=1 ;;
    -y|--yes)       ASSUME_YES=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# Resolve the compose command (v2 plugin preferred, legacy fallback).
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "error: neither 'docker compose' nor 'docker-compose' is available" >&2
  exit 1
fi

# Resolve the real volume name backing /data for a service, by inspecting its
# running container. Avoids guessing the compose-project volume prefix.
data_volume_of() {
  local svc=$1 cid
  cid=$("${DC[@]}" ps -q "$svc")
  if [[ -z "$cid" ]]; then
    echo "error: service '$svc' is not running; start the stack first" >&2
    exit 1
  fi
  docker inspect -f \
    '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' \
    "$cid"
}

PROD_VOL=$(data_volume_of "$PROD_SVC")
SANDBOX_VOL=$(data_volume_of "$SANDBOX_SVC")
echo "prod volume    : $PROD_VOL"
echo "sandbox volume : $SANDBOX_VOL"

if [[ "$PROD_VOL" == "$SANDBOX_VOL" ]]; then
  echo "error: prod and sandbox resolve to the SAME volume — refusing to run" >&2
  exit 1
fi

if [[ "$ASSUME_YES" != 1 ]]; then
  echo
  echo "This will OVERWRITE the sandbox database with a copy of production."
  [[ "$WITH_UPLOADS" == 1 ]] && echo "It will also overwrite sandbox uploads with prod's."
  read -r -p "Continue? [y/N] " reply
  [[ "$reply" == [yY] ]] || { echo "aborted."; exit 0; }
fi

# Host-side temp dir for the dump; cleaned up on exit.
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# --- a) Dump prod: consistent online backup of the live WAL DB. ----------------
# `.backup` uses SQLite's online-backup API, so it's safe against concurrent
# writers and folds in the WAL — no prod downtime, no stale -wal/-shm.
echo "==> dumping prod DB (online backup)…"
docker run --rm \
  -v "$PROD_VOL":/src \
  -v "$TMPDIR":/out \
  "$HELPER_IMAGE" sh -euc '
    apk add --no-cache sqlite >/dev/null
    sqlite3 /src/app.db ".backup /out/app.db"
    # Integrity-check the dump before we trust it.
    sqlite3 /out/app.db "PRAGMA integrity_check;" | grep -qx ok
  '
echo "    dump size: $(du -h "$TMPDIR/app.db" | cut -f1)"

# --- b) Load into sandbox: stop it, swap the file, fix perms, restart. ---------
echo "==> stopping sandbox…"
"${DC[@]}" stop "$SANDBOX_SVC"

echo "==> loading dump into sandbox volume…"
UPLOADS_CMD=":"
if [[ "$WITH_UPLOADS" == 1 ]]; then
  # Mirror prod uploads; tolerate prod having none yet.
  UPLOADS_CMD='rm -rf /dst/uploads && { [ -d /prod/uploads ] && cp -a /prod/uploads /dst/uploads || mkdir -p /dst/uploads; }'
fi
docker run --rm \
  -v "$SANDBOX_VOL":/dst \
  -v "$PROD_VOL":/prod:ro \
  -v "$TMPDIR":/dump:ro \
  "$HELPER_IMAGE" sh -euc '
    cp /dump/app.db /dst/app.db
    # Drop any stale WAL/SHM so the fresh DB is used as-is.
    rm -f /dst/app.db-wal /dst/app.db-shm
    '"$UPLOADS_CMD"'
    chown -R '"$APP_UID":"$APP_GID"' /dst
  '

echo "==> starting sandbox…"
"${DC[@]}" start "$SANDBOX_SVC"

echo "done. Sandbox now mirrors prod data."
echo "Note: sandbox keeps its own session secret + admin password (re-applied on boot)."
[[ "$WITH_UPLOADS" == 1 ]] || echo "Tip: re-run with --with-uploads if images/files look broken in the sandbox."
