"""Netatmo Weather Station (official API, dev.netatmo.com): outdoor and indoor temperatures.

Optional. Needs an app created on https://dev.netatmo.com and a first refresh token
(scope read_station) generated there. Netatmo rotates the refresh token at every use:
the new one is kept encrypted in data/netatmo-token.enc.json, so no secret has to be
rewritten by hand.

Stored: daily series per module in station.enc.json, hourly readings per year in
YYYY.station_h.enc.json, and daily aggregates (CO₂ of the night, hours humid / cold) in
station.enc.json. S-1.21 (#215): one health reading per module and per night,
station["health"][key][day] = [battery %, radio or Wi-Fi signal, answering 0/1], from the
getstationsdata response already read (no extra call); firmware changes go to devices.enc.json.
Formats: docs/api-notes.md, section « Station météo Netatmo ».
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from . import schema
from .errors import SourceError, error_code, raise_for_status
from .http import Paced
from .model import parse_measure_columns
from .schema import FormatError
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
# S-1.21: low battery and silent module thresholds (documented in docs/api-notes.md).
LOW_BATTERY = 15  # %, strictly below
SILENT_HOURS = 6  # last_seen older than this: the module no longer reports


class StationError(SourceError):
    """`auth`: refresh token refused, it must be generated again. Never the response body
    (S-1.16 #263: it may echo the station's MAC address)."""

    source = "Station Netatmo"


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
        self.health: dict[str, int] = {}
        # Gentle with the public API (50 requests / 10 s, 500 / h per user).
        self.api = Paced(self.http, "netatmo", min_interval, StationError)

    # ------------------------------------------------------------ auth (rotating refresh token)
    def _refresh_token(self) -> str:
        doc = self.store.doc(TOKEN_DOC)
        seed_hash = hashlib.sha256(self.seed_token.encode()).hexdigest()[:16]
        # A new token pasted in the secret wins over the stored one (re-authorisation).
        if doc.get("seed") == seed_hash and doc.get("refresh_token"):
            return doc["refresh_token"]
        return self.seed_token

    def login(self) -> None:
        resp = self.api.post(
            f"{API}/oauth2/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": self._refresh_token(),
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
        )
        if resp.status_code != 200:
            code = error_code(resp)
            hint = {
                "invalid_client": "client_id / client_secret refusés : vérifiez NETATMO_CLIENT_ID "
                "et NETATMO_CLIENT_SECRET",
                "invalid_grant": "refresh token refusé ou déjà utilisé : régénérez-le (scope read_station) "
                "et mettez-le dans NETATMO_REFRESH_TOKEN",
            }.get(code, "régénérez un jeton sur dev.netatmo.com et mettez-le dans NETATMO_REFRESH_TOKEN")
            raise StationError(
                endpoint="/oauth2/token",
                status=resp.status_code,
                code=code,
                hint=hint,
                auth=code == "invalid_grant" or resp.status_code in (401, 403),
            )
        try:
            raw = resp.json()
        except ValueError:
            raise FormatError("Station Netatmo", "/oauth2/token", "(réponse)", "n'est plus du JSON") from None
        body = schema.check("Station Netatmo", "/oauth2/token", schema.NETATMO_TOKEN, raw)
        self.access = body["access_token"]
        seed_hash = hashlib.sha256(self.seed_token.encode()).hexdigest()[:16]
        self.store.replace(TOKEN_DOC, {"seed": seed_hash, "refresh_token": body["refresh_token"]})
        # The previous refresh token is now consumed: write the new one to disk at once, so that
        # a failure later in the collection cannot lose it (#262; the workflow commits it anyway).
        self.store.flush(TOKEN_DOC)

    def _get(self, path: str, params: dict, spec: object = None) -> dict:
        resp = self.api.get(f"{API}{path}", params=params, headers={"Authorization": f"Bearer {self.access}"})
        raise_for_status(resp, StationError, path)
        try:
            body = resp.json()
        except ValueError:
            raise FormatError("Station Netatmo", path, "(réponse)", "n'est plus du JSON") from None
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
                "health": health(main, main=True),
            }
        ]
        for m in main.get("modules", []):
            out.append(
                {
                    "id": main["_id"],
                    "module": m["_id"],
                    "name": m.get("module_name") or m.get("type"),
                    "type": m.get("type"),
                    "health": health(m, main=False),
                }
            )
        return out

    def module_keys(self, modules: list[dict]) -> list[str]:
        """Stable storage key ("m0", "m1"…) per module, kept in the encrypted station document
        under "ids" (module id → key). The first time, keys follow the current API order, which
        is how they were assigned before; a module added later gets the next free key, so it
        never takes over the history of another one, whatever its place in the API list."""
        station = self.store.doc("station")
        ids: dict[str, str] = dict(station.get("ids") or {})
        uid = lambda m: m["module"] or m["id"]  # noqa: E731
        if not ids:
            ids = {uid(m): f"m{i}" for i, m in enumerate(modules)}
        used = set(ids.values())
        n = 0
        for m in modules:
            if uid(m) not in ids:
                while f"m{n}" in used:
                    n += 1
                ids[uid(m)] = f"m{n}"
                used.add(f"m{n}")
        self.store.set_top("station", "ids", ids)
        return [ids[uid(m)] for m in modules]

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
        station = self.store.doc("station")
        known = station.get("daily", {})
        last_days = [max(d) for d in known.values() if d]
        begin_day = min(last_days) if last_days else first_day
        begin = int((datetime.fromisoformat(begin_day).replace(tzinfo=zone) - timedelta(days=10)).timestamp())
        end = int(datetime.now(zone).timestamp())
        outdoor_days = 0
        names = {}
        modules = self.modules()
        for key, m in zip(self.module_keys(modules), modules, strict=True):
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
        self.health = store_health(self.store, modules, self.module_keys(modules), tz)
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


def _num(v: object) -> float | None:
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else None


def health(m: dict, main: bool) -> dict:
    """Battery, signal, link and firmware of one module of getstationsdata (S-1.21). The main
    module is on mains power and Wi-Fi: no battery, `wifi_status` as signal."""
    out: dict = {
        "battery": None if main else _num(m.get("battery_percent")),
        "signal": _num(m.get("wifi_status" if main else "rf_status")),
        "reachable": m.get("reachable"),
        "last_seen": _num(m.get("last_status_store" if main else "last_seen") or m.get("last_seen")),
        "firmware": m.get("firmware"),
    }
    return out


def store_health(
    store: Store, modules: list[dict], keys: list[str], tz: str, now: float | None = None
) -> dict[str, int]:
    """One [battery %, signal, answering] per module for today; firmware changes. Counts only."""
    from .devices import note_firmware

    now = float(now if now is not None else time.time())
    day = datetime.fromtimestamp(now, ZoneInfo(tz)).date().isoformat()
    counts = {"low_battery": 0, "silent": 0, "firmware": 0}
    for key, m in zip(keys, modules, strict=True):
        h = m.get("health") or {}
        seen = h.get("last_seen")
        silent = h.get("reachable") is False or (seen is not None and now - seen > SILENT_HOURS * 3600)
        battery = None if h.get("battery") is None else round(h["battery"])
        signal = None if h.get("signal") is None else round(h["signal"])
        if battery is None and signal is None and h.get("reachable") is None and seen is None:
            continue
        store.put("station", "health", key, day, [battery, signal, 0 if silent else 1])
        counts["low_battery"] += battery is not None and battery < LOW_BATTERY
        counts["silent"] += silent
        counts["firmware"] += note_firmware(store, key, h.get("firmware"), day, kind=m.get("type"))
    return counts


def health_note(counts: dict[str, int]) -> str | None:
    """Sources note and job summary (counts only, never a module name)."""
    parts = []
    if counts.get("low_battery"):
        parts.append(f"pile faible : {counts['low_battery']} module(s)")
    if counts.get("silent"):
        parts.append(f"{counts['silent']} module(s) muet(s) depuis plus de {SILENT_HOURS} h")
    return " ; ".join(parts) or None


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
