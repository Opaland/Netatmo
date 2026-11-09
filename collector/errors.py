"""One safe error for every outbound HTTP failure (the logs of this repository are public).

A SourceError carries only: the source, the endpoint path template (never the query
string), the HTTP status, a generic category, and at most a short validated error code
(`invalid_grant`, `21`). Never the URL query, the response body, a header, an id, a name
or a value. Each client (Intuis, Netatmo, Linky, Shelly, Open-Meteo) subclasses it, and
turns httpx errors (whose message holds the full URL) into it with `guarded`.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from urllib.parse import urlsplit

import httpx

CATEGORIES = {
    "auth": "accès refusé",
    "rate_limit": "trop de requêtes",
    "not_found": "introuvable",
    "client": "requête refusée",
    "server": "erreur du serveur",
    "timeout": "délai dépassé",
    "network": "serveur injoignable",
    "api": "erreur de l'API",
    "unknown": "erreur",
}
_SAFE_CODE = re.compile(r"[A-Za-z][A-Za-z_]{0,39}|\d{1,6}")
_SAFE_ENDPOINT = re.compile(r"/?[A-Za-z_][A-Za-z0-9_\-]*(/[A-Za-z_][A-Za-z0-9_.\-]*)*")


def category_for(status: int | None) -> str:
    if status is None:
        return "unknown"
    if status in (401, 403):
        return "auth"
    if status == 429:
        return "rate_limit"
    if status == 404:
        return "not_found"
    if 400 <= status < 500:
        return "client"
    if status >= 500:
        return "server"
    return "unknown"


def endpoint_of(url: str) -> str:
    """The path of a URL, without host, query or fragment; "(chemin)" if it looks like data."""
    path = urlsplit(url).path if "://" in url else url.split("?", 1)[0].split("#", 1)[0]
    path = path[:80]
    return path if _SAFE_ENDPOINT.fullmatch(path) else "(chemin)"


def safe_code(value: Any) -> str:
    """An API error code if it looks like one (`invalid_grant`, `21`), else ""."""
    if isinstance(value, bool):
        return ""
    if isinstance(value, int):
        value = str(value)
    return value if isinstance(value, str) and _SAFE_CODE.fullmatch(value) else ""


def error_code(resp: httpx.Response) -> str:
    """The error code of a JSON error body ({"error": "x"} or {"error": {"code": n}}), never its text."""
    try:
        body = resp.json()
    except ValueError:
        return ""
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        err = err.get("code")
    return safe_code(err)


class SourceError(RuntimeError):
    """An outbound call failed. `str()` is safe for a public log.

    `SourceError("fixed text")` keeps a message written in the code (never interpolate data
    into it); otherwise the message is built from the structured fields only."""

    source = "API"

    def __init__(
        self,
        message: str = "",
        auth: bool = False,
        *,
        endpoint: str = "",
        status: int | None = None,
        category: str = "",
        code: Any = "",
        hint: str = "",
        source: str = "",
    ) -> None:
        if source:
            self.source = source
        self.endpoint = endpoint_of(endpoint) if endpoint else ""
        self.status = status if isinstance(status, int) and not isinstance(status, bool) else None
        self.category = category if category in CATEGORIES else category_for(self.status)
        self.code = safe_code(code)
        self.auth = auth
        super().__init__(message or self._describe(hint))

    def _describe(self, hint: str) -> str:
        where = f"{self.endpoint} → " if self.endpoint else ""
        label = CATEGORIES[self.category]
        if self.status is not None:
            what = f"HTTP {self.status} ({label}{', ' + self.code if self.code else ''})"
        else:
            what = label + (f" ({self.code})" if self.code else "")
        return f"{self.source} : {where}{what}" + (f" — {hint}" if hint else "")


@contextmanager
def guarded(cls: type[SourceError], endpoint: str, **kw: Any) -> Iterator[None]:
    """httpx transport errors (their message holds the full URL) → cls, without the cause."""
    try:
        yield
    except httpx.HTTPError as exc:
        category = "timeout" if isinstance(exc, httpx.TimeoutException) else "network"
        # The class name only (ConnectError, ReadTimeout…): never the message.
        raise cls(endpoint=endpoint, category=category, code=type(exc).__name__, **kw) from None


def raise_for_status(
    resp: httpx.Response, cls: type[SourceError], endpoint: str, ok: tuple[int, ...] = (200,), **kw: Any
) -> None:
    """Like httpx's raise_for_status, but the error carries no URL, body or header."""
    if resp.status_code not in ok:
        raise cls(endpoint=endpoint, status=resp.status_code, **kw)
