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
    ("r-salon", "Salon", HEATING, 2.2),
    ("r-cuisine", "Cuisine", HEATING, 1.0),
    ("r-ch1", "Chambre parentale", HEATING, 1.2),
    ("r-ch2", "Chambre enfant", HEATING, 1.0),
    ("r-sdb", "Salle de bain", HEATING, 0.8),
    ("r-bureau", "Bureau", HEATING, 0.9),
    ("r-ce", "Chauffe-eau", WATER_HEATER, 1.0),
]


def generate(out_dir: Path, passphrase: str = "demo", start_year: int = 2022) -> list[str]:
    rnd = random.Random(42)
    store = Store(out_dir, passphrase)
    today = datetime.now(ZoneInfo("Europe/Paris")).date()
    d = date(start_year, 1, 1)
    # Each winter a little milder / the house a little better insulated.
    year_factor = {
        y: 1.0 - 0.06 * (y - start_year) + rnd.uniform(-0.05, 0.05) for y in range(start_year, today.year + 1)
    }
    while d < today:
        doy = d.timetuple().tm_yday
        cold = max(0.0, math.cos((doy - 15) / 365 * 2 * math.pi))  # 1 mid-January, 0 in summer
        weekend = d.weekday() >= 5
        for rid, _name, cat, weight in ROOMS:
            if cat == WATER_HEATER:
                kwh = 3.6 + 1.4 * cold + (0.6 if weekend else 0) + rnd.gauss(0, 0.35)
            else:
                base = 6.5 * cold**1.4 * weight * year_factor[d.year]
                if rid == "r-bureau" and weekend:
                    base *= 0.4
                kwh = base * rnd.uniform(0.75, 1.25) if base > 0.05 else 0.0
            store.merge(rid, d.isoformat(), round(max(kwh, 0) * 1000, 1))
        d += timedelta(days=1)
    rooms = [
        {"id": r, "name": n, "category": c, "module_types": ["NMH"] if c == HEATING else ["NMW"]}
        for r, n, c, _w in ROOMS
    ]
    return store.save({"id": "demo", "name": "Maison démo", "timezone": "Europe/Paris"}, rooms)
