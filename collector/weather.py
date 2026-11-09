"""Outdoor temperatures for degree days (DJU): Open-Meteo, or the Netatmo station if configured.

Open-Meteo is free and needs no key: https://open-meteo.com (archive = ERA5 reanalysis,
a few days late; the forecast endpoint fills the last days).
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from . import schema
from .budget import METER
from .storage import Store

log = logging.getLogger(__name__)

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
FORECAST = "https://api.open-meteo.com/v1/forecast"
DAILY = "temperature_2m_min,temperature_2m_max,temperature_2m_mean"


def _get(http: httpx.Client, url: str, params: dict) -> dict:
    with METER.call("open-meteo"):
        resp = http.get(url, params=params)
    resp.raise_for_status()
    endpoint = url.rsplit("/", 1)[-1]
    return schema.check("Open-Meteo", endpoint, schema.OPEN_METEO_DAILY, resp.json())


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
    have = doc.get("outdoor", {})
    today = datetime.now(ZoneInfo(tz)).date()
    start = date.fromisoformat(first_day)
    # Refresh the last 10 days (archive values land late), fetch everything older once.
    missing_from = min(
        (date.fromisoformat(d) for d in _missing_days(have, start, today - timedelta(days=10))), default=None
    )
    params = {"latitude": round(lat, 2), "longitude": round(lon, 2), "daily": DAILY, "timezone": tz}
    rows: list[tuple[str, list[float]]] = []
    if missing_from:
        body = _get(http, ARCHIVE, {**params, "start_date": missing_from.isoformat(), "end_date": today.isoformat()})
        rows += _rows(body)
    body = _get(http, FORECAST, {**params, "past_days": 10, "forecast_days": 1})
    rows += [r for r in _rows(body) if r[0] <= today.isoformat()]
    for day, vals in rows:
        store.put("weather", "outdoor", day, None, vals)
    if rows:
        store.set_top("weather", "source", "open-meteo")
    log.info("Météo Open-Meteo : %d jours", len(rows))
    return len(rows)


def _missing_days(have: dict, start: date, stop: date):
    d = start
    while d <= stop:
        if d.isoformat() not in have:
            yield d.isoformat()
        d += timedelta(days=1)
