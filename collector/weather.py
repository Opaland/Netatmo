"""Outdoor temperatures for degree days (DJU): Open-Meteo, or the Netatmo station if configured.

Open-Meteo is free and needs no key: https://open-meteo.com (archive = ERA5 reanalysis,
a few days late; the forecast endpoint fills the last days).

S-3.12 (#221): the daily mean wind at 10 m (km/h), the strongest gust and the rain (mm) come
from Open-Meteo in every case (the station of the home has neither anemometer nor rain gauge,
audit of 9 November 2026): in the same calls as the temperatures when Open-Meteo gives them,
else in calls of their own (`open_meteo_wind`). weather.enc.json:
  "wind": {"YYYY-MM-DD": [mean km/h, gust max km/h | null]}, "rain": {"YYYY-MM-DD": mm},
  "wind_source": "open-meteo"
A refusal of these variables (HTTP 400) never costs the temperatures: they are asked again alone.

#452: the daily global radiation (`shortwave_radiation_sum`, MJ/m²) comes with them, to tell the
days with little sun (a south-facing door hides its losses on sunny days): "sun": {"YYYY-MM-DD": MJ/m²}.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from . import redact, schema
from .budget import METER
from .errors import SourceError, endpoint_of, guarded, raise_for_status
from .storage import Store

log = logging.getLogger(__name__)

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
FORECAST = "https://api.open-meteo.com/v1/forecast"
DAILY = "temperature_2m_min,temperature_2m_max,temperature_2m_mean"
WIND = "wind_speed_10m_mean,wind_gusts_10m_max,precipitation_sum,shortwave_radiation_sum"

# #464: degree days, base 18 °C, « méthode météo » of Météo-France: 18 − (min + max) / 2 each
# day, 0 when warmer. A choice, so that a total reads against public figures; the reasons are in
# web/src/analysis.ts (DJU_BASE), kept equal to this one by web/src/dju.test.ts.
DJU_BASE = 18


def degree_days(tmin: float, tmax: float, base: float = DJU_BASE) -> float:
    """The degree days of one day (méthode météo)."""
    return max(0.0, base - (tmin + tmax) / 2)


class WeatherError(SourceError):
    """S-1.16 #261: never httpx's raise_for_status(), whose message holds the URL, hence the
    home's coordinates (latitude / longitude in the query string)."""

    source = "Open-Meteo"


def _get(http: httpx.Client, url: str, params: dict, spec: object = schema.OPEN_METEO_DAILY) -> dict:
    path = endpoint_of(url)
    with guarded(WeatherError, path), METER.call("open-meteo"):
        resp = http.get(url, params=params)
    raise_for_status(resp, WeatherError, path)
    endpoint = url.rsplit("/", 1)[-1]
    return schema.check("Open-Meteo", endpoint, spec, resp.json())


def _get_with_wind(http: httpx.Client, url: str, params: dict) -> dict:
    """Temperatures and wind in one call; temperatures alone if the wind variables are refused."""
    try:
        return _get(http, url, {**params, "daily": f"{DAILY},{WIND}"})
    except WeatherError as err:
        if err.status != 400:
            raise
    # outside the except: no error left as the context of a second failure (public log)
    log.warning("Open-Meteo : vent et pluie refusés (HTTP 400), températures seules")
    return _get(http, url, {**params, "daily": DAILY})


def _wind_rows(body: dict) -> list[tuple[str, list | None, float | None, float | None]]:
    """(day, [mean km/h, gust km/h | None] or None, rain mm or None, radiation MJ/m² or None) per day."""
    d = body.get("daily", {})
    out = []

    def col(k: str, i: int) -> float | None:
        values = d.get(k) or []
        return values[i] if i < len(values) else None

    for i, day in enumerate(d.get("time", [])):
        mean, gust, rain = col("wind_speed_10m_mean", i), col("wind_gusts_10m_max", i), col("precipitation_sum", i)
        wind = None if mean is None else [round(mean, 1), None if gust is None else round(gust)]
        sun = col("shortwave_radiation_sum", i)
        out.append((day, wind, None if rain is None else round(rain, 1), None if sun is None else round(sun, 1)))
    return out


def _store_wind(store: Store, body: dict, today: str) -> int:
    n = 0
    for day, wind, rain, sun in _wind_rows(body):
        if day > today:
            continue
        if sun is not None:
            store.put("weather", "sun", day, None, sun)
        if wind is not None:
            store.put("weather", "wind", day, None, wind)
            n += 1
        if rain is not None:
            store.put("weather", "rain", day, None, rain)
    if n:
        store.set_top("weather", "wind_source", "open-meteo")
    return n


def _rows(body: dict) -> list[tuple[str, list[float]]]:
    d = body.get("daily", {})
    out = []
    for i, day in enumerate(d.get("time", [])):
        vals = [d.get(k, [None] * (i + 1))[i] for k in DAILY.split(",")]
        if None in vals[:2]:
            continue
        mean = vals[2] if vals[2] is not None else (vals[0] + vals[1]) / 2
        out.append((day, [round(vals[0], 1), round(vals[1], 1), round(mean, 1)]))
    return out


def open_meteo(store: Store, lat: float, lon: float, tz: str, first_day: str, http: httpx.Client | None = None) -> int:
    """Fill weather.outdoor from first_day to today. Only missing / recent days are fetched."""
    http = http or httpx.Client(timeout=30.0)
    doc = store.doc("weather")
    if doc.get("source") not in (None, "open-meteo"):
        return 0  # a Netatmo station already provides the outdoor temperature
    today = datetime.now(ZoneInfo(tz)).date()
    start = date.fromisoformat(first_day)
    # Refresh the last 10 days (archive values land late), fetch everything older once; the
    # wind of an archive older than #221 is fetched once the same way.
    missing_from = min(
        (
            *_first_missing(doc.get("outdoor", {}), start, today - timedelta(days=10)),
            *_first_missing(doc.get("wind", {}), start, today - timedelta(days=10)),
            *_first_missing(doc.get("sun", {}), start, today - timedelta(days=10)),  # #452
        ),
        default=None,
    )
    params = _params(lat, lon, tz)
    rows: list[tuple[str, list[float]]] = []
    winds = 0
    if missing_from:
        span = {"start_date": missing_from.isoformat(), "end_date": today.isoformat()}
        body = _get_with_wind(http, ARCHIVE, {**params, **span})
        rows += _rows(body)
        winds += _store_wind(store, body, today.isoformat())
    body = _get_with_wind(http, FORECAST, {**params, "past_days": 10, "forecast_days": 1})
    rows += [r for r in _rows(body) if r[0] <= today.isoformat()]
    winds += _store_wind(store, body, today.isoformat())
    for day, vals in rows:
        store.put("weather", "outdoor", day, None, vals)
    if rows:
        store.set_top("weather", "source", "open-meteo")
    log.info("Météo Open-Meteo : %d jours, vent : %d jours", len(rows), winds)
    return len(rows)


def open_meteo_wind(
    store: Store, lat: float, lon: float, tz: str, first_day: str, http: httpx.Client | None = None
) -> int:
    """S-3.12 (#221): wind and rain alone (the Netatmo station gives the temperatures). Same
    windows as the temperatures: everything missing once, then the last 10 days."""
    http = http or httpx.Client(timeout=30.0)
    today = datetime.now(ZoneInfo(tz)).date()
    start = date.fromisoformat(first_day)
    doc = store.doc("weather")
    stop = today - timedelta(days=10)
    missing_from = min(
        (*_first_missing(doc.get("wind", {}), start, stop), *_first_missing(doc.get("sun", {}), start, stop)),
        default=None,
    )
    params = {**_params(lat, lon, tz), "daily": WIND}
    spec = schema.OPEN_METEO_WIND
    n = 0
    if missing_from:
        span = {"start_date": missing_from.isoformat(), "end_date": today.isoformat()}
        body = _get(http, ARCHIVE, {**params, **span}, spec)
        n += _store_wind(store, body, today.isoformat())
    body = _get(http, FORECAST, {**params, "past_days": 10, "forecast_days": 1}, spec)
    n += _store_wind(store, body, today.isoformat())
    log.info("Vent Open-Meteo : %d jours", n)
    return n


def _params(lat: float, lon: float, tz: str) -> dict:
    redact.register_coordinate(lat)  # S-1.16 #261: never in a public log, even by accident
    redact.register_coordinate(lon)
    return {"latitude": round(lat, 2), "longitude": round(lon, 2), "daily": DAILY, "timezone": tz}


def _first_missing(have: dict, start: date, stop: date) -> list[date]:
    first = next(_missing_days(have, start, stop), None)
    return [] if first is None else [date.fromisoformat(first)]


def _missing_days(have: dict, start: date, stop: date):
    d = start
    while d <= stop:
        if d.isoformat() not in have:
            yield d.isoformat()
        d += timedelta(days=1)
