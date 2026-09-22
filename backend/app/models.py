from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Metric = Literal["revenue", "orders", "items", "freight", "total_value", "average_order_value"]
Dimension = Literal[
    "year", "quarter", "month", "category", "customer_state", "seller_state", "status"
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Filters(StrictModel):
    # All fields are required by Structured Outputs; null means no restriction.
    date_from: date | None
    date_to: date | None
    category: str | None
    customer_state: str | None
    seller_state: str | None
    status: (
        Literal[
            "created",
            "approved",
            "invoiced",
            "processing",
            "shipped",
            "delivered",
            "unavailable",
            "canceled",
        ]
        | None
    )

    @model_validator(mode="after")
    def validate_filters(self):
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("The start date must not follow the end date.")
        if self.category is not None:
            self.category = self.category.strip()
            if not 1 <= len(self.category) <= 100:
                raise ValueError("Category must contain 1–100 characters.")
        for field in ("customer_state", "seller_state"):
            value = getattr(self, field)
            if value is not None:
                value = value.strip().upper()
                if len(value) != 2 or not value.isalpha() or not value.isascii():
                    raise ValueError("State must be a two-letter Brazilian state code.")
                setattr(self, field, value)
        return self


class QueryPlan(StrictModel):
    action: Literal["query", "clarify"]
    message: str
    metrics: list[Metric]
    dimensions: list[Dimension]
    filters: Filters
    sort_by: Metric | Dimension | Literal[""]
    sort_direction: Literal["asc", "desc"]
    limit: int

    @model_validator(mode="after")
    def validate_plan(self):
        if len(self.message) > 600:
            raise ValueError("Message too long.")
        if self.action == "query":
            if not 1 <= len(self.metrics) <= 4 or len(set(self.metrics)) != len(self.metrics):
                raise ValueError("Choose 1–4 distinct metrics.")
            if len(self.dimensions) > 2 or len(set(self.dimensions)) != len(self.dimensions):
                raise ValueError("Choose at most two distinct dimensions.")
            # Scalar aggregates have exactly one row; an omitted sort is unambiguous.
            if not self.dimensions and not self.sort_by:
                self.sort_by = self.metrics[0]
            if self.sort_by not in self.metrics + self.dimensions:
                raise ValueError("Sort must reference a selected metric or dimension.")
        if not 1 <= self.limit <= 100:
            raise ValueError("Result limit must be 1–100.")
        return self


class ContextTurn(StrictModel):
    question: str = Field(min_length=1, max_length=2000)
    plan: QueryPlan


class ChatRequest(StrictModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[ContextTurn] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def nonblank(self):
        self.question = self.question.strip()
        if not self.question:
            raise ValueError("Please enter a question.")
        return self


class Column(StrictModel):
    key: str
    label: str
    format: Literal["text", "number", "currency"]


class ChatResponse(StrictModel):
    request_id: str
    answer: str
    plan: QueryPlan
    columns: list[Column]
    rows: list[dict[str, str | int | None]]
    sql: str | None
    parameters: list[str | int]
    truncated: bool
    notes: list[str]
    timings_ms: dict[str, int]
    model: str
    usage: dict[str, int]
