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
import gzip
import io
import json
import re
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from collector import schema
from collector.weather import ARCHIVE, DAILY, WIND, degree_days

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


# #464: the degree days of the app (base 18 °C, méthode météo, collector.weather.degree_days)
# against the public daily data of Météo-France (data.gouv.fr, « Données climatologiques de base
# quotidiennes »), at a public station — Lyon-Bron, the reference of the region the issue names —
# never the home. Open-Meteo is asked at the station's own coordinates.
MF_DATASET = "https://www.data.gouv.fr/api/1/datasets/donnees-climatologiques-de-base-quotidiennes/"
MF_STATION = {"num": "69029001", "dept": "69", "latitude": 45.72, "longitude": 4.95, "timezone": "Europe/Paris"}
MF_FILE = re.compile(r"Q_(\d{2,3})_(?:latest|previous)-(\d{4})-(\d{4})_RR-T-Vent\.csv\.gz$")


def mf_degree_days(text: str, station: str, year: int) -> tuple[float, int]:
    """(degree days, days with TN and TX) of one station and one calendar year in a Météo-France
    daily file (separator « ; », columns NUM_POSTE, AAAAMMJJ, TN, TX), with the app's rule."""
    total, days = 0.0, 0
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        if r.get("NUM_POSTE") != station or not (r.get("AAAAMMJJ") or "").startswith(str(year)):
            continue
        if r.get("TN") and r.get("TX"):
            total += degree_days(float(r["TN"]), float(r["TX"]))
            days += 1
    return total, days


def om_degree_days(body: dict, year: int) -> tuple[float, int]:
    """The same rule on an Open-Meteo daily answer (min and max, as web/src/analysis.ts dju)."""
    d = body["daily"]
    rows = zip(d["time"], d["temperature_2m_min"], d["temperature_2m_max"], strict=True)
    vals = [degree_days(a, b) for t, a, b in rows if t.startswith(str(year)) and a is not None and b is not None]
    return sum(vals), len(vals)


def mf_file_for(resources: list[dict], dept: str, year: int) -> str | None:
    """The URL of the daily file (RR-T-Vent) of one département that covers `year`."""
    for r in resources:
        m = MF_FILE.search(r.get("url", ""))
        if m and m[1] == dept and int(m[2]) <= year <= int(m[3]):
            return r["url"]
    return None


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


def test_degres_jours_meteo_france_lus_comme_l_appli():
    head = "NUM_POSTE;NOM_USUEL;AAAAMMJJ;RR;TN;TX"
    rows = [
        "69029001;X;20250101;0;2.0;10.0",  # 18 - 6 = 12
        "69029001;X;20250102;0;15.0;25.0",  # warmer than 18: 0
        "69029001;X;20250103;0;;8.0",  # no TN: not counted
        "69029001;X;20240101;0;0.0;0.0",  # another year
        "69999999;X;20250101;0;0.0;0.0",  # another station
    ]
    assert mf_degree_days("\n".join([head, *rows]), "69029001", 2025) == (12.0, 2)
    days = ["2025-01-01", "2025-01-02"]
    body = {"daily": {"time": days, "temperature_2m_min": [2.0, None], "temperature_2m_max": [10.0, 5.0]}}
    assert om_degree_days(body, 2025) == (12.0, 1)
    assert degree_days(-4, 0) == 20
    assert degree_days(20, 30) == 0
    res = [
        {"url": "https://x/Q_69_previous-1950-2024_RR-T-Vent.csv.gz"},
        {"url": "https://x/Q_69_latest-2025-2026_RR-T-Vent.csv.gz"},
    ]
    assert mf_file_for(res, "69", 2025) == res[1]["url"]
    assert mf_file_for(res, "69", 2003) == res[0]["url"]
    assert mf_file_for(res, "38", 2025) is None


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


def wind_problems(body: object) -> list[str]:
    """#117: what weather.py could not read in the wind, rain and radiation call. These variables
    are optional in the schema (a refusal never costs the temperatures), so a renamed one would be
    dropped without a word: each is asked for here, and the radiation read in its unit."""
    try:
        schema.check("Open-Meteo", "archive", schema.OPEN_METEO_WIND, body)
    except Exception as err:  # the class and the path only (schema errors carry no value)
        return [f"Open-Meteo : format inattendu ({type(err).__name__} : {err})"]
    daily = body["daily"]  # type: ignore[index]
    problems = [f"Open-Meteo : variable {k} absente" for k in WIND.split(",") if k not in daily]
    unit = (body.get("daily_units") or {}).get("shortwave_radiation_sum")  # type: ignore[union-attr]
    if unit != "MJ/m²":
        problems.append(f"Open-Meteo : rayonnement en {unit!r}, MJ/m² attendu")
    sun = [v for v in daily.get("shortwave_radiation_sum") or [] if v is not None]
    if not sun or not all(0 <= v <= 45 for v in sun):
        problems.append("Open-Meteo : rayonnement quotidien absent ou hors de 0 à 45 MJ/m²")
    return problems


def test_un_rayonnement_renomme_est_nomme():
    daily = {"time": ["2026-01-10"], "wind_speed_10m_mean": [3.0], "precipitation_sum": [0.0]}
    body = {"daily": daily}
    problems = wind_problems({**body, "daily_units": {}})
    assert "Open-Meteo : variable shortwave_radiation_sum absente" in problems
    full = {**daily, "wind_gusts_10m_max": [9.0], "shortwave_radiation_sum": [6.2]}
    ok = {"daily_units": {"shortwave_radiation_sum": "MJ/m²"}, "daily": full}
    assert wind_problems(ok) == []


@pytest.mark.reseau
def test_open_meteo_vent_pluie_rayonnement_au_format_lu():
    """#117: the variable names of the radiation (and the wind, the rain) are the ones Open-Meteo
    answers, in MJ/m² per day."""
    day = (datetime.now(UTC).date() - timedelta(days=30)).isoformat()
    r = _get(ARCHIVE, **PLACE, daily=WIND, start_date=day, end_date=day)
    assert wind_problems(r.json()) == []


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


@pytest.mark.reseau
def test_pvgis_profil_horaire_d_un_lieu_public():
    """#356: the hourly PVGIS series of one roof, asked with the collector's own query for a public
    place (Paris, Hôtel de Ville), never the home: the shape the collector reads, a full year of
    days and a plausible yearly production of 1 kWc."""
    from collector.solar import PVGIS, hours_of, pvgis_params

    roof = {"name": "Toit", "azimuth": 180, "tilt": 30, "kwc": 1, "loss": 14}
    r = _get(PVGIS, **pvgis_params({"lat": PLACE["latitude"], "lon": PLACE["longitude"]}, roof))
    hours = hours_of(schema.check("PVGIS", "seriescalc", schema.PVGIS_SERIES, r.json()))
    assert len(hours) >= 365
    kwh = sum(sum(v) for v in hours.values()) / 1000
    assert 700 < kwh < 1600, f"{kwh:.0f} kWh par kWc et par an : hors de ce que la France produit"


@pytest.mark.reseau
def test_degres_jours_comme_meteo_france_a_une_station_publique():
    """#464: the last complete year at Lyon-Bron, Météo-France data against Open-Meteo at the
    same place, both counted with the app's rule. Measured on 12/11/2026 for 2025: 2 030 DJ from
    Météo-France, 2 138 from Open-Meteo (+5 %). A gap of more than 10 % would mean the source or
    the rule has changed. The expected « 2 300 à 2 500 » of the issue is the 1981-2010 average
    (2 379 at Bron, 2 226 over 1991-2020), not a year of the 2020s."""
    year = datetime.now(UTC).date().year - 1
    meta = _get(MF_DATASET)
    url = mf_file_for(meta.json().get("resources", []), MF_STATION["dept"], year)
    assert url, f"Météo-France : aucun fichier quotidien du {MF_STATION['dept']} pour {year} (noms changés ?)"
    text = gzip.decompress(_get(url).content).decode("utf-8", errors="replace")
    mf, mf_days = mf_degree_days(text, MF_STATION["num"], year)
    assert mf_days >= 360, f"Météo-France : {mf_days} jours lus pour {year} (colonnes TN / TX ?)"
    place = {k: MF_STATION[k] for k in ("latitude", "longitude", "timezone")}
    body = _get(ARCHIVE, **place, daily=DAILY, start_date=f"{year}-01-01", end_date=f"{year}-12-31").json()
    assert meteo_problems(body) == []
    om, om_days = om_degree_days(body, year)
    assert om_days >= 365
    assert 1500 < mf < 3200, f"{mf:.0f} DJ à Lyon-Bron en {year} : hors de ce que la station a connu"
    gap = om / mf - 1
    assert abs(gap) <= 0.10, f"Open-Meteo {om:.0f} DJ contre Météo-France {mf:.0f} ({gap:+.0%}) en {year}"
