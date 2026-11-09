"""Generate realistic fake data so the PWA can be tried without an Intuis account."""

from __future__ import annotations

import json
import math
import random
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .devices import collect_status
from .homeassistant import import_bytes
from .model import HEATING, WATER_HEATER
from .roomstate import merge_snapshots, snapshot
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
# S-1.8 / S-1.10: data-quality cases shown by the demo, like those of the real account.
# Days lost at Intuis (neither the day nor the month): every room, then two rooms only.
LOST = [
    (date(2024, 2, 12), date(2024, 3, 8), None),
    (date(2024, 11, 4), date(2024, 11, 17), {"r-salon", "r-cuisine"}),
]
# Days spread from a monthly total (estimated), heating rooms.
ESTIMATED = (date(2023, 12, 4), date(2023, 12, 8))
# Real days recorded far too low by Intuis (Linky saw the real consumption): "suspects".
SUSPECT = {date(2025, 1, 14): 0.12, date(2025, 1, 15): 0.15}
# Contract periods (meta.contract, S-12.1): Base, then HP/HC from October 2023 (12 kVA).
CONTRACT = [
    {"from": "2022-01-01", "offer": "edf-trv-base", "kva": 12},
    {"from": "2023-10-01", "offer": "edf-trv-hphc", "kva": 12},
]


def is_lost(rid: str, d: date) -> bool:
    return any(a <= d <= b and (rooms is None or rid in rooms) for a, b, rooms in LOST)


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


SHELLY_DAYS = 90
# S-1.17: Shelly plugs of the demo (name, model, mean W, washing cycles): the fridge and the
# freezer run around the clock; the washing machine runs ~1 kWh cycles 3 or 4 times a week;
# the TV box plug only gives its instantaneous power (not usable without a hub).
SHELLY_PLUGS = [
    ("p0", "Réfrigérateur", "SNPL-00112EU", 38.0),
    ("p1", "Congélateur", "SNPL-00112EU", 31.0),
    ("p2", "Lave-linge", "SHPLG-S", 0.0),
    ("p3", "Box TV", "SNPL-00112EU", None),
]
# S-1.30 (#279): a Shelly EM Gen3 with two clamps (water heater circuit, kitchen), one series per
# channel. Last 30 days only (installed recently).
CLAMP_DAYS = 30


def _shelly(store: Store, today: date) -> None:
    """Daily kWh of the demo Shelly plugs, last SHELLY_DAYS days (separate random stream)."""
    rnd = random.Random(158)
    start = today - timedelta(days=SHELLY_DAYS)
    for key, name, model, watts in SHELLY_PLUGS:
        store.put(
            "shelly",
            "plugs",
            key,
            None,
            {
                "id": f"demo{key}",
                "name": name,
                "model": model,
                "gen": "G1" if model == "SHPLG-S" else "G2",
                "usable": watts is not None,
            },
        )
        if watts is None:
            continue
        total = 0.0
        d = start
        while d < today:
            if watts:
                cold = max(0.0, math.cos((d.timetuple().tm_yday - 200) / 365 * 2 * math.pi))
                wh = watts * 24 * (0.9 + 0.15 * (1 - cold)) * rnd.uniform(0.93, 1.07)
            else:
                wh = rnd.uniform(850, 1250) if rnd.random() < (0.6 if d.weekday() >= 5 else 0.4) else rnd.uniform(1, 3)
            store.put("shelly", "daily", key, d.isoformat(), round(wh, 1))
            total += wh
            d += timedelta(days=1)
        store.put("shelly", "until", key, None, today.isoformat())
        store.put("shelly", "last", key, None, {"ts": 0, "total": round(total, 2)})
    clamp = random.Random(279)  # separate stream
    base = {"id": "demop4", "model": "S1EM-001PCEU", "gen": "G3", "usable": True}
    store.put("shelly", "plugs", "p4", None, {**base, "name": "Tableau électrique", "channels": 2})
    for i, label in enumerate(("Tableau électrique · canal 1", "Tableau électrique · canal 2")):
        key = f"p4c{i}"
        channel = {**base, "parent": "p4", "channel": f"em1data:{i}", "name": label}
        store.put("shelly", "plugs", key, None, channel)
        total = 0.0
        for back in range(CLAMP_DAYS, 0, -1):
            d = today - timedelta(days=back)
            wh = clamp.uniform(3800, 5200) if i == 0 else clamp.uniform(1200, 2600)
            store.put("shelly", "daily", key, d.isoformat(), round(wh, 1))
            total += wh
        store.put("shelly", "until", key, None, today.isoformat())
        store.put("shelly", "last", key, None, {"ts": 0, "total": round(total, 2)})


ROOMSTATE_DAYS = 365
# Demo absence (mode « absence » on every radiator, contactor off): a week, a month and a half ago.
ABSENCE = (45, 39)  # days before today


def _room_states(store: Store, today: date) -> dict[date, list[int]]:
    """S-13.2: the hourly homestatus snapshots of the last 365 days, as the hourly workflow
    would have taken them (about 4 % of runs missed), aggregated by the real code. Returns the
    hours the office window was really open, for the Home Assistant sensor of the demo."""
    office: dict[date, list[int]] = {}
    rnd = random.Random(13)  # separate stream: the rest of the demo stays identical
    tz = ZoneInfo("Europe/Paris")
    heated = [r for r, _n, c, _w, _s in ROOMS if c == HEATING]
    mod_room = {f"m-{r}": r for r, *_ in ROOMS}
    rnd15 = random.Random(1520)  # v1.5 fields: separate stream, the rest of the demo stays identical
    snaps = []
    for back in range(ROOMSTATE_DAYS, 0, -1):
        d = today - timedelta(days=back)
        doy = d.timetuple().tm_yday
        cold = max(0.0, min(1.0, (15 - (11.5 - 8.5 * math.cos((doy - 20) / 365 * 2 * math.pi))) / 12))
        away = ABSENCE[1] <= back <= ABSENCE[0]
        weekend = d.weekday() >= 5
        long_open = rnd.random() < 0.07  # the office aired for a whole morning
        for h in range(24):
            if rnd.random() < 0.04:
                continue  # GitHub skipped the scheduled run
            rooms, modules = [], []
            for rid in heated:
                window = {
                    "r-ch1": h in (7, 8) and rnd.random() < 0.6,
                    "r-ch2": h == 8 and rnd.random() < 0.4,
                    "r-cuisine": h == 19 and rnd.random() < 0.25,
                    "r-bureau": long_open and 9 <= h <= 12 and not weekend,
                    "r-salon": h == 14 and rnd.random() < 0.05,
                }.get(rid, False)
                if rid == "r-bureau" and window:
                    office.setdefault(d, []).append(h)
                boost = not away and (
                    (rid == "r-sdb" and h == 7 and not weekend and rnd.random() < 0.5)
                    or (rid == "r-salon" and h == 20 and rnd.random() < 0.08)
                )
                mode = "away" if away else ("manual" if rid == "r-bureau" and weekend and h > 9 else "schedule")
                rooms.append(
                    {
                        "id": rid,
                        "open_window": window,
                        "boost_status": "enabled" if boost else "disabled",
                        "therm_setpoint_mode": mode,
                    }
                )
                p = HEAT_SHAPE[h] / 10 * cold * (0.3 if away else 1.0)
                heating = not window and rnd.random() < p
                offload = heating and cold > 0.75 and 18 <= h <= 20 and rnd.random() < 0.3
                modules.append(
                    {"id": f"m-{rid}", "radiator_state": "heating" if heating else "idle", "offload": offload}
                )
            modules.append({"id": "m-r-ce", "contactor_mode": "off" if away else "auto"})
            ts = int(datetime(d.year, d.month, d.day, h, 23, tzinfo=tz).timestamp())
            _v15_snapshot(rnd15, back, h, ts, rooms, modules, away)
            snaps.append(snapshot({"body": {"home": {"rooms": rooms, "modules": modules}}}, ts, calls=2))
    merge_snapshots(store, snaps, "Europe/Paris", mod_room, today=today.isoformat())
    return office


# v1.5 (#214, #218, #276, #278): the kids' bedroom radiator lost its radio link for a day, three
# weeks ago (OFFLINE_BACK); the gateway restarted after two power cuts (BOOTS_BACK, local time);
# rooms anticipate the morning schedule and lower the setpoint at night.
OFFLINE_BACK = 21
BOOTS_BACK = ((80, 3, 12), (26, 14, 7))  # (days before today, hour, minute) of each restart
GATEWAY_SINCE = 400  # days: the gateway runs since then (first start)
TEMPO_FILE = Path(__file__).resolve().parent.parent / "web" / "public" / "tarifs" / "tempo_jours.json"
TEMPO_NAMES = {1: "blue", 2: "white", 3: "red"}


def _tempo_days() -> dict[str, int]:
    try:
        return {k: v for k, v in json.loads(TEMPO_FILE.read_text()).items() if v in TEMPO_NAMES}
    except (OSError, ValueError):
        return {}


_TEMPO = _tempo_days()


def _v15_snapshot(rnd: random.Random, back: int, h: int, ts: int, rooms: list, modules: list, away: bool) -> None:
    """Fields the v1.5 snapshots keep, added to the demo snapshot of hour h, `back` days ago."""
    for r in rooms:
        r["anticipating"] = not away and h in (5, 6) and r["id"] in ("r-salon", "r-sdb", "r-ch2") and rnd.random() < 0.8
        r["lowering"] = not away and (h >= 22 or h < 5) and r["id"] != "r-sdb"
    for m in modules:
        m["reachable"] = not (m["id"] == "m-r-ch2" and back == OFFLINE_BACK)
    start = GATEWAY_SINCE
    boot_ts = None
    for b_back, b_h, b_m in BOOTS_BACK:
        if back < b_back or (back == b_back and h > b_h):
            start, boot_ts = b_back, (b_h, b_m)
    d = datetime.fromtimestamp(ts, ZoneInfo("Europe/Paris"))
    origin = (d - timedelta(days=start - back)).replace(hour=0, minute=0)
    if boot_ts:
        origin = origin.replace(hour=boot_ts[0], minute=boot_ts[1])
    tempo_day = (d - timedelta(hours=6)).date().isoformat()
    color = TEMPO_NAMES.get(_TEMPO.get(tempo_day, 1), "blue")
    if back == 33:
        color = "white"  # one day where the gateway disagrees with api-couleur-tempo.fr (if blue there)
    modules.append(
        {
            "id": "m-gw",
            "type": "NMG",
            "uptime": int(ts - origin.timestamp()),
            "wifi_strength": round(58 + 6 * rnd.random() + (14 if back in (12, 13) else 0)),
            "therm_setpoint_day_color_type": color,
        }
    )


def _devices(store: Store, today: date) -> None:
    """v1.5 nightly reads of the last 60 nights, through the real code (#214, #216): radiator
    firmware updated 18 days ago, the kids' bedroom radiator silent 3 weeks ago; station health
    (#215): the outdoor module's battery runs low."""
    tz = ZoneInfo("Europe/Paris")
    rnd = random.Random(2150)  # separate stream
    mod_room = {f"m-{r}": r for r, *_ in ROOMS}
    types = {r: ("NMW" if c == WATER_HEATER else "NMH") for r, _n, c, _w, _s in ROOMS}
    setup = int(datetime(2021, 11, 15, 10, tzinfo=tz).timestamp())
    homesdata = {
        "body": {
            "homes": [
                {
                    "id": "demo",
                    "modules": [{"id": "m-gw", "type": "NMG", "setup_date": setup}]
                    + [{"id": f"m-{r}", "type": t, "setup_date": setup + 3600} for r, t in types.items()],
                }
            ]
        }
    }
    for back in range(60, 0, -1):
        d = today - timedelta(days=back)
        now = datetime(d.year, d.month, d.day, 5, 12, tzinfo=tz).timestamp()
        mods = [
            {
                "id": f"m-{r}",
                "type": t,
                "reachable": not (r == "r-ch2" and back == OFFLINE_BACK),
                "firmware_revision": 104 if back > 18 else 106,
                "last_seen": int(now) - 600,
            }
            for r, t in types.items()
        ]
        rooms_: list = []
        gw_mods: list = []
        _v15_snapshot(random.Random(back), back, 5, int(now), rooms_, gw_mods, False)
        gw = {**gw_mods[0], "firmware_revision": 312 if back > 45 else 318}
        collect_status(store, homesdata, {"body": {"home": {"modules": [gw, *mods]}}}, "Europe/Paris", mod_room, now)
    # Station health: m0 main (Wi-Fi), m1 outdoor (battery running low), m2 / m3 indoor modules.
    for back in range(90, 0, -1):
        day = (today - timedelta(days=back)).isoformat()
        store.put("station", "health", "m0", day, [None, 52 + rnd.randint(0, 6), 1])
        store.put("station", "health", "m1", day, [max(9, 34 - (90 - back) // 3), 74 + rnd.randint(0, 8), 1])
        store.put("station", "health", "m2", day, [88 - (90 - back) // 15, 66 + rnd.randint(0, 6), 1])
        store.put("station", "health", "m3", day, [71 - (90 - back) // 15, 81 + rnd.randint(0, 6), int(back != 40)])
    station = (("m0", "NAMain", "181"), ("m1", "NAModule1", "50"), ("m2", "NAModule4", "50"), ("m3", "NAModule4", "50"))
    for key, t, fw in station:
        store.put("devices", "modules", key, None, {"type": t, "fw": fw})
    store.put("devices", "firmware", "m0", None, [[(today - timedelta(days=52)).isoformat(), "178", "181"]])


# Intuis's view of the contract (#278): set to Base 9 kVA in the Intuis app while the shared contract
# says HP/HC 12 kVA: the demo shows the warning.
INTUIS_CONTRACT = {"tariff": "edf", "tariff_option": "base", "price_type": "base", "power_unit": "kva", "kva": 9.0}


def _linky_v15(store: Store, today: date) -> None:
    """#219: time of each daily peak; #277: index per rate period (HP / HC) over the last 120 days,
    with one day where the index disagrees with the daily total (shown by the quality view)."""
    rnd = random.Random(2190)  # separate stream
    linky = store.doc("linky")
    for day in sorted(linky.get("pmax", {})):
        h = rnd.choice([7, 7, 8, 12, 19, 19, 19, 20, 20, 21])
        store.put("linky", "pmax_at", day, None, f"{h:02d}:{rnd.randint(0, 59):02d}")
    hp, hc = 41_250_000.0, 28_730_000.0
    daily = linky.get("daily", {})
    for back in range(120, 0, -1):
        d = (today - timedelta(days=back)).isoformat()
        if d not in daily:
            continue
        total = daily[d] * (1.035 if back == 15 else 1.0)
        share = 0.36 + rnd.uniform(-0.03, 0.03)
        hc += total * share
        hp += total * (1 - share)
        read = (today - timedelta(days=back - 1)).isoformat()  # read at the start of the next day
        store.put("linky", "index", "distributeur.hch", read, round(hc))
        store.put("linky", "index", "distributeur.hph", read, round(hp))
    store.set_top("linky", "index_status", 200)


HA_DAYS = 120


def _home_assistant(store: Store, today: date, office: dict[date, list[int]]) -> None:
    """S-1.18: what `import-ha` would make of a Home Assistant export: the office window contact
    (Zigbee) over 120 days, with the short airings the radiator cannot see, and a fridge plug
    and a bedroom probe as long-term statistics. Imported by the real code."""
    rnd = random.Random(18)  # separate stream
    tz = ZoneInfo("Europe/Paris")
    start = today - timedelta(days=HA_DAYS)
    attrs = {"device_class": "window", "friendly_name": "Fenêtre bureau"}
    states = [
        {
            "entity_id": "binary_sensor.fenetre_bureau",
            "state": "off",
            "last_changed": datetime(start.year, start.month, start.day, tzinfo=tz).isoformat(),
            "attributes": attrs,
        }
    ]

    def event(d: date, h: int, m: int, on: bool) -> None:
        states.append(
            {
                "state": "on" if on else "off",
                "last_changed": datetime(d.year, d.month, d.day, h, m, tzinfo=tz).isoformat(),
            }
        )

    for back in range(HA_DAYS, 0, -1):
        d = today - timedelta(days=back)
        hours = office.get(d, [])
        if hours:  # the radiator saw it too
            event(d, min(hours), rnd.randint(0, 10), True)
            event(d, max(hours), rnd.randint(40, 59), False)
        if rnd.random() < 0.15:  # a 40-minute airing on a mild day: no drop the radiator can see
            event(d, 13, 5, True)
            event(d, 13, 45, False)
    event(today, 0, 0, False)
    import_bytes(store, json.dumps([states]).encode(), "Europe/Paris")
    stats: dict[str, list[dict]] = {"sensor.prise_frigo_energy": [], "sensor.sonde_chambre_enfant": []}
    total = 820.0
    for back in range(HA_DAYS, 0, -1):
        d = today - timedelta(days=back)
        ms = int(datetime(d.year, d.month, d.day, tzinfo=tz).timestamp() * 1000)
        change = round(rnd.uniform(0.9, 1.3), 3)
        total += change
        stats["sensor.prise_frigo_energy"].append({"start": ms, "sum": round(total, 3), "change": change})
        mean = 19.2 + rnd.gauss(0, 0.5)
        stats["sensor.sonde_chambre_enfant"].append(
            {"start": ms, "mean": round(mean, 2), "min": round(mean - 1.3, 2), "max": round(mean + 1.1, 2)}
        )
    doc = {"units": {"sensor.prise_frigo_energy": "kWh", "sensor.sonde_chambre_enfant": "°C"}, "statistics": stats}
    import_bytes(store, json.dumps(doc).encode(), "Europe/Paris")


def _sources(today: date) -> dict:
    """State of the sources (S-1.7, S-1.12) as the settings screen shows it."""
    ok = f"{today.isoformat()}T04:12:00+00:00"
    linky_since = date(today.year - 1, 3, 2)
    return {
        "intuis": {"ok": ok},
        "open-meteo": {"ok": ok},
        "netatmo": {"ok": ok, "since": "2023-11-20", "note": "pile faible : 1 module(s)"},
        "linky": {
            "ok": ok,
            "since": linky_since.isoformat(),
            "expires": linky_since.replace(year=linky_since.year + 3).isoformat(),
            "expires_estimated": True,
        },
        "linky-30min": {"ok": ok},
        "shelly": {
            "ok": ok,
            "since": (today - timedelta(days=SHELLY_DAYS)).isoformat(),
            "note": "1 prise(s) sans compteur d'énergie : non exploitable(s) sans hub",
        },
        "releve-horaire": {"ok": ok, "note": "161 relevés sur 168 heures (7 derniers jours)"},
        "appareils": {
            "ok": ok,
            "note": "8 modules, 0 module(s) injoignable(s), 0 mise(s) à jour de firmware détectée(s), "
            "passerelle redémarrée 0 fois (7 j)",
        },
        "ia": {"ok": ok},
    }


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
    spread: dict[str, dict[str, float]] = {}  # estimated days: room -> day -> real Wh
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
                if ABSENCE[1] <= (today - d).days <= ABSENCE[0]:
                    kwh *= 0.15  # mode « absence » (S-13.4): radiators kept at a low setpoint
            wh = round(max(kwh, 0) * 1000, 1)
            day_total += wh  # what the meter saw, whatever Intuis kept
            lost = is_lost(rid, d)  # random draws stay the same: the rest of the demo is unchanged
            if cat == HEATING and d in SUSPECT:
                wh = round(wh * SUSPECT[d], 1)
            if not lost and cat == HEATING and ESTIMATED[0] <= d <= ESTIMATED[1]:
                spread.setdefault(rid, {})[d.isoformat()] = wh
            if not lost:
                store.merge(rid, d.isoformat(), wh)
            if d >= tariffs_from and wh and not lost:
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
                if not lost:
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
    # Estimated days: Intuis kept the month, the collector spread it evenly (S-1.10).
    for rid, days in spread.items():
        share = round(sum(days.values()) / len(days), 1)
        for day in days:
            store.merge(rid, day, share)
            store.put(day[:4], "estimated", rid, day, 1)
    store.update_coverage()
    _shelly(store, today)
    office = _room_states(store, today)
    _devices(store, today)
    _linky_v15(store, today)
    _home_assistant(store, today, office)
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
        "has_shelly": True,
        "has_roomstate": True,
        "has_ha": True,
        "weather_source": "open-meteo",
        "contract": CONTRACT,
        "intuis_contract": INTUIS_CONTRACT,
        "sources": _sources(today),
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
                "fenetres_et_boost": {
                    "couverture_releve_pct": 96,
                    "pieces": [
                        {"piece": "Chambres (regroupées)", "fenetre_ouverte_h": 41.3, "boost_h": 0.0},
                        {"piece": "Pièce A", "fenetre_ouverte_h": 1.0, "boost_h": 2.1},
                    ],
                },
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
