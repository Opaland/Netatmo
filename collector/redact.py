"""Defence in depth for public GitHub Actions logs: redact what must never be printed.

The first line of defence is errors.SourceError (an HTTP error never carries a URL query,
a body, a header or an id). This module catches what slips through anyway:

- every log record is redacted when it is created (`install`), whatever logger emits it;
- an uncaught exception prints its frames, its type and, for the safe error types only,
  its message: the message of any other exception (a KeyError on an id…) is replaced;
- in GitHub Actions, stdout and stderr go through the same redaction.

Redacted: the query string of any URL, bearer tokens, JWTs, e-mail addresses, MAC
addresses, 24-hex ids (Netatmo / Intuis homes), 14-digit numbers (Linky PRM), the value
of sensitive `key=value` / `"key": value` pairs (tokens, ids, coordinates), and the exact
values registered at run time (secrets from the environment, home and room ids and names,
coordinates).
"""

from __future__ import annotations

import logging
import os
import re
import sys
import traceback
from collections.abc import Iterable
from typing import Any, TextIO

MASK = "[masqué]"
_MIN_LEN = 4  # shorter values (a room id "1") would wreck every line

_SENSITIVE_KEYS = (
    "access_token|refresh_token|id_token|client_secret|client_id|password|passphrase|auth_key|api_key|apikey"
    "|token|secret|authorization|pointid|prm|usage_point_id|home_id|room_id|module_id|device_id|bridge|mac"
    "|latitude|longitude|lat|lon|lng|username|email"
)
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # URL query string and fragment: https://host/path?latitude=…&longitude=… → https://host/path?[masqué]
    (re.compile(r"(\b[a-z][a-z0-9+.-]*://[^\s?#'\"<>]*)[?#][^\s'\"<>)\]]*", re.I), r"\1?" + MASK),
    (re.compile(r"(\bbearer\s+)[A-Za-z0-9._~+/=-]+", re.I), r"\1" + MASK),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*"), MASK),
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+\b"), MASK),
    (re.compile(r"\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b", re.I), MASK),
    (re.compile(r"(?<![0-9a-zA-Z])[0-9a-f]{24}(?![0-9a-zA-Z])", re.I), MASK),
    (re.compile(r"(?<![\d.])\d{14}(?![\d.])"), MASK),
    # key=value, key: value, "key": "value" (JSON, forms, repr of dicts)
    (
        re.compile(rf"(?i)(\b(?:{_SENSITIVE_KEYS})\b['\"]?\s*[:=]\s*['\"]?)(?!\[masqué\])[^\s&,;'\"}}\])]+"),
        r"\1" + MASK,
    ),
]

_values: set[str] = set()
_value_re: re.Pattern[str] | None = None


def register(*values: Any) -> None:
    """Exact values to redact from now on (secrets, ids, names, coordinates)."""
    global _value_re
    added = False
    for v in values:
        if v is None or isinstance(v, bool):
            continue
        text = str(v).strip()
        if len(text) >= _MIN_LEN and text not in _values:
            _values.add(text)
            added = True
    if added:
        alts = "|".join(re.escape(v) for v in sorted(_values, key=len, reverse=True))
        # Not inside a longer word or number (a coordinate "2.35" must not hit "12.357").
        _value_re = re.compile(rf"(?<![\w.])(?:{alts})(?![\w]|\.\d)")


def register_coordinate(value: float | None) -> None:
    """A coordinate as it may be printed: full, and rounded to 0.01° / 0.1° (Open-Meteo query)."""
    if value is None:
        return
    with_digits = [repr(float(value)), f"{value:.2f}", f"{round(value, 2)}", f"{value:.3f}", f"{value:.4f}"]
    register(*with_digits)


def reset() -> None:
    """Forget the registered values (tests)."""
    global _value_re
    _values.clear()
    _value_re = None


def redact(text: str) -> str:
    if not text:
        return text
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    if _value_re is not None:
        text = _value_re.sub(MASK, text)
    return text


# ---------------------------------------------------------------- exceptions
def safe_message(err: BaseException) -> str:
    """The message of an exception, only when its type is designed for public logs."""
    from .budget import CallCapReached
    from .errors import SourceError
    from .schema import FormatError

    if isinstance(err, SourceError | FormatError | CallCapReached):
        return redact(str(err))
    if isinstance(err, SystemExit | KeyboardInterrupt):
        return redact(str(err))
    return f"erreur {type(err).__name__} (message masqué : journal public)"


def safe_traceback(err: BaseException) -> str:
    """Frames (file, line, code) and type of each exception of the chain; safe messages only."""
    chain: list[BaseException] = []
    seen: set[int] = set()
    e: BaseException | None = err
    while e is not None and id(e) not in seen:
        chain.append(e)
        seen.add(id(e))
        e = e.__cause__ if e.__cause__ is not None else (None if e.__suppress_context__ else e.__context__)
    out: list[str] = []
    for i, exc in enumerate(reversed(chain)):
        if i:
            out.append("\nPuis :\n")
        out.append("Traceback (most recent call last):\n")
        out += traceback.format_tb(exc.__traceback__)
        out.append(f"{type(exc).__module__}.{type(exc).__qualname__}: {safe_message(exc)}\n")
    return redact("".join(out))


def _excepthook(exc_type, exc, tb) -> None:
    if exc is None:
        exc = exc_type()
    if exc.__traceback__ is None:
        exc = exc.with_traceback(tb)
    sys.stderr.write(safe_traceback(exc))


# ---------------------------------------------------------------- logging
_base_factory = logging.getLogRecordFactory()


def _record_factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
    record = _base_factory(*args, **kwargs)
    try:
        message = record.getMessage()
    except Exception:  # a bad format string: keep only the template
        message = str(record.msg)
    record.msg, record.args = redact(message), ()
    if record.exc_info and record.exc_info[1] is not None:
        record.exc_text = safe_traceback(record.exc_info[1]).rstrip("\n")
        record.exc_info = None
    if record.stack_info:
        record.stack_info = redact(record.stack_info)
    return record


class _RedactingStream:
    """A text stream whose writes are redacted (stdout / stderr in GitHub Actions)."""

    def __init__(self, stream: TextIO) -> None:
        self._stream = stream

    def write(self, text: str) -> int:
        self._stream.write(redact(text))
        return len(text)

    def writelines(self, lines: Iterable[str]) -> None:
        for line in lines:
            self.write(line)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)


def install(streams: bool | None = None) -> None:
    """Redact every log record and uncaught exception; and stdout / stderr when `streams`
    (default: in GitHub Actions, whose logs are public for this repository)."""
    if logging.getLogRecordFactory() is not _record_factory:
        logging.setLogRecordFactory(_record_factory)
    sys.excepthook = _excepthook
    if streams is None:
        streams = os.environ.get("GITHUB_ACTIONS") == "true"
    if streams:
        for name in ("stdout", "stderr"):
            stream = getattr(sys, name)
            if not isinstance(stream, _RedactingStream):
                setattr(sys, name, _RedactingStream(stream))


def uninstall() -> None:
    """Back to the default behaviour (tests)."""
    logging.setLogRecordFactory(_base_factory)
    sys.excepthook = sys.__excepthook__
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name)
        if isinstance(stream, _RedactingStream):
            setattr(sys, name, stream._stream)
