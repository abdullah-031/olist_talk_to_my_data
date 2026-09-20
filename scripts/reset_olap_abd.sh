#!/usr/bin/env bash
# Empty the OLAP sandbox before rerunning the KNIME pipelines.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

psql -d olist_olap_abd -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE TABLE
  fact_order_item,
  dim_seller,
  dim_customer,
  dim_product,
  dim_category,
  dim_geography,
  dim_date,
  dq_report
RESTART IDENTITY;
SQL

LOG="$ROOT/logs/db_operations.md"
n=$(awk -F'|' '/^\| [0-9]+ \|/{gsub(/ /, "", $2); n=$2} END{print n+1}' "$LOG")
printf '| %s | %s | `olist_olap_abd` | TRUNCATE | all OLAP tables, restart identities | ok |\n' \
  "$n" "$(date '+%Y-%m-%d %H:%M:%S %Z')" >> "$LOG"

echo "OLAP sandbox reset complete"
