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
    _collect_pmax(store, api, prm, start, today)
    if not rows:
        return 0
    factor = ENERGY_UNITS[_unit(store, "unit", bodies, rows, ENERGY_UNITS)]
    for day, v in rows:
        store.put("linky", "daily", day, None, round(v * factor, 1))
    log.info("Linky : %d jours", len(rows))
    return len(rows)


def _collect_pmax(store: Store, api: _Paced, prm: str, start: date, today: date) -> None:
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
    log.info("Linky : puissance max sur %d jours", len(rows))


# ---------------------------------------------------------------- load curve (S-1.11)
def _points(obj: object) -> list[tuple[str, float, str | None]]:
    """(timestamp, value, step) anywhere in the response, keeping the full timestamp."""
    out: list[tuple[str, float, str | None]] = []
    if isinstance(obj, dict):
        dk = next((k for k in DATE_KEYS if isinstance(obj.get(k), str)), None)
        vk = next((k for k in VALUE_KEYS if k in obj), None)
        if dk and vk is not None:
            step = next((obj[k] for k in STEP_KEYS if isinstance(obj.get(k), str)), None)
            with contextlib.suppress(TypeError, ValueError):
                out.append((obj[dk], float(obj[vk]), step))
        for v in obj.values():
            out += _points(v)
    elif isinstance(obj, list):
        for v in obj:
            out += _points(v)
    return out


def _step_minutes(step: str | None, default: int = 30) -> int:
    """Length of a point from its ISO 8601 duration (PT30M, PT10M, PT1H); `default` if unknown."""
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?", (step or "").strip().upper())
    minutes = int(m.group(1) or 0) * 60 + int(m.group(2) or 0) if m else 0
    return minutes or default


def parse_curve(body: object, tz: str) -> dict[str, float]:
    """Load curve → {"YYYY-MM-DDTHH:MM" local start of the half hour: Wh}.

    Enedis gives the average power (W) over each step, stamped at the END of the step
    (as ha-linky reads it): Wh = W × minutes / 60. Finer steps (PT10M) are summed into
    half hours; the two 02:00 of the autumn DST change are summed as well."""
    zone = ZoneInfo(tz)
    curve: dict[str, float] = {}
    for stamp, watts, step in _points(body):
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
        curve[key] = curve.get(key, 0.0) + watts * minutes / 60
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
