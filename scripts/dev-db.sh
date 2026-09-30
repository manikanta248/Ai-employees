#!/usr/bin/env bash
# Starts a throwaway local Postgres for database tests (no Docker needed).
# Usage: scripts/dev-db.sh start|stop|url
set -euo pipefail
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
DIR="${HAZIR_PG_DIR:-/tmp/hazir-pg}"
PORT="${HAZIR_PG_PORT:-54329}"
if [ "$(id -u)" = "0" ]; then RUN="runuser -u postgres --"; else RUN=""; fi

case "${1:-}" in
  start)
    if [ ! -d "$DIR/data" ]; then
      mkdir -p "$DIR"; [ "$(id -u)" = "0" ] && chown postgres "$DIR"
      $RUN "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust >/dev/null
    fi
    $RUN "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR" -l "$DIR/log" -w start >/dev/null || true
    echo "postgresql://postgres@localhost:$PORT/postgres"
    ;;
  stop) $RUN "$PGBIN/pg_ctl" -D "$DIR/data" -m fast stop ;;
  url) echo "postgresql://postgres@localhost:$PORT/postgres" ;;
  *) echo "usage: $0 start|stop|url" >&2; exit 2 ;;
esac
