"""Hourly room states (E13: S-13.2, S-13.4, S-13.5, S-13.6).

The Intuis API gives the state of the rooms (window open, boost, setpoint mode) and of the
radiators (heating, load shedding, contactor) only as an instantaneous `homestatus`; no history
type is known (S-13.1, `diagnose --probe-history`). So:

1. `python -m collector snapshot` (workflow « Relevé horaire », hourly, never commits): one
   `homestatus` request, a few whitelisted fields kept, the snapshot encrypted with the key of
   the archive (DATA_PASSPHRASE + data/keyinfo.json) and handed to the workflow, which keeps it
   as a short-lived Actions artifact (3 days).
2. The nightly collection downloads the snapshots, and `merge_snapshots` adds them to
   `roomstate.enc.json` as DAILY counts per room. The snapshots themselves are never committed
   and expire on their own.

Data minimisation (S-13.5): `presence` is not even read unless the owner opts in with the
repository variable ROOM_STATE_PRESENCE=true, and even then only the daily hours are kept.
Nothing hourly is ever stored in the repository.

roomstate.enc.json:
  {"seen":  {"YYYY-MM-DD": bitmask of the local hours that had a snapshot},
   "rooms": {room: {"YYYY-MM-DD": {"n": 22,              snapshots that day with this room
                                   "open_window_h": 1.1,  hours, estimated pro rata of n
                                   "boost_h": 0.0, "heating_h": 7.6, "offload_h": 0.0,
                                   "mode_h": {"away": 2.2},          setpoint modes other than
                                                                     the schedule
                                   "contactor_h": {"auto": 23.0},    contactor (water heater)
                                   "presence_h": 9.8,                only with the opt-in
                                   "offline_h": 0.0,                 a module of the room was
                                                                     unreachable (S-1.20 #214)
                                   "anticipating_h": 1.0,            pre-heating before the
                                   "lowering_h": 3.0}}},             schedule / lowering (#218)
   "values": {"radiator_state": ["heating", ...], ...}}  value names seen, to check the mapping

Hours = count × (hours in that local day) / n: a missed or late cron run lowers n, not the
hours (the coverage n / 24 is shown next to them).

The gateway (NMG) of each snapshot (`uptime`, `wifi_strength`, Tempo colour of the day, no id)
goes to devices.enc.json: restarts inferred from `uptime`, daily Wi-Fi (collector/devices.py).
"""

from __future__ import annotations

import json
import re
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from . import redact
from .crypto import Kdf, decrypt_json, encrypt_json

# Fields kept from homestatus. Everything else (temperatures, ids of other objects, names) is
# dropped at once. `presence` only with the opt-in.
ROOM_FIELDS = (
    "open_window",
    "boost_status",
    "therm_setpoint_mode",
    "heating_power_request",
    "anticipating",
    "lowering",
)
MODULE_FIELDS = ("radiator_state", "offload", "contactor_mode", "reachable", "connection_status")
PRESENCE = "presence"
# Enum-like fields whose value names are kept (encrypted) so the owner can check the mapping.
ENUM_FIELDS = ("boost_status", "therm_setpoint_mode", "radiator_state", "contactor_mode", "connection_status")
MAX_VALUES = 12
# A value that means "no": anything else that is not empty, zero or false means "yes".
OFF = {"", "0", "false", "off", "no", "none", "null", "disabled", "inactive", "idle", "standby", "stand_by"}
OFF |= {"stop", "stopped", "unknown", "not_heating", "normal", "schedule"}
# Setpoint modes that follow the weekly schedule (not counted in mode_h).
SCHEDULE_MODES = {"schedule", "program", "home", "auto"}
BOOST_MODES = {"max", "boost"}
_SAFE = re.compile(r"[a-z][a-z0-9_]{0,23}")
# connection_status values that mean "not connected" (S-1.20, names à confirmer by the inventory).
DISCONNECTED = {"disconnected", "offline", "unreachable", "not_connected", "lost", "no_signal", "error"}
SNAPSHOT_PREFIX = "etat-"
SNAPSHOT_VERSION = 1


def norm(value: object) -> object:
    """Booleans and numbers as they are, a text as a short identifier (else "autre")."""
    if value is None or isinstance(value, bool | int | float):
        return value
    text = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    return text if _SAFE.fullmatch(text) else "autre"


def is_on(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float):
        return value > 0
    return str(value) not in OFF


def snapshot(payload: dict, now: int, presence: bool = False, calls: int = 0) -> dict:
    """The few fields kept from a homestatus response (still with the API ids: encrypted)."""
    home = payload.get("body", {}).get("home", {}) if isinstance(payload, dict) else {}
    home = home if isinstance(home, dict) else {}
    fields_r = ROOM_FIELDS + ((PRESENCE,) if presence else ())
    rooms: dict[str, dict] = {}
    for r in home.get("rooms") or []:
        if isinstance(r, dict) and r.get("id") is not None:
            rooms[str(r["id"])] = {k: norm(r[k]) for k in fields_r if k in r}
    modules: dict[str, dict] = {}
    gateway: dict = {}
    for m in home.get("modules") or []:
        if not (isinstance(m, dict) and m.get("id") is not None):
            continue
        if is_gateway(m):
            gateway = gateway or gateway_fields(m)
            continue
        kept = {k: norm(m[k]) for k in MODULE_FIELDS if k in m}
        if kept:
            modules[str(m["id"])] = kept
    snap = {"v": SNAPSHOT_VERSION, "t": int(now), "calls": calls, "rooms": rooms, "modules": modules}
    if gateway:
        snap["gateway"] = gateway
    return snap


def is_gateway(m: dict) -> bool:
    """The Intuis gateway (NMG): by type, or by the fields only it sends."""
    return m.get("type") == "NMG" or ("uptime" in m and "radiator_state" not in m)


def gateway_fields(m: dict) -> dict:
    """Gateway fields kept (#276, #278): uptime (s), Wi-Fi strength, Tempo colour of the day.
    Numbers only, the colour as a short identifier; never an id."""
    out: dict = {}
    for k in ("uptime", "wifi_strength"):
        v = m.get(k)
        if isinstance(v, int | float) and not isinstance(v, bool) and v >= 0:
            out[k] = v
    if m.get("therm_setpoint_day_color_type") is not None:
        out["day_color"] = norm(m["therm_setpoint_day_color_type"])
    return out


def is_offline(f: dict) -> bool | None:
    """A module seen unreachable (None when the snapshot says nothing about it)."""
    if "reachable" not in f and "connection_status" not in f:
        return None
    if f.get("reachable") is False:
        return True
    return isinstance(f.get("connection_status"), str) and f["connection_status"] in DISCONNECTED


def write_snapshot(out_dir: Path, snap: dict, passphrase: str, salt: bytes, kdf: Kdf | int) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{SNAPSHOT_PREFIX}{snap['t']}.enc.json"
    path.write_text(json.dumps(encrypt_json(snap, passphrase, salt, kdf)) + "\n")
    return path


def read_snapshots(folder: Path, passphrase: str) -> tuple[list[dict], int]:
    """Decrypted snapshots of a folder (recursively), and the number of unreadable files."""
    snaps, bad = [], 0
    for path in sorted(folder.rglob(f"{SNAPSHOT_PREFIX}*.enc.json")):
        try:
            snap = decrypt_json(json.loads(path.read_text()), passphrase)
        except Exception:  # wrong passphrase (rekey), truncated file: skip, never fatal
            bad += 1
            continue
        if isinstance(snap, dict) and isinstance(snap.get("t"), int):
            snaps.append(snap)
        else:
            bad += 1
    return snaps, bad


def module_rooms(homesdata: dict, water_heaters: dict[str, str] | None = None) -> dict[str, str]:
    """Module id -> room id under which the archive stores it (homesdata, first home)."""
    homes = homesdata.get("body", {}).get("homes", []) if isinstance(homesdata, dict) else []
    if not homes:
        return {}
    h = homes[0]
    out = {str(mid): str(r["id"]) for r in h.get("rooms", []) or [] for mid in r.get("module_ids", []) or []}
    for m in h.get("modules", []) or []:
        if m.get("id") and m.get("room_id") and str(m["id"]) not in out:
            out[str(m["id"])] = str(m["room_id"])
    out.update(water_heaters or {})
    return out


def day_hours(day: str, tz: str) -> float:
    """Hours in a local day: 23 or 25 on the days the clocks change."""
    z = ZoneInfo(tz)
    d = date.fromisoformat(day)
    start = datetime(d.year, d.month, d.day, tzinfo=z)
    nxt = d + timedelta(days=1)
    end = datetime(nxt.year, nxt.month, nxt.day, tzinfo=z)
    return (end.timestamp() - start.timestamp()) / 3600


HOUR_KEYS = ("open_window", "boost", "heating", "offload", "presence", "offline", "anticipating", "lowering")
DICT_KEYS = ("mode", "contactor")


def _counts(cell: dict, hours: float) -> dict:
    """Stored cell -> integer counts (exact: hours were rounded to 0.1 with n <= 25)."""
    n = int(cell.get("n", 0))
    back = lambda h: round(float(h) * n / hours) if n else 0  # noqa: E731
    out: dict = {"n": n}
    for k in HOUR_KEYS:
        if f"{k}_h" in cell:
            out[k] = back(cell[f"{k}_h"])
    for k in DICT_KEYS:
        if f"{k}_h" in cell:
            out[k] = {name: back(h) for name, h in cell[f"{k}_h"].items()}
    return out


def _cell(counts: dict, hours: float) -> dict:
    n = counts["n"]
    h = lambda c: round(c * hours / n, 1)  # noqa: E731
    out: dict = {"n": n}
    for k in HOUR_KEYS:
        if k in counts:
            out[f"{k}_h"] = h(counts[k])
    for k in DICT_KEYS:
        if counts.get(k):
            out[f"{k}_h"] = {name: h(c) for name, c in sorted(counts[k].items())}
    return out


def _room_states(snap: dict, mod_room: dict[str, str], presence: bool) -> dict[str, dict]:
    """Per room, the booleans / modes of one snapshot."""
    out: dict[str, dict] = {}
    for rid, f in (snap.get("rooms") or {}).items():
        st: dict = {}
        if "open_window" in f:
            st["open_window"] = is_on(f["open_window"])
        mode = f.get("therm_setpoint_mode")
        if "boost_status" in f or mode is not None:
            st["boost"] = is_on(f.get("boost_status")) or mode in BOOST_MODES
        if isinstance(mode, str) and mode not in SCHEDULE_MODES and mode not in BOOST_MODES:
            st["mode"] = mode
        if "heating_power_request" in f:
            st["heating"] = is_on(f["heating_power_request"])
        if presence and PRESENCE in f:
            st["presence"] = is_on(f[PRESENCE])
        for k in ("anticipating", "lowering"):
            if k in f:
                st[k] = is_on(f[k])
        out[str(rid)] = st
    for mid, f in (snap.get("modules") or {}).items():
        rid = mod_room.get(str(mid))
        if rid is None:
            continue
        st = out.setdefault(rid, {})
        if "radiator_state" in f:
            st["heating"] = st.get("heating", False) or is_on(f["radiator_state"])
        if "offload" in f:
            st["offload"] = st.get("offload", False) or is_on(f["offload"])
        if isinstance(f.get("contactor_mode"), str):
            st["contactor"] = f["contactor_mode"]
        off = is_offline(f)
        if off is not None:
            st["offline"] = st.get("offline", False) or off
    return out


def merge_snapshots(
    store,
    snaps: list[dict],
    tz: str,
    mod_room: dict[str, str],
    *,
    today: str | None = None,
    presence: bool = False,
) -> dict[str, int]:
    """Add snapshots of COMPLETE local days (before `today`) to roomstate.enc.json.

    Idempotent: a snapshot whose local hour is already in `seen` is skipped, so a snapshot
    read twice (artifact not yet expired) or two runs in the same hour count once.
    Returns counts only (public log): snapshots read, added, already counted, days touched,
    the Intuis calls those snapshots made, and the gateway restarts seen (#276)."""
    from .devices import observe_gateway, observe_offline

    z = ZoneInfo(tz)
    today = today or datetime.now(z).date().isoformat()
    doc = store.doc("roomstate")
    seen: dict[str, int] = dict(doc.get("seen", {}))
    rooms: dict[str, dict] = {k: dict(v) for k, v in doc.get("rooms", {}).items()}
    values: dict[str, set] = {k: set(v) for k, v in doc.get("values", {}).items()}
    stats = {"snapshots": len(snaps), "added": 0, "duplicates": 0, "pending": 0, "days": 0, "calls": 0, "boots": 0}
    touched: set[str] = set()
    counts: dict[tuple[str, str], dict] = {}
    for snap in sorted(snaps, key=lambda s: s["t"]):
        if isinstance(snap.get("gateway"), dict):  # events: today's snapshots count too (no double count)
            stats["boots"] += observe_gateway(store, snap["t"], snap["gateway"], tz)
        # #280: every radiator out of reach in this snapshot (events: today's count too)
        links = [off for f in (snap.get("modules") or {}).values() if (off := is_offline(f)) is not None]
        observe_offline(store, snap["t"], links, tz)
        local = datetime.fromtimestamp(snap["t"], z)
        day = local.date().isoformat()
        if day >= today:
            stats["pending"] += 1  # day not over yet: next night
            continue
        bit = 1 << local.hour
        if seen.get(day, 0) & bit:
            stats["duplicates"] += 1
            continue
        seen[day] = seen.get(day, 0) | bit
        stats["added"] += 1
        stats["calls"] += int(snap.get("calls", 0) or 0)
        touched.add(day)
        hours = day_hours(day, tz)
        for part, fields in (("rooms", ENUM_FIELDS), ("modules", ENUM_FIELDS)):
            for f in (snap.get(part) or {}).values():
                for k in fields:
                    if isinstance(f.get(k), str):
                        values.setdefault(k, set()).add(f[k])
        for rid, st in _room_states(snap, mod_room, presence).items():
            key = (rid, day)
            if key not in counts:
                counts[key] = _counts(rooms.get(rid, {}).get(day, {}), hours)
            c = counts[key]
            c["n"] += 1
            for k in HOUR_KEYS:
                if k in st:
                    c[k] = c.get(k, 0) + int(st[k])
            for k in DICT_KEYS:
                if k in st:
                    d = c.setdefault(k, {})
                    d[st[k]] = d.get(st[k], 0) + 1
    for (rid, day), c in counts.items():
        rooms.setdefault(rid, {})[day] = _cell(c, day_hours(day, tz))
    stats["days"] = len(touched)
    if stats["added"]:
        store.replace(
            "roomstate",
            {
                "seen": seen,
                "rooms": rooms,
                "values": {k: sorted(v)[:MAX_VALUES] for k, v in sorted(values.items())},
            },
        )
    return stats


def coverage(store, today: str, days: int = 7) -> tuple[int, int]:
    """(hours with a snapshot, hours expected) over the `days` complete days before `today`."""
    seen = store.doc("roomstate").get("seen", {})
    end = date.fromisoformat(today)
    got = 0
    for i in range(1, days + 1):
        got += bin(seen.get((end - timedelta(days=i)).isoformat(), 0)).count("1")
    return got, 24 * days


def take(client, store, out_dir: Path, presence: bool) -> Path:
    """One homestatus request (the home id comes from the encrypted meta, so no homesdata
    call is needed once the archive exists), the snapshot encrypted into out_dir."""
    from .budget import METER

    home_id = (store.meta.get("home") or {}).get("id")
    if not home_id:
        homes = client.homesdata().get("body", {}).get("homes", [])
        if not homes:
            raise RuntimeError("Aucune maison trouvée sur ce compte")
        home_id = homes[0]["id"]
    redact.register(home_id)  # S-1.16: never in the public log of the hourly workflow
    payload = client.homestatus(home_id)
    snap = snapshot(payload, int(time.time()), presence=presence, calls=METER.calls.get("intuis", 0))
    return write_snapshot(out_dir, snap, store.passphrase, store.salt, store.kdf)
