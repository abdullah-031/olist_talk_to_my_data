from copy import deepcopy

import pytest
from app.models import QueryPlan
from app.query import compile_query
from pydantic import ValidationError

PLAN = {
    "action": "query",
    "message": "Revenue by category",
    "metrics": ["revenue", "orders"],
    "dimensions": ["category"],
    "filters": {
        "date_from": None,
        "date_to": None,
        "category": None,
        "customer_state": None,
        "seller_state": None,
        "status": None,
    },
    "sort_by": "revenue",
    "sort_direction": "desc",
    "limit": 5,
}


def test_sql_injection_is_bound_as_a_value():
    raw = deepcopy(PLAN)
    attack = "'; DROP TABLE public.fact_order_item; --"
    raw["filters"]["category"] = attack
    query = compile_query(QueryPlan.model_validate(raw))
    assert attack not in query.sql
    assert query.parameters == (attack, attack, 6)
    assert "COUNT(DISTINCT f.order_id)" in query.sql
    assert "LEFT JOIN public.dim_category" in query.sql


@pytest.mark.parametrize(
    "field,value",
    [
        ("metrics", ["pg_sleep(10)"]),
        ("dimensions", ["customer_id"]),
        ("sort_by", "revenue; DELETE FROM fact_order_item"),
        ("sort_direction", "desc; select 1"),
        ("limit", 100000),
        ("metrics", ["revenue", "revenue"]),
        ("dimensions", ["month", "year", "category"]),
    ],
)
def test_unreviewed_expressions_cannot_be_executed(field, value):
    raw = {**deepcopy(PLAN), field: value}
    with pytest.raises(ValidationError):
        QueryPlan.model_validate(raw)


def test_dates_filter_indexed_fact_key_without_unnecessary_joins():
    raw = deepcopy(PLAN)
    raw["dimensions"] = []
    raw["filters"].update(date_from="2018-01-01", date_to="2018-12-31", status="delivered")
    query = compile_query(QueryPlan.model_validate(raw))
    assert "JOIN" not in query.sql
    assert "f.date_key >= %s" in query.sql
    assert query.parameters == (20180101, 20181231, "delivered", 6)


def test_chronological_month_and_tie_breaker():
    raw = {
        **deepcopy(PLAN),
        "dimensions": ["month", "category"],
        "sort_by": "month",
        "sort_direction": "asc",
    }
    query = compile_query(QueryPlan.model_validate(raw))
    assert "'YYYY-MM'" in query.sql
    assert 'ORDER BY "month" ASC NULLS LAST, "category" ASC' in query.sql


def test_invalid_date_range_rejected():
    raw = deepcopy(PLAN)
    raw["filters"].update(date_from="2019-01-01", date_to="2018-01-01")
    with pytest.raises(ValidationError):
        QueryPlan.model_validate(raw)


def test_clarification_cannot_reach_database():
    with pytest.raises(ValueError):
        compile_query(QueryPlan.model_validate({**PLAN, "action": "clarify"}))


def test_scalar_aggregate_without_sort_uses_its_selected_metric():
    plan = QueryPlan.model_validate({**PLAN, "dimensions": [], "sort_by": ""})
    assert plan.sort_by == "revenue"
    assert 'ORDER BY "revenue"' in compile_query(plan).sql
