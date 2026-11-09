"""Turn raw API payloads into a small, stable data model."""

from __future__ import annotations

import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

HEATING = "heating"
WATER_HEATER = "water_heater"
IGNORE = "ignore"

# Words that identify the water-heater "room" in the app (accents stripped, lower case).
WATER_HEATER_WORDS = ("chauffe-eau", "chauffe eau", "ballon", "cumulus", "eau chaude", "water heater")
# Module types of water heaters (Intuis "Aqua Manager" = NMW). Their consumption is
# only reported at module level: the room that holds them returns nothing.
WATER_HEATER_MODULE_TYPES = {"NMW", "NWH"}


@dataclass
class Room:
    id: str
    name: str
    category: str
    module_types: list[str]
    # True for a water heater that sits in no room: its id is the module id, it is
    # never sent in the `rooms` list of a measure request.
    virtual: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Home:
    id: str
    name: str
    timezone: str
    bridge_id: str
    rooms: list[Room]
    latitude: float | None = None
    longitude: float | None = None
    # Water-heater module id -> id under which its consumption is stored (its room).
    water_heaters: dict[str, str] = field(default_factory=dict)

    def api_room_ids(self) -> list[str]:
        return [r.id for r in self.rooms if r.category != IGNORE and not r.virtual]


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return text.lower()


def classify_room(name: str, module_types: list[str], override: str | None = None) -> str:
    if override:
        return override
    n = _norm(name)
    if any(_norm(w) in n for w in WATER_HEATER_WORDS):
        return WATER_HEATER
    if module_types and all(t in WATER_HEATER_MODULE_TYPES for t in module_types):
        return WATER_HEATER
    return HEATING


def _coord(home: dict, index: int) -> float | None:
    """homesdata gives "coordinates": [longitude, latitude]."""
    c = home.get("coordinates")
    try:
        return float(c[index]) if c else None
    except (TypeError, ValueError, IndexError):
        return None


def parse_homes(payload: dict, overrides: dict[str, str] | None = None) -> list[Home]:
    overrides = overrides or {}
    homes = []
    for h in payload.get("body", {}).get("homes", []):
        modules = h.get("modules", [])
        bridge = next((m["id"] for m in modules if m.get("type") == "NMG"), None)
        if bridge is None:
            # Fall back to the first module that other modules point to.
            bridge = next((m.get("bridge") for m in modules if m.get("bridge")), "")
        types_by_module = {m["id"]: m.get("type", "") for m in modules}
        rooms = []
        for r in h.get("rooms", []):
            mtypes = sorted({types_by_module.get(mid, "") for mid in r.get("module_ids", [])} - {""})
            rooms.append(
                Room(
                    id=str(r["id"]),
                    name=r.get("name") or f"Pièce {r['id']}",
                    category=classify_room(r.get("name", ""), mtypes, overrides.get(str(r["id"]))),
                    module_types=mtypes,
                )
            )
        room_of_module = {mid: str(r["id"]) for r in h.get("rooms", []) for mid in r.get("module_ids", [])}
        water_heaters: dict[str, str] = {}
        for m in modules:
            if m.get("type") not in WATER_HEATER_MODULE_TYPES:
                continue
            storage = room_of_module.get(m["id"]) or (str(m["room_id"]) if m.get("room_id") else None)
            if storage is None or not any(r.id == storage for r in rooms):
                storage = m["id"]
                rooms.append(
                    Room(
                        id=storage,
                        name=m.get("name") or "Chauffe-eau",
                        category=overrides.get(storage, WATER_HEATER),
                        module_types=[m["type"]],
                        virtual=True,
                    )
                )
            water_heaters[m["id"]] = storage
        homes.append(
            Home(
                id=h["id"],
                name=h.get("name", "Maison"),
                timezone=h.get("timezone", "Europe/Paris"),
                bridge_id=bridge or "",
                rooms=rooms,
                water_heaters=water_heaters,
                latitude=_coord(h, 1),
                longitude=_coord(h, 0),
            )
        )
    return homes


Columns = list[float | None]


def parse_measure_columns(blocks: object, scale_seconds: int) -> list[tuple[int, Columns]]:
    """Parse Netatmo measures into [(timestamp, [value per requested type])].

    Two shapes exist: "optimized" blocks `[{beg_time, step_time, value: [[v], ...]}]`
    and plain `{"<timestamp>": [v, ...]}`. Points whose columns are all null are dropped.
    """
    raw: list[tuple[int, object]] = []
    if isinstance(blocks, dict):
        raw = [(int(ts), val) for ts, val in blocks.items()]
    elif isinstance(blocks, list):
        for block in blocks:
            beg = int(block.get("beg_time", 0))
            step = int(block.get("step_time", scale_seconds) or scale_seconds)
            raw += [(beg + i * step, val) for i, val in enumerate(block.get("value", []) or [])]
    points = []
    for ts, val in raw:
        cols = val if isinstance(val, list) else [val]
        parsed = [None if c is None else float(c) for c in cols]
        if any(c is not None for c in parsed):
            points.append((ts, parsed))
    return sorted(points, key=lambda p: p[0])


def total(cols: Columns) -> float:
    return sum(c for c in cols if c is not None)


def parse_measure_blocks(blocks: object, scale_seconds: int) -> list[tuple[int, float]]:
    """Like parse_measure_columns, with the columns summed (e.g. base + peak + off-peak)."""
    return [(ts, total(cols)) for ts, cols in parse_measure_columns(blocks, scale_seconds)]


def parse_room_measures(payload: dict, scale_seconds: int) -> dict[str, list[tuple[int, float]]]:
    """Return {room_id: [(timestamp, value), ...]} from a gethomemeasure response."""
    rooms = payload.get("body", {}).get("home", {}).get("rooms", [])
    return {str(r.get("id")): parse_measure_blocks(r.get("measures") or [], scale_seconds) for r in rooms}


def parse_module_measures(payload: dict, scale_seconds: int) -> dict[str, list[tuple[int, float]]]:
    """Same as parse_room_measures, for the `modules` part of a gethomemeasure response."""
    modules = payload.get("body", {}).get("home", {}).get("modules", []) or []
    return {str(m.get("id")): parse_measure_blocks(m.get("measures") or [], scale_seconds) for m in modules}


def parse_home_columns(payload: dict, scale_seconds: int, part: str) -> dict[str, list[tuple[int, Columns]]]:
    """Per-column points for `part` = "rooms" or "modules" of a gethomemeasure response."""
    items = payload.get("body", {}).get("home", {}).get(part, []) or []
    return {str(x.get("id")): parse_measure_columns(x.get("measures") or [], scale_seconds) for x in items}


def to_local_day(ts: int, tz: str) -> str:
    """Local calendar day a daily bucket belongs to.

    Daily buckets start around local midnight (sometimes reported an hour early or
    late around DST changes); shifting by 6 h lands safely inside the right day,
    and still works if the API ever reports buckets at noon.
    """
    return (datetime.fromtimestamp(ts, ZoneInfo(tz)) + timedelta(hours=6)).strftime("%Y-%m-%d")
