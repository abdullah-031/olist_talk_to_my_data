import json
import logging
import time
from decimal import Decimal

from app.catalog import DEFINITIONS
from app.models import ChatRequest, ChatResponse
from app.query import compile_query

logger = logging.getLogger("warehouse.agent")


class AgentService:
    def __init__(self, warehouse, planner, model: str):
        self.warehouse, self.planner, self.model = warehouse, planner, model

    def ask(self, request: ChatRequest, request_id: str) -> ChatResponse:
        start = time.perf_counter()
        metadata = self.warehouse.metadata(request_id)
        metadata_end = time.perf_counter()
        plan, usage = self.planner.plan(request, metadata)
        planned = time.perf_counter()
        # Enforce data quality in code even if the model ignores the warning.
        if metadata.get("unmatched_categories", 0) and (
            "category" in plan.dimensions or plan.filters.category is not None
        ):
            plan = plan.model_copy(
                update={
                    "action": "clarify",
                    "message": "Category analysis is currently unavailable because warehouse items "
                    "have missing category links. Repair the category mapping through KNIME. "
                    "You can still explore overall revenue, monthly trends, "
                    "states, and order status.",
                }
            )
        logger.info(
            json.dumps(
                {
                    "event": "agent_plan",
                    "request_id": request_id,
                    "model": self.model,
                    "action": plan.action,
                    "planning_ms": round((planned - metadata_end) * 1000),
                    **usage,
                }
            )
        )
        common = dict(request_id=request_id, plan=plan, model=self.model, usage=usage)
        if plan.action == "clarify":
            return ChatResponse(
                **common,
                answer=plan.message,
                columns=[],
                rows=[],
                sql=None,
                parameters=[],
                truncated=False,
                notes=[],
                timings_ms={"total": round((planned - start) * 1000)},
            )
        query = compile_query(plan)
        rows, truncated = self.warehouse.query(query, request_id)
        finished = time.perf_counter()
        notes = list(DEFINITIONS) + metadata.get("quality_warnings", [])
        notes.append(
            "Filters: "
            + ", ".join(
                f"{key}={value}"
                for key, value in plan.filters.model_dump().items()
                if value is not None
            )
            if any(value is not None for value in plan.filters.model_dump().values())
            else "Filters: none; all available dates and statuses."
        )
        if not metadata["items"]:
            answer = "The warehouse is empty. Load it through the KNIME workflows, then try again."
        elif not rows:
            answer = "No matching groups were found. Try a different date range or filter."
        elif not plan.dimensions:
            parts = []
            for column in query.columns:
                value = rows[0][column.key]
                prefix = "R$ " if column.format == "currency" and value is not None else ""
                if value is not None and column.format == "currency":
                    value = f"{Decimal(str(value)):,.2f}"
                elif value is not None and column.format == "number":
                    value = f"{int(value):,}"
                parts.append(
                    f"{column.label}: {prefix}{value if value is not None else 'not available'}"
                )
            answer = ". ".join(parts) + "."
        else:
            answer = f"Showing {len(rows)} {'groups' if len(rows) != 1 else 'group'}, ordered by "
            answer += f"{plan.sort_by.replace('_', ' ')} ({plan.sort_direction})."
        if truncated:
            notes.append(
                f"More groups exist. Only the first {plan.limit} are shown; this is not a total."
            )
        return ChatResponse(
            **common,
            answer=answer,
            columns=query.columns,
            rows=rows,
            sql=query.sql,
            parameters=list(query.parameters),
            truncated=truncated,
            notes=notes,
            timings_ms={
                "metadata": round((metadata_end - start) * 1000),
                "planning": round((planned - metadata_end) * 1000),
                "database": round((finished - planned) * 1000),
                "total": round((finished - start) * 1000),
            },
        )
