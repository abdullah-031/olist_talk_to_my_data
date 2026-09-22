import json

import httpx
from app.config import Settings
from app.models import ChatRequest
from app.planner import Planner
from test_query import PLAN


def test_openrouter_routing_and_structured_output_with_http_fixture():
    settings = Settings(_env_file=None, openrouter_api_key="fixture-router-key")
    planner = Planner(settings)
    requests = []

    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        assert request.url.host == "openrouter.ai"
        assert request.url.path == "/api/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer fixture-router-key"
        return httpx.Response(
            200,
            json={
                "id": "fixture",
                "object": "chat.completion",
                "created": 1,
                "model": "openai/gpt-4.1-nano",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {
                            "role": "assistant",
                            "content": json.dumps(PLAN),
                            "refusal": None,
                        },
                    }
                ],
                "usage": {"prompt_tokens": 12, "completion_tokens": 20, "total_tokens": 32},
            },
        )

    planner.client.close()
    from openai import OpenAI

    planner.client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key="fixture-router-key",
        http_client=httpx.Client(transport=httpx.MockTransport(respond)),
    )
    try:
        plan, usage = planner.plan(
            ChatRequest(question="Revenue by category?"),
            {
                "first_date": "2016-01-01",
                "last_date": "2018-12-31",
                "categories": [],
            },
        )
    finally:
        planner.close()
    assert plan.metrics == ["revenue", "orders"]
    assert usage == {"input_tokens": 12, "output_tokens": 20}
    assert requests[0]["model"] == "openai/gpt-4.1-nano"
    assert requests[0]["provider"] == {"require_parameters": True, "data_collection": "deny"}
    assert requests[0]["response_format"]["type"] == "json_schema"
    assert requests[0]["response_format"]["json_schema"]["strict"] is True
    assert "store" not in requests[0]
    assert "quality_warnings" not in json.dumps(requests[0]["messages"])


def test_provider_specific_defaults_and_keys():
    assert Settings(_env_file=None).openai_model == "openai/gpt-4.1-nano"
    assert "OPENROUTER_API_KEY" in Settings(_env_file=None).missing()
    direct = Settings(_env_file=None, openai_provider="openai", open_ai_api_key="fixture")
    assert direct.openai_model == "gpt-4.1-nano"
    assert "OPEN_AI_API_KEY" not in direct.missing()
    assert "OPENROUTER_API_KEY" not in direct.missing()
