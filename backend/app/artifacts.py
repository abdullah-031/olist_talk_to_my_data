"""Translate trusted Foundry file citations into conversation-scoped links."""

import re
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote

MEDIA_TYPES = {".png": "image/png", ".csv": "text/csv; charset=utf-8"}
MAX_FILE_BYTES = 10 * 1024 * 1024
FILE_ID = r"^[A-Za-z0-9_-]{1,200}$"


def citations(item: Any):
    if item.type != "message" or item.role != "assistant":
        return
    for part in item.content:
        if part.type == "output_text":
            for annotation in part.annotations:
                if annotation.type == "container_file_citation":
                    yield annotation


def filename(citation: Any) -> str:
    return PurePosixPath(citation.filename.replace("\\", "/")).name


def file_url(conversation_id: str, citation: Any) -> str | None:
    if (
        not all(re.fullmatch(FILE_ID, value) for value in (citation.container_id, citation.file_id))
        or PurePosixPath(filename(citation)).suffix.lower() not in MEDIA_TYPES
    ):
        return None
    return (
        f"/api/conversations/{quote(conversation_id, safe='')}/files/"
        f"{quote(citation.container_id, safe='')}/{quote(citation.file_id, safe='')}"
    )


def drop_link(text: str, path: str) -> str:
    """Removes the agent's own link to a file; the app adds one download link per file."""
    link = re.compile(r"(?<!!)\[([^\]]*)\]\(" + re.escape(path) + r"\)")
    if not link.search(text):
        return text
    lines = []
    for line in text.split("\n"):
        if link.search(line):
            rest = link.sub("", line).strip(" \t-*>")
            # A line that only offers the file ("Download the chart: [x.png](...)") goes.
            if (
                not rest.strip(":")
                or rest.endswith(":")
                or ("download" in rest.lower() and len(rest) <= 60)
            ):
                continue
            line = link.sub(r"\1", line)
        lines.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def message_text(item: Any, conversation_id: str) -> str:
    text = "".join(part.text for part in item.content if part.type in ("input_text", "output_text"))
    seen = set()
    for citation in citations(item):
        url = file_url(conversation_id, citation)
        if not url or url in seen:
            continue
        seen.add(url)
        name = filename(citation)
        image = name.lower().endswith(".png")
        download = f"{url}?download=true"
        # Rewrite only sandbox paths that match a real citation, never model-supplied IDs.
        for path in {f"sandbox:/mnt/data/{name}", quote(f"sandbox:/mnt/data/{name}", safe="/:")}:
            text = re.sub(r"(!\[[^\]]*\]\()" + re.escape(path) + r"\)", rf"\g<1>{url})", text)
            text = drop_link(text, path)
        # Charts always show inline and stay downloadable, whatever links the agent wrote.
        if image and f"]({url})" not in text:
            text += f"\n\n![{re.sub(r'[][]', '', name)}]({url})"
        text += f"\n\n[Download {'PNG' if image else 'CSV'}]({download})"
    return text
