# Azure PostgreSQL — DB operations log (Abdullah sandbox track)

Host: `tgsdb.postgres.database.azure.com`  
User: `tgsteam` (password from box secrets)  
SSL: require  
Sandbox DBs: `olist_oltp_abd` (source) · `olist_olap_abd` (target)  
Rule: every database hit on this track gets a short entry here.  
Do **not** write to shared `olist_oltp` / `olist_olap`.

Pre-abd history (shared DB loads, External Tool era, `*_abdullah` experiments) archived at `archive/logs_pre_abd/`.

| # | Timestamp (Europe/Amsterdam) | Database | Action | Detail | Result |
|---|------------------------------|----------|--------|--------|--------|
| 1 | 2026-09-19 21:09:38 CEST | `postgres` | CONNECT | create_abd_databases.sh as tgsteam | ok |
| 2 | 2026-09-19 21:09:39 CEST | `postgres` | DROP DATABASE | IF EXISTS olist_oltp_abdullah (legacy cleanup) | ok |
| 3 | 2026-09-19 21:09:40 CEST | `postgres` | DROP DATABASE | IF EXISTS olist_olap_abdullah (legacy cleanup) | ok |
| 4 | 2026-09-19 21:09:42 CEST | `postgres` | DROP DATABASE | IF EXISTS olist_oltp_abd | ok |
| 5 | 2026-09-19 21:09:43 CEST | `postgres` | DROP DATABASE | IF EXISTS olist_olap_abd | ok |
| 6 | 2026-09-19 21:09:44 CEST | `postgres` | CREATE DATABASE | olist_oltp_abd OWNER tgsteam | ok |
| 7 | 2026-09-19 21:09:44 CEST | `postgres` | CREATE DATABASE | olist_olap_abd OWNER tgsteam | ok |
| 8 | 2026-09-19 21:09:46 CEST | `olist_oltp_abd` | DDL | 01_olist_oltp_abd_schema.sql — 9 OLTP tables | ok |
| 9 | 2026-09-19 21:09:48 CEST | `olist_olap_abd` | DDL | 02_olist_olap_abd_schema.sql — empty star (initial IDENTITY) | ok |
| 10 | 2026-09-19 21:09:49 CEST | `olist_oltp_abd` | COPY | product_category_name_translation ← shared olist_oltp | ok: 71 rows |
| 11 | 2026-09-19 21:09:53 CEST | `olist_oltp_abd` | COPY | customers ← shared olist_oltp | ok: 99441 rows |
| 12 | 2026-09-19 21:10:10 CEST | `olist_oltp_abd` | COPY | geolocation ← shared olist_oltp | ok: 1000163 rows |
| 13 | 2026-09-19 21:10:12 CEST | `olist_oltp_abd` | COPY | products ← shared olist_oltp | ok: 32951 rows |
| 14 | 2026-09-19 21:10:14 CEST | `olist_oltp_abd` | COPY | sellers ← shared olist_oltp | ok: 3095 rows |
| 15 | 2026-09-19 21:10:26 CEST | `olist_oltp_abd` | COPY | orders ← shared olist_oltp | ok: 99441 rows |
| 16 | 2026-09-19 21:10:38 CEST | `olist_oltp_abd` | COPY | order_items ← shared olist_oltp | ok: 112650 rows |
| 17 | 2026-09-19 21:10:46 CEST | `olist_oltp_abd` | COPY | order_payments ← shared olist_oltp | ok: 103886 rows |
| 18 | 2026-09-19 21:10:56 CEST | `olist_oltp_abd` | COPY | order_reviews ← shared olist_oltp | ok: 99224 rows |
| 19 | 2026-09-19 21:10:58 CEST | `olist_oltp_abd` | SELECT | verify OLTP counts match shared | ok: identical |
| 20 | 2026-09-19 21:10:58 CEST | `olist_olap_abd` | SELECT | confirm empty OLAP star | ok: all 0 |
| 21 | 2026-09-19 21:20:27 CEST | `olist_olap` / `olist_olap_abd` | SELECT | information_schema diff (cols/PKs/FKs/indexes) | DIFF: 5 surrogate keys IDENTITY on abd vs SERIAL on shared |
| 22 | 2026-09-19 21:20:27 CEST | `olist_olap_abd` | DDL | re-apply 02_olist_olap_abd_schema.sql with SERIAL (match shared) | ok |
| 23 | 2026-09-19 21:20:27 CEST | `olist_oltp` / `olist_oltp_abd` | SELECT | schema diff cols/PKs/FKs/indexes | IDENTICAL |
| 24 | 2026-09-19 21:20:27 CEST | `olist_olap` / `olist_olap_abd` | SELECT | schema diff cols/PKs/FKs/indexes | IDENTICAL |
| 25 | 2026-09-19 21:20:27 CEST | `olist_oltp_abd` | SELECT | re-verify OLTP row counts vs shared | ok: match (see summary) |
| 26 | 2026-09-19 21:20:27 CEST | `olist_olap_abd` | SELECT | confirm still empty after SERIAL recreate | ok: all 0 |
| 27 | 2026-09-19 22:28:00 CEST | `olist_olap_abd` | DELETE | public.dim_seller (KNIME 06_Dim_Seller #17) | ok |
| 28 | 2026-09-19 22:28:00 CEST | `olist_olap_abd` | WRITE | DB Writer append public.dim_seller + setval seller_key | ok: 3095 rows, keys 1-3095, sequence 3095 |
| 29 | 2026-09-19 22:28:00 CEST | `olist_olap_abd` | SELECT | verify public.dim_seller | ok: 3095 rows, 3095 distinct seller_id, geo_key nulls 0, min_key 1, max_key 3095 |
| 30 | 2026-09-19 22:42:25 CEST | `olist_olap_abd` | SELECT | dim counts + fact_order_item before 07 load | ok: date 634, customer 99441, product 32951, seller 3095, category 74, fact 0 |
| 31 | 2026-09-19 22:42:25 CEST | `olist_oltp_abd` / `olist_olap_abd` | SELECT | order_items ⟕ orders ⟕ dims integrity | ok: 112650 items, orphans customer/product/seller/purchase_date 0, category_key nulls 0, price/freight nulls 0 |
| 32 | 2026-09-20 00:04 CEST | `olist_olap_abd` | SELECT | fact_order_item before 07 re-exec (nodes still IDLE; time approx, before 00:07) | ok: already 112650 |
| 33 | 2026-09-20 00:05 CEST | `olist_olap_abd` | SELECT | null FK spot-check before 07 re-exec (time approx, before 00:07) | ok: date_key/customer_key/product_key/seller_key/category_key nulls 0 |
| 34 | 2026-09-20 00:09:55 CEST | `olist_olap_abd` | DELETE | public.fact_order_item (KNIME 07_Fact_Order_Item #24) | ok |
| 35 | 2026-09-20 00:10:58 CEST | `olist_olap_abd` | WRITE | DB Writer append public.fact_order_item (KNIME #25) | ok: 112650 rows |
| 36 | 2026-09-20 00:10:59 CEST | `olist_olap_abd` | SELECT | verify public.fact_order_item (KNIME #26) | ok: 112650 rows, date_key/customer_key/product_key/seller_key/category_key nulls 0 |
| 37 | 2026-09-20 00:11:30 CEST | `olist_olap_abd` | SELECT | independent confirm COUNT(*) + null FKs after KNIME | ok: 112650, all five key nulls 0 |

## Verified OLTP row counts (`olist_oltp_abd` ≡ shared `olist_oltp`)

| Table | Rows |
|-------|------|
| customers | 99441 |
| geolocation | 1000163 |
| products | 32951 |
| sellers | 3095 |
| orders | 99441 |
| order_items | 112650 |
| order_payments | 103886 |
| order_reviews | 99224 |
| product_category_name_translation | 71 |

## Notes
- Dims and `fact_order_item` are loaded in `olist_olap_abd` (fact 112650 as of 2026-09-20 00:11 CEST).
- User retargets existing workflow connectors; new workflows we create/run must use `olist_oltp_abd` / `olist_olap_abd`.
- Source CSVs live under `data/` (see inventory there).
