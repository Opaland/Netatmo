"""#469: the evenings the wood stove burnt, read in the per-room half hours (room30).

The owner does not note his fires. They leave a trace: in the evening and at night, rooms next to
the stove's warm up while their radiator draws nothing, with no sun (after sunset) and no mild spell
outdoors. A pure function reads it day by day; the nightly collection (and the demo) keep the result
in the encrypted meta, `stove_fires`, read by the app (web/src/stove-fires.ts) for the calendar of
the fires and the split of the wood over the days (web/src/wood.ts woodDaily, the one rule):

    {"v": 1, "covered": [["YYYY-MM-DD", "YYYY-MM-DD"], ...],
     "fires": {"YYYY-MM-DD": [start slot, half hours, witnesses, smallest rise in tenths of °C]}}

`covered`: the days the detection could see (at least MIN_WITNESSES candidate rooms with energy and
temperature that evening, no mild spell): a day covered and not in `fires` is a day without fire.

The thresholds change what is computed (AGENTS.md §2): they are not invented, see each one. They
were set on the demo (collector/demo.py, `_stove`), whose stove follows what the owner reported
(issue #469: +1 to +2 °C in two bedrooms between 19 h and 23 h, radiators at 0 W). To adjust them
on real data: the answers « poêle allumé ce soir ? » kept on the owner's device (Historique ›
Flambées) give labelled evenings; with about twenty of them, the smallest rise of the evenings
answered « oui » and the largest of those answered « non » bound RISE_MIN as the demo does below.
Logs: nothing (no room, no value, no count).

Sun: Open-Meteo's radiation is collected as a daily sum only (#452, weather "sun", MJ/m²), which
cannot say whether the evening was sunny. The window therefore opens at sunset, computed for the
home's coordinates (or, when unknown, the latest sunset of mainland France that day): after it, the
radiation is nil and no sun warms a room; the daily sum is not needed.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

SLOTS = 48
# Smallest rise (°C) of a witness room over its run at 0 W, measured on the demo (tests/
# test_flambees.py, `test_rise_min_sits_between_the_noise_and_the_fires`): without a fire, the
# largest rise of a room at 0 W after sunset is 0.3 °C (sensor noise, the setpoint followed;
# about twenty such evenings in six weeks: a thin sample); with a fire, the smallest seen is
# 0.6 °C (a stove giving +1 to +2 °C over the burn, the owner's figures, seen from its first
# reading on). The midpoint, 0.45 °C: half a tenth from each reading of 0.1 °C.
# The test keeps both bounds, so a demo or a detection that crosses them breaks it. Real data: the
# answers « poêle allumé ? » bound it the same way (largest rise of a « non », smallest of a « oui »).
RISE_MIN = 0.45
# Shortest run (half hours) of a witness: a rise is a trend over two intervals at least, never one
# jump between two readings (a sensor glitch). Not a calibration: the smallest value that tells a
# trend from a step; the test checks that no fire of the demo is shorter (they last 5 to 9).
MIN_SLOTS = 2
# Rooms that must show it: the owner sees it in two bedrooms (#469); one room alone may be a
# shower, a door left open or someone in it.
MIN_WITNESSES = 2
# A « mild spell »: a rise of the daily mean outdoors larger than this share of the home's own
# day-to-day rises (the 95th percentile of its weather history, computed, not a number of °C).
MILD_PERCENTILE = 0.95

# The corners of mainland France, for the latest sunset of a day when the home is not located.
_FRANCE = ((42.3, -4.8), (51.1, -4.8))


def sunset_minutes(day: date, lat: float, lon: float, tz: str) -> float:
    """Local time of sunset (minutes after midnight), NOAA's approximation (±2 min in France)."""
    g = 2 * math.pi / 365 * (day.timetuple().tm_yday - 1)
    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(g)
        - 0.032077 * math.sin(g)
        - 0.014615 * math.cos(2 * g)
        - 0.040849 * math.sin(2 * g)
    )
    decl = (
        0.006918
        - 0.399912 * math.cos(g)
        + 0.070257 * math.sin(g)
        - 0.006758 * math.cos(2 * g)
        + 0.000907 * math.sin(2 * g)
        - 0.002697 * math.cos(3 * g)
        + 0.00148 * math.sin(3 * g)
    )
    phi = math.radians(lat)
    cos_ha = math.cos(math.radians(90.833)) / (math.cos(phi) * math.cos(decl)) - math.tan(phi) * math.tan(decl)
    ha = math.degrees(math.acos(max(-1.0, min(1.0, cos_ha))))
    utc = 720 + 4 * (ha - lon) - eqtime
    noon = datetime(day.year, day.month, day.day, tzinfo=ZoneInfo("UTC"))
    offset = noon.astimezone(ZoneInfo(tz)).utcoffset() or timedelta(0)
    return utc + offset.total_seconds() / 60


def evening_from(day: date, lat: float | None, lon: float | None, tz: str) -> int:
    """First half hour after sunset (the window of the detection runs from it to midnight)."""
    places = [(lat, lon)] if lat is not None and lon is not None else list(_FRANCE)
    latest = max(sunset_minutes(day, a, b, tz) for a, b in places)
    return min(SLOTS, max(0, math.ceil(latest / 30)))


def _col(cell: object) -> list[float | None]:
    if cell is None:
        return [None] * SLOTS
    if isinstance(cell, list):
        return ([*cell, *[None] * SLOTS])[:SLOTS]
    return [cell] * SLOTS  # type: ignore[list-item]


def _off(hp: list, hc: list, i: int) -> bool:
    """The radiator drew nothing in half hour `i` (known energy, 0 Wh)."""
    return not (hp[i] is None and hc[i] is None) and (hp[i] or 0) + (hc[i] or 0) == 0


def witness_run(cols: list, start: int) -> tuple[int, int, float] | None:
    """The largest rise of a room at 0 W from `start` to midnight: (first slot, half hours, °C),
    or None (no energy or temperature, or no run at 0 W). The rise is measured from the lowest
    reading of the run to the highest after it, all half hours between at 0 W."""
    hp, hc, temp = (_col(cols[k]) for k in range(3))
    best: tuple[int, int, float] | None = None
    i = start
    while i < SLOTS:
        if not _off(hp, hc, i):
            i += 1
            continue
        j = i
        while (
            j + 1 < SLOTS and not (hp[j + 1] is None and hc[j + 1] is None) and (hp[j + 1] or 0) + (hc[j + 1] or 0) == 0
        ):
            j += 1
        low = None
        for k in range(i, j + 1):
            t = temp[k]
            if t is None:
                continue
            if low is None or t < temp[low]:  # type: ignore[operator]
                low = k
                continue
            rise = t - temp[low]  # type: ignore[operator]
            if best is None or rise > best[2]:
                best = (low, k - low, rise)
        i = j + 1
    return best


def _witness(run: tuple[int, int, float]) -> bool:
    return run[2] >= RISE_MIN and run[1] >= MIN_SLOTS


def _has_evening(cols: list, start: int) -> bool:
    hp, hc, temp = (_col(cols[k]) for k in range(3))
    return any((hp[i] is not None or hc[i] is not None) and temp[i] is not None for i in range(start, SLOTS))


def mild_threshold(outdoor: dict[str, list]) -> float | None:
    """MILD_PERCENTILE of the day-to-day rises of the daily mean outdoors (None: too little weather)."""
    days = sorted(outdoor)
    rises = []
    for a, b in zip(days, days[1:], strict=False):
        if date.fromisoformat(b) - date.fromisoformat(a) == timedelta(days=1):
            rises.append(outdoor[b][2] - outdoor[a][2])
    if len(rises) < 30:
        return None
    rises.sort()
    return rises[min(len(rises) - 1, int(MILD_PERCENTILE * len(rises)))]


def detect_fires(
    room30: dict[str, dict[str, list]],
    candidates: list[str],
    outdoor: dict[str, list],
    lat: float | None,
    lon: float | None,
    tz: str,
) -> dict:
    """The fires of the stove, day by day (format above). `room30`: room -> day -> [hp, hc, temp,
    setpoint] (collector/room30.py); `candidates`: the heated rooms that may witness (never the
    water heater nor a room switched off on purpose); `outdoor`: day -> [min, max, mean] °C."""
    mild = mild_threshold(outdoor)
    days = sorted({d for r in candidates for d in room30.get(r, {})})
    # first pass: the evenings two rooms or more warm up at 0 W, and the rooms that did (the
    # neighbours of the stove: the detection learns them, nobody declares them)
    evenings: dict[str, tuple[int, list[str]]] = {}
    fires: dict[str, list] = {}
    neighbours: set[str] = set()
    for day in days:
        d = date.fromisoformat(day)
        prev = (d - timedelta(days=1)).isoformat()
        if mild is not None and day in outdoor and prev in outdoor and outdoor[day][2] - outdoor[prev][2] > mild:
            continue  # a mild spell: neither a fire nor a day without one
        start = evening_from(d, lat, lon, tz)
        seen = [r for r in candidates if day in room30.get(r, {}) and _has_evening(room30[r][day], start)]
        evenings[day] = (start, seen)
        runs = {
            r: w for r in seen if (w := witness_run(room30[r][day], start)) and w[2] >= RISE_MIN and w[1] >= MIN_SLOTS
        }
        if len(runs) >= MIN_WITNESSES:
            neighbours |= set(runs)
            ws = list(runs.values())
            spans = sorted(w[1] for w in ws)
            fires[day] = [min(w[0] for w in ws), spans[len(spans) // 2], len(ws), round(min(w[2] for w in ws) * 10)]
    # second pass: a day is covered (a fire would have been seen) when MIN_WITNESSES neighbours
    # sent their evening; one neighbour out of reach and the day says nothing, fire or not
    covered = [day for day, (_s, seen) in evenings.items() if len(neighbours.intersection(seen)) >= MIN_WITNESSES]
    return {"v": 1, "covered": _ranges(covered), "fires": fires}


def _ranges(days: list[str]) -> list[list[str]]:
    out: list[list[str]] = []
    for day in days:
        if out and date.fromisoformat(out[-1][1]) + timedelta(days=1) == date.fromisoformat(day):
            out[-1][1] = day
        else:
            out.append([day, day])
    return out


def room30_of(store) -> dict[str, dict[str, list]]:
    """Every year of the per-room half hours, merged: room -> day -> [hp, hc, temp, setpoint]."""
    out: dict[str, dict[str, list]] = {}
    for year in store.room30_years():
        for room, days in (store.doc(f"{year}.room30").get("rooms", {}) or {}).items():
            out.setdefault(room, {}).update(days or {})
    return out
