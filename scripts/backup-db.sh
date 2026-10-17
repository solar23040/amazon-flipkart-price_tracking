#!/usr/bin/env bash
# Back up the SQLite database with a retention policy.
# Usage: backup-db.sh [DB_PATH] [BACKUP_DIR]
#   DB_PATH    default: $DB_PATH or /mnt/media/projects/price_history/data/prices.db
#   BACKUP_DIR default: $BACKUP_DIR or /mnt/media/projects/price_history/backups
set -euo pipefail

DB="${1:-${DB_PATH:-/mnt/media/projects/price_history/data/prices.db}}"
BACKUP_DIR="${2:-${BACKUP_DIR:-/mnt/media/projects/price_history/backups}}"
KEEP="${BACKUP_KEEP:-14}"

fail() {
  printf 'backup-db: ERROR: %s\n' "$1" >&2
  exit 1
}

[ -f "$DB" ] || fail "database not found: $DB"

mkdir -p "$BACKUP_DIR" || fail "cannot create backup directory: $BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$BACKUP_DIR/prices-$STAMP.db"
[ -e "$BACKUP" ] && fail "$BACKUP already exists (two backups in the same second?)"

if command -v sqlite3 >/dev/null 2>&1; then
  # VACUUM INTO writes a transactionally consistent snapshot, WAL included.
  sqlite3 "$DB" "VACUUM INTO '$BACKUP'" || fail "sqlite3 VACUUM INTO failed for $DB"
else
  printf 'backup-db: WARNING: sqlite3 not found - copying db+wal+shm instead (may be inconsistent)\n' >&2
  cp "$DB" "$BACKUP" || fail "cp failed for $DB"
  [ -f "$DB-wal" ] && cp "$DB-wal" "$BACKUP-wal"
  [ -f "$DB-shm" ] && cp "$DB-shm" "$BACKUP-shm"
fi

# Retention: keep the newest $KEEP backups, remove the rest (plus their sidecar files).
mapfile -t old < <(ls -1t "$BACKUP_DIR"/prices-*.db 2>/dev/null | tail -n "+$((KEEP + 1))" || true)
for f in "${old[@]}"; do
  rm -f "$f" "$f-wal" "$f-shm"
done

kept="$(find "$BACKUP_DIR" -maxdepth 1 -name 'prices-*.db' -type f | wc -l | tr -d ' ')"
printf 'backup-db: OK\n'
printf '  source:  %s\n' "$DB"
printf '  backup:  %s (%s)\n' "$BACKUP" "$(du -h "$BACKUP" | cut -f1)"
printf '  kept:    %s backup(s), retention %s\n' "$kept" "$KEEP"
printf '  removed: %s old backup(s)\n' "${#old[@]}"
