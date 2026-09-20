# Olist source CSVs

Brazilian E-Commerce Public Dataset by Olist (9 files).

| File | Lines (incl. header) | Data rows |
|------|---------------------:|----------:|
| `olist_customers_dataset.csv` | 99442 | 99441 |
| `olist_geolocation_dataset.csv` | 1000164 | 1000163 |
| `olist_order_items_dataset.csv` | 112651 | 112650 |
| `olist_order_payments_dataset.csv` | 103887 | 103886 |
| `olist_order_reviews_dataset.csv` | 104720 | 104719 |
| `olist_orders_dataset.csv` | 99442 | 99441 |
| `olist_products_dataset.csv` | 32952 | 32951 |
| `olist_sellers_dataset.csv` | 3096 | 3095 |
| `product_category_name_translation.csv` | 72 | 71 |

Bundle: `olist_brazilian_ecommerce_source.zip` (same 9 CSVs).

**Note:** `olist_oltp_abd.order_reviews` has **99224** rows (composite PK after dedup of source duplicates). Other OLTP tables match CSV data-row counts above.

Provenance: public Olist dataset mirror (GitHub `0PeterAdel/Brazilian-ECommerce` `DataSet.zip`). Local `archive.zip` / Windows `Downloads/moqarfih` were not found on the box at cleanup time.
