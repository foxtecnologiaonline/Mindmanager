#!/usr/bin/env bash
# Valida as migrations num Postgres comum (sem Supabase de verdade):
# cria um "shim" (roles anon/authenticated, auth.uid(), storage mínimo),
# aplica TODAS as migrations em ordem e roda os cenários t*.sql, cada um
# num banco novo. Os cenários imprimem o resultado e as tentativas
# proibidas devem aparecer como ERROR (permission denied / RLS / exceção).
#
# Uso: PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh
# (ou defina PSQL="psql -h /tmp -p 5433 -U postgres")
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL=${PSQL:-psql}
for scenario in supabase/tests/t*.sql; do
  echo "=================== $scenario"
  $PSQL -q -c "drop database if exists mm_test" -c "create database mm_test" >/dev/null
  for f in supabase/tests/00_supabase_shim.sql supabase/migrations/*.sql; do
    $PSQL -d mm_test -v ON_ERROR_STOP=1 -q -f "$f" 2>&1 | grep -v NOTICE || true
  done
  $PSQL -d mm_test -q -f "$scenario" 2>&1 | grep -v '^$' || true
done
$PSQL -q -c "drop database if exists mm_test" >/dev/null
