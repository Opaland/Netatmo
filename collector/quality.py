"""Data-quality report of the encrypted archive (S-1.32, #336): `python -m collector diagnose --qualite`.

Printed in the log of a PUBLIC repository, so COUNTS ONLY: per year and per month, how many days
(or half hours, hours) each source holds, is missing or looks wrong. Never an energy value, a
temperature, a room or module name, an id, nor a date finer than the month.

Per month:
- heating: room-days (heating rooms added up) real / estimated (spread from a monthly total) /
  missing (between the room's first day and the last day of the archive, like `coverage`) /
  suspect (a real value that cannot be: negative, not a number or above SUSPECT_WH a day) /
  stopped (a room switched off on purpose, #346 / #440, from its declared day: not missing);
  number of heating rooms with at least one day. The rule of a room-day is the app's
  (web/src/data-quality.ts `roomDays`): both test suites read web/src/__fixtures__/quality-rule.json;
- water heater: the same room-days for the water-heater rooms;
- Linky daily: days present / missing between the first and the last day of the series;
- Linky 30 min, rooms 30 min, hourly snapshots: % of the half hours (hours) present between the
  first and the last day of the series (per room for the rooms);
- station: days per module key (m0, m1…), out of the days since the module's first day;
- cross-check with Linky (whole-home meter, Intuis is a part of it): days where the Intuis real
  values already exceed Linky (impossible), days where Linky has a value and Intuis none.
Per year: the longest gap of each series and the month it starts in.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable
from datetime import date, timedelta

from .devices import StoppedError, parse_stopped, stopped_on
from .model import IGNORE, WATER_HEATER
from .room30 import SLOTS, unpack
from .storage import Store, own_year_first

SUSPECT_WH = 80_000  # a room using more than 80 kWh in a day (3.3 kW for 24 h) is not credible
# Intuis above Linky by more than this is impossible (Intuis counts a part of what the meter sees).
CROSS_RATIO, CROSS_MARGIN_WH = 1.10, 500


def _day(s: str) -> date:
    return date.fromisoformat(s[:10])


def _days(first: date, last: date) -> Iterable[date]:
    d = first
    while d <= last:
        yield d
        d += timedelta(days=1)


def _range_per_month(first: str | None, last: str | None) -> dict[str, int]:
    """{"YYYY-MM": days of the month between first and last (included)}."""
    out: dict[str, int] = {}
    if not first or not last or first > last:
        return out
    for d in _days(_day(first), _day(last)):
        key = d.isoformat()[:7]
        out[key] = out.get(key, 0) + 1
    return out


def _valid(v: object) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v) and 0 <= v <= SUSPECT_WH


REAL, ESTIMATED, MISSING, SUSPECT, STOPPED = range(5)


def room_days(
    values: dict[str, dict[str, object]],
    estimated: dict[str, set[str]],
    kinds: dict[str, str],
    stopped: list[dict],
    last: str,
) -> dict[str, dict[str, list[int]]]:
    """{"YYYY-MM": {kind: [real, estimated, missing, suspect, stopped]}}: every room-day from the
    room's first value to `last`: estimated (flagged), else real (a value; suspect too when it
    cannot be), else stopped (switched off on purpose from that day), else missing. Same rule as
    the app (web/src/data-quality.ts `roomDays`)."""
    out: dict[str, dict[str, list[int]]] = {}
    for rid, days in values.items():
        if rid not in kinds or not days:
            continue
        est = estimated.get(rid, set())
        for d in _days(_day(min(days)), _day(last)):
            key = d.isoformat()
            cell = out.setdefault(key[:7], {}).setdefault(kinds[rid], [0, 0, 0, 0, 0])
            if key in est:
                cell[ESTIMATED] += 1
            elif key in days:
                cell[REAL] += 1
                if not _valid(days[key]):
                    cell[SUSPECT] += 1
            elif stopped_on(stopped, rid, key):
                cell[STOPPED] += 1
            else:
                cell[MISSING] += 1
    return out


def stopped_of(store: Store, env: str | None = None) -> list[dict]:
    """#346 / #440: the rooms switched off on purpose: STOPPED_ROOMS_JSON when given (the secret
    of the repository, #459), else the list the last collection saved in the archive. [] when invalid."""
    raw = env if env is not None and env.strip() else json.dumps(store.meta.get("stopped_rooms") or [])
    try:
        return parse_stopped(raw)
    except StoppedError:
        return []


def _longest(missing: Iterable[date]) -> dict[int, tuple[int, str]]:
    """Runs of consecutive missing days → {year of the start: (longest length, "YYYY-MM" of its start)}."""
    out: dict[int, tuple[int, str]] = {}
    start: date | None = None
    prev: date | None = None
    n = 0

    def close() -> None:
        if start is not None and n > out.get(start.year, (0, ""))[0]:
            out[start.year] = (n, start.isoformat()[:7])

    for d in sorted(missing):
        if prev is not None and d == prev + timedelta(days=1):
            n += 1
        else:
            close()
            start, n = d, 1
        prev = d
    close()
    return out


def _pct(got: int, expected: int) -> str:
    return "—" if not expected else f"{min(100, round(100 * got / expected))} %"


class Report:
    """All the counts, computed once from the store (nothing is written back)."""

    def __init__(self, store: Store, stopped: list[dict] | None = None) -> None:
        self.store = store
        self.stopped = stopped_of(store) if stopped is None else stopped
        cats = {str(r.get("id")): r.get("category") for r in store.meta.get("rooms", []) if isinstance(r, dict)}
        years = store.years()
        daily = {y: store.year(y) for y in years}
        estimated = {y: store.doc(str(y)).get("estimated", {}) for y in years}
        self.kind: dict[str, str] = {}  # room -> "heating" | "water"
        firsts: dict[str, str] = {}
        for days in daily.values():
            for rid, d in days.items():
                cat = cats.get(rid, "heating")
                if cat == IGNORE or not d:
                    continue
                self.kind[rid] = "water" if cat == WATER_HEATER else "heating"
                firsts[rid] = min(firsts.get(rid, "9999"), min(d))
        self.first, self.last = (min(firsts.values()), store.last_day()) if firsts else (None, None)

        # month -> [real, estimated, missing, suspect, stopped] per kind, rooms with data (heating)
        # #532: a day in two year files is read once (the file of its own year), as in the app
        values = {
            rid: days
            for rid, days in own_year_first([(y, {"daily": daily[y]}) for y in years], "daily").items()
            if rid in self.kind
        }
        flagged: dict[str, set[str]] = {}
        for y in years:
            for rid, days in estimated[y].items():
                if rid in self.kind and isinstance(days, dict):
                    flagged.setdefault(rid, set()).update(days)
        self.cells = room_days(values, flagged, self.kind, self.stopped, self.last) if self.last else {}
        self.rooms_with_data: dict[str, int] = {}
        self.real_wh: dict[str, float] = {}  # day -> Intuis real Wh (cross-check, never printed)
        self.intuis_days: set[str] = set()  # days with at least one Intuis value
        self.room_missing: set[str] = set()  # days where at least one room is missing (not stopped)
        for rid, days in values.items():
            months = {d[:7] for d in days}
            for m in months:
                if self.kind[rid] == "heating":
                    self.rooms_with_data[m] = self.rooms_with_data.get(m, 0) + 1
            est = flagged.get(rid, set())
            for day, v in days.items():
                self.intuis_days.add(day)
                if day not in est and _valid(v):
                    self.real_wh[day] = self.real_wh.get(day, 0.0) + float(v)
            if self.last:
                self.room_missing |= {
                    d.isoformat()
                    for d in _days(_day(min(days)), _day(self.last))
                    if d.isoformat() not in days
                    and d.isoformat() not in est
                    and not stopped_on(self.stopped, rid, d.isoformat())
                }

        linky = store.doc("linky").get("daily", {}) or {}
        self.linky = {d: v for d, v in linky.items() if isinstance(d, str) and len(d) == 10}
        self.linky_range = _range_per_month(min(self.linky, default=None), max(self.linky, default=None))
        self.linky_present: dict[str, int] = {}
        for d in self.linky:
            self.linky_present[d[:7]] = self.linky_present.get(d[:7], 0) + 1

        self.curve_got, self.curve_expected = self._linky30()
        self.room30_got, self.room30_expected = self._room30()
        self.seen_got, self.seen_expected = self._snapshots()
        self.station, self.station_expected = self._station()
        self.impossible, self.linky_only = self._cross()

    # ----------------------------------------------------------- per source
    def _linky30(self) -> tuple[dict[str, int], dict[str, int]]:
        got: dict[str, int] = {}
        keys: list[str] = []
        for y in self.store.linky_curve_years():
            for k in self.store.doc(f"{y}.linky30").get("curve", {}) or {}:
                keys.append(k)
                got[k[:7]] = got.get(k[:7], 0) + 1
        span = _range_per_month(min(keys, default=None), max(keys, default=None))
        return got, {m: SLOTS * n for m, n in span.items()}

    def _room30(self) -> tuple[dict[str, int], dict[str, int]]:
        got: dict[str, int] = {}
        firsts: dict[str, str] = {}
        last = ""
        for y in self.store.room30_years():
            for rid, days in (self.store.doc(f"{y}.room30").get("rooms", {}) or {}).items():
                if not days or self.kind.get(rid, "heating") not in ("heating", "water"):
                    continue
                for day, cols in days.items():
                    cols = cols if isinstance(cols, list) else []
                    columns = [unpack(c) for c in cols]
                    n = sum(1 for i in range(SLOTS) if any(c[i] is not None for c in columns))
                    if n:
                        got[day[:7]] = got.get(day[:7], 0) + n
                        firsts[rid] = min(firsts.get(rid, "9999"), day)
                        last = max(last, day)
        expected: dict[str, int] = {}
        for first in firsts.values():
            for m, n in _range_per_month(first, last).items():
                expected[m] = expected.get(m, 0) + SLOTS * n
        return got, expected

    def _snapshots(self) -> tuple[dict[str, int], dict[str, int]]:
        seen = self.store.doc("roomstate").get("seen", {}) or {}
        got: dict[str, int] = {}
        for day, mask in seen.items():
            if isinstance(mask, int):
                got[day[:7]] = got.get(day[:7], 0) + bin(mask).count("1")
        span = _range_per_month(min(seen, default=None), max(seen, default=None))
        return got, {m: 24 * n for m, n in span.items()}

    def _station(self) -> tuple[dict[str, dict[str, int]], dict[str, dict[str, int]]]:
        daily = self.store.doc("station").get("daily", {}) or {}
        last = max((d for days in daily.values() for d in days), default=None)
        got: dict[str, dict[str, int]] = {}
        expected: dict[str, dict[str, int]] = {}
        for i, (raw_key, days) in enumerate(sorted(daily.items())):
            if not days:
                continue
            key = raw_key if re.fullmatch(r"m\d{1,3}", str(raw_key)) else f"autre{i}"  # never an id
            for d in days:
                got.setdefault(d[:7], {})[key] = got.get(d[:7], {}).get(key, 0) + 1
            for m, n in _range_per_month(min(days), last).items():
                expected.setdefault(m, {})[key] = n
        return got, expected

    def _cross(self) -> tuple[dict[str, int], dict[str, int]]:
        impossible: dict[str, int] = {}
        linky_only: dict[str, int] = {}
        for day, v in self.linky.items():
            if not _valid_meter(v):
                continue
            intuis = self.real_wh.get(day)
            if intuis is not None and above_meter(intuis, float(v)):
                impossible[day[:7]] = impossible.get(day[:7], 0) + 1
            in_range = self.first is not None and self.last is not None and self.first <= day <= self.last
            if in_range and day not in self.intuis_days:
                linky_only[day[:7]] = linky_only.get(day[:7], 0) + 1
        return impossible, linky_only

    # ----------------------------------------------------------- output
    def months(self) -> list[str]:
        out = set(self.cells) | set(self.linky_range) | set(self.curve_expected) | set(self.room30_expected)
        out |= set(self.seen_expected) | set(self.station_expected)
        return sorted(out)

    def gaps(self) -> dict[str, dict[int, tuple[int, str]]]:
        all_missing: list[date] = []
        if self.first and self.last:
            all_missing = [d for d in _days(_day(self.first), _day(self.last)) if d.isoformat() not in self.intuis_days]
        linky_missing: list[date] = []
        if self.linky:
            lo, hi = _day(min(self.linky)), _day(max(self.linky))
            linky_missing = [d for d in _days(lo, hi) if d.isoformat() not in self.linky]
        station_missing: list[date] = []
        daily = self.store.doc("station").get("daily", {}) or {}
        any_station = {d for days in daily.values() for d in days}
        if any_station:
            lo, hi = _day(min(any_station)), _day(max(any_station))
            station_missing = [d for d in _days(lo, hi) if d.isoformat() not in any_station]
        return {
            "Intuis, toutes les pièces": _longest(all_missing),
            "Intuis, au moins une pièce": _longest(_day(d) for d in self.room_missing),
            "Linky jour": _longest(linky_missing),
            "station (tous modules)": _longest(station_missing),
        }

    def lines(self) -> list[str]:
        heating = sum(1 for k in self.kind.values() if k == "heating")
        water = len(self.kind) - heating
        modules = sorted({k for m in self.station_expected.values() for k in m}, key=_module_order)
        out = [
            "Bilan qualité des données (S-1.32) : nombres seulement, aucune valeur, aucun nom.",
            f"Pièces suivies : {heating} chauffage, {water} chauffe-eau ; modules de la station : {len(modules)}.",
            "Colonnes : chauffage en pièces-jours (réels / estimés / manquants / suspects / arrêtés) et pièces ayant",
            "des données ; chauffe-eau en jours (réels / estimés / manquants) ; Linky jour (présents / manquants) ;",
            "couverture des demi-heures Linky et des pièces (30 min) et du relevé horaire ; recoupement :",
            "jours où Intuis dépasse Linky (impossible) / jours avec Linky sans Intuis ; station : jours par module.",
            "Un jour suspect (valeur impossible) est aussi compté dans les réels ; un jour arrêté (pièce",
            "arrêtée volontairement, ⚙ Mon logement) n'est pas un manque. Même règle que l'écran État des données.",
            f"Pièces arrêtées volontairement : {len(self.stopped)}.",
        ]
        if not self.months():
            out.append("Archive vide : aucune donnée à évaluer.")
            return out
        header = (
            f"{'mois':<8} {'chauffage r/e/m/s/a':>21} {'pièces':>6} {'chauffe-eau':>12} {'Linky j':>9}"
            f" {'Linky 30':>8} {'pièces 30':>9} {'relevé h':>8} {'I>L/L-I':>8}  station"
        )
        gaps = self.gaps()
        for year in sorted({int(m[:4]) for m in self.months()}):
            out += ["", f"== {year} ==", header]
            for m in (x for x in self.months() if x.startswith(f"{year}-")):
                out.append(self._row(m, modules))
            out.append(f"Total {year} : " + self._year_total(year))
            for label, per_year in gaps.items():
                n, start = per_year.get(year, (0, ""))
                out.append(f"  plus long trou ({label}) : " + (f"{n} j, à partir de {start}" if n else "aucun"))
        return out

    def _row(self, m: str, modules: list[str]) -> str:
        h = self.cells.get(m, {}).get("heating")
        w = self.cells.get(m, {}).get("water")
        heat = "/".join(map(str, h)) if h else "—"
        water = "/".join(map(str, w[:3])) if w else "—"
        if w and w[SUSPECT]:
            water += f" s{w[SUSPECT]}"
        if w and w[STOPPED]:
            water += f" a{w[STOPPED]}"
        lk = (
            f"{self.linky_present.get(m, 0)}/{self.linky_range[m] - self.linky_present.get(m, 0)}"
            if m in self.linky_range
            else "—"
        )
        cross = f"{self.impossible.get(m, 0)}/{self.linky_only.get(m, 0)}" if m in self.linky_range else "—"
        exp = self.station_expected.get(m, {})
        got = self.station.get(m, {})
        station = " ".join(f"{k} {got.get(k, 0)}/{exp[k]}" for k in modules if k in exp) or "—"
        return (
            f"{m:<8} {heat:>21} {self.rooms_with_data.get(m, 0):>6} {water:>12} {lk:>9}"
            f" {_pct(self.curve_got.get(m, 0), self.curve_expected.get(m, 0)):>8}"
            f" {_pct(self.room30_got.get(m, 0), self.room30_expected.get(m, 0)):>9}"
            f" {_pct(self.seen_got.get(m, 0), self.seen_expected.get(m, 0)):>8} {cross:>8}  {station}"
        )

    def _year_total(self, year: int) -> str:
        p = f"{year}-"
        heat = [0, 0, 0, 0, 0]
        for m, kinds in self.cells.items():
            if m.startswith(p):
                heat = [a + b for a, b in zip(heat, kinds.get("heating", [0, 0, 0, 0, 0]), strict=True)]
        lk_got = sum(n for m, n in self.linky_present.items() if m.startswith(p))
        lk_exp = sum(n for m, n in self.linky_range.items() if m.startswith(p))
        imp = sum(n for m, n in self.impossible.items() if m.startswith(p))
        only = sum(n for m, n in self.linky_only.items() if m.startswith(p))
        return (
            f"chauffage {'/'.join(map(str, heat))} pièces-jours ; Linky {lk_got}/{lk_exp - lk_got} jours ;"
            f" recoupement : {imp} jours Intuis > Linky, {only} jours Linky sans Intuis"
        )


def above_meter(intuis_wh: float, meter_wh: float) -> bool:
    """Intuis above the whole-home meter that measures it: impossible (also the data audit, #532)."""
    return intuis_wh > CROSS_RATIO * meter_wh + CROSS_MARGIN_WH


def _valid_meter(v: object) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v) and v >= 0


def _module_order(key: str) -> tuple[int, str]:
    return (int(key[1:]), key) if key[1:].isdigit() else (10**6, key)


def report(store: Store, stopped: list[dict] | None = None) -> list[str]:
    return Report(store, stopped).lines()
