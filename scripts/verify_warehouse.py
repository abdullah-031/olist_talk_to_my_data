"""Read-only verification. Run with: uv run python scripts/verify_warehouse.py."""

import json
from pathlib import Path
from uuid import uuid4

from app.config import Settings
from app.warehouse import Warehouse, serialize

CHECKS = {
    "counts": """
        SELECT 'dim_date' AS table_name, COUNT(*) AS rows FROM public.dim_date
        UNION ALL SELECT 'dim_category', COUNT(*) FROM public.dim_category
        UNION ALL SELECT 'dim_customer', COUNT(*) FROM public.dim_customer
        UNION ALL SELECT 'dim_seller', COUNT(*) FROM public.dim_seller
        UNION ALL SELECT 'dim_product', COUNT(*) FROM public.dim_product
        UNION ALL SELECT 'dim_geography', COUNT(*) FROM public.dim_geography
        UNION ALL SELECT 'fact_order_item', COUNT(*) FROM public.fact_order_item
    """,
    "grain_and_keys": """
        SELECT COUNT(*) AS items,
            COUNT(*) - COUNT(DISTINCT (f.order_id, f.order_item_id)) AS duplicate_grain,
            COUNT(*) FILTER (WHERE d.date_key IS NULL) AS unmatched_dates,
            COUNT(*) FILTER (WHERE c.customer_key IS NULL) AS unmatched_customers,
            COUNT(*) FILTER (WHERE p.product_key IS NULL) AS unmatched_products,
            COUNT(*) FILTER (WHERE s.seller_key IS NULL) AS unmatched_sellers,
            COUNT(*) FILTER (WHERE ca.category_key IS NULL) AS unmatched_categories,
            COUNT(*) FILTER (WHERE f.item_total IS DISTINCT FROM
                f.price + f.freight_value) AS item_total_mismatch,
            COUNT(*) FILTER (WHERE d.date_key <> TO_CHAR(d.full_date, 'YYYYMMDD')::int)
                AS invalid_date_keys
        FROM public.fact_order_item f
        LEFT JOIN public.dim_date d ON d.date_key = f.date_key
        LEFT JOIN public.dim_customer c ON c.customer_key = f.customer_key
        LEFT JOIN public.dim_product p ON p.product_key = f.product_key
        LEFT JOIN public.dim_seller s ON s.seller_key = f.seller_key
        LEFT JOIN public.dim_category ca ON ca.category_key = f.category_key
    """,
    "baseline": """
        SELECT COUNT(*) AS items, COUNT(DISTINCT order_id) AS orders,
            SUM(price) AS revenue, SUM(freight_value) AS freight,
            SUM(item_total) AS total_value
        FROM public.fact_order_item
    """,
    "capabilities": """
        SELECT current_setting('server_version') AS server_version,
            current_setting('transaction_read_only') AS transaction_read_only,
            current_setting('pg_qs.query_capture_mode', true) AS query_store_mode,
            current_setting('index_tuning.mode', true) AS index_tuning_mode,
            (SELECT STRING_AGG(extname, ', ' ORDER BY extname) FROM pg_extension)
                AS installed_extensions
    """,
    "query_plan": """
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT c.category_name_english, SUM(f.price) AS revenue
        FROM public.fact_order_item f
        LEFT JOIN public.dim_category c ON c.category_key = f.category_key
        WHERE f.date_key >= 20180101 AND f.date_key <= 20181231
        GROUP BY c.category_name_english ORDER BY revenue DESC LIMIT 5
    """,
}


def main():
    warehouse = Warehouse(Settings())
    warehouse.open()
    report = {}
    try:
        for name, sql in CHECKS.items():
            report[name] = [
                serialize(row)
                for row in warehouse.read(sql, (), uuid4().hex, f"verification.{name}")
            ]
        report["metadata"] = warehouse.metadata(uuid4().hex)
        output = Path("artifacts/warehouse-verification.json")
        output.parent.mkdir(exist_ok=True)
        output.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(
            json.dumps(
                {
                    key: value
                    for key, value in report.items()
                    if key not in ("query_plan", "metadata")
                },
                indent=2,
            )
        )
        print(f"Full report saved to {output}")
        quality = report["grain_and_keys"][0]
        if quality["items"] != 112650 or any(
            value for key, value in quality.items() if key != "items"
        ):
            raise SystemExit("Warehouse validation failed; inspect the saved report.")
    except Exception as exc:
        print(f"Verification failed: {type(exc).__name__}. See the database audit log.")
        raise SystemExit(1) from None
    finally:
        warehouse.close()


if __name__ == "__main__":
    main()
