from copy import deepcopy
from decimal import Decimal

import pytest
from app.config import Settings
from app.main import create_app
from app.models import QueryPlan
from app.warehouse import serialize
from fastapi.testclient import TestClient
from test_query import PLAN


class FakeWarehouse:
    calls = 0

    def open(self):
        pass

    def close(self):
        pass

    def metadata(self, request_id):
        return {
            "items": 10,
            "orders": 8,
            "first_date": "2018-01-01",
            "last_date": "2018-12-31",
            "categories": [],
            "database": "olist_olap_abd",
            "currency": "BRL",
        }

    def query(self, query, request_id):
        self.calls += 1
        return [{"category": "books", "revenue": "123.45", "orders": 3}], False


class FakePlanner:
    def __init__(self, plan=None):
        self.result = plan or deepcopy(PLAN)

    def close(self):
        pass

    def plan(self, request, metadata):
        return QueryPlan.model_validate(self.result), {"input_tokens": 10, "output_tokens": 10}


def settings(**kwargs):
    return Settings(
        _env_file=None,
        pg_host="example.invalid",
        pg_user="reader",
        pg_password="test-secret",
        open_ai_api_key="test-key",
        openrouter_api_key="test-router-key",
        **kwargs,
    )


def test_question_to_result_contract():
    with TestClient(create_app(settings(), FakeWarehouse(), FakePlanner())) as client:
        response = client.post("/api/chat", json={"question": "Revenue by category?"})
        assert response.status_code == 200
        body = response.json()
        assert body["rows"][0]["revenue"] == "123.45"
        assert body["sql"].startswith("SELECT")
        assert body["request_id"] == response.headers["X-Request-ID"]
        assert "test-secret" not in response.text
        assert body["timings_ms"]["database"] >= 0


def test_clarification_never_executes_sql():
    db = FakeWarehouse()
    with TestClient(
        create_app(settings(), db, FakePlanner({**PLAN, "action": "clarify"}))
    ) as client:
        body = client.post("/api/chat", json={"question": "What is profit?"}).json()
        assert body["sql"] is None
        assert db.calls == 0


@pytest.mark.parametrize(
    "body",
    [{"question": " "}, {"question": "x" * 2001}, {"question": "hello", "sql": "DROP TABLE foo"}],
)
def test_request_validation_does_not_echo_input(body):
    with TestClient(create_app(settings(), FakeWarehouse(), FakePlanner())) as client:
        response = client.post("/api/chat", json=body)
        assert response.status_code == 422
        assert "DROP TABLE" not in response.text


def test_body_size_guard():
    with TestClient(create_app(settings(), FakeWarehouse(), FakePlanner())) as client:
        assert client.post("/api/chat", content=b"x" * 32769).status_code == 413


def test_configuration_and_auth_guards():
    with pytest.raises(ValueError):
        settings(pg_database="olist_olap")
    with pytest.raises(ValueError):
        settings(app_env="production")
    with TestClient(
        create_app(settings(auth_mode="azure_container_apps"), FakeWarehouse(), FakePlanner())
    ) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/warehouse").status_code == 401


def test_decimal_values_keep_precision():
    assert serialize({"revenue": Decimal("1234567890123.45")}) == {"revenue": "1234567890123.45"}


def test_missing_category_links_block_even_a_model_query_plan():
    class MissingCategories(FakeWarehouse):
        def metadata(self, request_id):
            return {**super().metadata(request_id), "unmatched_categories": 10}

    db = MissingCategories()
    with TestClient(create_app(settings(), db, FakePlanner())) as client:
        response = client.post("/api/chat", json={"question": "Top categories?"}).json()
        assert response["plan"]["action"] == "clarify"
        assert response["sql"] is None
        assert "KNIME" in response["answer"]
        assert db.calls == 0


def test_sql_failure_does_not_expose_connection_details():
    import psycopg

    class FailingWarehouse(FakeWarehouse):
        def query(self, query, request_id):
            raise psycopg.OperationalError("password=test-secret host=private-server")

    with TestClient(create_app(settings(), FailingWarehouse(), FakePlanner())) as client:
        response = client.post("/api/chat", json={"question": "Revenue?"})
        assert response.status_code == 503
        assert "test-secret" not in response.text
        assert "private-server" not in response.text


def test_warehouse_status_does_not_require_model_credentials():
    config = Settings(
        _env_file=None, pg_host="example.invalid", pg_user="reader", pg_password="fixture"
    )
    with TestClient(create_app(config, FakeWarehouse())) as client:
        assert client.get("/api/warehouse").status_code == 200
        assert client.get("/api/health").json()["configured"] is False
        response = client.post("/api/chat", json={"question": "Revenue?"})
        assert response.status_code == 503
        assert "Model setup" in response.json()["error"]
