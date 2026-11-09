"""Netatmo Weather Station (official API, dev.netatmo.com): outdoor and indoor temperatures.

Optional. Needs an app created on https://dev.netatmo.com and a first refresh token
(scope read_station) generated there. Netatmo rotates the refresh token at every use:
the new one is kept encrypted in data/netatmo-token.enc.json, so no secret has to be
rewritten by hand.

Stored: daily series per module in station.enc.json, hourly readings per year in
YYYY.station_h.enc.json, and daily aggregates (CO₂ of the night, hours humid / cold) in
station.enc.json. Formats: docs/api-notes.md, section « Station météo Netatmo ».
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from . import schema
from .budget import METER
from .model import parse_measure_columns
from .storage import Store

log = logging.getLogger(__name__)

API = "https://api.netatmo.com"
TOKEN_DOC = "netatmo-token"
DAY = 86400
HOUR = 3600
# Hourly readings: getmeasure returns at most 1024 points per call → 40 days of hours (960).
HOURLY_CHUNK_DAYS = 40
HOURLY_DAYS_BACKFILL = 365
HOURLY_DAYS_SYNC = 3
HOURLY_TYPES = {
    "NAMain": "temperature,humidity,co2",
    "NAModule4": "temperature,humidity,co2",
    "NAModule1": "temperature,humidity",
}
# Daily aggregates computed from the hourly readings (documented in docs/api-notes.md).
NIGHT_START, NIGHT_END = 22, 7  # night of D = D 22:00 → D+1 07:00 (end excluded), keyed by D
CO2_THRESHOLDS = (1000, 1400, 1500)  # ppm, strictly above
HUMID_ABOVE = 65  # %, strictly above
COLD_BELOW = 19  # °C, strictly below (indoor modules only)


class StationError(RuntimeError):
    def __init__(self, message: str, auth: bool = False) -> None:
        super().__init__(message)
        self.auth = auth  # refresh token refused: it must be generated again


class Station:
    def __init__(
        self,
        store: Store,
        client_id: str,
        client_secret: str,
        seed_token: str,
        http=None,
        min_interval: float = 0.5,
    ) -> None:
        self.store = store
        self.client_id = client_id
        self.client_secret = client_secret
        self.seed_token = seed_token
        self.http = http or httpx.Client(timeout=30.0)
        self.access = ""
        self.min_interval = min_interval
        self._last_call = 0.0

    # ------------------------------------------------------------ auth (rotating refresh token)
    def _refresh_token(self) -> str:
        doc = self.store.doc(TOKEN_DOC)
        seed_hash = hashlib.sha256(self.seed_token.encode()).hexdigest()[:16]
        # A new token pasted in the secret wins over the stored one (re-authorisation).
        if doc.get("seed") == seed_hash and doc.get("refresh_token"):
            return doc["refresh_token"]
        return self.seed_token

    def login(self) -> None:
        with METER.call("netatmo"):
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
        body = schema.check("Station Netatmo", "/oauth2/token", schema.NETATMO_TOKEN, resp.json())
        self.access = body["access_token"]
        seed_hash = hashlib.sha256(self.seed_token.encode()).hexdigest()[:16]
        self.store.replace(TOKEN_DOC, {"seed": seed_hash, "refresh_token": body["refresh_token"]})

    def _get(self, path: str, params: dict, spec: object = None) -> dict:
        # Gentle with the public API (50 requests / 10 s, 500 / h per user).
        wait = self._last_call + self.min_interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last_call = time.monotonic()
        with METER.call("netatmo"):
            resp = self.http.get(f"{API}{path}", params=params, headers={"Authorization": f"Bearer {self.access}"})
        if resp.status_code != 200:
            raise StationError(f"Station Netatmo : {path} → HTTP {resp.status_code} {resp.text[:150]}")
        body = resp.json()
        return schema.check("Station Netatmo", path, spec, body) if spec is not None else body

    # ------------------------------------------------------------ data
    def modules(self) -> list[dict]:
        """Main (indoor) module first, then its radio modules (outdoor, extra indoor)."""
        body = self._get("/api/getstationsdata", {}, schema.NETATMO_STATIONS)["body"]
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

    def module_keys(self, modules: list[dict]) -> list[str]:
        """Stable storage key ("m0", "m1"…) per module. The station document keeps, under
        "module_keys", a random salt and a map from a salted hash of each module id to its key
        (the MAC-like id itself is never stored). The first time, keys follow the current API
        order, which is how they were assigned before; a module added later gets the next free
        key, and a removed module keeps its key (and history) without shifting the others."""
        station = self.store.doc("station")
        stored = station.get("module_keys") or {}
        salt = stored.get("salt") or secrets.token_hex(8)
        keys: dict[str, str] = dict(stored.get("keys") or {})
        h = lambda raw: hashlib.sha256(f"{salt}:{raw}".encode()).hexdigest()[:16]  # noqa: E731
        uid = lambda m: h(m["module"] or m["id"])  # noqa: E731
        # Map of an earlier version, keyed by the raw module id: hash it once.
        for raw, key in (station.get("ids") or {}).items():
            keys.setdefault(h(raw), key)
        self.store.drop_top("station", "ids")
        if not keys:
            keys = {uid(m): f"m{i}" for i, m in enumerate(modules)}
        used = set(keys.values())
        n = 0
        for m in modules:
            if uid(m) not in keys:
                while f"m{n}" in used:
                    n += 1
                keys[uid(m)] = f"m{n}"
                used.add(f"m{n}")
        self.store.set_top("station", "module_keys", {"salt": salt, "keys": keys})
        return [keys[uid(m)] for m in modules]

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
            out += parse_measure_columns(self._get("/api/getmeasure", params, schema.NETATMO_MEASURE)["body"], DAY)
            start = stop
        return out

    def collect(self, tz: str, first_day: str) -> int:
        """Every module: daily min / max / mean temperature, humidity, CO₂ (indoor modules).
        Stored in station.enc.json; the outdoor module also feeds weather.outdoor (DJU)."""
        self.login()
        zone = ZoneInfo(tz)
        known = self.store.doc("station").get("daily", {})
        end = int(datetime.now(zone).timestamp())
        outdoor_days = 0
        names = {}
        modules = self.modules()
        for key, m in zip(self.module_keys(modules), modules, strict=True):
            # Per module: a removed module's old last day must not pull the others back, and a
            # new module starts from the first day.
            begin_day = max(known[key]) if known.get(key) else first_day
            begin = int((datetime.fromisoformat(begin_day).replace(tzinfo=zone) - timedelta(days=10)).timestamp())
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
        self.collect_hourly(tz, modules)
        if outdoor_days:
            self.store.set_top("weather", "source", "netatmo")
        log.info("Station Netatmo : %d modules, %d jours de température extérieure", len(names), outdoor_days)
        return outdoor_days

    # ------------------------------------------------------------ hourly readings
    def _hourly_points(self, device: str, module: str | None, types: str, begin: int, end: int) -> list:
        out = []
        start = begin
        while start < end:
            stop = min(start + HOURLY_CHUNK_DAYS * DAY, end)
            params = {
                "device_id": device,
                "scale": "1hour",
                "type": types,
                "date_begin": start,
                "date_end": stop,
                "optimize": "true",
                "real_time": "false",
            }
            if module:
                params["module_id"] = module
            out += parse_measure_columns(self._get("/api/getmeasure", params, schema.NETATMO_MEASURE)["body"], HOUR)
            start = stop
        return out

    def _last_hour(self, key: str, zone: ZoneInfo) -> int | None:
        for year in reversed(self.store.station_hourly_years()):
            hours = self.store.doc(f"{year}.station_h").get("hourly", {}).get(key)
            if hours:
                return int(datetime.strptime(max(hours), "%Y-%m-%dT%H").replace(tzinfo=zone).timestamp())
        return None

    def collect_hourly(self, tz: str, modules: list[dict] | None = None, now: int | None = None) -> int:
        """Hourly temperature, humidity and CO₂ (indoor modules) per module, stored per local
        hour in "YYYY.station_h", then the daily aggregates "nightly" and "hours" of the
        station document. First run: the last 365 days; then from the last stored hour
        (at least the last 3 days, at most 365)."""
        zone = ZoneInfo(tz)
        modules = modules if modules is not None else self.modules()
        now = int(now if now is not None else time.time())
        n = 0
        for key, m in zip(self.module_keys(modules), modules, strict=True):
            types = HOURLY_TYPES.get(m["type"])
            if not types:  # wind, rain: no temperature
                continue
            indoor = "co2" in types
            last = self._last_hour(key, zone)
            begin = now - HOURLY_DAYS_BACKFILL * DAY
            if last is not None:
                begin = max(begin, min(last, now - HOURLY_DAYS_SYNC * DAY))
            try:
                points = self._hourly_points(m["id"], m["module"], types, begin, now)
            except (StationError, httpx.HTTPError) as err:  # best effort: the daily series are already stored
                log.warning("Station Netatmo, relevés horaires indisponibles (%s) : %s", key, err)
                continue
            hours = local_hours(points, zone, indoor)
            for hour, value in hours.items():
                self.store.put(f"{hour[:4]}.station_h", "hourly", key, hour, value)
            n += len(hours)
            # The night of the day before the first fetched hour needs these hours too.
            first = datetime.fromtimestamp(begin, zone).date() - timedelta(days=1)
            aggregate_days(self.store, key, indoor, first, datetime.fromtimestamp(now, zone).date())
        log.info("Station Netatmo : %d relevés horaires", n)
        return n


def local_hours(points: list, zone: ZoneInfo, indoor: bool) -> dict[str, list]:
    """[(ts, [t, hum, co2?])] → {"YYYY-MM-DDTHH" local: [t, hum, co2]}. The hour is the local
    hour containing the timestamp. When the clocks go back, the two readings of the repeated
    hour are averaged."""
    acc: dict[str, list[list[float]]] = {}
    for ts, cols in points:
        cols = (list(cols) + [None, None, None])[:3]
        if not indoor:
            cols[2] = None
        hour = datetime.fromtimestamp(ts, zone).strftime("%Y-%m-%dT%H")
        acc.setdefault(hour, []).append(cols)
    out = {}
    for hour, rows in acc.items():
        means = []
        for col in zip(*rows, strict=True):
            vals = [v for v in col if v is not None]
            means.append(sum(vals) / len(vals) if vals else None)
        t, hum, co2 = means
        if t is None and hum is None and co2 is None:
            continue
        out[hour] = [
            None if t is None else round(t, 1),
            None if hum is None else round(hum),
            None if co2 is None else round(co2),
        ]
    return out


def _by_day(store: Store, key: str, first: date, last: date) -> dict[str, dict[int, list]]:
    """Day "YYYY-MM-DD" → {local hour 0-23: [t, hum, co2]} for one module, from first to last."""
    out: dict[str, dict[int, list]] = {}
    lo, hi = first.isoformat(), last.isoformat()
    for year in range(first.year, last.year + 1):
        for hour, value in store.doc(f"{year}.station_h").get("hourly", {}).get(key, {}).items():
            if lo <= hour[:10] <= hi:
                out.setdefault(hour[:10], {})[int(hour[11:13])] = value
    return out


def aggregate_days(store: Store, key: str, indoor: bool, first: date, last: date) -> None:
    """station["hours"][key][D] = {"n", "humid", "cold"?} for the hours of D, and for indoor
    modules station["nightly"][key][D] = {"n", "co2_max", "h_co2_1000", ...} for the night
    D 22:00 → D+1 07:00."""
    days = _by_day(store, key, first, last + timedelta(days=1))
    d = first
    while d <= last:
        today = days.get(d.isoformat(), {})
        if today:
            stats = {
                "n": len(today),
                "humid": sum(1 for _t, h, _c in today.values() if h is not None and h > HUMID_ABOVE),
            }
            if indoor:
                stats["cold"] = sum(1 for t, _h, _c in today.values() if t is not None and t < COLD_BELOW)
            store.put("station", "hours", key, d.isoformat(), stats)
        if indoor:
            tomorrow = days.get((d + timedelta(days=1)).isoformat(), {})
            night = [v[2] for h, v in today.items() if h >= NIGHT_START]
            night += [v[2] for h, v in tomorrow.items() if h < NIGHT_END]
            co2 = [c for c in night if c is not None]
            if co2:
                nightly = {"n": len(co2), "co2_max": max(co2)}
                for limit in CO2_THRESHOLDS:
                    nightly[f"h_co2_{limit}"] = sum(1 for c in co2 if c > limit)
                store.put("station", "nightly", key, d.isoformat(), nightly)
        d += timedelta(days=1)
