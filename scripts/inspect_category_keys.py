"""Read-only investigation of category relationships; all reads use the audit path."""

import json
from uuid import uuid4

from app.config import Settings
from app.warehouse import Warehouse

warehouse = Warehouse(Settings())
warehouse.open()
try:
    for name, sql in {
        "category_paths": """
            SELECT COUNT(*) AS items,
                COUNT(*) FILTER (WHERE f.category_key IS NULL) AS null_fact_category,
                COUNT(*) FILTER (WHERE c.category_key IS NOT NULL) AS via_fact_matched,
                COUNT(*) FILTER (WHERE pc.category_key IS NOT NULL) AS via_product_matched,
                MIN(f.category_key) AS min_fact_category, MAX(f.category_key) AS max_fact_category,
                MIN(p.category_key) AS min_product_category,
                MAX(p.category_key) AS max_product_category
            FROM public.fact_order_item f
            LEFT JOIN public.dim_category c ON c.category_key=f.category_key
            LEFT JOIN public.dim_product p ON p.product_key=f.product_key
            LEFT JOIN public.dim_category pc ON pc.category_key=p.category_key
        """,
        "dimension_ranges": """
            SELECT MIN(category_key) AS min_category, MAX(category_key) AS max_category,
                COUNT(*) AS rows, COUNT(DISTINCT category_key) AS unique_keys
            FROM public.dim_category
        """,
        "constraints": """
            SELECT conrelid::regclass::text AS table_name, contype, pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid IN ('public.fact_order_item'::regclass,
                'public.dim_product'::regclass, 'public.dim_category'::regclass)
        """,
    }.items():
        print(name, json.dumps(warehouse.read(sql, (), uuid4().hex, "diagnostic." + name)))
finally:
    warehouse.close()
