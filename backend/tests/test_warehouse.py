from unittest.mock import MagicMock

import pytest
from app.audit import AuditLog
from app.config import Settings
from app.warehouse import Warehouse


def test_every_query_gets_readonly_timeouts_and_auditing(tmp_path):
    settings = Settings(_env_file=None, audit_log_path=tmp_path / "audit.md")
    db = Warehouse(settings)
    connection = MagicMock()
    connection.execute.return_value.fetchall.return_value = [{"count": 2}]
    db.pool = MagicMock()
    db.pool.connection.return_value.__enter__.return_value = connection
    assert db.read("SELECT COUNT(*) FROM public.fact_order_item", (), "test", "test") == [
        {"count": 2}
    ]
    statements = [call.args[0] for call in connection.execute.call_args_list]
    assert statements[0] == "SET TRANSACTION READ ONLY"
    assert "statement_timeout" in statements[1]
    assert "lock_timeout" in statements[2]
    audit = settings.audit_log_path.read_text()
    assert '"operation": "test.started"' in audit
    assert '"operation": "test.completed"' in audit
    assert "SELECT COUNT" not in audit


def test_audit_failure_prevents_the_database_call(tmp_path):
    settings = Settings(_env_file=None, audit_log_path=tmp_path)
    db = Warehouse(settings)
    db.pool = MagicMock()
    with pytest.raises(OSError):
        db.read("SELECT 1", (), "test", "test")
    db.pool.connection.assert_not_called()


def test_audit_records_metadata_without_sql_literals(tmp_path):
    path = tmp_path / "audit.md"
    AuditLog(path).record("query", "id", "SELECT 'private-filter-value'")
    assert "private-filter-value" not in path.read_text()
