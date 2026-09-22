from dataclasses import dataclass

from app.catalog import DIMENSIONS, JOINS, METRICS
from app.models import Column, QueryPlan


@dataclass(frozen=True)
class CompiledQuery:
    sql: str
    parameters: tuple
    columns: list[Column]
    limit: int


def compile_query(plan: QueryPlan) -> CompiledQuery:
    # Revalidate even if a caller supplies an object constructed without Pydantic validation.
    plan = QueryPlan.model_validate(plan.model_dump())
    if plan.action != "query":
        raise ValueError("Clarifications cannot execute queries.")
    joins: set[str] = set()
    select, groups, conditions, params, columns = [], [], [], [], []
    for key in plan.dimensions:
        expression, label, dependency = DIMENSIONS[key]
        select.append(f'{expression} AS "{key}"')
        groups.append(str(len(select)))
        if dependency:
            joins.add(dependency)
        columns.append(Column(key=key, label=label, format="text"))
    for key in plan.metrics:
        expression, label, fmt = METRICS[key]
        select.append(f'{expression} AS "{key}"')
        columns.append(Column(key=key, label=label, format=fmt))
    filters = plan.filters
    for value, operator in [(filters.date_from, ">="), (filters.date_to, "<=")]:
        if value:
            # Filter the indexed fact FK directly; date_key is YYYYMMDD.
            conditions.append(f"f.date_key {operator} %s")
            params.append(int(value.strftime("%Y%m%d")))
    if filters.category:
        joins.add("category")
        conditions.append(
            "(LOWER(c.category_name_english) = LOWER(%s) OR LOWER(c.category_name_pt) = LOWER(%s))"
        )
        params.extend([filters.category, filters.category])
    for value, expression, dependency in [
        (filters.customer_state, "cu.customer_state", "customer"),
        (filters.seller_state, "s.seller_state", "seller"),
        (filters.status, "f.order_status", None),
    ]:
        if value:
            if dependency:
                joins.add(dependency)
            conditions.append(f"{expression} = %s")
            params.append(value)
    sql = "SELECT\n    " + ",\n    ".join(select) + "\nFROM public.fact_order_item AS f"
    for dependency, join in JOINS.items():
        if dependency in joins:
            sql += "\n" + join
    if conditions:
        sql += "\nWHERE " + " AND ".join(conditions)
    if groups:
        sql += "\nGROUP BY " + ", ".join(groups)
    direction = "ASC" if plan.sort_direction == "asc" else "DESC"
    sql += f'\nORDER BY "{plan.sort_by}" {direction} NULLS LAST'
    for key in plan.dimensions:
        if key != plan.sort_by:
            sql += f', "{key}" ASC NULLS LAST'
    sql += "\nLIMIT %s"
    params.append(plan.limit + 1)
    return CompiledQuery(sql, tuple(params), columns, plan.limit)
