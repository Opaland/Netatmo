"""Whole-home consumption from the Linky meter, through Conso API (https://conso.boris.sh).

Enedis' own API is reserved to companies; Conso API is the free relay used by the
Home Assistant "ha-linky" integration. The owner consents on the Enedis website and
gets a personal token. Optional: needs ENEDIS_TOKEN and ENEDIS_PRM (14-digit point id).

Besides the daily totals, the 30-minute load curve (S-1.11) is kept in one document per
year, YYYY.linky30.enc.json: {"curve": {"YYYY-MM-DDTHH:MM": Wh}} (local time, key = start
of the half hour). Enedis only records it when the customer enabled "collecte de la courbe
de charge" on their account (à vérifier): an empty answer is not an error.
"""

from __future__ import annotations

import base64
import contextlib
import json
import logging
import math
import re
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from .errors import SourceError, endpoint_of, raise_for_status
from .http import Paced
from .schema import FormatError, dated_records, safe_keys
from .storage import Store

log = logging.getLogger(__name__)

API = "https://conso.boris.sh/api/consommation_quotidienne"
API_PMAX = "https://conso.boris.sh/api/puissance_conso_max_quotidienne"
API_CURVE = "https://conso.boris.sh/api/courbe_de_charge_consommation"
# S-1.28 (#277): meter index per rate period (Enedis API v2 type, conso.boris.sh/migration-2026).
API_INDEX = "https://conso.boris.sh/api/index_consommation"
INDEX_BACKFILL_DAYS = 365  # first run: the last 12 months (one request), then the last 10 days
MAX_INDEX_SERIES = 16
# Names of a rate period / calendar in the index answer (format à confirmer by the inventory).
LABEL_KEYS = (
    "idClasseTemporelle",
    "classeTemporelle",
    "classe_temporelle",
    "codeCadran",
    "cadran",
    "idCalendrier",
    "calendrier",
    "libelle",
    "label",
    "code",
    "id",
)
USER_AGENT = "intuis-history/1.0 (+https://github.com/Opaland/Netatmo)"
# 2026 Enedis format: {"grandeur": [{"points": [{"d": "2024-01-01", "v": "12345"}]}]};
# older formats used date/value or date/valeur.
DATE_KEYS = ("d", "date", "dateDebut", "date_debut", "debut", "horodatage", "start")
VALUE_KEYS = ("v", "value", "valeur", "val", "consommation")
STEP_KEYS = ("p", "pas", "interval_length")
# Unit of the values: "unite" in the 2026 format ({"grandeur": [{"unite": "Wh", "points": …}]}),
# "unit" in the former one ({"reading_type": {"unit": "Wh"}, "interval_reading": […]}).
UNIT_KEYS = ("unite", "unit", "unité")
# Raw unit → factor to the stored unit (Wh for the daily totals, kVA for the maximum power).
ENERGY_UNITS = {"Wh": 1.0, "kWh": 1000.0}
POWER_UNITS = {"VA": 0.001, "kVA": 1.0, "W": 0.001, "kW": 1.0}

# Load curve: range per request undocumented, 7 days is Enedis' classic limit (à vérifier).
CURVE_CHUNK_DAYS = 7
CURVE_BACKFILL_DAYS = 365  # first run: the last 12 months at most
CURVE_REFRESH_DAYS = 3  # every night: the last days again (Enedis publishes them late)
CURVE_MIN_SLOTS = 46  # a complete day has 48 half hours (46 on the spring DST day)
# Conso API: 5 requests/s and 10 000/h shared by every user → keep at least 0.3 s apart.
MIN_INTERVAL = 0.3


class LinkyError(SourceError):
    """`auth`: token refused, consent expired or revoked. Never the URL (its query holds the
    PRM) nor the response body (S-1.16 #263)."""

    source = "Linky (Conso API)"


class _Paced(Paced):
    """GET with the Conso API token, at most one call every `min_interval` seconds."""

    def __init__(self, http: httpx.Client, token: str, min_interval: float | None) -> None:
        super().__init__(http, "linky", MIN_INTERVAL if min_interval is None else min_interval, LinkyError)
        self.token = token

    def get(self, url: str, params: dict) -> httpx.Response:  # type: ignore[override]
        return self.request("GET", url, params=params, headers={"Authorization": f"Bearer {self.token}"})


def _client() -> httpx.Client:
    return httpx.Client(timeout=60.0, headers={"User-Agent": USER_AGENT})


def _readings(obj: object) -> list[tuple[str, float]]:
    """Find (day, value) pairs anywhere in the response (its format changed in 2026)."""
    return [(stamp[:10], value) for stamp, value, _step in _points(obj)]


def _units(obj: object) -> set[str]:
    """Every unit named in the response (lower case), wherever it is."""
    out: set[str] = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in UNIT_KEYS and isinstance(v, str):
                out.add(v.strip().lower())
            else:
                out |= _units(v)
    elif isinstance(obj, list):
        for v in obj:
            out |= _units(v)
    return out


def _unit(store: Store, field: str, bodies: list[object], rows: list[tuple[str, float]], units: dict) -> str:
    """Unit of the raw values, decided from the response, never from their size (#266).

    1. a unit named in the response (and known for this series) wins;
    2. else the unit decided before and kept in linky[field];
    3. else, the first time only, a format hint: Enedis gives whole Wh / VA, so a decimal
       value means kWh / kVA; otherwise the unit of the API contract (Wh / VA).
    The result is kept in linky[field], so a quiet week (empty home, holiday house) can never
    change it."""
    known = {u.lower(): u for u in units}
    base, scaled = list(units)[:2]  # contract unit (Wh / VA), then its multiple (kWh / kVA)
    named = {known[u] for body in bodies for u in _units(body) if u in known}
    stored = store.doc("linky").get(field)
    if len(named) == 1:
        unit = next(iter(named))
    elif stored in units:
        unit = stored
    elif any(math.isfinite(v) and v != int(v) for _d, v in rows):
        unit = scaled
    else:
        unit = base
    if unit != stored:
        if stored:
            log.warning("Linky : unité %s annoncée par la réponse (au lieu de %s)", unit, stored)
        store.set_top("linky", field, unit)
    return unit


def _json(resp: httpx.Response, endpoint: str) -> object:
    try:
        return resp.json()
    except ValueError:
        raise FormatError("Linky (Conso API)", endpoint, "(réponse)", "n'est plus du JSON") from None


def _check_found(body: object, found: int, endpoint: str) -> None:
    """S-1.13: readings present (flat objects with a date) but none recognised means the field
    names changed, as Enedis did in 2026; no reading at all is just "no data". The message
    names the fields seen (identifiers only), never a value."""
    if found:
        return
    # A reading with known field names but an unusable value (null) is not a format change.
    records = [
        r for r in dated_records(body) if not (any(k in r for k in DATE_KEYS) and any(k in r for k in VALUE_KEYS))
    ]
    if records:
        fields = ", ".join(safe_keys(k for r in records[:20] for k in r)) or "?"
        raise FormatError("Linky (Conso API)", endpoint, "mesures", f"non reconnu (champs vus : {fields})")


def collect(
    store: Store,
    token: str,
    prm: str,
    first_day: str,
    tz: str,
    http: httpx.Client | None = None,
    min_interval: float | None = None,
) -> int:
    api = _Paced(http or _client(), token, min_interval)
    have = store.doc("linky").get("daily", {})
    today = datetime.now(ZoneInfo(tz)).date()
    # Enedis keeps about 3 years; refresh the last 10 days, fetch the rest once.
    start = max(date.fromisoformat(first_day), today - timedelta(days=3 * 365))
    if have:
        start = max(start, date.fromisoformat(max(have)) - timedelta(days=10))
    rows: list[tuple[str, float]] = []
    bodies: list[object] = []
    chunk_start = start
    while chunk_start < today:
        chunk_end = min(chunk_start + timedelta(days=365), today)
        resp = api.get(API, {"pointId": prm, "dateDebut": chunk_start.isoformat(), "dateFin": chunk_end.isoformat()})
        if resp.status_code in (401, 403):
            raise LinkyError(
                endpoint=endpoint_of(API),
                status=resp.status_code,
                hint="renouvelez l'accord sur conso.boris.sh et mettez le nouveau jeton dans ENEDIS_TOKEN",
                auth=True,
            )
        raise_for_status(resp, LinkyError, endpoint_of(API))
        body = _json(resp, "consommation_quotidienne")
        bodies.append(body)
        found = _readings(body)
        _check_found(body, len(found), "consommation_quotidienne")
        if not found:
            log.info("Linky : aucune mesure sur %s → %s", chunk_start, chunk_end)
        rows += found
        chunk_start = chunk_end
    _collect_pmax(store, api, prm, start, today, tz)
    if not rows:
        return 0
    factor = ENERGY_UNITS[_unit(store, "unit", bodies, rows, ENERGY_UNITS)]
    for day, v in rows:
        store.put("linky", "daily", day, None, round(v * factor, 1))
    log.info("Linky : %d jours", len(rows))
    return len(rows)


def _collect_pmax(store: Store, api: _Paced, prm: str, start: date, today: date, tz: str = "Europe/Paris") -> None:
    """Daily maximum power drawn (kVA): tells whether the subscribed power fits. Best effort."""
    rows: list[tuple[str, float]] = []
    bodies: list[object] = []
    chunk_start = start
    while chunk_start < today:
        chunk_end = min(chunk_start + timedelta(days=365), today)
        resp = api.get(
            API_PMAX, {"pointId": prm, "dateDebut": chunk_start.isoformat(), "dateFin": chunk_end.isoformat()}
        )
        if resp.status_code != 200:
            log.warning("Linky : puissance max indisponible (HTTP %s)", resp.status_code)
            return
        body = _json(resp, "puissance_conso_max_quotidienne")
        bodies.append(body)
        found = _readings(body)
        try:
            _check_found(body, len(found), "puissance_conso_max_quotidienne")
        except FormatError as err:  # best effort: the daily totals are already fetched
            log.warning("%s", err)
            return
        rows += found
        chunk_start = chunk_end
    if not rows:
        return
    factor = POWER_UNITS[_unit(store, "pmax_unit", bodies, rows, POWER_UNITS)]
    for day, v in rows:
        store.put("linky", "pmax", day, None, round(v * factor, 2))
    # S-1.25 (#219): the time of each maximum, when the answer dates it (local HH:MM).
    times = 0
    for body in bodies:
        for day, hhmm in peak_times(body, tz).items():
            store.put("linky", "pmax_at", day, None, hhmm)
            times += 1
    log.info("Linky : puissance max sur %d jours (%d avec l'heure du pic)", len(rows), times)


def peak_times(body: object, tz: str) -> dict[str, str]:
    """{"YYYY-MM-DD": "HH:MM"} local time of the daily maximum power, when the timestamp carries
    a time (format à confirmer by the inventory). A bare day gives nothing; a timestamp without
    offset is taken as local time. The day key is the one `pmax` uses (stamp[:10])."""
    zone = ZoneInfo(tz)
    out: dict[str, str] = {}
    for stamp, _v, _step in _points(body):
        if len(stamp) <= 10 or ("T" not in stamp and " " not in stamp):
            continue
        try:
            at = datetime.fromisoformat(stamp.replace("Z", "+00:00").replace(" ", "T", 1))
        except ValueError:
            continue
        local = at.replace(tzinfo=zone) if at.tzinfo is None else at.astimezone(zone)
        if (local.hour, local.minute, local.second) == (0, 0, 0):
            continue  # midnight on the dot: a day stamp in disguise, not the time of a peak
        out[stamp[:10]] = local.strftime("%H:%M")
    return out


# ---------------------------------------------------------------- index per rate period (#277)
def _label(obj: dict) -> str | None:
    for k in LABEL_KEYS:
        v = obj.get(k)
        if isinstance(v, str) and v.strip():
            text = re.sub(r"[^a-z0-9_]+", "_", v.strip().lower()).strip("_")[:24]
            if text and text[0].isalpha():
                return text
    return None


def parse_index(body: object) -> dict[str, dict[str, float]]:
    """Index answer → {series: {"YYYY-MM-DD": value}}. A series is named by the labels met on the
    way down (calendar, then rate period: "distributeur.hph"), "total" when there is none. The
    format is not documented (migration page of Conso API): any dated reading under a label is
    taken. Labels are identifiers only (never a free text, never the PRM: it starts with a digit)."""
    out: dict[str, dict[str, float]] = {}

    def walk(o: object, path: tuple[str, ...]) -> None:
        if isinstance(o, dict):
            label = _label(o)
            here = path + (label,) if label and label not in path else path
            dk = next((k for k in DATE_KEYS if isinstance(o.get(k), str)), None)
            vk = next((k for k in VALUE_KEYS if k in o), None)
            if dk and vk is not None:
                with contextlib.suppress(TypeError, ValueError):
                    v = float(o[vk])
                    if math.isfinite(v):
                        out.setdefault(".".join(path) or "total", {})[o[dk][:10]] = v
            for v in o.values():
                if isinstance(v, dict | list):
                    walk(v, here)
        elif isinstance(o, list):
            for v in o:
                walk(v, path)

    walk(body, ())
    return dict(sorted(out.items())[:MAX_INDEX_SERIES])


def collect_index(
    store: Store,
    token: str,
    prm: str,
    first_day: str,
    tz: str,
    http: httpx.Client | None = None,
    min_interval: float | None = None,
    today: date | None = None,
) -> int:
    """Daily meter index per rate period in linky["index"] = {series: {day: Wh}}. The last 12
    months on the first run, then the last 10 days. Best effort: an HTTP error or an empty answer
    (series not served for this meter) is not an error of the collection. Returns the readings."""
    api = _Paced(http or _client(), token, min_interval)
    today = today or datetime.now(ZoneInfo(tz)).date()
    have = store.doc("linky").get("index") or {}
    last = max((max(days) for days in have.values() if days), default=None)
    start = max(date.fromisoformat(first_day), today - timedelta(days=INDEX_BACKFILL_DAYS))
    if last:
        start = max(start, date.fromisoformat(last) - timedelta(days=10))
    if start >= today:
        return 0
    resp = api.get(API_INDEX, {"pointId": prm, "dateDebut": start.isoformat(), "dateFin": today.isoformat()})
    if resp.status_code != 200:
        log.warning("Linky : index par cadran indisponibles (HTTP %s)", resp.status_code)
        store.set_top("linky", "index_status", resp.status_code)
        return 0
    body = _json(resp, "index_consommation")
    series = parse_index(body)
    rows = [(d, v) for days in series.values() for d, v in days.items()]
    if not rows:
        log.info("Linky : aucun index par cadran")
        store.set_top("linky", "index_status", 204)
        return 0
    factor = ENERGY_UNITS[_unit(store, "index_unit", [body], rows, ENERGY_UNITS)]
    for name, days in series.items():
        for d, v in days.items():
            store.put("linky", "index", name, d, round(v * factor))
    store.set_top("linky", "index_status", 200)
    log.info("Linky : %d index (%d cadrans)", len(rows), len(series))
    return len(rows)


# ---------------------------------------------------------------- load curve (S-1.11)
def _points(obj: object, step: str | None = None) -> list[tuple[str, float, str | None]]:
    """(timestamp, value, step) anywhere in the response, keeping the full timestamp. The step is
    the point's own, else the nearest one above it: the 2026 format would give it once, at the top
    of the answer (`pas`), its points carrying only `d` and `v` (#568: the shape of the reference
    client bokub/linky, to be confirmed on the real answer by the inventory)."""
    out: list[tuple[str, float, str | None]] = []
    if isinstance(obj, dict):
        step = next((obj[k] for k in STEP_KEYS if isinstance(obj.get(k), str)), None) or step
        dk = next((k for k in DATE_KEYS if isinstance(obj.get(k), str)), None)
        vk = next((k for k in VALUE_KEYS if k in obj), None)
        if dk and vk is not None:
            with contextlib.suppress(TypeError, ValueError):
                out.append((obj[dk], float(obj[vk]), step))
        for v in obj.values():
            out += _points(v, step)
    elif isinstance(obj, list):
        for v in obj:
            out += _points(v, step)
    return out


# #568: a 2026 answer may carry several quantities in `grandeur[]` (format of the reference client
# bokub/linky 3.0.0; whether the real curve does is to be confirmed by the inventory). ONE is kept,
# never added to another: the consumption (`grandeurMetier` CONS) when named, then the active power
# (`grandeurPhysique` PA), then a power or energy unit, then the first. Factor of each unit: to W
# for a power, to Wh for an energy given per step.
ACTIVE_POWER = "PA"
CONSUMPTION = "CONS"
WATT_UNITS = {"w": 1.0, "kw": 1000.0}
ENERGY_STEP_UNITS = {"wh": 1.0, "kwh": 1000.0}


def _code(g: dict, key: str) -> str:
    return str(g.get(key) or "").strip().upper()


def curve_choice(body: object) -> tuple[dict | None, list[dict]]:
    """(the quantity kept, those left out) of a 2026 load curve answer; (None, []) otherwise."""
    if not (isinstance(body, dict) and isinstance(body.get("grandeur"), list)):
        return None, []
    parts = [g for g in body["grandeur"] if isinstance(g, dict)]
    if not parts:
        return None, []
    pool = [g for g in parts if _code(g, "grandeurMetier") == CONSUMPTION] or parts
    units = WATT_UNITS | ENERGY_STEP_UNITS
    kept = next(
        (g for g in pool if _code(g, "grandeurPhysique") == ACTIVE_POWER),
        next((g for g in pool if str(g.get("unite") or "").strip().lower() in units), pool[0]),
    )
    return kept, [g for g in parts if g is not kept]


def _curve_parts(body: object) -> list[tuple[object, str | None, float, bool]]:
    """(part, step, factor, energy) of a load curve answer: the whole former answer (W), or the ONE
    quantity `curve_choice` keeps, with the step given at the top and its unit (energy: Wh per step)."""
    kept, left = curve_choice(body)
    if kept is None:
        return [(body, None, 1.0, False)]
    if left:  # codes only (`safe_keys`): never a value
        log.warning(
            "Linky : courbe à %d grandeurs, gardée : %s, laissées : %s",
            len(left) + 1,
            ", ".join(safe_keys([_code(kept, "grandeurPhysique")])) or "?",
            ", ".join(safe_keys(_code(g, "grandeurPhysique") for g in left)) or "?",
        )
    top = next((body[k] for k in STEP_KEYS if isinstance(body.get(k), str)), None)  # type: ignore[union-attr]
    unit = str(kept.get("unite") or "w").strip().lower()
    if unit in ENERGY_STEP_UNITS:
        return [(kept, top, ENERGY_STEP_UNITS[unit], True)]
    return [(kept, top, WATT_UNITS.get(unit, 1.0), False)]


def _step_minutes(step: str | None, default: int = 30) -> int:
    """Length of a point from its ISO 8601 duration (PT30M, PT10M, PT1H); `default` if unknown."""
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?", (step or "").strip().upper())
    minutes = int(m.group(1) or 0) * 60 + int(m.group(2) or 0) if m else 0
    return minutes or default


def parse_curve(body: object, tz: str) -> dict[str, float]:
    """Load curve → {"YYYY-MM-DDTHH:MM" local start of the half hour: Wh}.

    Enedis gives the average power (W) over each step, stamped at the END of the step
    (as ha-linky reads it): Wh = W × minutes / 60. Finer steps (PT10M, PT15M) are summed into
    half hours; the two 02:00 of the autumn DST change are summed as well. The step given once at
    the top and the quantity kept among several are read by `_curve_parts` (#568)."""
    zone = ZoneInfo(tz)
    curve: dict[str, float] = {}
    points = [
        (st, v * factor, sp, energy)
        for part, top, factor, energy in _curve_parts(body)
        for st, v, sp in _points(part, top)
    ]
    for stamp, value, step, energy in points:
        try:
            end = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        except ValueError:
            continue
        if len(stamp) <= 10:  # a bare day is not a curve point
            continue
        end = end.replace(tzinfo=zone) if end.tzinfo is None else end
        minutes = _step_minutes(step)
        start = (end.astimezone(UTC) - timedelta(minutes=minutes)).astimezone(zone)
        slot = start.replace(minute=start.minute - start.minute % 30, second=0, microsecond=0)
        key = slot.strftime("%Y-%m-%dT%H:%M")
        curve[key] = curve.get(key, 0.0) + (value if energy else value * minutes / 60)
    return {k: round(v, 1) for k, v in curve.items()}


def curve_doc(year: int | str) -> str:
    return f"{year}.linky30"


def _curve_days(store: Store, years: range) -> dict[str, int]:
    """Number of half hours stored per day."""
    count: dict[str, int] = {}
    for y in years:
        for key in store.doc(curve_doc(y)).get("curve", {}):
            count[key[:10]] = count.get(key[:10], 0) + 1
    return count


def _chunks(days: list[date], size: int) -> list[tuple[date, date]]:
    """Consecutive days grouped into [start, end) ranges of at most `size` days."""
    out: list[tuple[date, date]] = []
    for d in sorted(days):
        if out and out[-1][1] == d and (d - out[-1][0]).days < size:
            out[-1] = (out[-1][0], d + timedelta(days=1))
        else:
            out.append((d, d + timedelta(days=1)))
    return out


def collect_curve(
    store: Store,
    token: str,
    prm: str,
    first_day: str,
    tz: str,
    http: httpx.Client | None = None,
    min_interval: float | None = None,
    today: date | None = None,
) -> int:
    """Fetch only the missing days of the 30-min load curve: the last 12 months at most on
    the first run, then the last 3 days each night. Returns the number of half hours
    received. Raises LinkyError on an HTTP error, keeping what was fetched before."""
    api = _Paced(http or _client(), token, min_interval)
    today = today or datetime.now(ZoneInfo(tz)).date()
    linky = store.doc("linky")
    window = max(date.fromisoformat(first_day), today - timedelta(days=CURVE_BACKFILL_DAYS))
    # Days up to `curve_scan` were already asked for: an empty one (curve collection not
    # enabled at the time) is not asked again, except the last few days.
    scanned = linky.get("curve_scan")
    begin = max(window, date.fromisoformat(scanned) + timedelta(days=1)) if scanned else window
    refresh_from = today - timedelta(days=CURVE_REFRESH_DAYS)
    have = _curve_days(store, range(window.year, today.year + 1))
    days = [window + timedelta(days=i) for i in range((today - window).days)]
    wanted = [d for d in days if d >= refresh_from or (d >= begin and have.get(d.isoformat(), 0) < CURVE_MIN_SLOTS)]
    received = 0
    for start, end in _chunks(wanted, CURVE_CHUNK_DAYS):
        resp = api.get(API_CURVE, {"pointId": prm, "dateDebut": start.isoformat(), "dateFin": end.isoformat()})
        if resp.status_code != 200:
            raise LinkyError(
                endpoint=endpoint_of(API_CURVE), status=resp.status_code, auth=resp.status_code in (401, 403)
            )
        body = _json(resp, "courbe_de_charge_consommation")
        _check_found(body, len(_points(body)), "courbe_de_charge_consommation")
        curve = parse_curve(body, tz)
        for key, wh in curve.items():
            store.put(curve_doc(key[:4]), "curve", key, None, wh)
        received += len(curve)
        last = (end - timedelta(days=1)).isoformat()
        if last > linky.get("curve_scan", ""):
            store.set_top("linky", "curve_scan", last)
    log.info("Linky : courbe de charge, %d demi-heures pour %d jours demandés", received, len(wanted))
    return received


# ---------------------------------------------------------------- token dates (S-1.12)
def token_dates(token: str) -> tuple[str | None, str | None]:
    """(issued, expires) as YYYY-MM-DD when the Conso API token is a JWT carrying iat / exp
    (format à vérifier); None otherwise. The signature is not checked: these dates only
    drive a reminder, and the token itself is never stored."""
    parts = token.split(".")
    if len(parts) != 3:
        return None, None
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except ValueError:
        return None, None
    if not isinstance(payload, dict):
        return None, None

    def day(key: str) -> str | None:
        v = payload.get(key)
        if isinstance(v, int | float) and not isinstance(v, bool) and v > 0:
            with contextlib.suppress(OverflowError, OSError, ValueError):
                return datetime.fromtimestamp(v, UTC).date().isoformat()
        return None

    return day("iat"), day("exp")
