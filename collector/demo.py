"""Generate realistic fake data so the PWA can be tried without an Intuis account."""

from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .model import HEATING, WATER_HEATER
from .storage import Store

ROOMS = [
    ("r-salon", "Salon", HEATING, 2.2, 20.0),
    ("r-cuisine", "Cuisine", HEATING, 1.0, 19.5),
    ("r-ch1", "Chambre parentale", HEATING, 1.2, 18.0),
    ("r-ch2", "Chambre enfant", HEATING, 1.0, 19.0),
    ("r-sdb", "Salle de bain", HEATING, 0.8, 21.0),
    ("r-bureau", "Bureau", HEATING, 0.9, 19.5),
    ("r-ce", "Chauffe-eau", WATER_HEATER, 1.0, None),
]
# Hourly shape of heating (relances matin / soir) and water heater (heures creuses la nuit).
HEAT_SHAPE = [3, 3, 3, 3, 3, 4, 9, 10, 7, 5, 4, 4, 4, 4, 4, 4, 5, 7, 9, 9, 8, 6, 4, 3]
WATER_SHAPE = [14, 16, 16, 15, 12, 6, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 6, 10]


def generate(out_dir: Path, passphrase: str = "demo", start_year: int = 2022) -> list[str]:
    rnd = random.Random(42)
    store = Store(out_dir, passphrase)
    today = datetime.now(ZoneInfo("Europe/Paris")).date()
    d = date(start_year, 1, 1)
    hourly_from = today - timedelta(days=365)
    tariffs_from = date(2025, 1, 1)
    # The house gets a little better each year (réglages, isolation).
    efficiency = {y: 1.0 - 0.05 * (y - start_year) for y in range(start_year, today.year + 1)}
    winter_noise: dict[int, float] = {}
    while d < today:
        doy = d.timetuple().tm_yday
        # Outdoor temperature: seasonal curve + a different winter each year + daily weather.
        season_key = d.year if d.month >= 7 else d.year - 1
        winter_noise.setdefault(season_key, rnd.uniform(-1.8, 1.8))
        tmean = 11.5 - 8.5 * math.cos((doy - 20) / 365 * 2 * math.pi) + winter_noise[season_key] + rnd.gauss(0, 2.2)
        tmin, tmax = tmean - rnd.uniform(2.5, 5), tmean + rnd.uniform(2.5, 6)
        store.put("weather", "outdoor", d.isoformat(), None, [round(tmin, 1), round(tmax, 1), round(tmean, 1)])
        store.put("weather", "indoor", d.isoformat(), None, round(19.6 + rnd.gauss(0, 0.4), 1))
        dju = max(0.0, 18 - tmean)
        weekend = d.weekday() >= 5
        day_total = 0.0
        for rid, _name, cat, weight, setpoint in ROOMS:
            if cat == WATER_HEATER:
                kwh = 3.4 + 0.09 * dju + (0.6 if weekend else 0) + rnd.gauss(0, 0.3)
            else:
                base = 0.42 * dju * weight * efficiency[d.year]
                if rid == "r-bureau" and weekend:
                    base *= 0.4
                kwh = base * rnd.uniform(0.85, 1.15) if dju > 1.5 else 0.0
            wh = round(max(kwh, 0) * 1000, 1)
            store.merge(rid, d.isoformat(), wh)
            day_total += wh
            if d >= tariffs_from and wh:
                hc_share = 0.9 if cat == WATER_HEATER else 0.32
                store.put(
                    str(d.year),
                    "tariffs",
                    rid,
                    d.isoformat(),
                    [0.0, round(wh * (1 - hc_share), 1), round(wh * hc_share, 1)],
                )
            if setpoint is not None:
                measured = setpoint - (0.4 if dju > 12 else 0) + rnd.gauss(0, 0.3)
                store.put(str(d.year), "temps", rid, d.isoformat(), [round(measured, 1), setpoint])
            if d >= hourly_from and wh:
                shape = WATER_SHAPE if cat == WATER_HEATER else HEAT_SHAPE
                s = sum(shape)
                for h, w in enumerate(shape):
                    if w:
                        key = f"{d.isoformat()}T{h:02d}"
                        store.put(f"{d.year}.hourly", "hourly", rid, key, round(wh * w / s * rnd.uniform(0.8, 1.2), 1))
        if d >= date(start_year + 1, 1, 1):  # Linky history shorter than the radiators'
            other = 6500 + (1800 if weekend else 0) + 900 * math.cos((doy - 15) / 365 * 2 * math.pi) + rnd.gauss(0, 900)
            store.put("linky", "daily", d.isoformat(), None, round(day_total + max(other, 2500), 1))
        d += timedelta(days=1)
    store.set_top("weather", "source", "open-meteo")
    rooms = [
        {"id": r, "name": n, "category": c, "module_types": ["NMH"] if c == HEATING else ["NMW"], "virtual": False}
        for r, n, c, _w, _sp in ROOMS
    ]
    extra = {"has_tariffs": True, "has_temps": True, "has_linky": True, "weather_source": "open-meteo"}
    return store.save({"id": "demo", "name": "Maison démo", "timezone": "Europe/Paris"}, rooms, extra)
