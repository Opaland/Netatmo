"""Shelly smart plugs through the Shelly Cloud Control API (S-1.17). Optional source.

Needs two secrets, both shown in the Shelly app → User settings → Authorization cloud key:
SHELLY_AUTH_KEY (the key) and SHELLY_SERVER (the "server uri", e.g. shelly-103-eu.shelly.cloud).

The Cloud Control API gives the current state of a device, not its history. Each plug
exposes a cumulative energy counter (Gen2+: `switch:0.aenergy.total` in Wh; Gen1:
`meters[0].total` in watt-minutes). Every collection keeps one reading per plug; the energy
between two readings is spread over the local days it covers, in proportion to time. With a
nightly collection, a day therefore gets parts of two intervals (the split inside an interval
is an even-consumption assumption, exact for a fridge, approximate for a washing machine).
A counter that went down (reset on reboot / power loss) counts the new value only, and the
days of an interval longer than LONG_GAP_HOURS (plug offline, missed collection) are marked
"estimated". Beyond MAX_GAP_DAYS the interval is dropped (too vague) and counting restarts.

Document `shelly.enc.json` (plugs are keyed p0, p1… so device ids never leave `plugs`):
  {"plugs":     {"p0": {"id": "...", "name": "Réfrigérateur", "model": "...", "gen": "G2", "usable": true}},
   "last":      {"p0": {"ts": 1731130000, "total": 123456.7}},   reading kept for the next run
   "daily":     {"p0": {"YYYY-MM-DD": Wh}},
   "estimated": {"p0": {"YYYY-MM-DD": 1}},
   "until":     {"p0": "YYYY-MM-DD"}}   days before this one are complete

Nothing about a plug (id, name, value) is ever logged: GitHub Actions logs are public.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from . import schema
from .http import Paced
from .schema import FormatError
from .storage import Store

log = logging.getLogger(__name__)

SOURCE = "Shelly Cloud"
DOC = "shelly"
BATCH = 10  # /v2/devices/api/get: 1 to 10 ids per request
MIN_INTERVAL = 1.1  # documented limit: 1 request per second
LONG_GAP_HOURS = 30
MAX_GAP_DAYS = 45
USER_AGENT = "intuis-history/1.0 (+https://github.com/Opaland/Netatmo)"
_HOST = re.compile(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.shelly\.cloud")
_CHANNEL = re.compile(r"(switch|pm1|em1):\d+")


class ShellyError(RuntimeError):
    """Messages never quote the key, an id, a name or a value (public log)."""

    def __init__(self, message: str, auth: bool = False) -> None:
        super().__init__(message)
        self.auth = auth


def server_url(raw: str) -> str:
    """https://<host> from SHELLY_SERVER; only *.shelly.cloud hosts, so the key goes nowhere else."""
    host = raw.strip().lower().removeprefix("https://").removeprefix("http://").split("/")[0]
    if not _HOST.fullmatch(host):
        raise ShellyError("Shelly : SHELLY_SERVER doit être un serveur *.shelly.cloud (ex. shelly-103-eu.shelly.cloud)")
    return f"https://{host}"


# ---------------------------------------------------------------- reading a device state
def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else None


def reading(status: dict) -> tuple[float | None, bool]:
    """(cumulative energy in Wh or None, measures power at all) from a device status."""
    total: float | None = None
    power = False
    for key, comp in status.items():
        if not (isinstance(comp, dict) and _CHANNEL.fullmatch(str(key))):
            continue
        power = power or "apower" in comp or "act_power" in comp
        ae = comp.get("aenergy")
        wh = _num(ae.get("total")) if isinstance(ae, dict) else None
        if wh is not None:
            total = (total or 0.0) + wh
    for key, factor in (("meters", 1 / 60), ("emeters", 1.0)):  # Gen1: meters in watt-minutes
        for m in status.get(key) or []:
            if not isinstance(m, dict):
                continue
            power = power or "power" in m
            v = _num(m.get("total"))
            if v is not None:
                total = (total or 0.0) + v * factor
    return total, power or total is not None


def device_time(status: dict) -> int | None:
    """Device clock (s) when the status was produced: Gen2 sys.unixtime, Gen1 unixtime."""
    sys_ = status.get("sys")
    t = _num(sys_.get("unixtime")) if isinstance(sys_, dict) else None
    t = t if t is not None else _num(status.get("unixtime"))
    return int(t) if t and t > 1_500_000_000 else None


def _settings_name(settings: Any) -> str | None:
    if not isinstance(settings, dict):
        return None
    dev = settings.get("sys", {}).get("device", {}) if isinstance(settings.get("sys"), dict) else {}
    name = dev.get("name") if isinstance(dev, dict) else None
    name = name or settings.get("name")
    return name.strip()[:60] if isinstance(name, str) and name.strip() else None


# ---------------------------------------------------------------- spreading a counter
def spread(start: float, end: float, wh: float, tz: str) -> dict[str, float]:
    """Energy of [start, end] (epoch seconds) spread over the local days, in proportion to time."""
    zone = ZoneInfo(tz)
    out: dict[str, float] = {}
    if end <= start:
        return out
    t = start
    while t < end:
        local = datetime.fromtimestamp(t, zone)
        nxt = datetime.combine(local.date() + timedelta(days=1), datetime.min.time(), zone).timestamp()
        stop = min(nxt, end)
        out[local.date().isoformat()] = out.get(local.date().isoformat(), 0.0) + wh * (stop - t) / (end - start)
        t = stop
    return out


def counter_step(prev: dict | None, ts: float, total: float) -> tuple[float | None, bool]:
    """(Wh consumed since `prev`, estimated) for a cumulative counter; None to restart counting."""
    if not prev or ts <= prev["ts"]:
        return None, False
    gap = ts - prev["ts"]
    if gap > MAX_GAP_DAYS * 86400:
        return None, False
    if total < prev["total"] - 0.5:  # reset (reboot, power loss): what was counted since
        return total, True
    return max(0.0, total - prev["total"]), gap > LONG_GAP_HOURS * 3600


def add_reading(store: Store, key: str, ts: float, total: float, tz: str) -> int:
    """Account one counter reading for plug `key`; returns the number of days touched."""
    doc = store.doc(DOC)
    prev = doc.get("last", {}).get(key)
    wh, estimated = counter_step(prev, ts, total)
    store.put(DOC, "last", key, None, {"ts": int(ts), "total": round(total, 2)})
    if wh is None:
        return 0
    daily = doc.setdefault("daily", {}).setdefault(key, {})
    parts = spread(prev["ts"], ts, wh, tz)
    for day, v in parts.items():
        store.put(DOC, "daily", key, day, round(daily.get(day, 0.0) + v, 1))
        if estimated:
            store.put(DOC, "estimated", key, day, 1)
    store.put(DOC, "until", key, None, datetime.fromtimestamp(ts, ZoneInfo(tz)).date().isoformat())
    return len(parts)


# ---------------------------------------------------------------- API
class _Api:
    def __init__(self, http: httpx.Client, base: str, key: str, min_interval: float | None) -> None:
        self.base, self.key = base, key
        self.api = Paced(http, "shelly", MIN_INTERVAL if min_interval is None else min_interval)

    def post(self, path: str, endpoint: str, **kw: Any) -> Any:
        try:
            resp = self.api.post(f"{self.base}{path}", **kw)
        except httpx.HTTPError as err:  # its message may carry the URL, hence the key: never print it
            raise ShellyError(f"Shelly : {endpoint} injoignable ({type(err).__name__})") from None
        if resp.status_code in (401, 403):
            raise ShellyError(
                f"Shelly : HTTP {resp.status_code}, clé refusée — nouvelle clé dans l'application Shelly "
                "(Paramètres utilisateur → Clé d'autorisation cloud), puis secret SHELLY_AUTH_KEY",
                auth=True,
            )
        if resp.status_code != 200:
            raise ShellyError(f"Shelly : {endpoint}, HTTP {resp.status_code}")
        try:
            return resp.json()
        except ValueError:
            raise FormatError(SOURCE, endpoint, "(réponse)", "n'est plus du JSON") from None

    def v1(self, path: str, endpoint: str) -> dict:
        """Legacy form API: {"isok": bool, "data": {...}} (auth_key in the form body)."""
        body = schema.check(SOURCE, endpoint, schema.SHELLY_V1, self.post(path, endpoint, data={"auth_key": self.key}))
        if not body["isok"]:
            errors = body.get("errors")
            names = schema.safe_keys(errors if isinstance(errors, dict) else [])
            auth = any("auth" in n or "key" in n for n in names)
            raise ShellyError(f"Shelly : {endpoint} refusé ({', '.join(names) or 'sans motif'})", auth=auth)
        return body.get("data") or {}


def _inventory(api: _Api) -> dict[str, dict]:
    """{device id: {"name", "type", "gen"}}. The device list is not in the official docs
    (à vérifier): /interface/device/list, else the ids of /device/all_status."""
    try:
        data = api.v1("/interface/device/list", "interface/device/list")
        devices = data.get("devices")
        if isinstance(devices, dict) and devices:
            return {str(i): d if isinstance(d, dict) else {} for i, d in devices.items()}
    except (ShellyError, FormatError) as err:
        if getattr(err, "auth", False):
            raise
        log.info("Shelly : liste des appareils indisponible, repli sur all_status")
    data = api.v1("/device/all_status", "device/all_status")
    statuses = data.get("devices_status")
    if not isinstance(statuses, dict):
        raise FormatError(SOURCE, "device/all_status", "data.devices_status", "absent")
    return {str(i): {} for i in statuses}


def collect(
    store: Store,
    auth_key: str,
    server: str,
    tz: str,
    http: httpx.Client | None = None,
    min_interval: float | None = None,
) -> dict[str, int]:
    """One reading per plug. Returns counts only: plugs, readings, offline, unusable."""
    base = server_url(server)
    api = _Api(http or httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT}), base, auth_key, min_interval)
    inventory = _inventory(api)
    doc = store.doc(DOC)
    known = {p.get("id"): k for k, p in doc.get("plugs", {}).items()}
    counts = {"plugs": 0, "readings": 0, "offline": 0, "unusable": 0}
    ids = sorted(inventory)
    for i in range(0, len(ids), BATCH):
        states = schema.check(
            SOURCE,
            "v2/devices/api/get",
            schema.SHELLY_V2_STATE,
            api.post(
                "/v2/devices/api/get",
                "v2/devices/api/get",
                params={"auth_key": auth_key},
                json={"ids": ids[i : i + BATCH], "select": ["status", "settings"]},
            ),
        )
        for st in states:
            status = st.get("status") or {}
            total, measures = reading(status)
            if not measures:
                continue  # not a plug or meter (sensor, button…)
            did = st["id"]
            key = known.get(did) or f"p{len(doc.get('plugs', {}))}"
            known[did] = key
            meta = inventory.get(did, {})
            name = meta.get("name") if isinstance(meta.get("name"), str) and meta["name"].strip() else None
            plug = {
                "id": did,
                "name": (name or _settings_name(st.get("settings")) or f"Prise {key[1:]}").strip()[:60],
                "model": str(meta.get("type") or st.get("code") or "")[:40],
                "gen": str(st.get("gen") or meta.get("gen") or "")[:8],
                "usable": total is not None,
            }
            store.put(DOC, "plugs", key, None, plug)
            counts["plugs"] += 1
            if total is None:
                counts["unusable"] += 1  # instantaneous power only: nothing to archive without a hub
                continue
            if st.get("online") in (0, False):
                counts["offline"] += 1
                continue
            ts = device_time(status) or time.time()
            add_reading(store, key, ts, total, tz)
            counts["readings"] += 1
    log.info(
        "Shelly : %d prises, %d relevés, %d hors ligne, %d sans compteur",
        counts["plugs"],
        counts["readings"],
        counts["offline"],
        counts["unusable"],
    )
    return counts


def note(counts: dict[str, int]) -> str | None:
    """Informative note for the sources state (counts only)."""
    parts = []
    if not counts["plugs"]:
        parts.append("aucune prise avec mesure d'énergie dans ce compte Shelly")
    if counts["unusable"]:
        parts.append(f"{counts['unusable']} prise(s) sans compteur d'énergie : non exploitable(s) sans hub")
    if counts["offline"]:
        parts.append(f"{counts['offline']} prise(s) hors ligne, rattrapée(s) à la prochaine collecte")
    return " ; ".join(parts) or None
