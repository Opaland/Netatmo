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
    def __init__(self, message: str, auth: bool = False) -> None:
        super().__init__(message)
        self.auth = auth  # refresh token refused: it must be generated again


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
            try:
                code = resp.json().get("error", "")
            except ValueError:
                code = ""
            hint = {
                "invalid_client": "client_id / client_secret refusés : vérifiez NETATMO_CLIENT_ID "
                "et NETATMO_CLIENT_SECRET",
                "invalid_grant": "refresh token refusé ou déjà utilisé : régénérez-le (scope read_station) "
                "et mettez-le dans NETATMO_REFRESH_TOKEN",
            }.get(code, "régénérez un jeton sur dev.netatmo.com et mettez-le dans NETATMO_REFRESH_TOKEN")
            raise StationError(
                f"Station Netatmo : HTTP {resp.status_code} {code} — {hint}",
                auth=code == "invalid_grant" or resp.status_code in (401, 403),
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
    def modules(self) -> list[dict]:
        """Main (indoor) module first, then its radio modules (outdoor, extra indoor)."""
        body = self._get("/api/getstationsdata", {})["body"]
        devices = body.get("devices", [])
        if not devices:
            raise StationError("Station Netatmo : aucune station sur ce compte")
        main = devices[0]
        out = [
            {
                "id": main["_id"],
                "module": None,
                "name": main.get("module_name") or "Station",
                "type": main.get("type", "NAMain"),
            }
        ]
        for m in main.get("modules", []):
            out.append(
                {
                    "id": main["_id"],
                    "module": m["_id"],
                    "name": m.get("module_name") or m.get("type"),
                    "type": m.get("type"),
                }
            )
        return out

    def _daily(self, device: str, module: str | None, types: str, begin: int, end: int) -> list[tuple[int, list]]:
        out = []
        start = begin
        while start < end:
            stop = min(start + 1000 * DAY, end)
            params = {
                "device_id": device,
                "scale": "1day",
                "type": types,
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
        """Every module: daily min / max / mean temperature, humidity, CO₂ (indoor modules).
        Stored in station.enc.json; the outdoor module also feeds weather.outdoor (DJU)."""
        self.login()
        zone = ZoneInfo(tz)
        station = self.store.doc("station")
        known = station.get("daily", {})
        last_days = [max(d) for d in known.values() if d]
        begin_day = min(last_days) if last_days else first_day
        begin = int((datetime.fromisoformat(begin_day).replace(tzinfo=zone) - timedelta(days=10)).timestamp())
        end = int(datetime.now(zone).timestamp())
        outdoor_days = 0
        names = {}
        for i, m in enumerate(self.modules()):
            key = f"m{i}"
            indoor = m["type"] in ("NAMain", "NAModule4")
            names[key] = {"name": m["name"], "type": m["type"], "indoor": indoor}
            types = "min_temp,max_temp,temperature,humidity" + (",co2" if indoor else "")
            for ts, cols in self._daily(m["id"], m["module"], types, begin, end):
                tmin, tmax, tmean, hum = (list(cols) + [None] * 5)[:4]
                co2 = cols[4] if indoor and len(cols) > 4 else None
                if tmin is None or tmax is None:
                    continue
                day = datetime.fromtimestamp(ts, zone).strftime("%Y-%m-%d")
                mean = tmean if tmean is not None else (tmin + tmax) / 2
                r = lambda v: None if v is None else round(v, 1)  # noqa: E731
                self.store.put(
                    "station",
                    "daily",
                    key,
                    day,
                    [r(tmin), r(tmax), r(mean), r(hum), None if co2 is None else round(co2)],
                )
                if m["type"] == "NAModule1":
                    self.store.put("weather", "outdoor", day, None, [r(tmin), r(tmax), r(mean)])
                    outdoor_days += 1
                elif m["type"] == "NAMain":
                    self.store.put("weather", "indoor", day, None, r(mean))
        self.store.set_top("station", "modules", names)
        if outdoor_days:
            self.store.set_top("weather", "source", "netatmo")
        log.info("Station Netatmo : %d modules, %d jours de température extérieure", len(names), outdoor_days)
        return outdoor_days
