"""Shared pacing for the HTTP clients of the collector (#275).

Every source asks gently: at most one request every `min_interval` seconds, each one counted
(and capped) by the call meter under its source name (S-1.14). The interval is measured from
the end of the previous request, whether it succeeded or failed.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from .budget import METER


class Paced:
    """`http.request` spaced by `min_interval` seconds and counted under `source`."""

    def __init__(self, http: Any, source: str, min_interval: float) -> None:
        self.http = http
        self.source = source
        self.min_interval = min_interval
        self.last = 0.0

    def wait(self) -> None:
        delay = self.last + self.min_interval - time.monotonic()
        if delay > 0:
            time.sleep(delay)

    def request(self, method: str, url: str, **kw: Any) -> httpx.Response:
        self.wait()
        try:
            with METER.call(self.source):
                return self.http.request(method, url, **kw)
        finally:
            self.last = time.monotonic()

    def get(self, url: str, **kw: Any) -> httpx.Response:
        return self.request("GET", url, **kw)

    def post(self, url: str, **kw: Any) -> httpx.Response:
        return self.request("POST", url, **kw)
