from contextlib import suppress
from typing import Any

import openai
from azure.ai.projects.aio import AIProjectClient
from azure.identity.aio import DefaultAzureCredential

from app.artifacts import MAX_FILE_BYTES, MEDIA_TYPES, citations, filename, message_text
from app.config import Settings

TITLE_CHARS = 80
# Pages of 100 scanned when listing; bounds latency while the project-wide list is unfiltered.
MAX_LIST_PAGES = 10


class ConversationNotFound(Exception):
    """The conversation does not exist, or it belongs to another user or agent."""


class ArtifactNotFound(Exception):
    """The file is not cited in an assistant message in this conversation."""


class ArtifactTooLarge(Exception):
    """Generated downloads are bounded to protect the API's memory."""


class AnswerIncomplete(Exception):
    """Foundry did not finish the response or needs an unsupported approval action."""


class FoundryAgent:
    """Talks to a Foundry agent; Foundry conversations are the only store of chat history."""

    def __init__(self, settings: Settings):
        self.name = settings.foundry_agent_name
        self.reference: dict[str, str] = {"type": "agent_reference", "name": self.name}
        if settings.foundry_agent_version:
            self.reference["version"] = settings.foundry_agent_version
        # Foundry agents accept Entra ID only: az login locally, managed identity in Azure.
        self.credential = DefaultAzureCredential()
        self.project = AIProjectClient(
            endpoint=str(settings.foundry_project_endpoint), credential=self.credential
        )
        self.client = self.project.get_openai_client(
            timeout=settings.foundry_timeout_s, max_retries=1
        )

    def _owned(self, metadata: dict[str, str] | None, user: str) -> bool:
        metadata = metadata or {}
        return metadata.get("user_id") == user and metadata.get("agent") == self.name

    async def _retrieve(self, conversation_id: str, user: str):
        try:
            conversation = await self.client.conversations.retrieve(conversation_id)
        except (openai.NotFoundError, openai.BadRequestError):
            # Foundry answers 400 for a malformed ID and 404 for an unknown one.
            raise ConversationNotFound from None
        # Another user's conversation looks exactly like a missing one.
        if not self._owned(conversation.metadata, user):
            raise ConversationNotFound
        return conversation

    async def ask(self, question: str, conversation_id: str | None, user: str) -> tuple[str, str]:
        """Answers in an existing conversation, or starts one. Returns (conversation_id, answer)."""
        created = not conversation_id
        if conversation_id:
            await self._retrieve(conversation_id, user)
        else:
            conversation = await self.client.conversations.create(
                metadata={"user_id": user, "agent": self.name, "title": question[:TITLE_CHARS]}
            )
            conversation_id = conversation.id
        try:
            # Foundry appends the question and answer to the conversation and supplies history.
            response = await self.client.responses.create(
                conversation=conversation_id,
                input=[{"role": "user", "content": question}],
                extra_body={"agent_reference": self.reference},
            )
            if response.status != "completed" or any(
                item.type == "mcp_approval_request" for item in response.output
            ):
                raise AnswerIncomplete
        except Exception:
            # A first question that failed would otherwise leave an empty conversation behind.
            if created:
                with suppress(openai.APIError):
                    await self.client.conversations.delete(conversation_id)
            raise
        answer = "\n\n".join(
            message_text(item, conversation_id)
            for item in response.output
            if item.type == "message" and item.role == "assistant"
        )
        return conversation_id, answer

    async def conversations(self, user: str, limit: int) -> list[dict[str, Any]]:
        """The user's conversations with this agent, newest first."""
        # The project-wide list endpoint is not in the SDK, and Foundry offers no metadata
        # filter, so the user's conversations are picked out here.
        found: list[dict[str, Any]] = []
        params: dict[str, Any] = {"limit": 100, "order": "desc"}
        for _ in range(MAX_LIST_PAGES):
            page: Any = await self.client.get(
                "/conversations", cast_to=object, options={"params": params}
            )
            for conversation in page.get("data", []):
                if self._owned(conversation.get("metadata"), user):
                    found.append(
                        {
                            "id": conversation["id"],
                            "title": conversation["metadata"].get("title") or "Untitled",
                            "created_at": conversation.get("created_at", 0),
                        }
                    )
                    if len(found) == limit:
                        return found
            if not page.get("has_more") or not page.get("last_id"):
                break
            params["after"] = page["last_id"]
        return found

    async def messages(self, conversation_id: str, user: str) -> list[dict[str, str]]:
        """The user and assistant messages of a conversation, oldest first."""
        await self._retrieve(conversation_id, user)
        messages = []
        # Tool calls and their outputs are also items; only the visible messages are returned.
        async for item in self.client.conversations.items.list(
            conversation_id, order="asc", limit=100
        ):
            if item.type != "message" or item.role not in ("user", "assistant"):
                continue
            if item.role == "assistant" and item.status != "completed":
                continue
            text = message_text(item, conversation_id)
            if text.strip():
                messages.append({"id": item.id, "role": item.role, "content": text})
        return messages

    async def artifact(
        self, conversation_id: str, container_id: str, file_id: str, user: str
    ) -> tuple[bytes, str]:
        await self._retrieve(conversation_id, user)
        matched = None
        async for item in self.client.conversations.items.list(
            conversation_id, order="desc", limit=100
        ):
            matched = next(
                (
                    citation
                    for citation in citations(item)
                    if citation.container_id == container_id and citation.file_id == file_id
                ),
                None,
            )
            if matched:
                break
        if matched is None:
            raise ArtifactNotFound
        name = filename(matched)
        if not any(name.lower().endswith(suffix) for suffix in MEDIA_TYPES):
            raise ArtifactNotFound
        try:
            async with self.client.containers.files.content.with_streaming_response.retrieve(
                file_id=file_id, container_id=container_id
            ) as response:
                content = bytearray()
                async for chunk in response.iter_bytes(chunk_size=65_536):
                    if len(content) + len(chunk) > MAX_FILE_BYTES:
                        raise ArtifactTooLarge
                    content.extend(chunk)
        except openai.NotFoundError:
            raise ArtifactNotFound from None
        return bytes(content), name

    async def delete(self, conversation_id: str, user: str) -> None:
        await self._retrieve(conversation_id, user)
        await self.client.conversations.delete(conversation_id)

    async def close(self):
        await self.client.close()
        await self.project.close()
        await self.credential.close()
