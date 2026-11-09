"""Generate realistic fake data so the PWA can be tried without an Intuis account."""

from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .model import HEATING, WATER_HEATER
from .station import aggregate_days
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
# Kids' bedroom CO₂ (ppm above the day level), door closed from 21 h, window opened at 7 h.
# Linky load curve, other usages (W above the ~250 W standby), per half hour: breakfast,
# lunch (mostly at weekends), cooking and evening lights/TV.
_EVENING_WEEKDAY = [300, 450, 1400, 1300, 700, 500, 450, 400, 300, 150, 100, 80]
_EVENING_WEEKEND = [500, 900, 1500, 1300, 800, 600, 500, 400, 300, 200, 150, 120]
OTHER_WEEKDAY = [60, 60] + [0] * 10 + [150, 500, 700, 600, 250, 80] + [60] * 6 + [700, 350, 80] + [60] * 9
OTHER_WEEKDAY += _EVENING_WEEKDAY
OTHER_WEEKEND = [120, 120] + [0] * 12 + [200, 400, 600, 500, 350, 300, 300, 350] + [400, 900, 1300, 1100, 400]
OTHER_WEEKEND += [300] * 9 + _EVENING_WEEKEND
CURVE_DAYS = 60
KIDS_CO2 = [700, 780, 840, 890, 930, 960, 980, 900, 250, 80, 0, 0, 0, 0, 0, 0, 50, 80, 100, 120, 150, 300, 450, 600]


def _station_hours(store: Store, rnd: random.Random, d: date, tmean: float, tmin: float, tmax: float) -> None:
    """Hourly readings of the four station modules for one day (S-11): living room (m0),
    outdoor (m1), kids' bedroom (m2, CO₂ rising at night), cellar (m3, humid)."""
    cold = max(0.0, 15 - tmean) / 15  # windows stay closed when it is cold
    cellar_hum = 70 + 3 * cold + rnd.gauss(0, 1.5)
    for h in range(24):
        hour = f"{d.isoformat()}T{h:02d}"
        wave = -math.cos((h - 4) / 24 * 2 * math.pi)  # coldest around 4 h
        out_t = tmean + (tmax - tmin) / 2 * wave
        night = h < 7 or h >= 22
        salon_t = (18.6 if night else 20.2) - 0.6 * cold * night + rnd.gauss(0, 0.25)
        salon_co2 = 550 + (350 if 18 <= h <= 22 else 0) + 250 * cold + rnd.gauss(0, 60)
        kids_t = (18.8 if night else 19.6) - 0.5 * cold + rnd.gauss(0, 0.25)
        kids_co2 = 520 + KIDS_CO2[h] * (0.75 + 0.6 * cold) + rnd.gauss(0, 50)
        rows = {
            "m0": [salon_t, 48 + 4 * wave + rnd.gauss(0, 2), salon_co2],
            "m1": [out_t, min(98, 80 - 8 * wave + rnd.gauss(0, 4)), None],
            "m2": [kids_t, 52 + KIDS_CO2[h] / 100 + rnd.gauss(0, 2), kids_co2],
            "m3": [11 + 0.35 * tmean + rnd.gauss(0, 0.15), cellar_hum + rnd.gauss(0, 1), 470 + rnd.gauss(0, 25)],
        }
        for key, (t, hum, co2) in rows.items():
            value = [round(t, 1), round(hum), None if co2 is None else round(co2)]
            store.put(f"{d.year}.station_h", "hourly", key, hour, value)


def _curve_day(store: Store, rnd: random.Random, d: date, hours_wh: list[float], other: float, weekend: bool) -> float:
    """30-min Linky curve of one day (S-1.11): radiators and water heater as recorded by the
    hourly data, plus a ~250 W standby and the other usages shaped over the day so that the
    day adds up to `other` Wh. Returns the day total (Wh), used as the Linky daily value."""
    shape = OTHER_WEEKEND if weekend else OTHER_WEEKDAY
    standby = [250 + rnd.gauss(0, 12) for _ in range(48)]  # fridge cycling, box, VMC
    rest = max(0.0, other - sum(standby) / 2)
    scale = rest / (sum(shape) / 2)
    total = 0.0
    for i in range(48):
        watts = standby[i] + shape[i] * scale * rnd.uniform(0.8, 1.2)
        wh = round(watts / 2 + hours_wh[i // 2] / 2, 1)
        store.put(f"{d.year}.linky30", "curve", f"{d.isoformat()}T{i // 2:02d}:{30 * (i % 2):02d}", None, wh)
        total += wh
    return round(total, 1)


def generate(out_dir: Path, passphrase: str = "demo", start_year: int = 2022) -> list[str]:
    rnd = random.Random(42)
    rnd_hours = random.Random(11)  # separate stream: the rest of the demo stays identical
    store = Store(out_dir, passphrase)
    today = datetime.now(ZoneInfo("Europe/Paris")).date()
    d = date(start_year, 1, 1)
    hourly_from = today - timedelta(days=365)
    curve_from = today - timedelta(days=CURVE_DAYS)
    rnd_curve = random.Random(30)  # separate stream as well
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
        # Netatmo station: living room (main), kids' bedroom, cellar, outdoor
        cold = max(0.0, 15 - tmean) / 15
        for key, base, hum, co2 in (("m0", 19.8, 50, 750), ("m2", 19.0, 55, 950), ("m3", 11 + 0.35 * tmean, 72, 480)):
            tm = base + rnd.gauss(0, 0.4)
            c = co2 + 350 * cold + rnd.gauss(0, 120)
            store.put(
                "station",
                "daily",
                key,
                d.isoformat(),
                [round(tm - 1.2, 1), round(tm + 1.4, 1), round(tm, 1), round(hum + rnd.gauss(0, 4)), round(c)],
            )
        store.put(
            "station",
            "daily",
            "m1",
            d.isoformat(),
            [round(tmin, 1), round(tmax, 1), round(tmean, 1), round(78 - tmean + rnd.gauss(0, 6)), None],
        )
        if d >= hourly_from:
            _station_hours(store, rnd_hours, d, tmean, tmin, tmax)
        dju = max(0.0, 18 - tmean)
        weekend = d.weekday() >= 5
        day_total = 0.0
        hours_wh = [0.0] * 24  # heating + water heater per hour, for the load curve
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
                        v = round(wh * w / s * rnd.uniform(0.8, 1.2), 1)
                        store.put(f"{d.year}.hourly", "hourly", rid, key, v)
                        hours_wh[h] += v
        if d >= date(start_year + 1, 1, 1):  # Linky history shorter than the radiators'
            other = 9500 + (1800 if weekend else 0) + 900 * math.cos((doy - 15) / 365 * 2 * math.pi) + rnd.gauss(0, 900)
            other = max(other, 7000)
            if d >= curve_from:
                total = _curve_day(store, rnd_curve, d, hours_wh, other, weekend)
                store.put("linky", "daily", d.isoformat(), None, total)
            else:
                store.put("linky", "daily", d.isoformat(), None, round(day_total + other, 1))
            store.put("linky", "pmax", d.isoformat(), None, round(min(11.8, 3.2 + 0.28 * dju + rnd.uniform(0, 2.5)), 2))
        d += timedelta(days=1)
    for key in ("m0", "m1", "m2", "m3"):
        aggregate_days(store, key, key != "m1", hourly_from, today)
    store.set_top("weather", "source", "open-meteo")
    store.set_top(
        "station",
        "modules",
        {
            "m0": {"name": "Salon", "type": "NAMain", "indoor": True},
            "m1": {"name": "Extérieur", "type": "NAModule1", "indoor": False},
            "m2": {"name": "Chambre enfants", "type": "NAModule4", "indoor": True},
            "m3": {"name": "Cave", "type": "NAModule4", "indoor": True},
        },
    )
    rooms = [
        {"id": r, "name": n, "category": c, "module_types": ["NMH"] if c == HEATING else ["NMW"], "virtual": False}
        for r, n, c, _w, _sp in ROOMS
    ]
    extra = {
        "has_tariffs": True,
        "has_temps": True,
        "has_linky": True,
        "has_station": True,
        "weather_source": "open-meteo",
    }
    store.replace(
        "insights",
        {
            "period": "exemple",
            "generated": today.isoformat(),
            "model": "exemple (démo)",
            "verified": True,
            "markdown": (
                "### Un mois plus sobre que l'an dernier, à météo comparable\n"
                "Le chauffage a consommé un peu moins que l'an dernier à la même période, alors que le mois a "
                "été aussi froid : l'effet vient donc des réglages, pas de la météo.\n"
                "### Ce qui a compté\n"
                "- **Salon** : toujours la première pièce, mais en baisse.\n"
                "- **Chauffe-eau** : stable, il chauffe surtout la nuit en heures creuses.\n"
                "### À essayer\n"
                "- Baisser la consigne de la **salle de bain** hors des créneaux du matin.\n"
                "- Vérifier la relance de 7 h dans le **bureau** le week-end."
            ),
            # What would have been sent: pseudonyms only (S-5.7), and the usage of the call (S-5.8)
            "facts": {
                "mois": "exemple",
                "pieces": [{"piece": "Pièce A", "usage": "chauffage", "kwh": 310.0, "kwh_annee_precedente": 340.0}],
                "station_confort": {"Capteur A": {"co2_moyen_ppm": 870, "heures_nuit_co2_sup_1000_ppm": 42}},
            },
            "pseudonyms": {"Pièce A": "Salon", "Capteur A": "Chambre enfants"},
            "usage": {
                "requests": 1,
                "input_tokens": 2100,
                "output_tokens": 900,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cost_usd": 0.0264,
                "cost_eur": 0.023,
                "eur_per_usd": 0.87,
                "served_by": ["claude-opus-5-5"],
            },
        },
    )
    return store.save({"id": "demo", "name": "Maison démo", "timezone": "Europe/Paris"}, rooms, extra)
