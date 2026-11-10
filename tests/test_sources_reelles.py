"""#363: the public sources without a key, called for real: Open-Meteo (collector/weather.py), the
CRE regulated-tariff CSV files (deploy.yml → web/public/tarifs/, read by collector/insights.py and
web/src/analysis.ts) and the Tempo day colours (scripts/tempo_jours.py).

A fake client only proves that we SEND what we think we send, never that the source still
ACCEPTS it and answers in the format the code reads (Job Finder, `.claude/rules/qualite.md`).

- The network tests are marked `reseau` and excluded by default (pyproject.toml: `-m "not reseau"`):
  `pytest -q` stays without network, as in the CI. Run them with `pytest -m reseau`, or through
  the manual workflow `.github/workflows/sources.yml`.
- A source that cannot be reached (DNS, timeout, 5xx) makes its test SKIPPED, with the reason
  « injoignable »; a source that answers in another format makes it FAIL, naming what is missing.
- Logs and messages only carry column names, counts and status codes: no value. The weather is
  asked for a public place (Paris, Hôtel de Ville), never the home's coordinates.
- No API with credentials (Intuis, Netatmo, Linky): out of scope.

The format checks are pure functions, tested offline below on the copies kept in the repository
(the « test of the test »: a renamed column makes the check fail, naming it).
"""

from __future__ import annotations

import csv
import io
import json
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from collector import schema
from collector.weather import ARCHIVE, DAILY

ROOT = Path(__file__).resolve().parent.parent
TARIFS = ROOT / "web" / "public" / "tarifs"
CRE_URL = "https://www.cre.fr/fileadmin/Documents/Open_data/Marches_de_detail/{}"
# Public place, not the home: Paris, Hôtel de Ville (2 decimals, as weather.py rounds).
PLACE = {"latitude": 48.86, "longitude": 2.35, "timezone": "Europe/Paris"}

# Columns the code reads in each CRE file (analysis.ts parseTrveCsv / parseTempoCsv, insights.py).
CRE_COLUMNS = {
    "Option_Base.csv": ["DATE_DEBUT", "DATE_FIN", "P_SOUSCRITE", "PART_FIXE_TTC", "PART_VARIABLE_TTC"],
    "Option_HPHC.csv": [
        *("DATE_DEBUT", "DATE_FIN", "P_SOUSCRITE", "PART_FIXE_TTC"),
        *("PART_VARIABLE_HC_TTC", "PART_VARIABLE_HP_TTC"),
    ],
    "Option_Tempo.csv": [
        "DATE_DEBUT",
        "DATE_FIN",
        "P_SOUSCRITE",
        "PART_FIXE_TTC",
        *(f"PART_VARIABLE_{h}{c}_TTC" for c in ("Bleu", "Blanc", "Rouge") for h in ("HC", "HP")),
    ],
}


# ------------------------------------------------------------------ pure format checks
def cre_problems(name: str, text: str) -> list[str]:
    """What the code could not read in this CRE file (empty: format as expected)."""
    rows = list(csv.reader(io.StringIO(text), delimiter=";"))
    if not rows:
        return [f"{name} : fichier vide"]
    header = [h.strip().lstrip("﻿") for h in rows[0]]
    problems = [f"{name} : colonne {c} absente" for c in CRE_COLUMNS[name] if c not in header]
    if problems:
        return problems
    data = [r for r in rows[1:] if any(cell.strip() for cell in r)]
    if not data:
        return [f"{name} : aucune ligne de tarif"]
    start = header.index("DATE_DEBUT")
    bad = sum(1 for r in data if len(r) <= start or not _fr_date(r[start]))
    if bad:
        problems.append(f"{name} : {bad} ligne(s) sur {len(data)} sans DATE_DEBUT au format JJ/MM/AAAA")
    priced = [r for r in data if len(r) == len(header) and r[header.index("PART_FIXE_TTC")].strip()]
    if not priced:
        problems.append(f"{name} : aucune ligne avec PART_FIXE_TTC renseignée")
    return problems


def _fr_date(s: str) -> bool:
    try:
        d, m, y = s.strip().split("/")
        date(int(y), int(m), int(d))
        return True
    except ValueError:
        return False


def meteo_problems(body: object) -> list[str]:
    """What weather.py could not read in an Open-Meteo daily answer."""
    try:
        schema.check("Open-Meteo", "archive", schema.OPEN_METEO_DAILY, body)
    except Exception as err:  # the class and the path only (schema errors carry no value)
        return [f"Open-Meteo : format inattendu ({type(err).__name__} : {err})"]
    daily = body["daily"]  # type: ignore[index]
    problems = [f"Open-Meteo : variable {k} absente" for k in DAILY.split(",") if k not in daily]
    if not daily.get("time"):
        problems.append("Open-Meteo : aucune journée renvoyée")
    return problems


def tempo_problems(payload: object, start: int) -> list[str]:
    """What scripts/tempo_jours.py could not read in one season's answer."""
    sys.path.insert(0, str(ROOT / "scripts"))
    try:
        import tempo_jours
    finally:
        sys.path.pop(0)
    found, ignored = tempo_jours.parse_season(payload, start)
    problems = []
    if ignored:
        problems.append(f"Tempo {start}-{start + 1} : {ignored} entrée(s) illisibles (clés dateJour / codeJour ?)")
    if len(found) < 300:
        problems.append(f"Tempo {start}-{start + 1} : {len(found)} jours lus, au moins 300 attendus")
    return problems


# ------------------------------------------------------------------ offline: the test of the test
@pytest.mark.parametrize("name", sorted(CRE_COLUMNS))
def test_les_copies_du_depot_ont_le_format_attendu(name):
    assert cre_problems(name, (TARIFS / name).read_text(encoding="utf-8")) == []


@pytest.mark.parametrize("name", sorted(CRE_COLUMNS))
def test_une_colonne_renommee_est_nommee(name):
    text = (TARIFS / name).read_text(encoding="utf-8")
    renamed = text.replace("PART_FIXE_TTC", "PART_FIXE_TTC_V2", 1)
    assert cre_problems(name, renamed) == [f"{name} : colonne PART_FIXE_TTC absente"]


def test_une_date_au_mauvais_format_est_comptee():
    text = (TARIFS / "Option_Base.csv").read_text(encoding="utf-8").splitlines()
    text[1] = text[1].replace("/", "-", 2)
    n = len([t for t in text[1:] if t.strip()])
    want = f"Option_Base.csv : 1 ligne(s) sur {n} sans DATE_DEBUT au format JJ/MM/AAAA"
    assert cre_problems("Option_Base.csv", "\n".join(text)) == [want]


def test_une_reponse_meteo_sans_variable_echoue():
    good = {"daily": {"time": ["2025-01-01"], **{k: [1.0] for k in DAILY.split(",")}}}
    assert meteo_problems(good) == []
    bad = {"daily": {"time": ["2025-01-01"], "temperature_2m_min": [1.0], "temperature_2m_max": [2.0]}}
    [problem] = meteo_problems(bad)
    assert "temperature_2m_mean" in problem
    empty = {"daily": {"time": [], **{k: [] for k in DAILY.split(",")}}}
    assert meteo_problems(empty) == ["Open-Meteo : aucune journée renvoyée"]


def test_une_saison_tempo_renommee_echoue():
    days = [{"dateJour": (date(2024, 9, 1) + timedelta(days=i)).isoformat(), "codeJour": 1} for i in range(365)]
    assert tempo_problems(days, 2024) == []
    renamed = [{"date": d["dateJour"], "code": d["codeJour"]} for d in days]
    assert tempo_problems(renamed, 2024) == ["Tempo 2024-2025 : 0 jours lus, au moins 300 attendus"]
    assert tempo_problems([*days[:200], {"dateJour": "2024-02-30", "codeJour": 1}], 2024) == [
        "Tempo 2024-2025 : 1 entrée(s) illisibles (clés dateJour / codeJour ?)",
        "Tempo 2024-2025 : 200 jours lus, au moins 300 attendus",
    ]


# ------------------------------------------------------------------ network (pytest -m reseau)
def _get(url: str, **params) -> httpx.Response:
    """GET, or SKIP when the source cannot be reached (never a failure for a network outage)."""
    try:
        headers = {"User-Agent": "intuis-history-sources"}
        r = httpx.get(url, params=params or None, timeout=30, follow_redirects=True, headers=headers)
    except httpx.TransportError as err:
        pytest.skip(f"injoignable ({type(err).__name__})")
    if r.status_code >= 500 or r.status_code == 429:  # down, or asking us to come back later
        pytest.skip(f"injoignable (HTTP {r.status_code})")
    assert r.status_code == 200, f"HTTP {r.status_code} (adresse déplacée ?)"
    return r


@pytest.mark.reseau
def test_open_meteo_archive_repond_au_format_lu():
    day = (datetime.now(UTC).date() - timedelta(days=30)).isoformat()
    r = _get(ARCHIVE, **PLACE, daily=DAILY, start_date=day, end_date=day)
    assert meteo_problems(r.json()) == []


@pytest.mark.reseau
@pytest.mark.parametrize("name", sorted(CRE_COLUMNS))
def test_cre_csv_a_les_colonnes_lues(name):
    r = _get(CRE_URL.format(name))
    assert cre_problems(name, r.content.decode("utf-8-sig", errors="replace")) == []


@pytest.mark.reseau
def test_tempo_derniere_saison_complete():
    today = datetime.now(UTC).date()
    start = (today.year if today.month >= 9 else today.year - 1) - 1  # the last COMPLETE season
    r = _get(f"https://www.api-couleur-tempo.fr/api/joursTempo?periode={start}-{start + 1}")
    try:
        payload = r.json()
    except json.JSONDecodeError:
        pytest.fail("Tempo : la réponse n'est pas du JSON")
    assert tempo_problems(payload, start) == []
