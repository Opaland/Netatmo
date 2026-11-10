"""#204 + #356: the home's location and its solar production profile (PVGIS).

Configuration: the repository SECRET HOME_LOCATION_JSON, written from the app (⚙ Mon logement →
« Localisation et toits », sealed in the browser), e.g.
  {"v": 1, "lat": 45.12, "lon": 4.57, "precision": 2, "commune": "…",
   "roofs": [{"name": "Grand abri", "azimuth": 180, "tilt": 15, "kwc": 3.6, "loss": 14}]}
Azimuth in compass degrees (0 north, 90 east, 180 south), tilt from the horizontal, `loss` the %
lost in cables, inverter and near shading. Same rule as the app (web/src/solar.ts parseLocation),
both checked against web/src/__fixtures__/home-location.json.

Privacy (#204, #261 — a coordinate once reached a public log through an error message):
- the coordinates are registered with `redact` before anything else, so no log line can carry
  them, in any rounding;
- PVGIS receives them rounded to 0.01° (≈ 1 km), never finer, whatever the precision stored;
- an error never quotes a value (LocationError, PvgisError carry fixed texts / HTTP codes);
- the location and the profile are written to solar.enc.json only (encrypted), never to meta.

solar.enc.json:
  {"source": "pvgis", "database": "PVGIS-SARAH3", "year": 2023, "fetched": "YYYY-MM-DD",
   "digest": "<sha256 of the location, 16 hex>", "location": {...},
   "roofs": [{"name": "...", "kwc": 3.6, "hours": {"MM-DD": [24 Wh per kWc, UTC hours]}}]}
PVGIS is asked again only when the location changes (digest): one call per roof.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import UTC, date, datetime

import httpx

from . import redact, schema
from .budget import METER
from .errors import SourceError, endpoint_of, guarded, raise_for_status
from .storage import Store

PVGIS = "https://re.jrc.ec.europa.eu/api/v5_3/seriescalc"
# Year of the hourly weather behind the profile: the last year of PVGIS-SARAH3 (read on
# re.jrc.ec.europa.eu, 10/11/2026). A data choice, not an assumption of the owner.
PVGIS_YEAR = 2023
THIRD_PARTY_DECIMALS = 2  # ≈ 1 km: the finest a third party ever receives (#204)
MAX_ROOFS = 6
NAME_MAX = 40
COMMUNE_MAX = 60
MAX_WH_PER_KWC_HOUR = 1500


class LocationError(ValueError):
    """Invalid HOME_LOCATION_JSON. Messages never quote the values (public log)."""


class PvgisError(SourceError):
    """Never httpx's message: the URL holds the coordinates (#261)."""

    source = "PVGIS"


def _num(v: object) -> float | None:
    if isinstance(v, bool) or not isinstance(v, int | float):
        return None
    return float(v) if math.isfinite(v) else None


def _text(v: object, max_len: int) -> str | None:
    if not isinstance(v, str):
        return None
    s = "".join(" " if (ord(c) < 32 or ord(c) == 127 or c in "\u2028\u2029") else c for c in v)
    s = " ".join(s.split())
    return s[:max_len]


def _round(x: float, d: int) -> float:
    # Same as the app's Math.round(x * 10**d) / 10**d (half up), not Python's banker's rounding.
    return math.floor(x * 10**d + 0.5) / 10**d


def parse_roof(v: object) -> dict:
    if not isinstance(v, dict):
        raise LocationError("toit illisible")
    name = _text(v.get("name"), NAME_MAX)
    az, tilt, kwc, loss = (_num(v.get(k)) for k in ("azimuth", "tilt", "kwc", "loss"))
    if not name or az is None or tilt is None or kwc is None or loss is None:
        raise LocationError("toit incomplet (nom, orientation, pente, kWc, pertes)")
    if not (0 <= az < 360 and 0 <= tilt <= 90 and 0 < kwc <= 36 and 0 <= loss <= 60):
        raise LocationError("toit hors des bornes")
    return {
        "name": name,
        "azimuth": int(_round(az, 0)),
        "tilt": int(_round(tilt, 0)),
        "kwc": _round(kwc, 2),
        "loss": _round(loss, 1),
    }


def parse_location(raw: str | object) -> dict:
    """The validated location (rounded to its own precision); LocationError otherwise."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raise LocationError("JSON illisible") from None
    if not isinstance(raw, dict) or raw.get("v") != 1 or isinstance(raw.get("v"), bool):
        raise LocationError("version inconnue")
    p = raw.get("precision")
    if isinstance(p, bool) or p not in (1, 2, 3):
        raise LocationError("précision inconnue")
    lat, lon = _num(raw.get("lat")), _num(raw.get("lon"))
    if lat is None or lon is None or abs(lat) > 90 or abs(lon) > 180:
        raise LocationError("coordonnées hors des bornes")
    commune = "" if "commune" not in raw else _text(raw.get("commune"), COMMUNE_MAX)
    if commune is None:
        raise LocationError("commune illisible")
    roofs = raw.get("roofs")
    if not isinstance(roofs, list) or not 1 <= len(roofs) <= MAX_ROOFS:
        raise LocationError(f"de 1 à {MAX_ROOFS} toits attendus")
    return {
        "v": 1,
        "lat": _round(lat, p),
        "lon": _round(lon, p),
        "precision": p,
        "commune": commune,
        "roofs": [parse_roof(r) for r in roofs],
    }


def register(loc: dict) -> None:
    """Every printable form of the coordinates is masked from now on (public log)."""
    for v in (loc["lat"], loc["lon"]):
        redact.register_coordinate(v)
        redact.register_coordinate(_round(v, THIRD_PARTY_DECIMALS))
    if loc.get("commune"):
        redact.register(loc["commune"])


def digest(loc: dict) -> str:
    return hashlib.sha256(json.dumps(loc, sort_keys=True).encode()).hexdigest()[:16]


def pvgis_params(loc: dict, roof: dict) -> dict:
    """The query of one roof: 1 kWc, coordinates rounded to ≈ 1 km, PVGIS azimuth (0 = south)."""
    return {
        "lat": f"{_round(loc['lat'], THIRD_PARTY_DECIMALS):.2f}",
        "lon": f"{_round(loc['lon'], THIRD_PARTY_DECIMALS):.2f}",
        "peakpower": 1,
        "loss": roof["loss"],
        "angle": roof["tilt"],
        "aspect": ((roof["azimuth"] - 180 + 540) % 360) - 180,
        "pvcalculation": 1,
        "usehorizon": 1,  # far shading by the relief, computed by PVGIS
        "outputformat": "json",
        "startyear": PVGIS_YEAR,
        "endyear": PVGIS_YEAR,
    }


def hours_of(body: dict) -> dict[str, list[float]]:
    """outputs.hourly → {"MM-DD": [24 Wh per kWc]} (UTC hours; P is the mean W of the hour)."""
    out: dict[str, list[float]] = {}
    for h in body["outputs"]["hourly"]:
        t, p = h.get("time"), _num(h.get("P"))
        if not isinstance(t, str) or len(t) < 11 or p is None or p < 0:
            continue
        key, hour = f"{t[4:6]}-{t[6:8]}", t[9:11]
        if not hour.isdigit() or int(hour) > 23:
            continue
        out.setdefault(key, [0.0] * 24)[int(hour)] = min(MAX_WH_PER_KWC_HOUR, round(p, 1))
    if len(out) < 300:
        raise PvgisError("PVGIS : moins de 300 jours dans la réponse")
    return out


def fetch_roof(http: httpx.Client, loc: dict, roof: dict) -> tuple[dict[str, list[float]], str]:
    path = endpoint_of(PVGIS)
    with guarded(PvgisError, path), METER.call("pvgis"):
        resp = http.get(PVGIS, params=pvgis_params(loc, roof))
    raise_for_status(resp, PvgisError, path)
    try:
        body = resp.json()
    except ValueError:
        raise PvgisError(endpoint=path, category="api", code="json") from None
    schema.check("PVGIS", "seriescalc", schema.PVGIS_SERIES, body)
    db = body.get("inputs", {}).get("meteo_data", {}).get("radiation_db")
    return hours_of(body), db if isinstance(db, str) and db.isascii() and len(db) <= 40 else ""


def collect(store: Store, raw: str, http: httpx.Client | None = None, today: date | None = None) -> str:
    """Refresh solar.enc.json when the location changed. Returns a note for the sources (counts,
    never a value). LocationError / PvgisError / FormatError / CallCapReached propagate."""
    loc = parse_location(raw)
    register(loc)
    d = digest(loc)
    doc = store.doc("solar")
    if doc.get("digest") == d and doc.get("source") == "pvgis" and doc.get("roofs"):
        return f"{len(loc['roofs'])} toit(s), profil déjà à jour"
    http = http or httpx.Client(timeout=60.0)
    roofs, database = [], ""
    for roof in loc["roofs"]:
        hours, database = fetch_roof(http, loc, roof)
        roofs.append({"name": roof["name"], "kwc": roof["kwc"], "hours": hours})
    store.replace(
        "solar",
        {
            "source": "pvgis",
            "database": database,
            "year": PVGIS_YEAR,
            "fetched": (today or datetime.now(UTC).date()).isoformat(),
            "digest": d,
            "location": loc,
            "roofs": roofs,
        },
    )
    return f"{len(roofs)} toit(s), profil PVGIS mis à jour"
