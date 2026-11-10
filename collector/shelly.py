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

S-1.30 (#279): clamp meters. Shelly EM Gen3 / Pro EM keep their energy in `em1data:N.total_act_energy`
(Wh), the Pro 3EM in `emdata:N.total_act` (the returned energy `*_ret_*` is ignored). A device with
several measuring channels gives ONE SERIES PER CHANNEL ("p2c0", "p2c1", named « Device · canal N »)
instead of their sum, which would mean nothing (water heater + main supply). A one-channel device
keeps its key pN, so existing plugs keep their history.

Document `shelly.enc.json` (plugs are keyed p0, p1…; the Shelly device id, derived from its MAC
address, is never stored: only a salted hash in "plug_keys", collector/storage.py KeyMap. The "id"
of each plug written by v1.4/v1.5 is hashed once and removed):
  {"plug_keys": {"salt": "<hex>", "keys": {"<sha256(salt:id)[:16]>": "p0"}},
   "plugs":     {"p0": {"name": "Réfrigérateur", "model": "...", "gen": "G2", "usable": true},
                 "p2": {..., "channels": 2},                       a multi-channel device
                 "p2c0": {"parent": "p2", "channel": "em1data:0", "name": "Pinces · canal 1", ...}},
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
from .errors import SourceError, raise_for_status
from .http import Paced
from .schema import FormatError
from .storage import KeyMap, Store
from .texte import nombre

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
_EM_DATA = re.compile(r"(em1data|emdata):\d+")
# Energy consumed (Wh) in the clamp-meter components; "*_ret_*" (returned to the grid) is ignored.
_EM_TOTAL = {"em1data": "total_act_energy", "emdata": "total_act"}


class ShellyError(SourceError):
    """Messages never quote the key, an id, a name or a value (public log)."""

    source = "Shelly"


def server_url(raw: str) -> str:
    """https://<host> from SHELLY_SERVER; only *.shelly.cloud hosts, so the key goes nowhere else."""
    host = raw.strip().lower().removeprefix("https://").removeprefix("http://").split("/")[0]
    if not _HOST.fullmatch(host):
        raise ShellyError("Shelly : SHELLY_SERVER doit être un serveur *.shelly.cloud (ex. shelly-103-eu.shelly.cloud)")
    return f"https://{host}"


# ---------------------------------------------------------------- reading a device state
def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else None


def channels(status: dict) -> tuple[dict[str, float], bool]:
    """({channel: cumulative energy in Wh}, measures power at all) from a device status. Channels
    are the components that carry an energy counter: "switch:0", "em1data:1", "emdata:0",
    "meters:0" (Gen1, watt-minutes), "emeters:1" (Gen1 EM, Wh)."""
    out: dict[str, float] = {}
    power = False
    for key, comp in status.items():
        if not isinstance(comp, dict):
            continue
        if _CHANNEL.fullmatch(str(key)):
            power = power or "apower" in comp or "act_power" in comp
            ae = comp.get("aenergy")
            wh = _num(ae.get("total")) if isinstance(ae, dict) else None
            if wh is not None:
                out[str(key)] = wh
        elif _EM_DATA.fullmatch(str(key)):
            wh = _num(comp.get(_EM_TOTAL[str(key).split(":")[0]]))
            if wh is not None:
                out[str(key)] = wh
    for key, factor in (("meters", 1 / 60), ("emeters", 1.0)):  # Gen1: meters in watt-minutes
        for i, m in enumerate(status.get(key) or []):
            if not isinstance(m, dict):
                continue
            power = power or "power" in m
            v = _num(m.get("total"))
            if v is not None:
                out[f"{key}:{i}"] = v * factor
    return dict(sorted(out.items(), key=lambda kv: _channel_order(kv[0]))), power or bool(out)


def _channel_order(name: str) -> tuple[str, int]:
    kind, _, n = name.partition(":")
    return kind, int(n) if n.isdigit() else 0


def reading(status: dict) -> tuple[float | None, bool]:
    """(cumulative energy in Wh or None, measures power at all): the sum of the channels, kept for
    one-channel devices and the diagnostic."""
    found, power = channels(status)
    return (sum(found.values()) if found else None), power


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
        self.api = Paced(http, "shelly", MIN_INTERVAL if min_interval is None else min_interval, ShellyError)

    def post(self, path: str, endpoint: str, **kw: Any) -> Any:
        # httpx messages carry the URL, hence the key: Paced(error=ShellyError) never prints them.
        resp = self.api.post(f"{self.base}{path}", **kw)
        if resp.status_code in (401, 403):
            raise ShellyError(
                endpoint=endpoint,
                status=resp.status_code,
                hint="clé refusée, nouvelle clé dans l'application Shelly "
                "(Paramètres utilisateur → Clé d'autorisation cloud), puis secret SHELLY_AUTH_KEY",
                auth=True,
            )
        raise_for_status(resp, ShellyError, endpoint)
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


def plug_keys(store: Store) -> KeyMap:
    """Stable key pN per device. Plugs written by an earlier version kept their Shelly id in
    clear ("id"): it is hashed into "plug_keys" and removed from every plug, channels included."""
    plugs = store.doc(DOC).get("plugs", {})
    legacy = {str(p["id"]): k for k, p in plugs.items() if "parent" not in p and p.get("id")}
    keys = KeyMap(store, DOC, "p", field="plug_keys", legacy=legacy, reserved=set(plugs))
    for k, p in list(plugs.items()):
        if "id" in p:
            store.put(DOC, "plugs", k, None, {f: v for f, v in p.items() if f != "id"})
    keys.save()
    return keys


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
    keys = plug_keys(store)
    counts = {"plugs": 0, "readings": 0, "offline": 0, "unusable": 0, "channels": 0}
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
            found, measures = channels(status)
            if not measures:
                continue  # not a plug or meter (sensor, button…)
            did = st["id"]
            key = keys.key(str(did))
            meta = inventory.get(did, {})
            name = meta.get("name") if isinstance(meta.get("name"), str) and meta["name"].strip() else None
            plug = {
                "name": (name or _settings_name(st.get("settings")) or f"Prise {key[1:]}").strip()[:60],
                "model": str(meta.get("type") or st.get("code") or "")[:40],
                "gen": str(st.get("gen") or meta.get("gen") or "")[:8],
                "usable": bool(found),
            }
            if len(found) > 1:
                plug["channels"] = len(found)
            store.put(DOC, "plugs", key, None, {**(doc.get("plugs", {}).get(key) or {}), **plug})
            counts["plugs"] += 1
            if not found:
                counts["unusable"] += 1  # instantaneous power only: nothing to archive without a hub
                continue
            if st.get("online") in (0, False):
                counts["offline"] += 1
                continue
            ts = device_time(status) or time.time()
            if len(found) == 1:
                add_reading(store, key, ts, next(iter(found.values())), tz)
            else:
                counts["channels"] += len(found)
                for i, (channel, wh) in enumerate(found.items()):
                    ckey = f"{key}c{i}"
                    store.put(
                        DOC,
                        "plugs",
                        ckey,
                        None,
                        {
                            "parent": key,
                            "channel": channel,
                            "name": f"{plug['name'][:48]} · canal {i + 1}",
                            "model": plug["model"],
                            "gen": plug["gen"],
                            "usable": True,
                        },
                    )
                    add_reading(store, ckey, ts, wh, tz)
            counts["readings"] += 1
    keys.save()
    log.info(
        "Shelly : %d prises, %d relevés, %d hors ligne, %d sans compteur, %d canaux de pinces",
        counts["plugs"],
        counts["readings"],
        counts["offline"],
        counts["unusable"],
        counts["channels"],
    )
    return counts


def note(counts: dict[str, int]) -> str | None:
    """Informative note for the sources state (counts only)."""
    parts = []
    if not counts["plugs"]:
        parts.append("aucune prise avec mesure d'énergie dans ce compte Shelly")
    if counts["unusable"]:
        n = counts["unusable"]
        usable = "non exploitables" if n > 1 else "non exploitable"
        parts.append(f"{nombre(n, 'prise')} sans compteur d'énergie : {usable} sans hub")
    if counts["offline"]:
        n = counts["offline"]
        caught = "rattrapées" if n > 1 else "rattrapée"
        parts.append(f"{nombre(n, 'prise')} hors ligne, {caught} à la prochaine collecte")
    return " ; ".join(parts) or None
