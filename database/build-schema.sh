#!/usr/bin/env bash
# Rigenera database/schema.sql concatenando le migrazioni in ordine (fonte unica: migrations/).
set -euo pipefail
cd "$(dirname "$0")"
{
  echo "-- ====================================================================================="
  echo "-- schema.sql – schema completo del gestionale (GENERATO da build-schema.sh, non modificare a mano)"
  echo "-- Fonte: database/migrations/*.sql · Target: PostgreSQL 15+ / Supabase"
  echo "-- ====================================================================================="
  for f in migrations/*.sql; do
    echo
    echo "-- >>> $f"
    cat "$f"
  done
} > schema.sql
echo "schema.sql generato da $(ls migrations/*.sql | wc -l) migrazioni"
