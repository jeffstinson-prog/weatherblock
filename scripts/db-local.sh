#!/usr/bin/env bash
# Create a fresh test database and apply the Supabase stand-ins and every migration.
# Usage: DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/wb_test scripts/db-local.sh
set -euo pipefail
url="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/wb_test}"
admin="${url%/*}/postgres"
db="${url##*/}"
psql "$admin" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$db\" with (force);" -c "create database \"$db\";"
psql "$url" -v ON_ERROR_STOP=1 -q -f supabase/test-shim.sql
for f in supabase/migrations/*.sql; do
  psql "$url" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "Database ready: $db"
