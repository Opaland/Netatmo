"""Anonymous diagnostic, safe to print in a public CI log.

Prints only structure (module type codes, field names, which room holds what) and,
for each measure type, how many days returned a non-zero value. No names, no ids,
no energy values.

`--inventory` (S-1.19, `inventory`): field names, measure types, accepted scales, point counts
and history depth of every configured source (Intuis, Netatmo station, Linky), for
docs/audit-donnees.md.
"""

from __future__ import annotations

import re
import time

from .api import ApiError, IntuisClient
from .model import parse_measure_blocks
from .schema import FormatError, safe_keys

TYPES = [
    "sum_energy_elec",
    "sum_energy_elec$0",
    "sum_energy_elec$1",
    "sum_energy_elec$2",
    "sum_energy_elec_heating",
    "sum_energy_elec_hot_water",
]
DAY = 86400


def _nonzero_days(blocks: object) -> int:
    return sum(1 for _ts, v in parse_measure_blocks(blocks, DAY) if v)


# Window-open detection (#162): names this field may take, to check on a real run.
OPEN_WINDOW_KEYS = ("open_window", "window_open", "open_window_detected")


def status_keys(payload: object) -> dict[str, list[str]]:
    """Field NAMES of the rooms and modules of a homestatus response: sorted, deduplicated,
    identifiers only. Never a value, an id or a name (public log)."""
    home = (payload.get("body", {}) if isinstance(payload, dict) else {}).get("home", {})
    home = home if isinstance(home, dict) else {}
    out = {}
    for part in ("rooms", "modules"):
        items = home.get(part) or []
        out[part] = safe_keys(k for x in items if isinstance(x, dict) for k in x)
    return out


def print_status_keys(client: IntuisClient, home_id: str) -> None:
    """#162: does /syncapi/v1/homestatus expose open_window for Intuis radiators?"""
    print("\nChamps de /syncapi/v1/homestatus (noms seulement) :")
    try:
        keys = status_keys(client.homestatus(home_id))
    except (ApiError, FormatError) as err:
        print(f"  erreur : {str(err)[:80]}")
        return
    for part, label in (("rooms", "pièces"), ("modules", "modules")):
        print(f"  {label:<8}: {', '.join(keys[part]) or '(aucun)'}")
    found = [k for k in OPEN_WINDOW_KEYS if k in keys["rooms"] or k in keys["modules"]]
    print(f"  fenêtre ouverte : {', '.join(found) + ' présent' if found else 'aucun champ open_window'}")


def run(client: IntuisClient, days: int = 60, status_only: bool = False) -> None:
    raw = client.homesdata()
    homes = raw.get("body", {}).get("homes", [])
    print(f"Maisons : {len(homes)}")
    now = int(time.time())
    for hi, h in enumerate(homes):
        modules = h.get("modules", [])
        rooms = h.get("rooms", [])
        room_of = {mid: f"P{ri}" for ri, r in enumerate(rooms) for mid in r.get("module_ids", [])}
        print(f"\n== Maison {hi} : {len(rooms)} pièces, {len(modules)} modules ==")
        print_status_keys(client, h["id"])
        if status_only:
            continue
        print("Champs d'un module :", sorted({k for m in modules for k in m}))
        for mi, m in enumerate(modules):
            extra = {k: m[k] for k in ("subtype", "appliance_type", "muller_type", "category") if k in m}
            where = room_of.get(m["id"]) or ("room_id seul" if m.get("room_id") else "-")
            print(f"  M{mi}: type={m.get('type')} pièce={where} {extra}")
        bridge = next((m["id"] for m in modules if m.get("type") == "NMG"), "")
        room_ids = [str(r["id"]) for r in rooms]
        others = [m["id"] for m in modules if m.get("type") not in ("NMG", "NMH")]
        print(f"\nJours non nuls sur {days} jours, par type de mesure :")
        for t in TYPES:
            try:
                payload = client.home_measure(
                    h["id"],
                    bridge,
                    room_ids,
                    measure_type=t,
                    scale="1day",
                    date_begin=now - days * DAY,
                    date_end=now,
                    module_ids=others or None,
                )
            except ApiError as err:
                print(f"  {t:<28} erreur : {str(err)[:80]}")
                continue
            body_home = payload.get("body", {}).get("home", {})
            per_room = {str(r.get("id")): _nonzero_days(r.get("measures") or []) for r in body_home.get("rooms", [])}
            per_mod = {
                str(m.get("id")): _nonzero_days(m.get("measures") or []) for m in body_home.get("modules", []) or []
            }
            rooms_txt = " ".join(f"P{i}={per_room.get(rid, '?')}" for i, rid in enumerate(room_ids))
            mod_index = {m["id"]: i for i, m in enumerate(modules)}
            mods_txt = " ".join(f"M{mod_index.get(mid, '?')}={n}" for mid, n in per_mod.items())
            print(f"  {t:<28} {rooms_txt}  {('modules: ' + mods_txt) if mods_txt else ''}")


HISTORY_SCALES = ("1day", "1week", "1month")
COMBINED = "sum_energy_elec$0,sum_energy_elec$1,sum_energy_elec$2"


def history(client: IntuisClient) -> None:
    """Which periods still answer, at which scale (counts of non-zero points only)."""
    from datetime import UTC, datetime

    raw = client.homesdata()
    for h in raw.get("body", {}).get("homes", []):
        modules = h.get("modules", [])
        rooms = h.get("rooms", [])
        print("Dates d'installation (année-mois) :")
        for mi, m in enumerate(modules):
            sd = m.get("setup_date")
            when = datetime.fromtimestamp(int(sd), UTC).strftime("%Y-%m") if sd else "?"
            print(f"  M{mi} {m.get('type')}: {when}")
        print("Champs de la maison :", sorted(h.keys()))
        bridge = next((m["id"] for m in modules if m.get("type") == "NMG"), "")
        room_ids = [str(r["id"]) for r in rooms]
        heaters = [m["id"] for m in modules if m.get("type") == "NMW"]
        this_year = datetime.now(UTC).year
        print(f"\nPoints non nuls par année (toutes pièces + chauffe-eau), type {COMBINED} puis sum_energy_elec :")
        for mtype in (COMBINED, "sum_energy_elec"):
            for scale in HISTORY_SCALES:
                cells = []
                for year in range(this_year - 5, this_year + 1):
                    b = int(datetime(year, 1, 1, tzinfo=UTC).timestamp())
                    e = int(datetime(year + 1, 1, 1, tzinfo=UTC).timestamp())
                    try:
                        payload = client.home_measure(
                            h["id"],
                            bridge,
                            room_ids,
                            measure_type=mtype,
                            scale=scale,
                            date_begin=b,
                            date_end=e,
                            module_ids=heaters or None,
                        )
                    except ApiError as err:
                        cells.append(f"{year}=err({str(err)[:30]})")
                        continue
                    home = payload.get("body", {}).get("home", {})
                    n = sum(_nonzero_days(x.get("measures") or []) for x in home.get("rooms", []))
                    n += sum(_nonzero_days(x.get("measures") or []) for x in home.get("modules", []) or [])
                    cells.append(f"{year}={n}")
                print(f"  {mtype[:16]:<16} {scale:<7} " + " ".join(cells))


def history_deep(client: IntuisClient) -> None:
    """Probe where 2022-2023 data might live: per module, per room endpoint, other types."""
    from datetime import UTC, datetime

    h = client.homesdata()["body"]["homes"][0]
    modules = h.get("modules", [])
    bridge = next((m["id"] for m in modules if m.get("type") == "NMG"), "")
    room_ids = [str(r["id"]) for r in h.get("rooms", [])]
    nmh = [m["id"] for m in modules if m.get("type") in ("NMH", "NMR", "NMW")]
    types = [
        "sum_energy_elec",
        "sum_energy_elec$0",
        "sum_energy_elec$1",
        "sum_energy_elec$2",
        "sum_energy_elec_heating",
        "sum_energy_price",
        "sum_energy_buy_from_grid",
        "sum_energy_buy_from_grid$0",
    ]
    print("\nPar pièce (P = pièce, M = module), jours non nuls à l'échelle 1day :")
    for year in (2022, 2023, 2024, 2025):
        b = int(datetime(year, 1, 1, tzinfo=UTC).timestamp())
        e = int(datetime(year + 1, 1, 1, tzinfo=UTC).timestamp())
        for t in (
            "sum_energy_elec_heating",
            "sum_energy_elec",
            "sum_energy_elec$1,sum_energy_elec$2",
            "sum_energy_elec_hot_water",
        ):
            try:
                cells = []
                start = b
                per_room: dict[str, int] = {}
                per_mod: dict[str, int] = {}
                while start < e:
                    stop = min(start + 1000 * DAY, e)
                    p = client.home_measure(
                        h["id"],
                        bridge,
                        room_ids,
                        measure_type=t,
                        scale="1day",
                        date_begin=start,
                        date_end=stop,
                        module_ids=nmh,
                    )
                    home = p.get("body", {}).get("home", {})
                    for x in home.get("rooms", []):
                        per_room[str(x.get("id"))] = per_room.get(str(x.get("id")), 0) + _nonzero_days(
                            x.get("measures") or []
                        )
                    for x in home.get("modules", []) or []:
                        per_mod[str(x.get("id"))] = per_mod.get(str(x.get("id")), 0) + _nonzero_days(
                            x.get("measures") or []
                        )
                    start = stop
                cells = [f"P{i}={per_room.get(rid, 0)}" for i, rid in enumerate(room_ids)]
                mi = {m["id"]: i for i, m in enumerate(modules)}
                cells += [f"M{mi[mid]}={n}" for mid, n in per_mod.items() if n]
                print(f"  {year} {t[:28]:<28} " + " ".join(cells))
            except ApiError as err:
                print(f"  {year} {t[:28]:<28} erreur {str(err)[:40]}")
    for year in (2022, 2023, 2024):
        b = int(datetime(year, 1, 1, tzinfo=UTC).timestamp())
        e = int(datetime(year + 1, 1, 1, tzinfo=UTC).timestamp())
        print(f"\n== {year}, échelle 1month ==")
        for t in types:
            try:
                p = client.home_measure(
                    h["id"], bridge, room_ids, measure_type=t, scale="1month", date_begin=b, date_end=e, module_ids=nmh
                )
                home = p.get("body", {}).get("home", {})
                rooms_n = sum(_nonzero_days(x.get("measures") or []) for x in home.get("rooms", []))
                mods_n = sum(_nonzero_days(x.get("measures") or []) for x in home.get("modules", []) or [])
                txt = f"pièces={rooms_n} modules={mods_n}"
            except ApiError as err:
                txt = f"erreur {str(err)[:40]}"
            try:
                rn = 0
                for rid in room_ids:
                    rp = client.room_measure(h["id"], rid, measure_type=t, scale="1month", date_begin=b, date_end=e)
                    rn += _nonzero_days(rp.get("body", []))
                txt += f" getroommeasure={rn}"
            except ApiError as err:
                txt += f" getroommeasure=erreur {str(err)[:40]}"
            print(f"  {t:<28} {txt}")


# S-13.1: measure types that might hold a history of window / boost / presence states.
# Netatmo Energy cites `temperature`, `heating_power_request`, `sum_boiler_on` / `boileron` for its
# own thermostats (dev.netatmo.com Energy API and its community forum); the others mirror the
# `homestatus` field names seen on a real Intuis account (open_window, boost_status, presence,
# radiator_state, offload…), alone or with the `sum_` prefix of the energy types. None is documented
# for Intuis. `temperature` is a control:
# it is known to answer.
PROBE_TYPES = (
    "temperature",
    "open_window",
    "sum_open_window",
    "window_open",
    "boost",
    "sum_boost",
    "boost_status",
    "sum_boost_duration",
    "presence",
    "sum_presence",
    "therm_setpoint_mode",
    "heating_power_request",
    "sum_heating_power_request",
    "sum_boiler_on",
    "boileron",
    "radiator_state",
    "sum_radiator_state",
    "offload",
    "sum_offload",
    "anticipating",
)
PROBE_DAYS = 7
PROBE_SCALE = "1hour"


def count_points(measures: object) -> int:
    """Non-null values in measure blocks ([{beg_time, value: [[v, ...]]}] or {"<ts>": [v]})."""
    rows: list = []
    if isinstance(measures, dict):
        rows = list(measures.values())
    elif isinstance(measures, list):
        for block in measures:
            if isinstance(block, dict):
                rows += list(block.get("value") or [])
    n = 0
    for row in rows:
        for v in row if isinstance(row, list) else [row]:
            n += v is not None
    return n


def _refusal(err: Exception) -> str:
    """Why a type was refused, without the body of the answer (it may echo the request)."""
    if isinstance(err, FormatError):
        return "format inattendu"
    m = re.search(r"HTTP (\d{3})", str(err))
    return f"HTTP {m.group(1)}" if m else "erreur de l'API"


def probe_history(client: IntuisClient, types: tuple[str, ...] = PROBE_TYPES, days: int = PROBE_DAYS) -> dict:
    """Try each candidate type on gethomemeasure (all rooms) and getroommeasure (first room),
    scale 1 hour, over the last `days` days. Prints, per type and endpoint, only « accepté »
    with the number of non-null points, or « refusé » with the HTTP status: no value, id or name."""
    h = client.homesdata()["body"]["homes"][0]
    modules = h.get("modules", [])
    bridge = next((m["id"] for m in modules if m.get("type") == "NMG"), "")
    room_ids = [str(r["id"]) for r in h.get("rooms", [])]
    now = int(time.time())
    begin = now - days * DAY
    print(f"Types candidats sur {days} jours, échelle {PROBE_SCALE} (points non nuls, aucune valeur) :")
    print(f"  {'type':<28} {'gethomemeasure':<24} getroommeasure (1re pièce)")
    results: dict[str, tuple[str, str]] = {}
    for t in types:
        try:
            p = client.home_measure(
                h["id"], bridge, room_ids, measure_type=t, scale=PROBE_SCALE, date_begin=begin, date_end=now
            )
            home = p.get("body", {}).get("home", {})
            n = sum(count_points(x.get("measures")) for x in home.get("rooms", []) or [])
            home_txt = f"accepté, {n} points"
        except (ApiError, FormatError) as err:
            home_txt = f"refusé ({_refusal(err)})"
        if room_ids:
            try:
                p = client.room_measure(
                    h["id"], room_ids[0], measure_type=t, scale=PROBE_SCALE, date_begin=begin, date_end=now
                )
                room_txt = f"accepté, {count_points(p.get('body'))} points"
            except (ApiError, FormatError) as err:
                room_txt = f"refusé ({_refusal(err)})"
        else:
            room_txt = "aucune pièce"
        results[t] = (home_txt, room_txt)
        print(f"  {t:<28} {home_txt:<24} {room_txt}")
    useful = [t for t, (a, b) in results.items() if t != "temperature" and (_has_points(a) or _has_points(b))]
    print(
        "\nVerdict : "
        + (
            f"historique possible avec {', '.join(useful)} (voir S-13.1)"
            if useful
            else "aucun type historique ne renvoie de points : relevé horaire de homestatus (S-13.2)"
        )
    )
    return results


def _has_points(txt: str) -> bool:
    m = re.match(r"accepté, (\d+) points", txt)
    return bool(m and int(m.group(1)))


# ---------------------------------------------------------------- S-1.19: data inventory
# `diagnose --inventory`: what each source CAN give, to compare with what is collected
# (docs/audit-donnees.md). Prints only field names, measure type names, module type codes,
# point counts, accepted scales, HTTP statuses and how far back data goes (in days). Never a
# value, an id, a name, a MAC address, coordinates or a PRM: the log of the workflow is public.
INV_INTUIS_TYPES = (
    "sum_energy_elec",
    "sum_energy_elec$0",
    "sum_energy_elec$1",
    "sum_energy_elec$2",
    "sum_energy_elec_heating",
    "sum_energy_elec_hot_water",
    "temperature",
    "sp_temperature",
)
# Scale -> days requested (short windows: few points, one call each).
INV_INTUIS_SCALES = {"5min": 1, "30min": 3, "1hour": 7, "1day": 60}
INV_ENERGY = ",".join(INV_INTUIS_TYPES[:6])
# How far back each scale still answers: one short window ending this many days ago.
INV_DEPTH_DAYS = (7, 30, 90, 180, 365, 730, 1095, 1460, 1825)
INV_WALK_DEPTH = 6

NETATMO_API = "https://api.netatmo.com"
# Candidate getmeasure types per module type (dev.netatmo.com, Weather API, getmeasure).
# `temperature` is also asked of the wind and rain gauges: does the API refuse it? The nightly
# collection asks it of every module (S-1.19, gap G4 of docs/audit-donnees.md).
INV_STATION_TYPES = {
    "NAMain": (
        "temperature",
        "humidity",
        "co2",
        "pressure",
        "noise",
        "min_temp",
        "max_temp",
        "min_hum",
        "max_hum",
        "min_pressure",
        "max_pressure",
        "min_noise",
        "max_noise",
        "date_max_temp",
    ),
    "NAModule1": ("temperature", "humidity", "min_temp", "max_temp", "min_hum", "max_hum", "date_min_temp"),
    "NAModule4": ("temperature", "humidity", "co2", "min_temp", "max_temp", "min_hum", "max_hum"),
    "NAModule2": ("windstrength", "windangle", "guststrength", "gustangle", "temperature"),
    "NAModule3": ("rain", "sum_rain", "temperature"),
}
INV_STATION_PRIMARY = {"NAModule2": "windstrength", "NAModule3": "sum_rain"}
INV_STATION_SCALES = ("30min", "1hour", "3hours", "1day", "1week", "1month")
INV_STATION_DEPTH_DAYS = (30, 365, 1095, 1825)
# Fields worth an alert (battery, radio, reachability, firmware): presence only.
HEALTH_KEYS = (
    "battery_percent",
    "battery_vp",
    "battery_state",
    "rf_status",
    "wifi_status",
    "reachable",
    "firmware",
    "firmware_revision",
    "last_seen",
    "last_status_store",
    "last_message",
    "connection_status",
)

# Conso API (conso.boris.sh): current French endpoints, then the older English ones. Only
# consumption / production series: identity, address and contract endpoints are never called.
LINKY_BASE = "https://conso.boris.sh/api/"
INV_LINKY_ENDPOINTS = (
    "consommation_quotidienne",
    "courbe_de_charge_consommation",
    "puissance_conso_max_quotidienne",
    "production_quotidienne",
    "courbe_de_charge_production",
    "daily_consumption",
    "consumption_load_curve",
    "consumption_max_power",
    "daily_production",
    "production_load_curve",
)


def _strings(obj: object, out: set[str] | None = None) -> set[str]:
    """Every text value of a response: a key equal to one of them (a dict keyed by room
    names, say) is never printed."""
    out = set() if out is None else out
    if isinstance(obj, str):
        out.add(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            _strings(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _strings(v, out)
    return out


def _walk_lists(obj: object, key: str) -> list[list]:
    """Every list found under `key`, at any depth."""
    out: list[list] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key and isinstance(v, list):
                out.append(v)
            out += _walk_lists(v, key)
    elif isinstance(obj, list):
        for v in obj:
            out += _walk_lists(v, key)
    return out


def _name_ok(k: object, forbidden: set[str]) -> bool:
    return bool(safe_keys([k])) and k not in forbidden


def shape(obj: object, root: str = "", forbidden: set[str] | None = None) -> dict[str, dict]:
    """Structure of a response: {path: {"keys": [...], "n": items, "per": (min, max) | None}}.

    Paths are made of field names only ("home.schedules[].zones[]"). A dict whose keys are not
    identifiers (ids, dates, names) is shown as "{*}" and its own keys are never listed."""
    forbidden = _strings(obj) if forbidden is None else forbidden
    out: dict[str, dict] = {}

    def walk(o: object, path: str, depth: int) -> None:
        if depth > INV_WALK_DEPTH:
            return
        if isinstance(o, list):
            node = out.setdefault(path + "[]", {"keys": set(), "n": 0, "per": None})
            node["n"] += len(o)
            lo, hi = node["per"] or (len(o), len(o))
            node["per"] = (min(lo, len(o)), max(hi, len(o)))
            for x in o:
                if isinstance(x, dict | list):
                    walk(x, path + "[]", depth + 1)
            return
        if not isinstance(o, dict):
            return
        node = out.setdefault(path or ".", {"keys": set(), "n": 0, "per": None})
        if not path.endswith("[]"):
            node["n"] += 1
        if o and not any(_name_ok(k, forbidden) for k in o):  # keyed by ids / dates: shape only
            node["keys"].add("{*}")
            for v in list(o.values())[:20]:
                walk(v, f"{path}.{{*}}" if path else "{*}", depth + 1)
            return
        for k, v in o.items():
            if not _name_ok(k, forbidden):
                continue
            node["keys"].add(k)
            if isinstance(v, dict | list):
                walk(v, f"{path}.{k}" if path else k, depth + 1)

    walk(obj, root, 0)
    return {p: {**v, "keys": sorted(v["keys"])} for p, v in out.items()}


def print_shape(title: str, obj: object, root: str = "", forbidden: set[str] | None = None) -> dict[str, dict]:
    s = shape(obj, root, forbidden)
    print(f"\n{title} (noms de champs, nombre d'éléments) :")
    for path, node in sorted(s.items()):
        count = ""
        if path.endswith("[]"):
            lo, hi = node["per"] or (0, 0)
            count = f" [{node['n']} élément(s)" + ("" if lo == hi else f", {lo} à {hi} par parent") + "]"
        print(f"  {path}{count}: {', '.join(node['keys']) or '(aucun champ)'}")
    return s


def _type_code(m: dict) -> str:
    t = m.get("type")
    return t if isinstance(t, str) and safe_keys([t]) else "?"


def keys_by_type(items: object, forbidden: set[str]) -> dict[str, list[str]]:
    """Module type code -> union of the field names of the modules of that type."""
    out: dict[str, set[str]] = {}
    for m in items if isinstance(items, list) else []:
        if isinstance(m, dict):
            out.setdefault(_type_code(m), set()).update(k for k in m if _name_ok(k, forbidden))
    return {t: sorted(v) for t, v in sorted(out.items())}


def _points_of(payload: object) -> tuple[int, int]:
    body = payload.get("body", {}) if isinstance(payload, dict) else {}
    home = body.get("home", {}) if isinstance(body, dict) else {}
    rooms = sum(count_points(x.get("measures")) for x in home.get("rooms", []) or [] if isinstance(x, dict))
    mods = sum(count_points(x.get("measures")) for x in home.get("modules", []) or [] if isinstance(x, dict))
    return rooms, mods


def inventory_intuis(client: IntuisClient, now: int | None = None) -> dict:
    """homesdata (schedules included), homestatus, and gethomemeasure per type and scale."""
    now = int(now if now is not None else time.time())
    result: dict = {"measures": {}, "depth": {}}
    raw = client.homesdata()
    body = raw.get("body", {})
    homes = body.get("homes", []) or []
    forbidden = _strings(raw)
    print("\n==== Intuis ====")
    print(f"homesdata, champs de body : {', '.join(k for k in sorted(body) if _name_ok(k, forbidden))}")
    print(f"Maisons : {len(homes)}")
    if not homes:
        return result
    h = homes[0]
    result["homesdata"] = print_shape("homesdata, 1re maison", h, "home", forbidden)
    modules = [m for m in h.get("modules", []) or [] if isinstance(m, dict)]
    print("\nModules de homesdata par type :")
    for t, keys in keys_by_type(modules, forbidden).items():
        n = sum(1 for m in modules if _type_code(m) == t)
        print(f"  {t} ×{n}: {', '.join(keys)}")
    print(f"Plannings : {len(h.get('schedules') or [])} (structure : chemins home.schedules[] ci-dessus)")
    try:
        status = client.homestatus(h["id"])
        st_home = status.get("body", {}).get("home", {})
        result["homestatus"] = print_shape("homestatus", st_home, "home")
        print("\nModules de homestatus par type :")
        for t, keys in keys_by_type(st_home.get("modules"), forbidden | _strings(status)).items():
            print(f"  {t}: {', '.join(keys)}")
    except (ApiError, FormatError) as err:
        print(f"homestatus : refusé ({_refusal(err)})")
    bridge = next((m["id"] for m in modules if m.get("type") == "NMG"), "")
    room_ids = [str(r["id"]) for r in h.get("rooms", []) or []]
    others = [m["id"] for m in modules if m.get("type") != "NMG"]

    def measure(mtype: str, scale: str, begin: int, end: int) -> tuple[int, int]:
        p = client.home_measure(
            h["id"],
            bridge,
            room_ids,
            measure_type=mtype,
            scale=scale,
            date_begin=begin,
            date_end=end,
            module_ids=others or None,
        )
        return _points_of(p)

    print("\nMesures (gethomemeasure, toutes pièces + modules) : points non nuls, aucune valeur")
    for t in INV_INTUIS_TYPES:
        cells = []
        for scale, days in INV_INTUIS_SCALES.items():
            try:
                r, m = measure(t, scale, now - days * DAY, now)
                txt = f"pièces {r} / modules {m}"
            except (ApiError, FormatError) as err:
                txt = f"refusé ({_refusal(err)})"
            result["measures"][(t, scale)] = txt
            cells.append(f"{scale} ({days} j) : {txt}")
        print(f"  {t:<26} " + " ; ".join(cells))
    print("\nProfondeur d'historique (types d'énergie réunis, une fenêtre courte finissant il y a N jours) :")
    for scale in INV_INTUIS_SCALES:
        window = 7 * DAY if scale == "1day" else DAY
        cells, oldest = [], None
        for back in INV_DEPTH_DAYS:
            end = now - back * DAY
            try:
                try:
                    r, m = measure(INV_ENERGY, scale, end - window, end)
                except (ApiError, FormatError):
                    r, m = measure("sum_energy_elec", scale, end - window, end)
            except (ApiError, FormatError) as err:
                cells.append(f"{back}j=refusé ({_refusal(err)})")
                if back == INV_DEPTH_DAYS[0]:
                    break  # scale refused even for recent days: no need to go further back
                continue
            cells.append(f"{back}j={r + m}")
            if r + m:
                oldest = back
        result["depth"][scale] = oldest
        print(f"  {scale:<6} " + " ".join(cells) + (f"  → au moins {oldest} jours" if oldest else "  → rien"))
    return result


class _Paced:
    """GET with a bearer token, spaced calls, counted under `source`."""

    def __init__(self, http, token: str, source: str, min_interval: float) -> None:
        self.http, self.token, self.source, self.min_interval = http, token, source, min_interval
        self.last = 0.0

    def get(self, url: str, params: dict):
        from .budget import METER

        wait = self.last + self.min_interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        try:
            with METER.call(self.source):
                return self.http.get(url, params=params, headers={"Authorization": f"Bearer {self.token}"})
        finally:
            self.last = time.monotonic()


def _json_or_none(resp) -> object:
    try:
        return resp.json()
    except ValueError:
        return None


def inventory_station(token: str, http=None, now: int | None = None, min_interval: float = 0.5) -> dict:
    """getstationsdata structure, then getmeasure types / scales / depth per module.

    Takes the ACCESS token the nightly collection already obtained (`sync` with
    STATION_INVENTORY=true, input « inventaire » of collect.yml): no new login here, so the
    rotating refresh token is only renewed, saved and committed by the collection itself."""
    import httpx

    now = int(now if now is not None else time.time())
    api = _Paced(http or httpx.Client(timeout=30.0), token, "netatmo", min_interval)
    result: dict = {"types": {}, "scales": {}, "depth": {}}
    print("\n==== Station Netatmo ====")
    resp = api.get(f"{NETATMO_API}/api/getstationsdata", {})
    if resp.status_code != 200:
        print(f"getstationsdata : HTTP {resp.status_code}")
        return result
    raw = _json_or_none(resp)
    body = raw.get("body", {}) if isinstance(raw, dict) else {}
    # Measure names listed in data_type ("Temperature"…) are also the keys of dashboard_data.
    declared_all = {x for d in _walk_lists(body, "data_type") for x in d if isinstance(x, str)}
    forbidden = _strings(raw) - declared_all
    result["shape"] = print_shape("getstationsdata (body)", body, "body", forbidden)
    devices = [d for d in body.get("devices", []) or [] if isinstance(d, dict)]
    print(f"Stations : {len(devices)}")
    if not devices:
        return result
    main = devices[0]
    mods = [main] + [m for m in main.get("modules", []) or [] if isinstance(m, dict)]
    print("\nModules (noms de champs, champs de santé, types de mesure déclarés) :")
    for i, m in enumerate(mods):
        dash = m.get("dashboard_data") if isinstance(m.get("dashboard_data"), dict) else {}
        declared = [x for x in m.get("data_type", []) or [] if isinstance(x, str) and safe_keys([x])]
        print(f"  #{i} {_type_code(m)} : {', '.join(k for k in sorted(m) if _name_ok(k, forbidden))}")
        print(f"     dashboard_data : {', '.join(k for k in sorted(dash) if _name_ok(k, forbidden)) or '(absent)'}")
        health = ", ".join(k for k in HEALTH_KEYS if k in m) or "(aucun)"
        print(f"     data_type : {', '.join(declared) or '(absent)'} ; santé : {health}")
    print(
        "\ngetmeasure (2 derniers jours au pas 1hour ; min_, max_, date_ : 7 jours au pas 1day) : "
        "points non nuls par type, aucune valeur"
    )
    for i, m in enumerate(mods):
        t = _type_code(m)
        base = {"device_id": main.get("_id"), "optimize": "true", "real_time": "false"}
        if m is not main:
            base["module_id"] = m.get("_id")

        def ask(mtype: str, scale: str, begin: int, end: int, base: dict = base) -> str:
            r = api.get(
                f"{NETATMO_API}/api/getmeasure",
                {**base, "type": mtype, "scale": scale, "date_begin": begin, "date_end": end},
            )
            if r.status_code != 200:
                return f"refusé (HTTP {r.status_code})"
            b = _json_or_none(r)
            return f"accepté, {count_points(b.get('body') if isinstance(b, dict) else None)} points"

        cells = []
        for mtype in INV_STATION_TYPES.get(t, ("temperature",)):
            # min_ / max_ / date_ types only exist for aggregated scales (1day and above).
            daily = mtype.startswith(("min_", "max_", "date_"))
            txt = ask(mtype, "1day" if daily else "1hour", now - (7 if daily else 2) * DAY, now)
            result["types"][(i, mtype)] = txt
            cells.append(f"{mtype} {txt}")
        print(f"  #{i} {t} : " + " ; ".join(cells))
        primary = INV_STATION_PRIMARY.get(t, "temperature")
        scales = []
        for scale in INV_STATION_SCALES:
            days = 2 if scale in ("30min", "1hour", "3hours") else 60 if scale in ("1day", "1week") else 400
            txt = ask(primary, scale, now - days * DAY, now)
            result["scales"][(i, scale)] = txt
            scales.append(f"{scale}={'oui' if _has_points(txt) else txt.split(',')[0]}")
        print(f"     échelles ({primary}) : " + " ".join(scales))
        depth, oldest = [], None
        for back in INV_STATION_DEPTH_DAYS:
            end = now - back * DAY
            got = _has_points(ask(primary, "30min", end - DAY, end))
            depth.append(f"{back}j={'oui' if got else 'non'}")
            oldest = back if got else oldest
        result["depth"][i] = oldest
        print("     profondeur au pas de 30 min : " + " ".join(depth))
    return result


def inventory_linky(token: str, prm: str, http=None, today=None, min_interval: float = 0.3) -> dict:
    """HTTP status (and number of dated points) of each Conso API series over the last 7 days,
    plus the daily consumption 3 years ago. The PRM is sent, never printed."""
    from datetime import UTC, datetime, timedelta

    import httpx

    from .enedis import USER_AGENT, _points

    api = _Paced(http or httpx.Client(timeout=60.0, headers={"User-Agent": USER_AGENT}), token, "linky", min_interval)
    today = today or datetime.now(UTC).date()
    result: dict = {}

    def ask(endpoint: str, begin, end) -> tuple[int | None, int]:
        try:
            r = api.get(
                LINKY_BASE + endpoint, {"pointId": prm, "dateDebut": begin.isoformat(), "dateFin": end.isoformat()}
            )
        except httpx.HTTPError:
            return None, 0
        return r.status_code, len(_points(_json_or_none(r))) if r.status_code == 200 else 0

    def txt(status: int | None, n: int) -> str:
        return "erreur réseau" if status is None else f"HTTP {status}" + (f", {n} points" if status == 200 else "")

    print("\n==== Linky (Conso API) ====")
    print("Séries sur les 7 derniers jours (statut HTTP, nombre de points datés, aucune valeur) :")
    for ep in INV_LINKY_ENDPOINTS:
        result[ep] = ask(ep, today - timedelta(days=7), today)
        print(f"  {ep:<34} {txt(*result[ep])}")
    old_end = today - timedelta(days=3 * 365 - 7)
    result["depth_3y"] = ask(INV_LINKY_ENDPOINTS[0], old_end - timedelta(days=7), old_end)
    print(f"  profondeur : {INV_LINKY_ENDPOINTS[0]} il y a 3 ans → {txt(*result['depth_3y'])}")
    return result


def inventory(settings, intuis: IntuisClient | None = None) -> None:
    """Every configured source; a source without its secrets is skipped, and a failing one
    never stops the others (only the class of the error is printed)."""
    print("Inventaire des données disponibles (S-1.19) : noms et volumes seulement, aucune valeur.")
    sections = []
    if intuis is not None:
        sections.append(("Intuis", lambda: inventory_intuis(intuis)))
    else:
        print("\nIntuis : ignoré (identifiants INTUIS_* absents)")
    print(
        "\nStation Netatmo : pas ici (son jeton de rafraîchissement change à chaque usage et ce job ne "
        "peut pas l'enregistrer) ; lancer « Collecte quotidienne » avec la case « inventaire »"
    )
    if settings.enedis_token and settings.enedis_prm:
        sections.append(("Linky", lambda: inventory_linky(settings.enedis_token, settings.enedis_prm)))
    else:
        print("\nLinky : ignoré (ENEDIS_TOKEN / ENEDIS_PRM absents)")
    for name, run_section in sections:
        try:
            run_section()
        except (ApiError, FormatError) as err:
            print(f"\n{name} : interrompu ({_refusal(err)})")
        except Exception as err:  # never echo the message: it may carry a URL with the PRM
            print(f"\n{name} : interrompu ({type(err).__name__})")
