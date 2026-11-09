"""Per-room energy (HP / HC), temperature and setpoint every 30 minutes (S-1.26, #224, #217).

Intuis serves `sum_energy_elec$1/$2` and `temperature` / `sp_temperature` per room at the 30-min
scale with at least four years of history (docs/audit-donnees.md § 6). They are kept in one
encrypted document per year, YYYY.room30.enc.json:

    {"rooms": {room: {"YYYY-MM-DD": [hp, hc, temp, setpoint]}}}

Each of the four columns holds the 48 half hours of the LOCAL day (index = 2 × hour + minute / 30,
the key of the half hour's start, like YYYY.linky30), compacted:
  - null:        no value that day;
  - a number:    the same value for the 48 half hours (a day without heating: 0; a constant setpoint);
  - a list of 48: one value per half hour, null where missing.
Energy in Wh (rounded to the unit), temperatures in °C (one decimal). Daylight saving time is
handled like the Linky curve: on the spring change 02:00 and 02:30 stay null; on the autumn change
the two 02:00 (and 02:30) are merged, energy added, temperatures averaged. The base energy ($0) and,
on older periods, the families without tariff split are counted with HP: they have no off-peak.

The history is fetched progressively, newest first, in windows of whole local days (21 days =
1 008 points, under the 1 024 points of one request), a few windows per night within a call budget
of its own (MAX_CALLS_INTUIS_30MIN), always below the Intuis cap of the collection (#109). The
progress is kept per room in room30.enc.json: {"newest": day refreshed last, "progress": {room:
{"to": oldest day fetched, "empty": consecutive empty windows, "done": bool}}}. A room is done after
two empty windows in a row or at MAX_DAYS. Logs hold counters only.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .api import ApiError
from .budget import METER
from .model import IGNORE, Columns, Home
from .storage import Store

log = logging.getLogger(__name__)

SLOTS = 48
WINDOW_DAYS = 21  # 21 × 48 = 1 008 points (+2 on the autumn change) ≤ the 1 024 of one request
MAX_DAYS = 1830  # nothing older is served (≥ 1 460 days, nothing at 1 825: docs/audit-donnees.md § 6)
REFRESH_DAYS = 2  # every night, the last days again (values arrive late)
EMPTY_STOP = 2  # consecutive empty windows before a room's history is considered complete
DEFAULT_CALLS = 50  # per nightly collection (≈ 3 nights for the 4 years of a 7-room home)
BACKFILL_CALLS = 200  # during a full backfill (the Intuis cap is 3 000 then)
RESERVE = 10  # Intuis calls always left to the rest of the collection
# Size watch: a year of a 7-room home is ≈ 1.5 MB encrypted. Past this, a warning (counters only).
DOC_BUDGET_BYTES = 4_000_000

ENERGY = "sum_energy_elec$0,sum_energy_elec$1,sum_energy_elec$2"
LEGACY_ENERGY = "sum_energy_elec,sum_energy_elec_heating,sum_energy_elec_hot_water"
TEMPS = "temperature,sp_temperature"

PROGRESS = "room30"

# (endpoint, measure types, home, begin, end, rooms, with_modules) -> {room: [(ts, columns)]}
Fetch = Callable[..., dict[str, list[tuple[int, Columns]]]]


def doc_name(year: int | str) -> str:
    return f"{year}.room30"


def env_calls(backfill: bool = False) -> int:
    raw = os.environ.get("MAX_CALLS_INTUIS_30MIN", "").strip()
    return int(raw) if raw.isdigit() else BACKFILL_CALLS if backfill else DEFAULT_CALLS


# ---------------------------------------------------------------- compact day columns
def _num(v: float, digits: int) -> float | int:
    r = round(v, digits)
    return int(r) if r == int(r) else r


def pack(col: list[float | None]) -> float | int | list | None:
    """48 values -> null (all missing), one number (all equal) or the list."""
    if all(v is None for v in col):
        return None
    if None not in col and len(set(col)) == 1:
        return col[0]
    return col


def unpack(cell: object) -> list[float | None]:
    if cell is None:
        return [None] * SLOTS
    if isinstance(cell, list):
        return (list(cell) + [None] * SLOTS)[:SLOTS]
    return [cell] * SLOTS  # type: ignore[list-item]


def slot_of(ts: int, tz: ZoneInfo) -> tuple[str, int]:
    """(local day, half-hour index) of the half hour starting at `ts`."""
    t = datetime.fromtimestamp(ts, tz)
    return t.strftime("%Y-%m-%d"), t.hour * 2 + t.minute // 30


def to_days(
    energy: list[tuple[int, Columns]],
    temps: list[tuple[int, Columns]],
    tz: ZoneInfo,
    legacy: bool = False,
) -> dict[str, list[list[float | None]]]:
    """Points of one room -> {day: [hp[48], hc[48], temp[48], setpoint[48]]} (rounded).

    The repeated local half hours of the autumn change: energy added, temperatures averaged."""
    acc: dict[str, list[list[float | None]]] = {}
    count: dict[tuple[str, int, int], int] = {}

    def cell(day: str) -> list[list[float | None]]:
        return acc.setdefault(day, [[None] * SLOTS for _ in range(4)])

    for ts, c in energy:
        day, i = slot_of(ts, tz)
        cols = (list(c) + [None, None, None])[:3]
        if legacy:  # several families describe the same energy: the largest one
            vals = [v for v in cols if v is not None]
            hp, hc = (max(vals) if vals else None), None
        else:
            base = [v for v in (cols[0], cols[1]) if v is not None]
            hp, hc = (sum(base) if base else None), cols[2]
        if hp is None and hc is None:
            continue
        d = cell(day)
        for k, v in ((0, hp), (1, hc)):
            if v is not None:
                d[k][i] = (d[k][i] or 0.0) + v
    for ts, c in temps:
        day, i = slot_of(ts, tz)
        for k, v in zip((2, 3), (list(c) + [None, None])[:2], strict=True):
            if v is None:
                continue
            d = cell(day)
            n = count.get((day, i, k), 0)
            d[k][i] = v if not n else ((d[k][i] or 0.0) * n + v) / (n + 1)
            count[(day, i, k)] = n + 1
    for cols in acc.values():
        for i in range(SLOTS):  # a half hour measured in one tariff is 0 in the other (not missing)
            if cols[0][i] is not None or cols[1][i] is not None:
                cols[0][i], cols[1][i] = cols[0][i] or 0.0, cols[1][i] or 0.0
        for k, col in enumerate(cols):
            digits = 0 if k < 2 else 1
            cols[k] = [None if v is None else _num(v, digits) for v in col]
    return acc


def to_days_from_columns(*cols: list[float | None]) -> list[list[float | None]]:
    """[hp, hc, temp, setpoint] of one day, rounded like the collected ones (demo, tests)."""
    return [[None if v is None else _num(v, 0 if k < 2 else 1) for v in col] for k, col in enumerate(cols)]


def merge_day(store: Store, room: str, day: str, cols: list[list[float | None]]) -> bool:
    """Write the half hours received over the stored ones (a refetch overwrites, never adds)."""
    name = doc_name(day[:4])
    old = store.doc(name).get("rooms", {}).get(room, {}).get(day)
    cur = [unpack(c) for c in (old or [None] * 4)]
    for k in range(4):
        for i, v in enumerate(cols[k]):
            if v is not None:
                cur[k][i] = v
    packed = [pack(c) for c in cur]
    if all(p is None for p in packed):
        return False
    store.put(name, "rooms", room, day, packed)
    return True


# ---------------------------------------------------------------- collection
@dataclass
class Stats:
    calls: int = 0
    room_days: int = 0
    windows: int = 0
    rooms: int = 0
    rooms_done: int = 0
    oldest: str | None = None
    stopped: bool = False  # budget exhausted before the end
    years: set[str] = field(default_factory=set)


def _midnight(day: date, tz: ZoneInfo) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=tz).timestamp())


class Collector:
    def __init__(self, store: Store, home: Home, fetch: Fetch, endpoint: str, max_calls: int) -> None:
        self.store = store
        self.home = home
        self.fetch = fetch
        self.endpoint = endpoint
        self.tz = ZoneInfo(home.timezone)
        self.max_calls = max_calls
        self.stats = Stats()
        self._meter0 = METER.calls.get("intuis", 0)

    # ------------------------------------------------------------ budget
    def _used(self) -> int:
        return max(self.stats.calls, METER.calls.get("intuis", 0) - self._meter0)

    def _left(self) -> int:
        left = self.max_calls - self._used()
        cap = METER.caps.get("intuis")
        if cap is not None:
            left = min(left, cap - self._meter0 - self._used() - RESERVE)
        return left

    def _cost(self, rooms: list[str]) -> int:
        """Requests of one window (energy + temperatures, one more for the older energy families)."""
        per_type = 1 if self.endpoint == "home" else len(rooms)
        return 3 * per_type

    # ------------------------------------------------------------ one window
    def _call(self, mtype: str, begin: int, end: int, rooms: list[str], modules: bool) -> dict:
        self.stats.calls += 1 if self.endpoint == "home" else len(rooms)
        try:
            return self.fetch(
                self.endpoint, mtype, self.home, begin, end, "30min", rooms=set(rooms), with_modules=modules
            )
        except ApiError as err:
            log.info("30 min : %s indisponible (%s)", "énergie" if "energy" in mtype else "températures", err)
            return {}

    def window(self, d0: date, d1: date, rooms: list[str], legacy_ok: bool) -> set[str]:
        """Fetch the local days [d0, d1) for `rooms`; returns the rooms that received something."""
        begin, end = _midnight(d0, self.tz), _midnight(d1, self.tz) - 1
        energy = self._call(ENERGY, begin, end, rooms, True)
        legacy = False
        if legacy_ok and not any(any(v for v in c if v) for pts in energy.values() for _ts, c in pts):
            older = self._call(LEGACY_ENERGY, begin, end, rooms, True)
            if any(any(v for v in c if v) for pts in older.values() for _ts, c in pts):
                energy, legacy = older, True
        temps = self._call(TEMPS, begin, end, rooms, False)
        self.stats.windows += 1
        got: set[str] = set()
        first, last = d0.isoformat(), (d1 - timedelta(days=1)).isoformat()
        for rid in rooms:
            days = to_days(energy.get(rid, []), temps.get(rid, []), self.tz, legacy)
            for day, cols in days.items():
                if first <= day <= last and merge_day(self.store, rid, day, cols):
                    self.stats.room_days += 1
                    self.stats.years.add(day[:4])
                    got.add(rid)
        return got

    # ------------------------------------------------------------ the night
    def run(self, today: date) -> Stats:
        rooms = [r.id for r in self.home.rooms if r.category != IGNORE]
        state = self.store.doc(PROGRESS)
        progress: dict[str, dict] = {k: dict(v) for k, v in state.get("progress", {}).items()}
        floor = today - timedelta(days=MAX_DAYS)
        # 1. the last days again (and the nights missed since the last run)
        newest = state.get("newest")
        start = today - timedelta(days=REFRESH_DAYS)
        if newest:
            start = max(floor, min(start, date.fromisoformat(newest) - timedelta(days=1)))
        d = start
        refreshed = True
        while d <= today and rooms:
            d1 = min(d + timedelta(days=WINDOW_DAYS), today + timedelta(days=1))
            if self._left() < self._cost(rooms):
                refreshed = False
                break
            self.window(d, d1, rooms, legacy_ok=False)
            self.store.set_top(PROGRESS, "newest", (d1 - timedelta(days=1)).isoformat())
            d = d1
        # 2. the history, newest first, a window at a time
        if refreshed:
            for rid in rooms:
                progress.setdefault(rid, {"to": start.isoformat(), "empty": 0, "done": False})
        while refreshed:
            pending = {rid: p for rid, p in progress.items() if rid in rooms and not p.get("done")}
            if not pending:
                break
            d1 = max(date.fromisoformat(p["to"]) for p in pending.values())
            d0 = max(floor, d1 - timedelta(days=WINDOW_DAYS))
            group = sorted(rid for rid, p in pending.items() if date.fromisoformat(p["to"]) > d0)
            if self._left() < self._cost(group):
                self.stats.stopped = True
                break
            got = self.window(d0, d1, group, legacy_ok=True)
            for rid in group:
                p = progress[rid]
                p["to"] = d0.isoformat()
                p["empty"] = 0 if rid in got else int(p.get("empty", 0)) + 1
                p["done"] = p["empty"] >= EMPTY_STOP or d0 <= floor
            self.store.set_top(PROGRESS, "progress", {k: dict(v) for k, v in progress.items()})
        active = [progress[r] for r in rooms if r in progress]
        self.stats.rooms = len(rooms)
        self.stats.rooms_done = sum(1 for p in active if p.get("done"))
        self.stats.oldest = min((p["to"] for p in active), default=None)
        return self.stats


def size_check(store: Store, years: set[str]) -> list[str]:
    """Years whose document exceeds DOC_BUDGET_BYTES once encrypted (estimated: base64 of the JSON)."""
    big = []
    for y in sorted(years):
        raw = len(json.dumps(store.doc(doc_name(y)), separators=(",", ":")).encode())
        if raw * 4 // 3 > DOC_BUDGET_BYTES:
            big.append(y)
    return big


def collect(store: Store, home: Home, fetch: Fetch, endpoint: str, today: date, max_calls: int) -> Stats:
    """One night of 30-min collection. Best effort: an API error skips a window, never the night."""
    stats = Collector(store, home, fetch, endpoint, max_calls).run(today)
    log.info(
        "30 min : %d jours-pièces, %d fenêtres, %d appels ; historique complet pour %d pièce(s) sur %d%s",
        stats.room_days,
        stats.windows,
        stats.calls,
        stats.rooms_done,
        stats.rooms,
        " (reprise à la prochaine collecte)" if stats.stopped else "",
    )
    for y in size_check(store, stats.years):
        log.warning("30 min : le document %s dépasse %d Mo, à surveiller", y, DOC_BUDGET_BYTES // 1_000_000)
    return stats
