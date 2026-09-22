import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from threading import BoundedSemaphore
from uuid import uuid4

import openai
import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from psycopg_pool import PoolTimeout
from pydantic import ValidationError

from app.catalog import DEFINITIONS, DIMENSIONS, METRICS
from app.config import ROOT, Settings
from app.models import ChatRequest, ChatResponse
from app.planner import Planner, PlannerError
from app.service import AgentService
from app.warehouse import Warehouse

logger = logging.getLogger("warehouse.api")


def create_app(settings: Settings | None = None, warehouse=None, planner=None) -> FastAPI:
    settings = settings or Settings()
    gate = BoundedSemaphore(settings.max_concurrent_requests)

    @asynccontextmanager
    async def lifespan(app):
        logging.basicConfig(level=logging.INFO, format="%(message)s")
        # Do not emit HTTP provider request URLs or payloads in normal logs.
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        if settings.applicationinsights_connection_string.get_secret_value():
            from azure.monitor.opentelemetry import configure_azure_monitor

            configure_azure_monitor(
                connection_string=settings.applicationinsights_connection_string.get_secret_value(),
                instrumentation_options={"psycopg": {"enabled": False}},
            )
        app.state.service = None
        if not any(key.startswith("PG") for key in settings.missing()):
            db = warehouse or Warehouse(settings)
            llm = planner or (Planner(settings) if not settings.missing() else None)
            db.open()
            app.state.service = AgentService(db, llm, settings.openai_model)
            try:
                yield
            finally:
                db.close()
                if llm:
                    llm.close()
        else:
            yield

    app = FastAPI(
        title="Olist Warehouse Agent",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs" if settings.app_env == "local" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = uuid4().hex
        started = time.perf_counter()
        if settings.auth_mode == "azure_container_apps" and request.url.path != "/api/health":
            # Only safe behind ACA built-in auth with unauthenticated requests rejected.
            # ACA removes externally supplied identity headers. See docs/cloud.md.
            if not request.headers.get("x-ms-client-principal-id"):
                return JSONResponse(status_code=401, content={"error": "Sign in to continue."})
        if request.method == "POST":
            # Bounded streaming read, including requests without Content-Length.
            size, chunks = 0, []
            async for chunk in request.stream():
                size += len(chunk)
                if size > 32768:
                    return JSONResponse(status_code=413, content={"error": "Request too large."})
                chunks.append(chunk)
            request._body = b"".join(chunks)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
        )
        if settings.app_env == "local" and request.url.path == "/api/docs":
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "img-src 'self' data: https://fastapi.tiangolo.com; "
                "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
            )
        logger.info(
            json.dumps(
                {
                    "event": "http_request",
                    "request_id": request.state.request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000),
                }
            )
        )
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # FastAPI's default echoes invalid input, which may contain sensitive text.
        return JSONResponse(
            status_code=422,
            content={
                "error": "Enter a question of 1–2,000 characters and at most six prior turns.",
                "request_id": request.state.request_id,
            },
        )

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.detail,
                "request_id": request.state.request_id,
            },
            headers=exc.headers,
        )

    def service(request):
        if request.app.state.service is None:
            raise HTTPException(503, "Backend setup is incomplete. Check the server environment.")
        return request.app.state.service

    def protected_call(function):
        if not gate.acquire(blocking=False):
            raise HTTPException(
                429, "The agent is busy. Please try again shortly.", headers={"Retry-After": "3"}
            )
        try:
            return function()
        except psycopg.errors.QueryCanceled as exc:
            raise HTTPException(
                504, "The warehouse query timed out. Try a narrower date range."
            ) from exc
        except (psycopg.Error, PoolTimeout) as exc:
            raise HTTPException(
                503, "Warehouse unavailable. Check connectivity and configuration."
            ) from exc
        except openai.RateLimitError as exc:
            raise HTTPException(
                429, "The model quota or rate limit was reached. Try again later."
            ) from exc
        except (openai.AuthenticationError, openai.PermissionDeniedError) as exc:
            raise HTTPException(
                503,
                "The model service rejected the configured credentials. "
                "Update the API key in the backend environment and restart the server.",
            ) from exc
        except (openai.APIError, PlannerError, ValidationError, ValueError) as exc:
            raise HTTPException(
                502, "The model could not plan this question. Try rephrasing it."
            ) from exc
        except OSError as exc:
            raise HTTPException(
                503, "The local audit log is unavailable. Check server permissions."
            ) from exc
        finally:
            gate.release()

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "configured": not settings.missing(),
            "model": settings.openai_model,
            "provider": settings.openai_provider,
        }

    @app.get("/api/warehouse")
    def warehouse_info(request: Request):
        info = protected_call(lambda: service(request).warehouse.metadata(request.state.request_id))
        return {
            **info,
            "model": settings.openai_model,
            "provider": settings.openai_provider,
            "definitions": DEFINITIONS,
            "metrics": [{"key": key, "label": value[1]} for key, value in METRICS.items()],
            "dimensions": [{"key": key, "label": value[1]} for key, value in DIMENSIONS.items()],
        }

    @app.post("/api/chat", response_model=ChatResponse)
    def chat(body: ChatRequest, request: Request):
        agent = service(request)
        if agent.planner is None:
            raise HTTPException(
                503,
                "Model setup is incomplete. Add the provider API key "
                "to the backend environment and restart the server.",
            )
        return protected_call(lambda: agent.ask(body, request.state.request_id))

    # One same-origin container in production, Vite proxy during local development.
    frontend = ROOT / "frontend/dist"
    if Path(frontend).is_dir():
        app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return app


app = create_app()
