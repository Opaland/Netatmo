"""Import Home Assistant statistics into the encrypted archive (S-1.18).

`python -m collector import-ha FICHIER` reads an export made by the owner on their own
network (Home Assistant is never reached from GitHub), turns it into daily aggregates per
sensor and merges them into `data/ha.enc.json`. Accepted files (docs/import-ha.md):

1. History JSON of the REST API: GET /api/history/period/<start>?filter_entity_id=…
   (a list of lists of states; `minimal_response` accepted).
2. History CSV of the History panel ("Download data"): entity_id,state,last_changed.
3. Long-term statistics JSON: {"statistics": {"sensor.x": [{"start", "mean", "min", "max",
   "sum" | "change"}]}, "units": {"sensor.x": "kWh"}} — the answer of the websocket command
   recorder/statistics_during_period, wrapped with the units (bare answer accepted too).

Stored (decrypted) document, published as docs/import-ha.schema.json:
  {"sensors": {"h0": {"entity": "binary_sensor.fenetre_salon", "name": "...", "kind": "opening",
                      "unit": ""}},
   "daily":   {"h0": {"YYYY-MM-DD": {"on_h": 2.5, "n": 3}}},     opening / binary
              {"h1": {"YYYY-MM-DD": {"kwh": 1.234}}},            energy (counter differences)
              {"h2": {"YYYY-MM-DD": {"min": 18.2, "max": 21.0, "mean": 19.6}}}  other numbers
   "imported": "YYYY-MM-DDTHH:MM:SS+00:00"}

From history files only whole local days are kept (the first and last days of an export are
partial). From statistics, a partial first or last day is kept only when nothing was imported
for that day before: it never replaces a value already stored. Messages and logs give counts
only, never an entity, a name or a value.
"""

from __future__ import annotations

import csv
import io
import json
import re
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .shelly import counter_step, spread
from .storage import Store

DOC = "ha"
MAX_BYTES = 50_000_000
MAX_SENSORS = 300
ON = {"on", "open", "opened", "true", "detected", "1"}
OFF = {"off", "closed", "close", "false", "clear", "0"}
OPENING_CLASSES = {"door", "window", "opening", "garage_door"}
OPENING_WORDS = re.compile(r"fen[eê]tre|porte|window|door|ouverture|opening|contact", re.I)
ENERGY_UNITS = {"wh": 0.001, "kwh": 1.0, "mwh": 1000.0}
_ENTITY = re.compile(r"[a-z_]+\.[a-z0-9_]+")


class ImportFormatError(ValueError):
    """Unusable file. The message never quotes the content (only positions and counts)."""


class Series:
    def __init__(self, entity: str) -> None:
        self.entity = entity
        self.name = ""
        self.unit = ""
        self.device_class = ""
        self.points: list[tuple[float, str]] = []  # (epoch s, raw state)
        self.stats: list[dict] = []


def _ts(v: Any) -> float | None:
    if isinstance(v, int | float) and not isinstance(v, bool):
        return v / 1000 if v > 1e11 else float(v)  # ms (websocket) or s
    if isinstance(v, str):
        try:
            d = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        return (d if d.tzinfo else d.replace(tzinfo=UTC)).timestamp()
    return None


def _float(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


# ---------------------------------------------------------------- parsing
def parse(raw: bytes) -> dict[str, Series]:
    if len(raw) > MAX_BYTES:
        raise ImportFormatError(f"fichier trop gros (plus de {MAX_BYTES // 1_000_000} Mo)")
    text = raw.decode("utf-8-sig", errors="strict")
    stripped = text.lstrip()
    if stripped.startswith(("[", "{")):
        try:
            data = json.loads(text)
        except json.JSONDecodeError as err:
            raise ImportFormatError(f"JSON illisible (ligne {err.lineno})") from None
        out = _parse_history_json(data) if isinstance(data, list) else _parse_statistics(data)
    else:
        out = _parse_csv(text)
    if not out:
        raise ImportFormatError("aucun capteur reconnu (voir docs/import-ha.md)")
    if len(out) > MAX_SENSORS:
        raise ImportFormatError(f"plus de {MAX_SENSORS} capteurs : filtrez l'export")
    return out


def _series(out: dict[str, Series], entity: Any, where: str) -> Series:
    if not isinstance(entity, str) or not _ENTITY.fullmatch(entity):
        raise ImportFormatError(f"{where} : entity_id invalide")
    return out.setdefault(entity, Series(entity))


def _parse_history_json(data: list) -> dict[str, Series]:
    out: dict[str, Series] = {}
    for i, group in enumerate(data, 1):
        if not isinstance(group, list):
            raise ImportFormatError(f"historique : élément {i} n'est pas une liste d'états")
        entity = None
        for state in group:
            if not isinstance(state, dict):
                raise ImportFormatError(f"historique : élément {i}, état mal formé")
            entity = state.get("entity_id", entity)  # minimal_response: only the first carries it
            s = _series(out, entity, f"historique, élément {i}")
            attrs = state.get("attributes")
            if isinstance(attrs, dict):
                s.unit = str(attrs.get("unit_of_measurement") or s.unit)[:12]
                s.device_class = str(attrs.get("device_class") or s.device_class)[:24]
                s.name = str(attrs.get("friendly_name") or s.name)[:60]
            t = _ts(state.get("last_changed") or state.get("last_updated"))
            if t is not None and isinstance(state.get("state"), str | int | float):
                s.points.append((t, str(state["state"])))
    return out


def _parse_csv(text: str) -> dict[str, Series]:
    rows = csv.reader(io.StringIO(text))
    header = [h.strip().lower() for h in next(rows, [])]
    try:
        ie, isv, it = header.index("entity_id"), header.index("state"), header.index("last_changed")
    except ValueError:
        raise ImportFormatError("CSV : colonnes entity_id, state, last_changed attendues") from None
    out: dict[str, Series] = {}
    for n, row in enumerate(rows, 2):
        if not row:
            continue
        if len(row) <= max(ie, isv, it):
            raise ImportFormatError(f"CSV : ligne {n} incomplète")
        t = _ts(row[it])
        if t is None:
            raise ImportFormatError(f"CSV : ligne {n}, date illisible")
        _series(out, row[ie].strip(), f"CSV, ligne {n}").points.append((t, row[isv].strip()))
    return out


def _parse_statistics(data: dict) -> dict[str, Series]:
    stats = data.get("statistics", data)
    units = data.get("units", {}) if isinstance(data.get("units"), dict) else {}
    if not isinstance(stats, dict):
        raise ImportFormatError("statistiques : objet {entity_id: [lignes]} attendu")
    out: dict[str, Series] = {}
    for entity, rows in stats.items():
        s = _series(out, entity, "statistiques")
        if not isinstance(rows, list):
            raise ImportFormatError("statistiques : liste de lignes attendue par capteur")
        s.unit = str(units.get(entity) or "")[:12]
        for row in rows:
            if not isinstance(row, dict) or _ts(row.get("start")) is None:
                raise ImportFormatError("statistiques : ligne sans « start »")
            s.stats.append(row)
    return out


# ---------------------------------------------------------------- classification and aggregates
def kind(s: Series) -> str:
    unit = s.unit.lower()
    if unit in ENERGY_UNITS or s.device_class == "energy":
        return "energy"
    if s.stats:
        if any("sum" in r or "change" in r for r in s.stats):
            return "energy" if unit in ENERGY_UNITS or not unit else "numeric"
        return _numeric_kind(s)
    states = {v.lower() for _t, v in s.points}
    if s.entity.startswith("binary_sensor.") or (states and states <= ON | OFF | {"unavailable", "unknown"}):
        if s.device_class in OPENING_CLASSES or OPENING_WORDS.search(s.entity + " " + s.name):
            return "opening"
        return "binary"
    return _numeric_kind(s)


def _numeric_kind(s: Series) -> str:
    unit = s.unit.lower()
    if unit in ("°c", "°f") or s.device_class == "temperature":
        return "temperature"
    if s.device_class == "humidity":
        return "humidity"
    if unit in ("w", "kw"):
        return "power"
    return "numeric"


def _whole_days(points: list[tuple[float, Any]], tz: str) -> tuple[str, str] | None:
    """First and last local days fully inside [first point, last point]."""
    zone = ZoneInfo(tz)
    first = datetime.fromtimestamp(points[0][0], zone)
    last = datetime.fromtimestamp(points[-1][0], zone)
    start = first.date() if first.time() == datetime.min.time() else first.date() + timedelta(days=1)
    end = last.date() - timedelta(days=1)
    return (start.isoformat(), end.isoformat()) if start <= end else None


def _binary_days(points: list[tuple[float, str]], tz: str) -> dict[str, dict]:
    pts = sorted((t, v.lower()) for t, v in points if v.lower() in ON | OFF)
    span = _whole_days(pts, tz) if pts else None
    if not span:
        return {}
    on_s: dict[str, float] = defaultdict(float)
    opens: dict[str, int] = defaultdict(int)
    zone = ZoneInfo(tz)
    prev_on = False
    for (t, v), nxt in zip(pts, [*pts[1:], (pts[-1][0], "")], strict=True):
        is_on = v in ON
        if is_on and not prev_on:
            opens[datetime.fromtimestamp(t, zone).date().isoformat()] += 1
        if is_on:
            for day, secs in spread(t, nxt[0], nxt[0] - t, tz).items():
                on_s[day] += secs
        prev_on = is_on
    days = _days_between(*span)
    return {d: {"on_h": round(on_s.get(d, 0.0) / 3600, 2), "n": opens.get(d, 0)} for d in days}


def _days_between(a: str, b: str) -> list[str]:
    d, end, out = datetime.fromisoformat(a).date(), datetime.fromisoformat(b).date(), []
    while d <= end:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _energy_days(points: list[tuple[float, float]], tz: str) -> dict[str, dict]:
    pts = sorted(points)
    span = _whole_days(pts, tz) if pts else None
    if not span:
        return {}
    kwh: dict[str, float] = defaultdict(float)
    prev: dict | None = None
    for t, v in pts:
        wh, _est = counter_step(prev, t, v)
        if wh is not None and prev is not None:
            for day, part in spread(prev["ts"], t, wh, tz).items():
                kwh[day] += part
        prev = {"ts": t, "total": v}
    return {d: {"kwh": round(kwh.get(d, 0.0), 3)} for d in _days_between(*span)}


def _numeric_days(points: list[tuple[float, float]], tz: str) -> dict[str, dict]:
    pts = sorted(points)
    span = _whole_days(pts, tz) if pts else None
    if not span:
        return {}
    zone = ZoneInfo(tz)
    per: dict[str, list[float]] = defaultdict(list)
    for t, v in pts:
        per[datetime.fromtimestamp(t, zone).date().isoformat()].append(v)
    return {
        d: {"min": round(min(v), 2), "max": round(max(v), 2), "mean": round(sum(v) / len(v), 2)}
        for d, v in per.items()
        if span[0] <= d <= span[1]
    }


def _day_seconds(day: str, zone: ZoneInfo) -> float:
    """Length of a local day (23 or 25 h on the DST changes)."""
    d = datetime.fromisoformat(day).date()
    start = datetime.combine(d, datetime.min.time(), zone)
    end = datetime.combine(d + timedelta(days=1), datetime.min.time(), zone)
    return end.timestamp() - start.timestamp()


def _stat_days(s: Series, k: str, tz: str) -> tuple[dict[str, dict], set[str]]:
    """(daily aggregates, days only partly covered by the export). A statistics row covers
    `step` seconds (an hour, a day…: the smallest gap between two rows; a single row counts as
    covering its day); a day whose rows cover less than the whole day is partial (#272)."""
    zone = ZoneInfo(tz)
    rows = sorted(s.stats, key=lambda r: _ts(r["start"]) or 0)
    starts = [_ts(r["start"]) or 0 for r in rows]
    gaps = [b - a for a, b in zip(starts, starts[1:], strict=False) if b > a]
    step = min(gaps) if gaps else None
    out: dict[str, dict] = {}
    covered: dict[str, float] = defaultdict(float)
    if k == "energy":
        factor = ENERGY_UNITS.get(s.unit.lower(), 1.0)
        prev_sum = None
        for r, t in zip(rows, starts, strict=True):
            day = datetime.fromtimestamp(t, zone).date().isoformat()
            change = _float(r.get("change"))
            total = _float(r.get("sum"))
            if change is None and total is not None and prev_sum is not None:
                change = total - prev_sum if total >= prev_sum else total
            prev_sum = total if total is not None else prev_sum
            if change is not None:
                cell = out.setdefault(day, {"kwh": 0.0})
                cell["kwh"] = round(cell["kwh"] + change * factor, 3)
                covered[day] += step or 0
    else:
        acc: dict[str, list[tuple[float | None, float | None, float | None]]] = defaultdict(list)
        for r, t in zip(rows, starts, strict=True):
            day = datetime.fromtimestamp(t, zone).date().isoformat()
            acc[day].append((_float(r.get("min")), _float(r.get("max")), _float(r.get("mean"))))
        for day, vals in acc.items():
            means = [m for _a, _b, m in vals if m is not None]
            if not means:
                continue
            mins = [a for a, _b, _m in vals if a is not None] or means
            maxs = [b for _a, b, _m in vals if b is not None] or means
            out[day] = {
                "min": round(min(mins), 2),
                "max": round(max(maxs), 2),
                "mean": round(sum(means) / len(means), 2),
            }
            covered[day] = len(means) * (step or 0)
    partial = set() if step is None else {d for d in out if covered[d] < _day_seconds(d, zone) - 1}
    return out, partial


def aggregate(s: Series, tz: str) -> tuple[str, dict[str, dict]]:
    k = kind(s)
    if s.stats:
        return k, _stat_days(s, k, tz)[0]
    if k in ("opening", "binary"):
        return k, _binary_days(s.points, tz)
    nums = [(t, f) for t, v in s.points if (f := _float(v)) is not None]
    if k == "energy":
        factor = ENERGY_UNITS.get(s.unit.lower(), 1.0)
        return k, _energy_days([(t, v * factor) for t, v in nums], tz)
    return k, _numeric_days(nums, tz)


# ---------------------------------------------------------------- storing
def import_file(store: Store, path: Path, tz: str) -> dict[str, int]:
    """Merge the file's daily aggregates into ha.enc.json (in memory; the caller saves).
    Returns counts only: sensors, days, skipped (sensors without a whole day), partial_kept
    (partial statistics days that left a value already imported in place)."""
    return import_bytes(store, path.read_bytes(), tz)


def import_bytes(store: Store, raw: bytes, tz: str) -> dict[str, int]:
    """Same as import_file, from the content of an export (the demo builds one in memory)."""
    series = parse(raw)
    doc = store.doc(DOC)
    known = {v.get("entity"): k for k, v in doc.get("sensors", {}).items()}
    counts = {"sensors": 0, "days": 0, "skipped": 0, "partial_kept": 0}
    for entity in sorted(series):
        s = series[entity]
        k = kind(s)
        days, partial = _stat_days(s, k, tz) if s.stats else (aggregate(s, tz)[1], set())
        if not days:
            counts["skipped"] += 1
            continue
        key = known.get(entity) or f"h{len(doc.get('sensors', {}))}"
        known[entity] = key
        old = doc.get("sensors", {}).get(key, {})
        name = s.name or old.get("name") or entity
        sensor = {"entity": entity, "name": name, "kind": k, "unit": s.unit or old.get("unit", "")}
        store.put(DOC, "sensors", key, None, sensor)
        stored = doc.get("daily", {}).get(key, {})
        for day, value in days.items():
            # Statistics may start or end in the middle of a day: such a partial day never
            # replaces a value already imported, which may be a complete day (#272).
            if day in partial and day in stored:
                counts["partial_kept"] += 1
                continue
            store.put(DOC, "daily", key, day, value)
        counts["sensors"] += 1
        counts["days"] += len(days)
    if counts["sensors"]:
        store.set_top(DOC, "imported", datetime.now(UTC).isoformat(timespec="seconds"))
    return counts
