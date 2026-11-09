"""Download the history of EDF Tempo day colours (public data) into web/public/tarifs/tempo_jours.json.

Source: https://www.api-couleur-tempo.fr (free community API relaying RTE's published colours).
Run at deploy time; on failure the copy already in the repository is kept.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import UTC, date, datetime
from pathlib import Path

OUT = Path("web/public/tarifs/tempo_jours.json")
API = "https://www.api-couleur-tempo.fr/api/joursTempo?periode={}"
FIRST_SEASON = 2017
_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")


def season_bounds(start: int) -> tuple[date, date]:
    """A Tempo season runs from September 1st to August 31st."""
    return date(start, 9, 1), date(start + 1, 8, 31)


def valid_day(key: object, code: object, first: date, last: date) -> bool:
    """S-1.16 #274: only "YYYY-MM-DD" keys of a real date inside [first, last], colour 1, 2 or 3
    (the file is served by the site and read by the app as dates)."""
    if not isinstance(key, str) or not _DAY.fullmatch(key):
        return False
    if isinstance(code, bool) or code not in (1, 2, 3):
        return False
    try:
        return first <= date.fromisoformat(key) <= last
    except ValueError:
        return False


def parse_season(payload: object, start: int) -> tuple[dict[str, int], int]:
    """({day: colour}, number of entries ignored) of one season's answer."""
    first, last = season_bounds(start)
    out: dict[str, int] = {}
    ignored = 0
    for d in payload if isinstance(payload, list) else []:
        key, code = (d.get("dateJour"), d.get("codeJour")) if isinstance(d, dict) else (None, None)
        if valid_day(key, code, first, last):
            out[key] = code
        elif not (isinstance(d, dict) and code in (0, None)):  # 0 / null: colour not known yet
            ignored += 1
    return out, ignored


def main() -> int:
    today = datetime.now(UTC).date()
    last_season = today.year if today.month >= 9 else today.year - 1
    first_ok, last_ok = season_bounds(FIRST_SEASON)[0], season_bounds(last_season)[1]
    previous = json.loads(OUT.read_text()) if OUT.exists() else {}
    # The copy in the repository is checked too: a bad key written before never stays.
    days: dict[str, int] = {
        k: v for k, v in (previous.items() if isinstance(previous, dict) else []) if valid_day(k, v, first_ok, last_ok)
    }
    for start in range(FIRST_SEASON, last_season + 1):
        period = f"{start}-{start + 1}"
        try:
            headers = {"User-Agent": "intuis-history (github.com/Opaland/Netatmo)"}
            req = urllib.request.Request(API.format(period), headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                found, ignored = parse_season(json.load(resp), start)
            days.update(found)
            if ignored:
                print(f"::warning::Couleurs Tempo {period} : {ignored} entrées invalides ignorées")
        except Exception as err:  # keep what we have; the class only (never an answer's text)
            print(f"::warning::Couleurs Tempo {period} indisponibles ({type(err).__name__})")
    OUT.write_text(json.dumps(dict(sorted(days.items())), separators=(",", ":")) + "\n")
    print(f"{len(days)} jours Tempo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
