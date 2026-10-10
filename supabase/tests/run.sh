#!/usr/bin/env bash
# Valida as migrations num Postgres comum (sem Supabase de verdade):
# cria um "shim" (roles anon/authenticated, auth.uid(), storage mínimo),
# aplica TODAS as migrations em ordem — qualquer erro de SQL derruba o
# script — e roda os cenários t*.sql, cada um num banco novo. Os cenários
# imprimem os resultados; as tentativas proibidas (RLS, grants, triggers)
# devem aparecer como ERROR e são conferidas à vista, não por asserção.
#
# Uso: PSQL="psql -h localhost -U postgres" ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL=${PSQL:-psql}
export PGOPTIONS='-c client_min_messages=warning'

for scenario in supabase/tests/t*.sql; do
  echo "=================== $scenario"
  $PSQL -q -c "drop database if exists mm_test" -c "create database mm_test"
  for f in supabase/tests/00_supabase_shim.sql supabase/migrations/*.sql; do
    $PSQL -d mm_test -v ON_ERROR_STOP=1 -q -f "$f"
  done
  $PSQL -d mm_test -q -f "$scenario" 2>&1 | grep -v '^$' || true
done
$PSQL -q -c "drop database if exists mm_test"
echo "OK: todas as migrations aplicaram sem erro."
