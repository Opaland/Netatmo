"""Count and cap the API calls of one collection (S-1.14).

Every HTTP request to a source goes through `METER.call(source)`: it counts the call,
adds its duration, and raises CallCapReached once the source's cap is exceeded. The
collection then stops asking that source, keeps what it already fetched and resumes the
next night. Caps come from MAX_CALLS_<SOURCE> (e.g. MAX_CALLS_INTUIS=300).
"""

from __future__ import annotations

import os
import time
from collections.abc import Iterator
from contextlib import contextmanager

# Calls per collection. A daily sync uses a few dozen at most; the first run (backfill)
# walks back year by year and needs more, hence the larger Intuis cap in that case.
DEFAULT_CAPS = {"intuis": 300, "netatmo": 400, "linky": 200, "open-meteo": 20, "shelly": 30, "pvgis": 8}
BACKFILL_CAPS = {"intuis": 3000}


class CallCapReached(RuntimeError):
    def __init__(self, source: str, cap: int) -> None:
        self.source, self.cap = source, cap
        super().__init__(
            f"{source} : plafond de {cap} appels atteint pour cette collecte, arrêt propre "
            f"(reprise à la prochaine collecte ; réglable avec {env_name(source)})"
        )


def env_name(source: str) -> str:
    return "MAX_CALLS_" + source.upper().replace("-", "_")


def caps_from_env(backfill: bool = False) -> dict[str, int]:
    caps = {**DEFAULT_CAPS, **(BACKFILL_CAPS if backfill else {})}
    for source in caps:
        raw = os.environ.get(env_name(source), "").strip()
        if raw.isdigit():
            caps[source] = int(raw)
    return caps


class Meter:
    def __init__(self, caps: dict[str, int] | None = None) -> None:
        self.reset(caps)

    def reset(self, caps: dict[str, int] | None = None) -> None:
        self.caps: dict[str, int] = dict(caps or {})
        self.calls: dict[str, int] = {}
        self.seconds: dict[str, float] = {}
        self.capped: set[str] = set()

    @contextmanager
    def call(self, source: str) -> Iterator[None]:
        cap = self.caps.get(source)
        if cap is not None and self.calls.get(source, 0) >= cap:
            self.capped.add(source)
            raise CallCapReached(source, cap)
        self.calls[source] = self.calls.get(source, 0) + 1
        start = time.monotonic()
        try:
            yield
        finally:
            self.seconds[source] = self.seconds.get(source, 0.0) + time.monotonic() - start

    def rows(self) -> list[tuple[str, int, int | None, float]]:
        """(source, calls, cap, seconds) for every source called or capped."""
        names = sorted(set(self.calls) | self.capped)
        return [(n, self.calls.get(n, 0), self.caps.get(n), self.seconds.get(n, 0.0)) for n in names]


# One collection per process: a single shared meter (reset at the start of `sync`).
METER = Meter()
