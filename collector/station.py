"""Netatmo Weather Station (official API, dev.netatmo.com): outdoor and indoor temperatures.

Optional. Needs an app created on https://dev.netatmo.com and a first refresh token
(scope read_station) generated there. Netatmo rotates the refresh token at every use:
the new one is kept encrypted in data/netatmo-token.enc.json, so no secret has to be
rewritten by hand.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from .model import parse_measure_columns
from .storage import Store

log = logging.getLogger(__name__)

API = "https://api.netatmo.com"
TOKEN_DOC = "netatmo-token"
DAY = 86400


class StationError(RuntimeError):
    pass


class Station:
    def __init__(self, store: Store, client_id: str, client_secret: str, seed_token: str, http=None) -> None:
        self.store = store
        self.client_id = client_id
        self.client_secret = client_secret
        self.seed_token = seed_token
        self.http = http or httpx.Client(timeout=30.0)
        self.access = ""

    # ------------------------------------------------------------ auth (rotating refresh token)
    def _refresh_token(self) -> str:
        doc = self.store.doc(TOKEN_DOC)
        seed_hash = hashlib.sha256(self.seed_token.encode()).hexdigest()[:16]
        # A new token pasted in the secret wins over the stored one (re-authorisation).
        if doc.get("seed") == seed_hash and doc.get("refresh_token"):
            return doc["refresh_token"]
        return self.seed_token

    def login(self) -> None:
        resp = self.http.post(
            f"{API}/oauth2/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": self._refresh_token(),
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
        )
        if resp.status_code != 200:
            raise StationError(
                f"Station Netatmo : jeton refusé (HTTP {resp.status_code}). Régénérez un jeton sur dev.netatmo.com "
                "et mettez-le dans le secret NETATMO_REFRESH_TOKEN."
            )
        body = resp.json()
        self.access = body["access_token"]
        seed_hash = hashlib.sha256(self.seed_token.encode()).hexdigest()[:16]
        self.store.replace(TOKEN_DOC, {"seed": seed_hash, "refresh_token": body["refresh_token"]})

    def _get(self, path: str, params: dict) -> dict:
        resp = self.http.get(f"{API}{path}", params=params, headers={"Authorization": f"Bearer {self.access}"})
        if resp.status_code != 200:
            raise StationError(f"Station Netatmo : {path} → HTTP {resp.status_code} {resp.text[:150]}")
        return resp.json()

    # ------------------------------------------------------------ data
    def devices(self) -> tuple[str, str | None]:
        """(main device id = indoor, outdoor module id or None)."""
        body = self._get("/api/getstationsdata", {})["body"]
        devices = body.get("devices", [])
        if not devices:
            raise StationError("Station Netatmo : aucune station sur ce compte")
        main = devices[0]
        outdoor = next((m["_id"] for m in main.get("modules", []) if m.get("type") == "NAModule1"), None)
        return main["_id"], outdoor

    def _daily(self, device: str, module: str | None, begin: int, end: int) -> list[tuple[int, list]]:
        out = []
        start = begin
        while start < end:
            stop = min(start + 1000 * DAY, end)
            params = {
                "device_id": device,
                "scale": "1day",
                "type": "min_temp,max_temp,temperature",
                "date_begin": start,
                "date_end": stop,
                "optimize": "true",
                "real_time": "false",
            }
            if module:
                params["module_id"] = module
            out += parse_measure_columns(self._get("/api/getmeasure", params).get("body", []), DAY)
            start = stop
        return out

    def collect(self, tz: str, first_day: str) -> int:
        self.login()
        main, outdoor = self.devices()
        zone = ZoneInfo(tz)
        have = (
            self.store.doc("weather").get("outdoor", {}) if self.store.doc("weather").get("source") == "netatmo" else {}
        )
        begin_day = max(have) if have else first_day
        begin_dt = datetime.fromisoformat(begin_day).replace(tzinfo=zone) - timedelta(days=10)
        begin = int(begin_dt.timestamp())
        end = int(datetime.now(zone).timestamp())
        n = 0
        if outdoor:
            for ts, (tmin, tmax, tmean) in self._daily(main, outdoor, begin, end):
                if tmin is None or tmax is None:
                    continue
                day = datetime.fromtimestamp(ts, zone).strftime("%Y-%m-%d")
                mean = tmean if tmean is not None else (tmin + tmax) / 2
                self.store.put("weather", "outdoor", day, None, [round(tmin, 1), round(tmax, 1), round(mean, 1)])
                n += 1
            self.store.set_top("weather", "source", "netatmo")
        for ts, (tmin, tmax, tmean) in self._daily(main, None, begin, end):
            if tmin is None or tmax is None:
                continue
            day = datetime.fromtimestamp(ts, zone).strftime("%Y-%m-%d")
            mean = tmean if tmean is not None else (tmin + tmax) / 2
            self.store.put("weather", "indoor", day, None, round(mean, 1))
        log.info("Station Netatmo : %d jours de température extérieure", n)
        return n
