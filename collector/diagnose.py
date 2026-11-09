"""Anonymous diagnostic, safe to print in a public CI log.

Prints only structure (module type codes, field names, which room holds what) and,
for each measure type, how many days returned a non-zero value. No names, no ids,
no energy values.
"""

from __future__ import annotations

import time

from .api import ApiError, IntuisClient
from .model import parse_measure_blocks

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


def run(client: IntuisClient, days: int = 60) -> None:
    raw = client.homesdata()
    homes = raw.get("body", {}).get("homes", [])
    print(f"Maisons : {len(homes)}")
    now = int(time.time())
    for hi, h in enumerate(homes):
        modules = h.get("modules", [])
        rooms = h.get("rooms", [])
        room_of = {mid: f"P{ri}" for ri, r in enumerate(rooms) for mid in r.get("module_ids", [])}
        print(f"\n== Maison {hi} : {len(rooms)} pièces, {len(modules)} modules ==")
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
