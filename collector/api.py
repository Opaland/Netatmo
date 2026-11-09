"""Client for the Intuis / Muller Intuitiv cloud (a Netatmo-operated backend).

This is the backend used by the official "Intuitiv with Netatmo" / "Intuis Connect"
mobile app. It is not a documented public API: endpoints may change without notice.
The client stays gentle with it: one call per second at most, honours Retry-After
and backs off on 429.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from .config import Settings

log = logging.getLogger(__name__)

# The backend caps a measure request at 1024 points.
MAX_POINTS = 1024
SCALE_SECONDS = {"30min": 1800, "1hour": 3600, "3hours": 10800, "1day": 86400, "1week": 604800, "1month": 2678400}
FALLBACK_API_BASE = "https://app-prod.intuis-sas.com"


class ApiError(RuntimeError):
    pass


class IntuisClient:
    def __init__(self, settings: Settings, http: httpx.Client | None = None, min_interval: float = 1.0) -> None:
        self.s = settings
        self.http = http or httpx.Client(timeout=30.0)
        self.base = settings.api_base
        self.min_interval = min_interval
        self._last_call = 0.0
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._expires_at = 0.0

    # ---------------------------------------------------------------- auth
    def _token_request(self, data: dict[str, str]) -> None:
        payload = {
            "client_id": self.s.client_id,
            "client_secret": self.s.client_secret,
            "user_prefix": self.s.user_prefix,
            **data,
        }
        try:
            resp = self.http.post(f"{self.base}/oauth2/token", data=payload)
        except httpx.TransportError as exc:
            if self.base != FALLBACK_API_BASE:
                log.warning("%s injoignable (%s), essai de %s", self.base, exc, FALLBACK_API_BASE)
                self.base = FALLBACK_API_BASE
                return self._token_request(data)
            raise ApiError(f"Serveur injoignable : {exc}") from exc
        if resp.status_code != 200:
            # Never echo the request (it holds the password); the body only has an error code.
            raise ApiError(f"Authentification refusée (HTTP {resp.status_code}) : {resp.text[:200]}")
        body = resp.json()
        self._access_token = body["access_token"]
        self._refresh_token = body.get("refresh_token", self._refresh_token)
        self._expires_at = time.time() + int(body.get("expires_in", 3600)) - 60

    def login(self) -> None:
        self._token_request(
            {
                "grant_type": "password",
                "username": self.s.username,
                "password": self.s.password,
                "scope": "read_muller write_muller",
            }
        )

    def _ensure_token(self) -> str:
        if self._access_token and time.time() < self._expires_at:
            return self._access_token
        if self._refresh_token:
            try:
                self._token_request({"grant_type": "refresh_token", "refresh_token": self._refresh_token})
                return self._access_token  # type: ignore[return-value]
            except ApiError:
                log.info("Refresh token refusé, nouvelle connexion")
        self.login()
        return self._access_token  # type: ignore[return-value]

    # ---------------------------------------------------------------- calls
    def _throttle(self) -> None:
        wait = self._last_call + self.min_interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last_call = time.monotonic()

    def _call(self, method: str, path: str, *, json: Any = None, data: Any = None) -> Any:
        for attempt in range(5):
            self._throttle()
            headers = {"Authorization": f"Bearer {self._ensure_token()}"}
            resp = self.http.request(method, f"{self.base}{path}", headers=headers, json=json, data=data)
            if resp.status_code in (401, 403) and attempt == 0:
                # Token invalidated server-side: force a fresh login once.
                self._access_token = None
                self._refresh_token = None
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                retry_after = resp.headers.get("Retry-After", "")
                delay = int(retry_after) if retry_after.isdigit() else 15 * (attempt + 1)
                log.warning("%s → HTTP %s, nouvelle tentative dans %ss", path, resp.status_code, delay)
                time.sleep(delay)
                continue
            if resp.status_code != 200:
                raise ApiError(f"{path} → HTTP {resp.status_code} : {resp.text[:300]}")
            body = resp.json()
            if isinstance(body, dict) and "error" in body:
                raise ApiError(f"{path} → {body['error']}")
            return body
        raise ApiError(f"{path} : échec après plusieurs tentatives")

    def homesdata(self) -> dict:
        return self._call("GET", "/api/homesdata")

    def homestatus(self, home_id: str) -> dict:
        return self._call("POST", "/syncapi/v1/homestatus", data={"home_id": home_id})

    def home_measure(
        self,
        home_id: str,
        bridge_id: str,
        room_ids: list[str],
        *,
        measure_type: str,
        scale: str,
        date_begin: int,
        date_end: int,
        module_ids: list[str] | None = None,
    ) -> dict:
        """All rooms (and optionally modules) in one call (what the mobile app does)."""
        home: dict = {
            "id": home_id,
            "rooms": [{"id": rid, "bridge": bridge_id, "type": measure_type} for rid in room_ids],
        }
        if module_ids:
            home["modules"] = [{"id": mid, "bridge": bridge_id, "type": measure_type} for mid in module_ids]
        body = {
            "app_identifier": self.s.app_identifier,
            "scale": scale,
            "date_begin": date_begin,
            "date_end": date_end,
            "home": home,
        }
        return self._call("POST", "/api/gethomemeasure", json=body)

    def room_measure(
        self, home_id: str, room_id: str, *, measure_type: str, scale: str, date_begin: int, date_end: int
    ) -> dict:
        """One room per call; fallback when gethomemeasure returns empty measures."""
        return self._call(
            "POST",
            "/api/getroommeasure",
            data={
                "home_id": home_id,
                "room_id": room_id,
                "scale": scale,
                "type": measure_type,
                "date_begin": date_begin,
                "date_end": date_end,
                "optimize": "true",
                "app_identifier": self.s.app_identifier,
            },
        )


def chunk_ranges(date_begin: int, date_end: int, scale: str) -> list[tuple[int, int]]:
    """Split [begin, end] into windows that each stay under MAX_POINTS points."""
    step = SCALE_SECONDS[scale] * (MAX_POINTS - 4)
    out = []
    start = date_begin
    while start < date_end:
        stop = min(start + step, date_end)
        out.append((start, stop))
        start = stop
    return out
