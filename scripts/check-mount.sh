#!/usr/bin/env bash
# Fail fast if the HDD backing this project is not mounted or not writable.
# Run this before starting the backend (dev runs now, systemd/pm2 later).
set -euo pipefail

MOUNT_POINT="${MOUNT_POINT:-/mnt/media}"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

fail() {
  printf 'check-mount: ERROR: %s\n' "$1" >&2
  exit 1
}

mountpoint -q "$MOUNT_POINT" || fail "$MOUNT_POINT is not a mount point - is the HDD connected and mounted?"

[ -d "$PROJECT_DIR" ] || fail "project directory $PROJECT_DIR does not exist"
[ -w "$PROJECT_DIR" ] || fail "project directory $PROJECT_DIR is not writable"

tmp="$(mktemp -p "$PROJECT_DIR" .check-mount.XXXXXX)" || fail "cannot create files in $PROJECT_DIR"
rm -f "$tmp"

# SQLite must be able to create and write its file on this filesystem.
if command -v sqlite3 >/dev/null 2>&1; then
  mkdir -p "$PROJECT_DIR/data"
  db="$PROJECT_DIR/data/.check-mount.db"
  sqlite3 "$db" 'CREATE TABLE t(x); DROP TABLE t;' >/dev/null 2>&1 \
    || fail "SQLite cannot write to $PROJECT_DIR/data"
  rm -f "$db" "$db-wal" "$db-shm"
fi

printf 'check-mount: OK - %s is mounted and %s is writable\n' "$MOUNT_POINT" "$PROJECT_DIR"
