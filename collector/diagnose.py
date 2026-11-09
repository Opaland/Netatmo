"""Anonymous diagnostic, safe to print in a public CI log.

Prints only structure (module type codes, field names, which room holds what) and,
for each measure type, how many days returned a non-zero value. No names, no ids,
no energy values.
"""

from __future__ import annotations

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
