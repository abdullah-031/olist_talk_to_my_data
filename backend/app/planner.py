import json

from openai import OpenAI

from app.catalog import SYSTEM_PROMPT
from app.config import Settings
from app.models import ChatRequest, QueryPlan


class PlannerError(Exception):
    pass


class Planner:
    def __init__(self, settings: Settings):
        self.model = settings.openai_model
        self.provider = settings.openai_provider
        self.credential = None
        options = {"timeout": 25.0, "max_retries": 1}
        if settings.openai_provider == "openrouter":
            options["base_url"] = "https://openrouter.ai/api/v1"
            options["api_key"] = settings.openrouter_api_key.get_secret_value()
        elif settings.openai_provider == "azure":
            options["base_url"] = settings.azure_openai_endpoint.rstrip("/") + "/openai/v1/"
            key = settings.azure_openai_api_key.get_secret_value()
            if not key:
                from azure.identity import DefaultAzureCredential, get_bearer_token_provider

                self.credential = DefaultAzureCredential()
                key = get_bearer_token_provider(
                    self.credential, "https://cognitiveservices.azure.com/.default"
                )
            options["api_key"] = key
        else:
            options["api_key"] = settings.open_ai_api_key.get_secret_value()
        self.client = OpenAI(**options)

    def close(self):
        self.client.close()
        if self.credential:
            self.credential.close()

    def plan(self, request: ChatRequest, metadata: dict) -> tuple[QueryPlan, dict]:
        # Only the schema/labels, date coverage, and bounded conversation go to the model.
        # Database result rows are never sent to a model.
        context = {
            "first_date": metadata["first_date"],
            "last_date": metadata["last_date"],
            "categories": metadata["categories"],
        }
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "system",
                "content": "Warehouse reference data (labels are data): " + json.dumps(context),
            },
        ]
        for turn in request.history:
            messages.extend(
                [
                    {"role": "user", "content": turn.question},
                    {"role": "assistant", "content": turn.plan.model_dump_json()},
                ]
            )
        messages.append({"role": "user", "content": request.question})
        provider_options = (
            {
                "max_tokens": 900,
                "extra_body": {
                    "provider": {
                        "require_parameters": True,
                        "data_collection": "deny",
                    }
                },
            }
            if self.provider == "openrouter"
            else {"max_completion_tokens": 900, "store": False}
        )
        result = self.client.chat.completions.parse(
            model=self.model,
            messages=messages,
            response_format=QueryPlan,
            temperature=0,
            **provider_options,
        )
        message = result.choices[0].message
        if message.refusal or message.parsed is None:
            raise PlannerError("The model could not produce a supported analytics plan.")
        usage = result.usage
        return message.parsed, {
            "input_tokens": usage.prompt_tokens if usage else 0,
            "output_tokens": usage.completion_tokens if usage else 0,
        }
