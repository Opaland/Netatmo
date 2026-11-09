"""Command line: python -m collector <command>.

discover    Connexion + inventaire de la maison (pièces, modules, catégories)
sync        Récupère les derniers jours (ou tout l'historique au premier lancement)
backfill    Force la récupération de tout l'historique disponible
verify      Déchiffre les données locales et affiche un résumé
export-csv  Exporte les données déchiffrées en CSV
demo        Génère des données de démonstration chiffrées (phrase « demo »)
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from pathlib import Path

from .api import IntuisClient
from .config import Settings
from .storage import Store
from .sync import Syncer


def _client(s: Settings) -> IntuisClient:
    s.require("username", "password", "client_id", "client_secret")
    return IntuisClient(s)


def cmd_discover(s: Settings, args: argparse.Namespace) -> None:
    syncer = Syncer(_client(s), store=None, overrides=s.room_categories)  # type: ignore[arg-type]
    raw = syncer.client.homesdata()
    if args.save_raw:
        Path(args.save_raw).write_text(json.dumps(raw, indent=2, ensure_ascii=False))
        print(f"Réponse brute enregistrée dans {args.save_raw} (contient des identifiants : ne pas commiter)")
    home = syncer.home()
    print(f"Maison : {home.name}  (fuseau {home.timezone}, passerelle {'trouvée' if home.bridge_id else 'ABSENTE'})")
    for r in home.rooms:
        print(f"  - {r.name:<28} id={r.id:<14} modules={','.join(r.module_types) or '-':<12} → {r.category}")
    print("\nSi une pièce est mal classée, définir INTUIS_ROOM_CATEGORIES, ex. :")
    print('  INTUIS_ROOM_CATEGORIES={"<id>": "water_heater"}   (valeurs : heating, water_heater, ignore)')


def cmd_diagnose(s: Settings, args: argparse.Namespace) -> None:
    from .diagnose import run

    run(_client(s))


def cmd_sync(s: Settings, args: argparse.Namespace, backfill: bool = False) -> None:
    s.require("passphrase")
    store = Store(s.data_dir, s.passphrase)
    changed = Syncer(_client(s), store, s.room_categories).run(days=args.days, backfill=backfill)
    print("Fichiers modifiés : " + (", ".join(changed) if changed else "aucun"))
    print(f"Couverture : {store.first_day()} → {store.last_day()}")


def cmd_verify(s: Settings, args: argparse.Namespace) -> None:
    s.require("passphrase")
    store = Store(s.data_dir, s.passphrase)
    rooms = {r["id"]: r for r in store.meta.get("rooms", [])}
    print(f"Maison : {store.meta.get('home', {}).get('name')}  — mise à jour {store.meta.get('updated')}")
    for y in store.years():
        per_cat: dict[str, float] = {}
        for rid, days in store.year(y).items():
            cat = rooms.get(rid, {}).get("category", "?")
            per_cat[cat] = per_cat.get(cat, 0) + sum(days.values())
        print(f"  {y} : " + ", ".join(f"{c} {v / 1000:.0f} kWh" for c, v in sorted(per_cat.items())))


def cmd_export(s: Settings, args: argparse.Namespace) -> None:
    s.require("passphrase")
    store = Store(s.data_dir, s.passphrase)
    rooms = {r["id"]: r for r in store.meta.get("rooms", [])}
    rows = [["date", "piece", "categorie", "kwh"]]
    for y in store.years():
        for rid, days in sorted(store.year(y).items()):
            room = rooms.get(rid, {"name": rid, "category": "?"})
            for day, wh in sorted(days.items()):
                rows.append([day, room["name"], room["category"], f"{wh / 1000:.3f}".replace(".", ",")])
    if args.output == "-":
        csv.writer(sys.stdout, delimiter=";").writerows(rows)
    else:
        with open(args.output, "w", newline="", encoding="utf-8") as fh:
            csv.writer(fh, delimiter=";").writerows(rows)


def cmd_demo(s: Settings, args: argparse.Namespace) -> None:
    from .demo import generate

    out = Path(args.output)
    for f in out.glob("*.json"):
        f.unlink()
    print("Fichiers : " + ", ".join(generate(out, args.passphrase)))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(
        prog="collector", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("discover")
    d.add_argument("--save-raw", metavar="FICHIER")
    sub.add_parser("diagnose", help="diagnostic anonyme (sans noms ni valeurs)")
    for name in ("sync", "backfill"):
        sp = sub.add_parser(name)
        sp.add_argument("--days", type=int, default=35, help="jours re-téléchargés à chaque sync (défaut 35)")
    sub.add_parser("verify")
    e = sub.add_parser("export-csv")
    e.add_argument("-o", "--output", default="-")
    dm = sub.add_parser("demo")
    dm.add_argument("-o", "--output", default="web/public/demo")
    dm.add_argument("--passphrase", default="demo")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s %(message)s")
    s = Settings.from_env()
    {
        "discover": cmd_discover,
        "diagnose": cmd_diagnose,
        "sync": cmd_sync,
        "backfill": lambda s, a: cmd_sync(s, a, backfill=True),
        "verify": cmd_verify,
        "export-csv": cmd_export,
        "demo": cmd_demo,
    }[args.cmd](s, args)


if __name__ == "__main__":
    main()
