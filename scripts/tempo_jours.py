"""Download the history of EDF Tempo day colours (public data) into web/public/tarifs/tempo_jours.json.

Source: https://www.api-couleur-tempo.fr (free community API relaying RTE's published colours).
Run at deploy time; on failure the copy already in the repository is kept.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

OUT = Path("web/public/tarifs/tempo_jours.json")
API = "https://www.api-couleur-tempo.fr/api/joursTempo?periode={}"


def main() -> int:
    days: dict[str, int] = json.loads(OUT.read_text()) if OUT.exists() else {}
    today = datetime.now(UTC).date()
    last_season = today.year if today.month >= 9 else today.year - 1
    for start in range(2017, last_season + 1):
        period = f"{start}-{start + 1}"
        try:
            headers = {"User-Agent": "intuis-history (github.com/Opaland/Netatmo)"}
            req = urllib.request.Request(API.format(period), headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                for d in json.load(resp):
                    if d.get("codeJour") in (1, 2, 3):
                        days[d["dateJour"]] = d["codeJour"]
        except Exception as err:  # keep what we have
            print(f"::warning::Couleurs Tempo {period} indisponibles : {err}")
    OUT.write_text(json.dumps(dict(sorted(days.items())), separators=(",", ":")) + "\n")
    print(f"{len(days)} jours Tempo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
