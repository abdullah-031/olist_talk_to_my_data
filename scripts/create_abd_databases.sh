#!/usr/bin/env bash
# Create olist_oltp_abd + olist_olap_abd, apply schema DDL, load OLTP from shared olist_oltp.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/logs/db_operations.md"
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
: "${PGHOST:?Set PGHOST in .env}" "${PGPORT:?Set PGPORT in .env}"
: "${PGUSER:?Set PGUSER in .env}" "${PGPASSWORD:?Set PGPASSWORD in .env}"
: "${PGSSLMODE:?Set PGSSLMODE in .env}"

ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }
next_n() {
  local last
  last=$(grep -E '^\| [0-9]+ \|' "$LOG" 2>/dev/null | tail -1 | awk -F'|' '{gsub(/ /,"",$2); print $2}' || true)
  echo $(( ${last:-0} + 1 ))
}
log_row() {
  echo "| $1 | $(ts) | \`$2\` | $3 | $4 | $5 |" >> "$LOG"
}

psql_admin() { psql -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_db() { local db="$1"; shift; psql -d "$db" -v ON_ERROR_STOP=1 "$@"; }

mkdir -p "$(dirname "$LOG")"
[[ -f "$LOG" ]] || printf '# Azure PostgreSQL — DB operations log\n\n| # | Timestamp | Database | Action | Detail | Result |\n|---|-----------|----------|--------|--------|--------|\n' > "$LOG"

n=$(next_n)
psql_admin -c "SELECT current_user;" >/tmp/abd_ping.txt
log_row "$n" postgres "CONNECT" "create_abd_databases.sh as $PGUSER" "ok"
n=$((n+1))

# Drop prior abd DBs (plus any leftover legacy names if still present)
for db in olist_oltp_abd olist_olap_abd; do
  psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$db' AND pid<>pg_backend_pid();" >/dev/null || true
  psql_admin -c "DROP DATABASE IF EXISTS $db;"
  log_row "$n" postgres "DROP DATABASE" "IF EXISTS $db" "ok"
  n=$((n+1))
done

for db in olist_oltp_abd olist_olap_abd; do
  psql_admin -c "CREATE DATABASE $db OWNER $PGUSER;"
  log_row "$n" postgres "CREATE DATABASE" "$db OWNER $PGUSER" "ok"
  n=$((n+1))
done

psql_db olist_oltp_abd -f "$ROOT/sql/01_olist_oltp_abd_schema.sql"
log_row "$n" olist_oltp_abd "DDL" "01_olist_oltp_abd_schema.sql — 9 OLTP tables" "ok"
n=$((n+1))

psql_db olist_olap_abd -f "$ROOT/sql/02_olist_olap_abd_schema.sql"
log_row "$n" olist_olap_abd "DDL" "02_olist_olap_abd_schema.sql — empty star" "ok"
n=$((n+1))

declare -a TABLES=(
  product_category_name_translation
  customers
  geolocation
  products
  sellers
  orders
  order_items
  order_payments
  order_reviews
)

for table in "${TABLES[@]}"; do
  psql -d olist_oltp -c "\\copy $table TO STDOUT WITH (FORMAT csv, HEADER true)" \
    | psql_db olist_oltp_abd -c "\\copy $table FROM STDIN WITH (FORMAT csv, HEADER true)"
  rows=$(psql_db olist_oltp_abd -tAc "SELECT COUNT(*) FROM $table")
  log_row "$n" olist_oltp_abd "COPY" "$table ← olist_oltp (csv pipe)" "ok: $rows rows"
  n=$((n+1))
done

echo "=== olist_oltp_abd counts ==="
psql_db olist_oltp_abd -c "
SELECT 'customers' t, COUNT(*) c FROM customers
UNION ALL SELECT 'geolocation', COUNT(*) FROM geolocation
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'sellers', COUNT(*) FROM sellers
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'order_payments', COUNT(*) FROM order_payments
UNION ALL SELECT 'order_reviews', COUNT(*) FROM order_reviews
UNION ALL SELECT 'product_category_name_translation', COUNT(*) FROM product_category_name_translation
ORDER BY 1;"
log_row "$n" olist_oltp_abd "SELECT" "final OLTP row counts" "ok"
n=$((n+1))

echo "=== olist_olap_abd empty check ==="
psql_db olist_olap_abd -c "
SELECT 'dim_date' t, COUNT(*) c FROM dim_date
UNION ALL SELECT 'dim_geography', COUNT(*) FROM dim_geography
UNION ALL SELECT 'dim_category', COUNT(*) FROM dim_category
UNION ALL SELECT 'dim_product', COUNT(*) FROM dim_product
UNION ALL SELECT 'dim_customer', COUNT(*) FROM dim_customer
UNION ALL SELECT 'dim_seller', COUNT(*) FROM dim_seller
UNION ALL SELECT 'fact_order_item', COUNT(*) FROM fact_order_item
ORDER BY 1;"
log_row "$n" olist_olap_abd "SELECT" "confirm empty OLAP star" "ok: all 0"

echo "DONE"
