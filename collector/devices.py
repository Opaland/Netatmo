"""Health of the devices, from responses the collection already receives (v1.5).

- S-1.20 (#214): Intuis modules (radiators, water heater, relays) that no longer answer:
  `reachable`, `connection_status`, `last_seen` of `homestatus`, one status per module and per day.
- S-1.22 (#216): firmware versions (Intuis `firmware_revision`, station `firmware`) and the
  `setup_date` of `homesdata`: only the CHANGES are kept, with the date of the collection that
  saw them.
- S-1.27 (#276): the Intuis gateway (NMG): restarts (power cuts) inferred from `uptime`, Wi-Fi
  strength per day. Fed by the hourly snapshots (collector/roomstate.py) and the nightly read.
- S-1.29 (#278): Tempo colour of the day known by the gateway (`therm_setpoint_day_color_type`),
  and the tariff seen by Intuis in the schedules of `homesdata` (kept in the encrypted meta).

The nightly collection reads `homestatus` once (one Intuis call) for the first three; nothing
else is asked. Modules are keyed i0, i1…: the API id (a MAC address) is never stored, only a
salted hash of it in "module_keys" (collector/storage.py KeyMap; the "ids" table of v1.5, id in
clear → key, is hashed once and removed).

devices.enc.json:
  {"module_keys": {"salt": "<hex>", "keys": {"<sha256(salt:id)[:16]>": "i0"}},
   "modules":  {"i0": {"type": "NMH", "room": "<room id>", "setup": "YYYY-MM-DD", "fw": "105"},
                "m1": {"type": "NAModule1", "fw": "50"}},        station modules: key of station.enc.json
   "reach":    {"i0": {"YYYY-MM-DD": 1}},       nightly: 1 answering, 0 unreachable or silent > 6 h
   "firmware": {"i0": [["YYYY-MM-DD", "104", "105"]]},          changes only
   "gateway":  {"last": {"t": epoch, "boot": epoch},             last observation
                "boots": ["YYYY-MM-DDTHH:MM"],                   restarts, local time, newest last
                "wifi": {"YYYY-MM-DD": [min, mean, max, n]}},
   "tempo":    {"YYYY-MM-DD": "blue"}}          gateway colour per Tempo day (6 h → 6 h)

Public log: counts and module types only, never an id, a name or a value.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from .roomstate import DISCONNECTED, gateway_fields, is_gateway, norm
from .storage import KeyMap, Store

DOC = "devices"
SILENT_HOURS = 6  # a module whose last_seen is older is counted as not answering
BOOT_JUMP = 900  # s: the inferred start time moved forward more than this → a restart
MAX_BOOTS = 200
MAX_FIRMWARE_CHANGES = 20
TEMPO_DAY_START = 6  # a Tempo day runs from 6:00 to 6:00 the next day
_VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,23}")
# Words of the public log and of the alert issue (types only, never a room).
TYPE_LABEL = {"NMH": "radiateur", "NMW": "chauffe-eau", "NMR": "relais", "NMG": "passerelle"}


def type_label(t: object) -> str:
    return TYPE_LABEL.get(str(t), "module")


def version(v: object) -> str | None:
    """A firmware version as a short identifier, else None (never a free text)."""
    if isinstance(v, bool) or v is None:
        return None
    text = str(v).strip()
    return text if _VERSION.fullmatch(text) else None


def _num(v: object) -> float | None:
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else None


def module_keys(store: Store, ids: list[str]) -> dict[str, str]:
    """Stable key per Intuis module (i0, i1…), assigned once, in the order of `ids`. The returned
    map (API id → key) lives in memory only: the document keeps salted hashes."""
    keys = KeyMap(store, DOC, "i", legacy=store.doc(DOC).get("ids") or {})
    out = {mid: keys.key(mid) for mid in ids}
    keys.save()
    store.drop_top(DOC, "ids")
    return out


def note_firmware(store: Store, key: str, raw: object, day: str, kind: str | None = None) -> bool:
    """Remember the version of a module; True when it changed since the last collection."""
    v = version(raw)
    doc = store.doc(DOC)
    info = dict(doc.get("modules", {}).get(key) or {})
    if kind and info.get("type") != kind:
        info["type"] = kind
    changed = False
    if v is not None:
        before = info.get("fw")
        if before is not None and before != v:
            changes = list(doc.get("firmware", {}).get(key) or [])
            changes.append([day, before, v])
            store.put(DOC, "firmware", key, None, changes[-MAX_FIRMWARE_CHANGES:])
            changed = True
        info["fw"] = v
    if info:
        store.put(DOC, "modules", key, None, info)
    return changed


def tempo_day(t: float, zone: ZoneInfo) -> str:
    return (datetime.fromtimestamp(t, zone) - timedelta(hours=TEMPO_DAY_START)).date().isoformat()


def observe_gateway(store: Store, t: float, gw: dict, tz: str) -> int:
    """One observation of the gateway (hourly snapshot or nightly read). Returns 1 when it shows
    a restart: the start time inferred from `uptime` (t − uptime) moved forward by more than
    BOOT_JUMP since the previous observation. Observations older than the last one are ignored,
    so a snapshot read twice counts once. The first observation records the last start."""
    zone = ZoneInfo(tz)
    doc = store.doc(DOC)
    g = doc.get("gateway") or {}
    last = g.get("last") or {}
    if last and t <= last.get("t", 0):
        return 0
    boots = 0
    uptime = _num(gw.get("uptime"))
    boot = None if uptime is None else int(t - uptime)
    if boot is not None:
        prev = last.get("boot")
        if prev is None or boot > prev + BOOT_JUMP:
            stamp = datetime.fromtimestamp(boot, zone).strftime("%Y-%m-%dT%H:%M")
            known = list(g.get("boots") or [])
            if stamp not in known:
                known.append(stamp)
                store.put(DOC, "gateway", "boots", None, sorted(known)[-MAX_BOOTS:])
            boots = int(prev is not None)  # the first one is the start before monitoring began
    wifi = _num(gw.get("wifi_strength"))
    if wifi is not None:
        day = datetime.fromtimestamp(t, zone).date().isoformat()
        cell = (g.get("wifi") or {}).get(day)
        if cell and len(cell) == 4:
            lo, mean, hi, n = cell
            cell = [min(lo, wifi), round((mean * n + wifi) / (n + 1), 1), max(hi, wifi), n + 1]
        else:
            cell = [wifi, wifi, wifi, 1]
        store.put(DOC, "gateway", "wifi", None, {**(g.get("wifi") or {}), day: cell})
    if isinstance(gw.get("day_color"), str) and gw["day_color"] not in ("autre", ""):
        store.put(DOC, "tempo", tempo_day(t, zone), None, gw["day_color"])
    store.put(DOC, "gateway", "last", None, {"t": int(t), "boot": boot if boot is not None else last.get("boot")})
    return boots


def boots_since(store: Store, days: int, now: float, tz: str) -> int:
    """Restarts recorded over the last `days` days (the first, pre-monitoring start excluded
    is not distinguishable here: it is counted when it falls in the window)."""
    since = datetime.fromtimestamp(now - days * 86400, ZoneInfo(tz)).strftime("%Y-%m-%dT%H:%M")
    return sum(1 for b in (store.doc(DOC).get("gateway") or {}).get("boots") or [] if b >= since)


def _setup_day(v: object, zone: ZoneInfo) -> str | None:
    t = _num(v)
    if t is None or t < 1_000_000_000:
        return None
    return datetime.fromtimestamp(t, zone).date().isoformat()


def answering(m: dict, now: float) -> bool | None:
    """None when the module says nothing about its link; else whether it answers."""
    known = False
    ok = True
    if "reachable" in m:
        known = True
        ok = ok and m["reachable"] is not False
    cs = m.get("connection_status")
    if isinstance(cs, str):
        known = True
        ok = ok and norm(cs) not in DISCONNECTED
    seen = _num(m.get("last_seen"))
    if seen is not None and seen > 1_000_000_000:
        known = True
        ok = ok and now - seen <= SILENT_HOURS * 3600
    return ok if known else None


def since_day(reach: dict[str, int], day: str) -> str:
    """First day of the current run of "not answering" days ending on `day`."""
    start = day
    d = datetime.fromisoformat(day).date()
    while True:
        d -= timedelta(days=1)
        if reach.get(d.isoformat()) != 0:
            return start
        start = d.isoformat()


def collect_status(
    store: Store, homesdata: dict, homestatus: dict, tz: str, mod_room: dict[str, str], now: float | None = None
) -> dict:
    """Nightly read of `homestatus`: daily status, firmware and gateway. Returns counts only,
    plus `alerts`: lines for the optional public issue (module types and dates only)."""
    now = float(now if now is not None else datetime.now(UTC).timestamp())
    zone = ZoneInfo(tz)
    day = datetime.fromtimestamp(now, zone).date().isoformat()
    homes = homesdata.get("body", {}).get("homes", []) if isinstance(homesdata, dict) else []
    declared = {str(m["id"]): m for m in (homes[0].get("modules") or [] if homes else []) if isinstance(m, dict)}
    home = homestatus.get("body", {}).get("home", {}) if isinstance(homestatus, dict) else {}
    status = [m for m in (home.get("modules") or []) if isinstance(m, dict) and m.get("id") is not None]
    ids = sorted({*declared, *(str(m["id"]) for m in status)})
    keys = module_keys(store, ids)
    counts = {"modules": 0, "unreachable": 0, "firmware": 0, "boots": 0, "alerts": []}
    by_type: dict[str, list[str]] = {}
    for mid in ids:
        key = keys[mid]
        d = declared.get(mid, {})
        info = dict(store.doc(DOC).get("modules", {}).get(key) or {})
        kind = d.get("type") or info.get("type")
        if isinstance(kind, str) and norm(kind) != "autre":
            info["type"] = kind[:12]
        if mid in mod_room:
            info["room"] = mod_room[mid]
        setup = _setup_day(d.get("setup_date"), zone)
        if setup:
            info["setup"] = setup
        store.put(DOC, "modules", key, None, info)
    for m in status:
        mid = str(m["id"])
        key = keys[mid]
        counts["modules"] += 1
        kind = (store.doc(DOC)["modules"].get(key) or {}).get("type") or m.get("type")
        if note_firmware(store, key, m.get("firmware_revision"), day):
            counts["firmware"] += 1
        if is_gateway(m):
            counts["boots"] += observe_gateway(store, now, gateway_fields(m), tz)
        ok = answering(m, now)
        if ok is None:
            continue
        store.put(DOC, "reach", key, day, int(ok))
        if not ok:
            counts["unreachable"] += 1
            reach = store.doc(DOC)["reach"][key]
            by_type.setdefault(type_label(kind), []).append(since_day(reach, day))
    for label, starts in sorted(by_type.items()):
        n = len(starts)
        plural = "s" if n > 1 else ""
        counts["alerts"].append(f"{n} {label}{plural} injoignable{plural} depuis le {min(starts)}")
    return counts


# ---------------------------------------------------------------- rooms without readings (#346)
SILENT_DAYS = 2  # 48 h without a daily reading of a room while the others have theirs


def silent_rooms(store: Store, rooms: list[dict], today: str | None = None) -> list[str]:
    """#346: alert lines for the rooms whose radiator (or water heater) has sent no daily reading
    for SILENT_DAYS days or more while the other rooms have theirs: the module is out of reach,
    unplugged or removed, and the room would otherwise show 0 kWh. Module types and dates only
    (public issue), never a room name. `today`: the last day of the archive by default."""
    category = {str(r.get("id")): r.get("category") for r in rooms if isinstance(r, dict)}
    last: dict[str, str] = {}
    for y in store.years():
        for rid, days in store.year(y).items():
            if category.get(rid) in ("heating", "water_heater") and days:
                last[rid] = max(last.get(rid, ""), max(days))
    if len(last) < 2:
        return []
    ref = today or max(last.values())
    limit = (datetime.fromisoformat(ref).date() - timedelta(days=SILENT_DAYS)).isoformat()
    by_type: dict[str, list[str]] = {}
    for rid, day in last.items():
        if day <= limit:
            since = (datetime.fromisoformat(day).date() + timedelta(days=1)).isoformat()
            label = "chauffe-eau" if category[rid] == "water_heater" else "radiateur"
            by_type.setdefault(label, []).append(since)
    out = []
    for label, starts in sorted(by_type.items()):
        n = len(starts)
        plural = "s" if n > 1 else ""
        out.append(f"{n} {label}{plural} sans relevé de consommation depuis le {min(starts)} (48 h ou plus)")
    return out


# ---------------------------------------------------------------- tariff seen by Intuis (#278)
CONTRACT_FIELDS = ("tariff", "tariff_option", "price_type")


def _kva(v: object) -> float | None:
    n = _num(v)
    if n is not None:
        return n if 1 <= n <= 36 else None
    m = re.fullmatch(r"\s*(\d{1,2}(?:[.,]\d)?)\s*(?:kva|kw)?\s*", str(v or ""), re.IGNORECASE)
    return float(m.group(1).replace(",", ".")) if m else None


def intuis_contract(homesdata: dict) -> dict | None:
    """Tariff option and power that the Intuis app knows (homesdata), as short identifiers:
    {"tariff": "edf", "tariff_option": "peak_and_off_peak", "price_type": "...", "power_unit": "kva",
    "kva": 9}. Values of the selected schedule (else every schedule); several values are listed.
    None when Intuis says nothing. Field values à confirmer (inventory: names only)."""
    homes = homesdata.get("body", {}).get("homes", []) if isinstance(homesdata, dict) else []
    if not homes or not isinstance(homes[0], dict):
        return None
    h = homes[0]
    schedules = [s for s in h.get("schedules") or [] if isinstance(s, dict)]
    chosen = [s for s in schedules if s.get("selected")] or schedules
    out: dict = {}
    for field in CONTRACT_FIELDS:
        seen: set = set()
        for s in chosen:
            for z in s.get("zones") or []:
                if isinstance(z, dict) and z.get(field) is not None:
                    v = norm(z[field])
                    if v is not None and v != "autre":
                        seen.add(v)
            if s.get(field) is not None:
                seen.add(norm(s[field]))
        seen.discard(None)
        if seen:
            values = sorted(seen, key=str)[:4]
            out[field] = values[0] if len(values) == 1 else values
    unit = h.get("contract_power_unit")
    if unit is not None:
        out["power_unit"] = norm(unit)
        kva = _kva(unit)
        if kva is not None:
            out["kva"] = kva
    for k in ("contract_power", "subscribed_power"):
        kva = _kva(h.get(k))
        if kva is not None:
            out["kva"] = kva
    return out or None
