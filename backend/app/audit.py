import hashlib
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

logger = logging.getLogger("warehouse.audit")


class AuditLog:
    """Local repository audit plus structured stdout. Never log secrets or filter values."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = Lock()

    def record(self, operation: str, request_id: str, sql: str = "", **details):
        event = {
            "timestamp": datetime.now(UTC).isoformat(),
            "database": "olist_olap_abd",
            "operation": operation,
            "request_id": request_id,
            "query_hash": hashlib.sha256(sql.encode()).hexdigest()[:16] if sql else None,
            **details,
        }
        # Fail closed before a DB operation if its audit cannot be written.
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as file:
                file.write("\n- Agent DB audit: `" + json.dumps(event) + "`\n")
        logger.info(json.dumps(event))
