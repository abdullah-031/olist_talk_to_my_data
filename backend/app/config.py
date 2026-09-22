from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore", populate_by_name=True)

    pg_host: str = Field(default="", validation_alias="PGHOST")
    pg_port: int = Field(default=5432, validation_alias="PGPORT", ge=1, le=65535)
    pg_database: str = Field(default="olist_olap_abd", validation_alias="PGDATABASE")
    pg_user: str = Field(default="", validation_alias="PGUSER")
    pg_password: SecretStr = Field(default=SecretStr(""), validation_alias="PGPASSWORD")
    pg_sslmode: Literal["require", "verify-ca", "verify-full"] = Field(
        default="verify-full", validation_alias="PGSSLMODE"
    )
    pg_sslrootcert: str | None = Field(default=None, validation_alias="PGSSLROOTCERT")
    pg_auth_mode: Literal["password", "entra"] = "password"
    open_ai_api_key: SecretStr = Field(
        default=SecretStr(""), validation_alias=AliasChoices("OPEN_AI_API_KEY", "OPENAI_API_KEY")
    )
    openrouter_api_key: SecretStr = SecretStr("")
    openai_model: str = ""
    openai_provider: Literal["openrouter", "openai", "azure"] = "openrouter"
    azure_openai_endpoint: str = ""
    azure_openai_api_key: SecretStr = SecretStr("")
    app_env: Literal["local", "production"] = "local"
    auth_mode: Literal["local", "azure_container_apps"] = "local"
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "testserver"]
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    db_pool_max_size: int = Field(default=4, ge=1, le=32)
    query_timeout_ms: int = Field(default=8000, ge=500, le=30000)
    max_concurrent_requests: int = Field(default=4, ge=1, le=32)
    audit_log_path: Path = ROOT / "logs/db_operations.md"
    applicationinsights_connection_string: SecretStr = SecretStr("")

    @model_validator(mode="after")
    def production_guard(self):
        if not self.openai_model:
            self.openai_model = (
                "openai/gpt-4.1-nano" if self.openai_provider == "openrouter" else "gpt-4.1-nano"
            )
        if self.pg_database != "olist_olap_abd":
            raise ValueError("This app is restricted to the personal olist_olap_abd warehouse.")
        if self.app_env == "production":
            if self.auth_mode != "azure_container_apps":
                raise ValueError(
                    "Production requires Azure Container Apps built-in authentication."
                )
            if self.pg_sslmode != "verify-full":
                raise ValueError("Production requires PGSSLMODE=verify-full.")
            if "*" in self.allowed_hosts:
                raise ValueError("Production requires explicit ALLOWED_HOSTS.")
        return self

    def missing(self) -> list[str]:
        missing = []
        for key, value in [("PGHOST", self.pg_host), ("PGUSER", self.pg_user)]:
            if not value:
                missing.append(key)
        if self.pg_auth_mode == "password" and not self.pg_password.get_secret_value():
            missing.append("PGPASSWORD")
        if self.openai_provider == "openai" and not self.open_ai_api_key.get_secret_value():
            missing.append("OPEN_AI_API_KEY")
        if self.openai_provider == "openrouter" and not self.openrouter_api_key.get_secret_value():
            missing.append("OPENROUTER_API_KEY")
        if self.openai_provider == "azure" and not self.azure_openai_endpoint:
            missing.append("AZURE_OPENAI_ENDPOINT")
        return missing
