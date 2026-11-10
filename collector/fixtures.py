"""#353: named demo fixtures for the end-to-end tests (edge cases of a real account).

Each fixture is the demo dataset (collector/demo.py, fixed random seeds) transformed in a
deterministic way, then encrypted with the demo passphrase « demo ». They are made fake data
only, generated next to the build (`web/dist/demo-fixtures/<name>/`), never committed nor
deployed. The app opens one only in demo mode, with `?fixture=<name>` in the address
(web/src/data.ts `dataDir`).

    python -m collector fixtures -o web/dist/demo-fixtures [noms…]
"""

from __future__ import annotations

import re
import shutil
import tempfile
from collections.abc import Callable
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .demo import generate
from .storage import Store

PASSPHRASE = "demo"
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}")
# meta fields recomputed by Store.save (everything else is passed back as `extra`)
_COMPUTED = {
    "home",
    "rooms",
    "years",
    "hourly_years",
    "linky_curve_years",
    "station_hourly_years",
    "room30_years",
    "first_day",
    "last_day",
    "updated",
}


class Fixture:
    """An open copy of the demo: every document decrypted, changed in place, then saved."""

    def __init__(self, out: Path, today: date) -> None:
        self.store = Store(out, PASSPHRASE)
        self.today = today
        self.dir = out
        self.names = sorted(
            p.name.removesuffix(".enc.json") for p in out.glob("*.enc.json") if p.name != "meta.enc.json"
        )
        self.meta = dict(self.store.meta)
        self.rooms: list[dict] = list(self.meta["rooms"])

    def doc(self, name: str) -> dict:
        return self.store.doc(name)

    def docs(self, *, kinds: tuple[str, ...] | None = None) -> list[str]:
        """Names of the documents, optionally only the yearly ones of these kinds ("" = daily)."""
        if kinds is None:
            return list(self.names)
        out = []
        for n in self.names:
            if n[:4].isdigit() and n[4:].lstrip(".") in kinds:
                out.append(n)
        return out

    def ago(self, days: int) -> str:
        return (self.today - timedelta(days=days)).isoformat()

    def drop_days(self, names: list[str], keep: Callable[[str], bool], room: str | None = None) -> None:
        """Remove every entry keyed by a day (or an hour of a day) that `keep` rejects, in the
        given documents; only under `room` when one is given."""
        for name in names:
            doc = self.doc(name)
            if room is None:
                _prune(doc, keep)
            else:
                for section in doc.values():
                    if isinstance(section, dict) and isinstance(section.get(room), dict):
                        _prune(section[room], keep)

    def module_of(self, room: str) -> list[str]:
        mods = self.doc("devices").get("modules", {})
        return [k for k, m in mods.items() if isinstance(m, dict) and m.get("room") == room]

    def save(self) -> None:
        store = self.store
        for name in self.names:
            doc = store.doc(name)
            if _empty(doc):  # a year left without any value: the file goes, like a fresh account
                (self.dir / f"{name}.enc.json").unlink(missing_ok=True)
                store._docs.pop(name, None)
                store._dirty.discard(name)
            else:
                store._dirty.add(name)
        store.update_coverage()
        extra = {k: v for k, v in self.meta.items() if k not in _COMPUTED}
        store.save(self.meta["home"], self.rooms, extra)


def _prune(obj: Any, keep: Callable[[str], bool]) -> None:
    if not isinstance(obj, dict):
        return
    for k in list(obj):
        if _DAY.match(k) and not keep(k[:10]):
            del obj[k]
        else:
            _prune(obj[k], keep)
            if isinstance(obj[k], dict) and not obj[k] and _DAY.match(k):
                del obj[k]


def _empty(obj: Any) -> bool:
    """No value at all (only empty dicts, or a lone « source »-like string at the top)."""
    if isinstance(obj, dict):
        return all(_empty(v) for k, v in obj.items() if k not in ("coverage",))
    return False


# --------------------------------------------------------------------------- the fixtures
ENERGY = ("", "hourly", "room30")  # what the radiators report (Intuis)


def _clip(f: Fixture, start: str) -> None:
    """The archive starts on `start`: everything before is removed, in every document."""
    f.drop_days(f.docs(), lambda d: d >= start)
    contract = f.meta.get("contract", [])
    # the period in force on `start` begins on `start`; the later ones are kept
    current = [c for c in contract if c["from"] <= start][-1:]
    f.meta["contract"] = [{**c, "from": start} for c in current] + [c for c in contract if c["from"] > start]


def annee_incomplete(f: Fixture) -> None:
    """The first year starts in July: the yearly comparisons have an incomplete year."""
    _clip(f, date(f.today.year - 1, 7, 1).isoformat())


def une_annee(f: Fixture) -> None:
    """Exactly one year of history: no « vs l'an dernier » to the day for most periods."""
    _clip(f, f.ago(365))


def quelques_jours(f: Fixture) -> None:
    """Twelve days of history (no full month, no full year)."""
    _clip(f, f.ago(12))


def trou_41_jours(f: Fixture) -> None:
    """Intuis lost 41 days, two weeks ago (every room); Linky and the station kept them."""
    a, b = f.ago(55), f.ago(14)  # [a, b[ : 41 days
    f.drop_days(f.docs(kinds=ENERGY) + ["roomstate"], lambda d: not (a <= d < b))


def piece_hors_ligne(f: Fixture) -> None:
    """The kids' bedroom radiator stopped answering ten days ago (no value since)."""
    since = f.ago(10)
    for name in f.docs(kinds=ENERGY) + ["roomstate"]:
        f.drop_days([name], lambda d: d < since, room="r-ch2")
    reach = f.doc("devices").setdefault("reach", {})
    for key in f.module_of("r-ch2"):
        days = reach.setdefault(key, {})
        for back in range(10, 0, -1):
            days[f.ago(back)] = 0


def piece_coupee(f: Fixture) -> None:
    """The office is switched off at the fuse board for two months: 0 Wh, no temperature."""
    since = f.ago(60)
    for name in f.docs(kinds=("",)):
        doc = f.doc(name)
        for d in list(doc.get("daily", {}).get("r-bureau", {})):
            if d >= since:
                doc["daily"]["r-bureau"][d] = 0.0
        for section in ("tariffs", "temps"):
            _prune(doc.get(section, {}).get("r-bureau", {}), lambda d: d < since)
    for name in f.docs(kinds=("hourly", "room30")):
        f.drop_days([name], lambda d: d < since, room="r-bureau")


def sans_chauffe_eau(f: Fixture) -> None:
    """No water heater on the account."""
    f.rooms = [r for r in f.rooms if r["id"] != "r-ce"]
    f.store.delete_room("r-ce")
    f.doc("roomstate").get("rooms", {}).pop("r-ce", None)
    mods = f.doc("devices").get("modules", {})
    for key in f.module_of("r-ce"):
        mods.pop(key, None)
        f.doc("devices").get("reach", {}).pop(key, None)


def _station_keep(f: Fixture, keep: set[str], names: dict[str, str]) -> None:
    station = f.doc("station")
    station["modules"] = {
        k: {**m, "name": names.get(k, m["name"])} for k, m in station.get("modules", {}).items() if k in keep
    }
    for section in station.values():
        if isinstance(section, dict) and section is not station["modules"]:
            for k in [k for k in section if re.fullmatch(r"m\d+", k) and k not in keep]:
                del section[k]
    for name in f.docs(kinds=("station_h",)):
        hourly = f.doc(name).get("hourly", {})
        for k in [k for k in hourly if k not in keep]:
            del hourly[k]
    mods = f.doc("devices").get("modules", {})
    for k in [k for k in mods if re.fullmatch(r"m\d+", k) and k not in keep]:
        del mods[k]


def station_sans_module(f: Fixture) -> None:
    """A weather station alone (no outdoor nor indoor module), named after no room."""
    _station_keep(f, {"m0"}, {"m0": "Séjour"})


def module_nom_different(f: Fixture) -> None:
    """Station modules named differently from the rooms (« Chambre de Léa » vs « Chambre enfant »)."""
    _station_keep(f, {"m0", "m1", "m2", "m3"}, {"m0": "Pièce à vivre", "m2": "Chambre de Léa", "m3": "Garage"})


def sans_station(f: Fixture) -> None:
    """No Netatmo weather station."""
    for name in ["station", *f.docs(kinds=("station_h",))]:
        f.store.replace(name, {})
    f.meta["has_station"] = False
    mods = f.doc("devices").get("modules", {})
    for k in [k for k in mods if re.fullmatch(r"m\d+", k)]:
        del mods[k]
    f.doc("devices").pop("firmware", None)


def valeurs_nulles(f: Fixture) -> None:
    """Missing measures inside the documents: no setpoint, no humidity / CO₂, empty hours,
    days at 0 Wh for every room and a Linky day at 0."""
    since = f.ago(30)
    for name in f.docs(kinds=("",)):
        for days in f.doc(name).get("temps", {}).values():
            for d, v in days.items():
                if d >= since:
                    days[d] = [v[0], None]
        for days in f.doc(name).get("daily", {}).values():
            for back in (3, 4, 5):
                if f.ago(back) in days:
                    days[f.ago(back)] = 0.0
    for days in f.doc("station").get("daily", {}).values():
        for d, v in days.items():
            if d >= since:
                days[d] = [*v[:3], None, None]
    for name in f.docs(kinds=("station_h",)):
        for hours in f.doc(name).get("hourly", {}).values():
            for h in hours:
                if h >= f.ago(7):
                    hours[h] = [None, None, None]
    linky = f.doc("linky").get("daily", {})
    if f.ago(2) in linky:
        linky[f.ago(2)] = 0.0


def sans_prix(f: Fixture) -> None:
    """No contract nor price known: costs cannot be computed."""
    for key in ("contract", "intuis_contract"):
        f.meta.pop(key, None)
    f.meta["has_tariffs"] = False
    for name in f.docs(kinds=("",)):
        f.doc(name).pop("tariffs", None)


FIXTURES: dict[str, Callable[[Fixture], None]] = {
    "annee-incomplete": annee_incomplete,
    "une-annee": une_annee,
    "quelques-jours": quelques_jours,
    "trou-41-jours": trou_41_jours,
    "piece-hors-ligne": piece_hors_ligne,
    "piece-coupee": piece_coupee,
    "sans-chauffe-eau": sans_chauffe_eau,
    "station-sans-module": station_sans_module,
    "module-nom-different": module_nom_different,
    "sans-station": sans_station,
    "valeurs-nulles": valeurs_nulles,
    "sans-prix": sans_prix,
}


def build(out_dir: Path, names: list[str] | None = None) -> list[str]:
    """Generate the demo once, then one folder per fixture under `out_dir`. Returns the names."""
    names = names or list(FIXTURES)
    unknown = [n for n in names if n not in FIXTURES]
    if unknown:
        raise SystemExit(f"Fixtures inconnues : {', '.join(unknown)} (connues : {', '.join(FIXTURES)})")
    today = datetime.now(ZoneInfo("Europe/Paris")).date()
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp) / "demo"
        generate(base, PASSPHRASE)
        for name in names:
            out = out_dir / name
            shutil.rmtree(out, ignore_errors=True)
            shutil.copytree(base, out)
            f = Fixture(out, today)
            FIXTURES[name](f)
            f.save()
    return names
