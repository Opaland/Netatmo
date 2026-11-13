"""Catch-up of the missing days (#569): case « rattrapage » of « Collecte quotidienne »
(`RATTRAPAGE=true`), after the nightly collection, in the same run and under the same call caps.

What the nightly collection does not ask again, and the catch-up does:
- Intuis (radiators, water heater): every room-day missing between the room's first day and the
  last day of the archive (same rule as the quality report, `quality.Report.missing`), asked at the
  day scale. The nightly collection only asks the last 35 days; the full history (« backfill »)
  asks everything but REWRITES present days and rebuilds the water heater from scratch.
- Netatmo station: the days missing between a module's first and last daily reading (the nightly
  collection resumes 10 days before its last one).
- Linky load curve: the days of the last 24 months without any half hour (the first night only
  went 12 months back, and days already asked are not asked again).

The rule, whatever the source: ADD ONLY. A day present in the archive (real, estimated, or with at
least one half hour) is neither asked nor rewritten; running the catch-up twice adds nothing the
second time. Each source is never fatal: a refusal, an error or the call cap stops that source,
keeps what was added, and is said in the log.

The log is public: per series and per month, the number of days asked and added. Never a value,
a room or module name, an id, nor a date finer than the month.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from .budget import METER, CallCapReached
from .errors import SourceError
from .schema import FormatError

log = logging.getLogger(__name__)


@dataclass
class Tally:
    """{series: {"YYYY-MM": [asked, added]}} and one note per series (refusal, cap, error).
    #581: `rooms` adds which room was asked which month ({series: {room id: {"YYYY-MM"}}}): the
    encrypted meta only (meta_doc), never the public log (public_lines)."""

    months: dict[str, dict[str, list[int]]] = field(default_factory=dict)
    notes: dict[str, str] = field(default_factory=dict)
    rooms: dict[str, dict[str, set[str]]] = field(default_factory=dict)

    def _cell(self, serie: str, day: str) -> list[int]:
        return self.months.setdefault(serie, {}).setdefault(day[:7], [0, 0])

    def asked(self, serie: str, day: str, room: str | None = None) -> None:
        self._cell(serie, day)[0] += 1
        if room is not None:
            self.rooms.setdefault(serie, {}).setdefault(room, set()).add(day[:7])

    def added(self, serie: str, day: str) -> None:
        self._cell(serie, day)[1] += 1

    def note(self, serie: str, text: str) -> None:
        self.notes[serie] = text

    def total_added(self) -> int:
        return sum(c[1] for months in self.months.values() for c in months.values())


def public_lines(tally: Tally) -> list[str]:
    """Counts only, per series and per month (« mois ajoutés/demandés »)."""
    lines = [
        "Rattrapage des jours manquants (#569) : jours ajoutés / demandés par série et par mois ;",
        "aucune valeur, aucun nom. Un jour déjà présent n'est ni redemandé ni réécrit.",
    ]
    series = [s for s in LABELS if s in tally.months or s in tally.notes]
    if not series:
        lines.append("  Rien à rattraper : aucun jour manquant dans les séries suivies.")
    for serie in series:
        months = tally.months.get(serie, {})
        asked = sum(c[0] for c in months.values())
        added = sum(c[1] for c in months.values())
        detail = ", ".join(f"{m} {c[1]}/{c[0]}" for m, c in sorted(months.items()))
        line = f"  {LABELS[serie]} : {added} ajoutés sur {asked} demandés" + (f" ({detail})" if detail else "")
        if serie in tally.notes:
            line += f" ; {tally.notes[serie]}"
        lines.append(line)
    return lines


def meta_doc(previous: object, tally: Tally, day: str) -> dict:
    """meta["catch_up"] (encrypted meta, read by État des données): {"at": {series: day of its last
    catch-up}, "months": {series: {"YYYY-MM": [asked, added]}}}. A month asked again replaces its
    counts (the days still missing then were asked that day, and the source gave nothing); the
    other months are kept. A series stopped on the way (cap, error, refusal: it has a note) is left
    as it was. Counts and months only, like the log.

    #581: and "rooms": {series: {room id: {"YYYY-MM": day it was asked}}}, the rooms the catch-up
    really asked (Intuis: only those it still lists), so that a room NOT asked never inherits the
    « redemandé » of another room of the same month. Room ids stay in this encrypted meta; the key
    is left out while no room was ever asked (a meta written before #581 has none: the app then
    says « redemandé » of no single room)."""
    prev = previous if isinstance(previous, dict) else {}
    at = {k: v for k, v in (prev.get("at") or {}).items() if k in LABELS and isinstance(v, str)}
    months = {k: dict(v) for k, v in (prev.get("months") or {}).items() if k in LABELS and isinstance(v, dict)}
    rooms = {
        k: {rid: dict(ms) for rid, ms in v.items() if isinstance(rid, str) and isinstance(ms, dict)}
        for k, v in (prev.get("rooms") or {}).items()
        if k in LABELS and isinstance(v, dict)
    }
    for serie, cells in tally.months.items():
        if serie in tally.notes:  # #569 B1: an interrupted series writes neither its months nor its day
            continue
        asked = {m: list(c) for m, c in cells.items() if c[0]}
        if asked:
            months.setdefault(serie, {}).update(asked)
            at[serie] = day
        for rid, ms in tally.rooms.get(serie, {}).items():
            rooms.setdefault(serie, {}).setdefault(rid, {}).update({m: day for m in ms})
    doc = {"at": at, "months": months}
    if rooms:
        doc["rooms"] = rooms
    return doc


ERRORS = (SourceError, httpx.HTTPError, FormatError)
# Series of the tally (the keys of meta["catch_up"], read by the app: web/src/data-quality.ts) and
# their name in the public log. Intuis: room-days of the heating rooms, days of the water heater.
LABELS = {
    "heating": "chauffage (pièces-jours)",
    "water": "chauffe-eau (jours)",
    "station": "station (jours par module)",
    "linky30": "Linky à la demi-heure (jours)",
}


def _guard(tally: Tally, series: tuple[str, ...], source: str, step) -> None:
    """Run one source's catch-up; never fatal (the night's data must be committed anyway). A stop
    is noted on every series of the source, which then keeps its previous meta (meta_doc)."""

    def note(text: str) -> None:
        for serie in series:
            tally.note(serie, text)

    if source in METER.capped:
        note("plafond d'appels déjà atteint par la collecte : relancer le rattrapage")
        return
    try:
        step()
    except CallCapReached:
        note("plafond d'appels atteint : relancer le rattrapage pour continuer")
    except ERRORS as err:
        # S-1.16: the type only, never the message (it may quote a URL holding the PRM)
        note(f"interrompu ({type(err).__name__})")


def run(
    store,
    syncer,
    home,
    stopped: list[dict],
    station=None,
    linky: tuple[str, str] | None = None,
    today: str | None = None,
) -> Tally:
    """The catch-up of every configured source. `station` is the logged-in Station client of the
    night (None when not configured or failing), `linky` the (token, PRM) pair (None without)."""
    from .enedis import CURVE_SERIE, catch_up_curve
    from .model import IGNORE
    from .quality import Report
    from .station import STATION_SERIE

    tally = Tally()
    today = today or datetime.now(ZoneInfo(home.timezone)).date().isoformat()

    def intuis() -> None:
        report = Report(store, stopped)
        # #569 B2: only the rooms Intuis still lists are asked (a room taken down keeps its history,
        # keep_gone_rooms, but nothing can be asked for it); M6: never the day still being measured
        listed = {r.id for r in home.rooms if r.category != IGNORE}
        missing = {rid: {d for d in days if d < today} for rid, days in report.missing.items() if rid in listed}
        syncer.catch_up(home, missing, report.kind, tally)

    _guard(tally, ("heating", "water"), "intuis", intuis)
    if station is not None and station.access:
        _guard(tally, (STATION_SERIE,), "netatmo", lambda: station.catch_up(home.timezone, tally))
    if linky and store.first_day():
        token, prm = linky
        _guard(
            tally,
            (CURVE_SERIE,),
            "linky",
            lambda: catch_up_curve(store, token, prm, store.first_day(), home.timezone, tally),
        )
    log.info("Rattrapage : %d jours ajoutés", tally.total_added())
    return tally
