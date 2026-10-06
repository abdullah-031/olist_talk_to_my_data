"""Signed per-browser session cookies for AUTH_MODE=shared_login.

One username and password are shared with an audience, so the credentials cannot
identify anyone. Each successful sign-in mints a random visitor ID instead, and the
cookie carries it signed so conversations stay private per browser.
"""

import hmac
import secrets
import time
from hashlib import sha256

COOKIE = "olist_session"
VISITOR_BYTES = 16
MAX_COOKIE_CHARS = 200
# Failed sign-ins tolerated per client address before a cool-off, and the window.
MAX_ATTEMPTS = 10
WINDOW_S = 300
MAX_TRACKED_CLIENTS = 2048


def _mac(secret: str, payload: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), sha256).hexdigest()


def issue(secret: str, lifetime_s: int) -> str:
    """A cookie value for a new visitor, valid for lifetime_s seconds."""
    payload = f"{secrets.token_hex(VISITOR_BYTES)}.{int(time.time()) + lifetime_s}"
    return f"{payload}.{_mac(secret, payload)}"


def visitor(secret: str, value: str | None) -> str | None:
    """The visitor ID in a cookie, or None if it is absent, forged or expired."""
    if not value or len(value) > MAX_COOKIE_CHARS:
        return None
    visitor_id, _, rest = value.partition(".")
    expires, _, signature = rest.partition(".")
    if not visitor_id or not expires.isdigit() or not signature:
        return None
    if not hmac.compare_digest(_mac(secret, f"{visitor_id}.{expires}"), signature):
        return None
    return visitor_id if int(expires) > time.time() else None


class Throttle:
    """Per-address failed sign-in counter, so a public link cannot be guessed at."""

    def __init__(self, max_attempts: int = MAX_ATTEMPTS, window_s: int = WINDOW_S):
        self.max_attempts, self.window_s = max_attempts, window_s
        self._failures: dict[str, list[float]] = {}

    def _recent(self, client: str, now: float) -> list[float]:
        return [at for at in self._failures.get(client, []) if now - at < self.window_s]

    def allowed(self, client: str) -> bool:
        return len(self._recent(client, time.monotonic())) < self.max_attempts

    def failed(self, client: str) -> None:
        now = time.monotonic()
        if len(self._failures) > MAX_TRACKED_CLIENTS:
            # Unbounded growth is a memory risk; a reset only forgives old failures.
            self._failures = {}
        self._failures[client] = self._recent(client, now) + [now]

    def succeeded(self, client: str) -> None:
        self._failures.pop(client, None)
