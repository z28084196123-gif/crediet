#!/usr/bin/env bash
# 在本機 Postgres 建立乾淨資料庫,套用 Supabase 相容層 + migrations + 測試資料,然後跑 RLS/流程測試。
# 需要環境變數 PGHOST / PGPORT / PGUSER(預設 localhost:5432 postgres)。
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-yijia_training_test}
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -v ON_ERROR_STOP=1 -q -X -d "$DB" -o /dev/null -f "$1"; }
run supabase/tests/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do echo "▶ $f"; run "$f"; done
for f in supabase/tests/[1-9]*.sql; do echo "▶ $f"; run "$f"; done
echo "✅ 全部測試通過"
