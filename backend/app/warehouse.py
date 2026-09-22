import time
from datetime import date, datetime
from decimal import Decimal
from threading import Lock

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.audit import AuditLog
from app.config import Settings
from app.query import CompiledQuery


class EntraConnection(psycopg.Connection):
    credential = None

    @classmethod
    def connect(cls, conninfo="", **kwargs):
        # Acquire a fresh token for every new physical connection, including pool replacements.
        kwargs["password"] = cls.credential.get_token(
            "https://ossrdbms-aad.database.windows.net/.default"
        ).token
        return super().connect(conninfo, **kwargs)


class Warehouse:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.audit = AuditLog(settings.audit_log_path)
        self.metadata_lock = Lock()
        self.metadata_cache = None
        self.metadata_until = 0.0
        self.credential = None
        kwargs = dict(
            host=settings.pg_host,
            port=settings.pg_port,
            dbname=settings.pg_database,
            user=settings.pg_user,
            password=settings.pg_password.get_secret_value(),
            sslmode=settings.pg_sslmode,
            connect_timeout=8,
            application_name="olist_warehouse_agent",
            autocommit=True,
            row_factory=dict_row,
            prepare_threshold=None,
        )
        if settings.pg_sslrootcert:
            kwargs["sslrootcert"] = settings.pg_sslrootcert
        connection_class = psycopg.Connection
        if settings.pg_auth_mode == "entra":
            from azure.identity import DefaultAzureCredential

            self.credential = DefaultAzureCredential()
            connection_class = type(
                "AppEntraConnection", (EntraConnection,), {"credential": self.credential}
            )
        self.pool = ConnectionPool(
            kwargs=kwargs,
            connection_class=connection_class,
            min_size=0,
            max_size=settings.db_pool_max_size,
            timeout=10,
            max_waiting=settings.max_concurrent_requests,
            max_lifetime=1800,
            reconnect_timeout=10,
            open=False,
        )

    def open(self):
        self.pool.open()

    def close(self):
        self.pool.close()
        if self.credential:
            self.credential.close()

    def read(self, sql: str, params: tuple, request_id: str, operation: str) -> list[dict]:
        started = time.perf_counter()
        self.audit.record(operation + ".started", request_id, sql)
        try:
            with self.pool.connection() as connection, connection.transaction():
                connection.execute("SET TRANSACTION READ ONLY")
                connection.execute(
                    "SELECT set_config('statement_timeout', %s, true)",
                    (str(self.settings.query_timeout_ms),),
                )
                connection.execute("SELECT set_config('lock_timeout', '2000', true)")
                connection.execute("SELECT set_config('search_path', 'pg_catalog,public', true)")
                rows = connection.execute(sql, params).fetchall()
        except Exception as exc:
            self.audit.record(operation + ".failed", request_id, sql, error_type=type(exc).__name__)
            raise
        self.audit.record(
            operation + ".completed",
            request_id,
            sql,
            rows=len(rows),
            elapsed_ms=round((time.perf_counter() - started) * 1000),
        )
        return rows

    def query(self, query: CompiledQuery, request_id: str):
        rows = self.read(query.sql, query.parameters, request_id, "analytics.select")
        truncated = len(rows) > query.limit
        return [serialize(row) for row in rows[: query.limit]], truncated

    def metadata(self, request_id: str) -> dict:
        with self.metadata_lock:
            if self.metadata_cache and time.monotonic() < self.metadata_until:
                return self.metadata_cache
            summary = self.read(
                "SELECT COUNT(*) AS items, COUNT(DISTINCT f.order_id) AS orders, "
                "MIN(d.full_date) AS first_date, MAX(d.full_date) AS last_date, "
                "COUNT(*) FILTER (WHERE c.category_key IS NULL) AS unmatched_categories "
                "FROM public.fact_order_item f "
                "LEFT JOIN public.dim_date d ON d.date_key = f.date_key "
                "LEFT JOIN public.dim_category c ON c.category_key = f.category_key",
                (),
                request_id,
                "metadata.summary",
            )[0]
            categories = self.read(
                "SELECT category_name_pt, category_name_english FROM public.dim_category "
                "ORDER BY category_key LIMIT 200",
                (),
                request_id,
                "metadata.categories",
            )
            self.metadata_cache = {
                **serialize(summary),
                "quality_warnings": [
                    "Category analysis is unavailable: "
                    f"{summary['unmatched_categories']:,} order items have no category link. "
                    "Repair the category mapping through KNIME and reload the warehouse."
                ]
                if summary["unmatched_categories"]
                else [],
                "categories": categories,
                "database": "olist_olap_abd",
                "currency": "BRL",
                "metadata_ttl_seconds": 60,
            }
            self.metadata_until = time.monotonic() + 60
            return self.metadata_cache


def serialize(row: dict) -> dict:
    # Keep decimal amounts exact on the wire. JS converts only for display/chart rendering.
    return {
        key: str(value)
        if isinstance(value, Decimal)
        else value.isoformat()
        if isinstance(value, (date, datetime))
        else value
        for key, value in row.items()
    }
