import asyncio
import logging
import secrets
from contextlib import asynccontextmanager
from pathlib import PurePosixPath
from typing import Annotated
from urllib.parse import quote
from uuid import uuid4

import openai
from azure.core.exceptions import ClientAuthenticationError
from fastapi import FastAPI, HTTPException, Path, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app import session
from app.artifacts import FILE_ID, MEDIA_TYPES
from app.config import ROOT, Settings
from app.foundry import (
    AnswerIncomplete,
    ArtifactNotFound,
    ArtifactTooLarge,
    ConversationNotFound,
    FoundryAgent,
)

logger = logging.getLogger("olist.api")


MAX_QUESTION_CHARS = 4000
CONVERSATION_ID = r"^conv_[A-Za-z0-9_-]{1,200}$"
ConversationId = Annotated[str, Path(pattern=CONVERSATION_ID)]
# Reachable before sign-in: the health probe, the session check and the sign-in itself.
OPEN_PATHS = frozenset({"/api/health", "/api/session", "/api/login", "/api/logout"})
Credential = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_QUESTION_CHARS)
    ]
    # Omitted for the first question; Foundry then starts a conversation.
    conversation_id: Annotated[str | None, Field(pattern=CONVERSATION_ID)] = None


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: Credential
    password: Credential


class SessionState(BaseModel):
    mode: str
    authenticated: bool


class ChatResponse(BaseModel):
    request_id: str
    conversation_id: str
    answer: str


class ConversationSummary(BaseModel):
    id: str
    title: str
    created_at: int


class ConversationMessage(BaseModel):
    id: str
    role: str
    content: str


class ConversationDetail(BaseModel):
    id: str
    messages: list[ConversationMessage]


# Starlette picks the most specific handler, so APIError only catches what is left.
ERRORS: list[tuple[tuple[type[Exception], ...], int, str]] = [
    ((openai.RateLimitError,), 429, "The Foundry agent is rate limited. Try again shortly."),
    ((openai.APITimeoutError,), 504, "The Foundry agent took too long to answer. Try again."),
    (
        (openai.AuthenticationError, openai.PermissionDeniedError, ClientAuthenticationError),
        503,
        "The backend could not authenticate to Microsoft Foundry. "
        "Sign in with az login or check the identity's Azure AI User role.",
    ),
    ((openai.APIError,), 502, "The Foundry agent could not answer. Try again."),
]


def create_app(settings: Settings | None = None, agent=None) -> FastAPI:
    settings = settings or Settings()
    gate = asyncio.Semaphore(settings.max_concurrent_requests)
    shared_login = settings.auth_mode == "shared_login"
    # Without an explicit secret every process signs with its own, so a restart or a
    # second replica signs everyone out. Fine for a demo; set SESSION_SECRET otherwise.
    session_secret = settings.session_secret or secrets.token_hex(32)
    throttle = session.Throttle()
    session_lifetime_s = int(settings.session_hours * 3600)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logging.basicConfig(level=logging.INFO, format="%(message)s")
        if shared_login and not settings.session_secret:
            logger.warning("session_secret_generated sign_ins_end_on_restart=true")
        app.state.agent = agent or (FoundryAgent(settings) if settings.configured else None)
        try:
            yield
        finally:
            if app.state.agent:
                await app.state.agent.close()

    app = FastAPI(
        title="Olist Foundry Chat",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)

    @app.middleware("http")
    async def request_limits(request: Request, call_next):
        if settings.auth_mode == "azure_container_apps" and request.url.path != "/api/health":
            # Only safe behind ACA built-in auth that rejects unauthenticated requests;
            # ACA strips client-supplied identity headers. See docs/cloud.md.
            if not request.headers.get("x-ms-client-principal-id"):
                return error(request, 401, "Sign in to continue.")
        if shared_login and request.url.path.startswith("/api/"):
            # The UI itself stays public, because it serves the sign-in form.
            if request.url.path not in OPEN_PATHS and visitor(request) is None:
                return error(request, 401, "Sign in to continue.")
        if request.method == "POST":
            # Bounded streaming read, including requests without Content-Length.
            size, chunks = 0, []
            async for chunk in request.stream():
                size += len(chunk)
                if size > settings.max_request_bytes:
                    return error(request, 413, "Request too large.")
                chunks.append(chunk)
            request._body = b"".join(chunks)
        return await call_next(request)

    # Registered last to wrap early authentication and body-limit responses too.
    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = uuid4().hex
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Cache-Control"] = "no-store"
        if not request.url.path.startswith("/api/docs"):
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
                "frame-ancestors 'none'; base-uri 'self'"
            )
        return response

    def error(
        request: Request, status: int, message: str, headers: dict[str, str] | None = None
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status,
            content={"error": message, "request_id": request.state.request_id},
            headers=headers,
        )

    def visitor(request: Request) -> str | None:
        return session.visitor(session_secret, request.cookies.get(session.COOKIE))

    def caller(request: Request) -> str:
        # Conversations are tagged with this ID in Foundry and only shown to the same caller.
        if settings.auth_mode == "azure_container_apps":
            return request.headers["x-ms-client-principal-id"]
        if shared_login:
            # One shared credential cannot identify anyone, so each browser that signs
            # in gets its own ID and therefore its own history.
            return visitor(request) or "anonymous"
        return "local"

    def foundry(request: Request) -> FoundryAgent:
        if request.app.state.agent is None:
            raise HTTPException(
                503,
                "Foundry is not configured. Set FOUNDRY_PROJECT_ENDPOINT and "
                "FOUNDRY_AGENT_NAME in the backend environment and restart the server.",
            )
        return request.app.state.agent

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # The default handler echoes the input back; questions may be sensitive.
        if request.url.path == "/api/chat":
            return error(request, 422, "Send a non-empty question of up to 4,000 characters.")
        return error(request, 422, "Invalid request.")

    @app.exception_handler(ConversationNotFound)
    async def conversation_not_found(request: Request, exc: ConversationNotFound):
        return error(request, 404, "Conversation not found. It may have been deleted.")

    @app.exception_handler(ArtifactNotFound)
    async def artifact_not_found(request: Request, exc: ArtifactNotFound):
        return error(request, 404, "File unavailable. It may have expired; ask for a fresh export.")

    @app.exception_handler(ArtifactTooLarge)
    async def artifact_too_large(request: Request, exc: ArtifactTooLarge):
        return error(
            request, 413, "This file exceeds the 10 MB download limit. Request fewer rows."
        )

    @app.exception_handler(AnswerIncomplete)
    async def answer_incomplete(request: Request, exc: AnswerIncomplete):
        return error(
            request,
            502,
            "The agent did not complete the answer. Try again or check its tool approvals.",
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return error(request, exc.status_code, exc.detail, exc.headers)

    for types, status, message in ERRORS:

        async def handler(request: Request, exc: Exception, status=status, message=message):
            logger.warning(
                "foundry_error request_id=%s type=%s",
                request.state.request_id,
                type(exc).__name__,
            )
            return error(request, status, message)

        for exc_type in types:
            app.add_exception_handler(exc_type, handler)

    @app.get("/api/health")
    async def health():
        return {
            "status": "ok",
            "configured": settings.configured,
            "agent": settings.foundry_agent_name or None,
        }

    @app.get("/api/session", response_model=SessionState)
    async def session_state(request: Request):
        authenticated = (
            visitor(request) is not None
            if shared_login
            else bool(request.headers.get("x-ms-client-principal-id"))
            if settings.auth_mode == "azure_container_apps"
            else True
        )
        return SessionState(mode=settings.auth_mode, authenticated=authenticated)

    def client_address(request: Request) -> str:
        # Spoofable, so this only slows down guessing; the cool-off is per replica.
        forwarded = request.headers.get("x-forwarded-for", "")
        return forwarded.split(",")[0].strip() or (request.client.host if request.client else "-")

    @app.post("/api/login", status_code=204)
    async def login(body: LoginRequest, request: Request):
        if not shared_login:
            raise HTTPException(404, "Sign-in is not enabled on this deployment.")
        address = client_address(request)
        if not throttle.allowed(address):
            raise HTTPException(
                429,
                "Too many sign-in attempts. Wait a few minutes and try again.",
                headers={"Retry-After": "60"},
            )
        # Both comparisons always run, so a wrong username is not faster than a wrong password.
        name_ok = secrets.compare_digest(body.username.strip(), settings.shared_login_username)
        password_ok = secrets.compare_digest(body.password, settings.shared_login_password)
        if not (name_ok and password_ok):
            throttle.failed(address)
            logger.warning("login_failed request_id=%s", request.state.request_id)
            raise HTTPException(401, "Incorrect username or password.")
        throttle.succeeded(address)
        response = Response(status_code=204)
        response.set_cookie(
            session.COOKIE,
            session.issue(session_secret, session_lifetime_s),
            max_age=session_lifetime_s,
            httponly=True,
            secure=settings.app_env == "production",
            samesite="lax",
            path="/",
        )
        return response

    @app.post("/api/logout", status_code=204)
    async def logout():
        response = Response(status_code=204)
        response.delete_cookie(session.COOKIE, path="/")
        return response

    @app.post("/api/chat", response_model=ChatResponse)
    async def chat(body: ChatRequest, request: Request):
        agent = foundry(request)
        if gate.locked():
            raise HTTPException(
                429,
                "The assistant is busy. Please try again shortly.",
                headers={"Retry-After": "3"},
            )
        async with gate:
            conversation_id, answer = await agent.ask(
                body.question, body.conversation_id, caller(request)
            )
        if not answer.strip():
            raise HTTPException(502, "The Foundry agent returned an empty answer. Try again.")
        return ChatResponse(
            request_id=request.state.request_id, conversation_id=conversation_id, answer=answer
        )

    @app.get("/api/conversations", response_model=list[ConversationSummary])
    async def list_conversations(request: Request, limit: Annotated[int, Query(ge=1, le=100)] = 50):
        return await foundry(request).conversations(caller(request), limit)

    @app.get("/api/conversations/{conversation_id}", response_model=ConversationDetail)
    async def get_conversation(conversation_id: ConversationId, request: Request):
        messages = await foundry(request).messages(conversation_id, caller(request))
        return ConversationDetail(id=conversation_id, messages=messages)

    @app.delete("/api/conversations/{conversation_id}", status_code=204)
    async def delete_conversation(conversation_id: ConversationId, request: Request):
        await foundry(request).delete(conversation_id, caller(request))

    @app.get("/api/conversations/{conversation_id}/files/{container_id}/{file_id}")
    async def download_artifact(
        conversation_id: ConversationId,
        container_id: Annotated[str, Path(pattern=FILE_ID)],
        file_id: Annotated[str, Path(pattern=FILE_ID)],
        request: Request,
        download: bool = False,
    ):
        if gate.locked():
            raise HTTPException(
                429,
                "The assistant is busy. Please try again shortly.",
                headers={"Retry-After": "3"},
            )
        async with gate:
            content, name = await foundry(request).artifact(
                conversation_id, container_id, file_id, caller(request)
            )
        suffix = PurePosixPath(name).suffix.lower()
        disposition = "attachment" if download or suffix != ".png" else "inline"
        return Response(
            content=content,
            media_type=MEDIA_TYPES[suffix],
            headers={
                "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name, safe='')}"
            },
        )

    # One same-origin container in production, Vite proxy during local development.
    frontend = ROOT / "frontend/dist"
    if frontend.is_dir():
        app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return app


app = create_app()
