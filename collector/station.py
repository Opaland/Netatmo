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
S-11.4 (#220): pressure of the main module, station["pressure"]["m0"][day] = [mean, min, max,
trend vs the day before] (hPa), and, only with the repository variable STATION_NOISE=true, the
noise of the main module kept as station["noise"]["m0"][day] = {"n": hours read, "loud": hours
above NOISY_ABOVE}: never an hour of the day, the hourly noise is dropped at once.
Anemometer and rain gauge (NAModule2 / NAModule3) are never asked a temperature (gap G4 of the
data audit, #221): an error on them cannot stop the station.
Formats: docs/api-notes.md, section « Station météo Netatmo ».
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

import httpx

from . import schema
from .enedis import CATCH_UP_GAP, day_ranges
from .errors import SourceError, error_code, raise_for_status
from .http import Paced
from .model import parse_measure_columns
from .schema import FormatError
from .storage import KeyMap, Store

if TYPE_CHECKING:
    from .rattrapage import Tally
from .texte import nombre

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
# S-11.4 (#220): modules without temperature (anemometer, rain gauge), and the noise threshold.
NO_TEMPERATURE = ("NAModule2", "NAModule3")
PRESSURE_TYPES = "pressure,min_pressure,max_pressure"
# dB, hourly mean strictly above: a lively conversation or a loud television. Chosen by judgement
# (no norm for a living room), only counts « noisy hours »; shown with its value in the app.
NOISY_ABOVE = 55
STATION_SERIE = "station"  # key of the catch-up tally (collector/rattrapage.py LABELS)


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
        noise: bool = False,
    ) -> None:
        self.store = store
        self.noise = noise  # S-11.4: opt-in (STATION_NOISE), off by default
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
        """Stable storage key ("m0", "m1"…) per module. The station document keeps, under
        "module_keys", a random salt and a map from a salted hash of each module id to its key:
        the module id (a MAC address) is never stored. The first time, keys follow the current
        API order, which is how they were assigned before; a module added later gets the next
        free key, whatever its place in the list, and a removed module keeps its key (and its
        history) without shifting the others. The "ids" table of v1.4/v1.5 (id in clear → key)
        is hashed once and removed."""
        legacy = self.store.doc("station").get("ids") or {}
        keys = KeyMap(self.store, "station", "m", legacy=legacy)
        out = [keys.key(m["module"] or m["id"]) for m in modules]
        keys.save()
        self.store.drop_top("station", "ids")
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
        keys = self.module_keys(modules)
        for key, m in zip(keys, modules, strict=True):
            # Per module: each one resumes from ITS last day (minus 10 days), so a removed module,
            # frozen on an old day, never drags the others back; a new module starts from the
            # first day of the home.
            begin_day = max(known[key]) if known.get(key) else first_day
            begin = int((datetime.fromisoformat(begin_day).replace(tzinfo=zone) - timedelta(days=10)).timestamp())
            indoor = m["type"] in ("NAMain", "NAModule4")
            names[key] = {"name": m["name"], "type": m["type"], "indoor": indoor}
            if m["type"] in NO_TEMPERATURE:  # G4 (#221): no temperature to ask a wind or rain gauge
                continue
            for ts, cols in self._daily(m["id"], m["module"], daily_types(indoor), begin, end):
                row = daily_row(cols, indoor)
                if row is None:
                    continue
                day = datetime.fromtimestamp(ts, zone).strftime("%Y-%m-%d")
                self.store.put("station", "daily", key, day, row)
                if m["type"] == "NAModule1":
                    self.store.put("weather", "outdoor", day, None, row[:3])
                    outdoor_days += 1
                elif m["type"] == "NAMain":
                    self.store.put("weather", "indoor", day, None, row[2])
        self.store.set_top("station", "modules", names)
        self.health = store_health(self.store, modules, keys, tz)
        for key, m in zip(keys, modules, strict=True):
            if m["type"] == "NAMain":
                self.collect_pressure(key, m, zone, first_day, end)
        self.collect_hourly(tz, modules)
        if outdoor_days:
            self.store.set_top("weather", "source", "netatmo")
        log.info("Station Netatmo : %d modules, %d jours de température extérieure", len(names), outdoor_days)
        return outdoor_days

    def catch_up(self, tz: str, tally: Tally) -> None:
        """#569: per module, the days missing between its first and its last daily reading (the
        nightly collection only asks the 10 days before its last one), asked again from Netatmo,
        which keeps the station's history. Only absent days are added (and the outdoor / indoor
        weather of the day when it is absent too); a present day is never rewritten. Needs `login`."""
        zone = ZoneInfo(tz)
        daily = self.store.doc("station").setdefault("daily", {})
        weather = self.store.doc("weather")
        modules = self.modules()
        for key, m in zip(self.module_keys(modules), modules, strict=True):
            have = daily.get(key) or {}
            if m["type"] in NO_TEMPERATURE or len(have) < 2:
                continue
            first, last = date.fromisoformat(min(have)), date.fromisoformat(max(have))
            absent = [
                first + timedelta(days=i)
                for i in range((last - first).days)
                if (first + timedelta(days=i)).isoformat() not in have
            ]
            indoor = m["type"] in ("NAMain", "NAModule4")
            for start, end in day_ranges(absent, 1000, gap=CATCH_UP_GAP):
                begin = int(datetime.combine(start, datetime.min.time(), zone).timestamp())
                stop = int(datetime.combine(end, datetime.min.time(), zone).timestamp())
                wanted = {(start + timedelta(days=i)).isoformat() for i in range((end - start).days)}
                for d in sorted(wanted):
                    tally.asked(STATION_SERIE, d)
                for ts, cols in self._daily(m["id"], m["module"], daily_types(indoor), begin, stop):
                    day = datetime.fromtimestamp(ts, zone).strftime("%Y-%m-%d")
                    row = daily_row(cols, indoor)
                    if row is None or day not in wanted or day in have:
                        continue
                    self.store.put("station", "daily", key, day, row)
                    tally.added(STATION_SERIE, day)
                    if m["type"] == "NAModule1" and day not in (weather.get("outdoor") or {}):
                        self.store.put("weather", "outdoor", day, None, row[:3])
                    elif m["type"] == "NAMain" and day not in (weather.get("indoor") or {}):
                        self.store.put("weather", "indoor", day, None, row[2])

    # ------------------------------------------------------------ pressure (S-11.4, #220)
    def collect_pressure(self, key: str, m: dict, zone: ZoneInfo, first_day: str, end: int) -> int:
        """Daily mean / min / max pressure of the main module, and the trend (mean − mean of the
        day before). Best effort: a refusal never stops the station (counts only in the log)."""
        have = self.store.doc("station").get("pressure", {}).get(key) or {}
        begin_day = max(have) if have else first_day  # first time: the whole history of the home
        begin = int((datetime.fromisoformat(begin_day).replace(tzinfo=zone) - timedelta(days=10)).timestamp())
        try:
            rows = self._daily(m["id"], m["module"], PRESSURE_TYPES, begin, end)
        except (StationError, httpx.HTTPError, FormatError) as err:
            log.warning("Station Netatmo, pression indisponible : %s", type(err).__name__)
            return 0
        n = 0
        for ts, cols in rows:
            mean, lo, hi = (list(cols) + [None] * 3)[:3]
            if mean is None:
                continue
            day = datetime.fromtimestamp(ts, zone).strftime("%Y-%m-%d")
            r = lambda v: None if v is None else round(v, 1)  # noqa: E731
            self.store.put("station", "pressure", key, day, [r(mean), r(lo), r(hi), None])
            n += 1
        pressure_trends(self.store, key)
        return n

    def collect_noise(self, key: str, m: dict, zone: ZoneInfo, now: int) -> int:
        """S-11.4 (#220), opt-in: hourly noise of the main module, turned at once into a count of
        noisy hours per day. Nothing hourly is kept. Re-reads the last 3 days (today is partial)."""
        have = self.store.doc("station").get("noise", {}).get(key) or {}
        begin = now - HOURLY_DAYS_BACKFILL * DAY
        if have:
            last = int(datetime.fromisoformat(max(have)).replace(tzinfo=zone).timestamp())
            begin = max(begin, min(last, now - HOURLY_DAYS_SYNC * DAY))
        try:
            points = self._hourly_points(m["id"], m["module"], "noise", begin, now)
        except (StationError, httpx.HTTPError, FormatError) as err:
            log.warning("Station Netatmo, bruit indisponible : %s", type(err).__name__)
            return 0
        days = noisy_hours(points, zone)
        for day, cell in days.items():
            self.store.put("station", "noise", key, day, cell)
        return len(days)

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
            if self.noise and m["type"] == "NAMain":
                self.collect_noise(key, m, zone, now)
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


def daily_types(indoor: bool) -> str:
    """Types of the daily series of a module (CO₂ for the indoor ones only)."""
    return "min_temp,max_temp,temperature,humidity" + (",co2" if indoor else "")


def daily_row(cols: list, indoor: bool) -> list | None:
    """One day of `getmeasure` (`daily_types`) → [min, max, mean, humidity, CO₂ | None], as kept in
    station["daily"]; None without a min or a max. Shared by the nightly collection and the catch-up
    of the missing days (#569, collector/rattrapage.py)."""
    tmin, tmax, tmean, hum = (list(cols) + [None] * 5)[:4]
    co2 = cols[4] if indoor and len(cols) > 4 else None
    if tmin is None or tmax is None:
        return None
    mean = tmean if tmean is not None else (tmin + tmax) / 2
    r = lambda v: None if v is None else round(v, 1)  # noqa: E731
    return [r(tmin), r(tmax), r(mean), r(hum), None if co2 is None else round(co2)]


def pressure_trends(store: Store, key: str) -> None:
    """Trend of each day: its mean minus the mean of the day before (None without it)."""
    days = store.doc("station").get("pressure", {}).get(key) or {}
    for day in sorted(days):
        prev = days.get((date.fromisoformat(day) - timedelta(days=1)).isoformat())
        v = days[day]
        trend = None if not prev or prev[0] is None or v[0] is None else round(v[0] - prev[0], 1)
        if len(v) < 4 or v[3] != trend:
            store.put("station", "pressure", key, day, [*v[:3], trend])


def noisy_hours(points: list, zone: ZoneInfo) -> dict[str, dict]:
    """[(ts, [noise dB])] → {"YYYY-MM-DD" local: {"n": hours read, "loud": hours above NOISY_ABOVE}}."""
    hours: dict[str, list[float]] = {}
    for ts, cols in points:
        v = cols[0] if cols else None
        if isinstance(v, int | float) and not isinstance(v, bool):
            hours.setdefault(datetime.fromtimestamp(ts, zone).strftime("%Y-%m-%dT%H"), []).append(float(v))
    out: dict[str, dict] = {}
    for hour, vals in hours.items():
        cell = out.setdefault(hour[:10], {"n": 0, "loud": 0})
        cell["n"] += 1
        cell["loud"] += int(sum(vals) / len(vals) > NOISY_ABOVE)
    return out


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
        parts.append(f"pile faible : {nombre(counts['low_battery'], 'module')}")
    if counts.get("silent"):
        parts.append(f"{nombre(counts['silent'], 'module muet', 'modules muets')} depuis plus de {SILENT_HOURS} h")
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
