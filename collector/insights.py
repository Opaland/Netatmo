"""Monthly analysis written by Claude, stored encrypted like the rest (data/insights.enc.json).

Principle: the CODE computes every number (facts below); the model only writes the
text around them. Every number in the text is then checked against the facts.

What is sent to the Anthropic API: aggregated monthly figures (kWh, estimated €, °C,
degree days, percentages, a few unusual days, station comfort counts, data coverage, and the
monthly hours of open window and boost per room with the bedrooms merged, S-5.10 / S-13.5).
Rooms and station modules are sent as pseudonyms ("Pièce A", "Capteur B"), never their
names or ids (S-5.7); the real names are put back in the text locally, before storing.
No home name, address, coordinates or identifiers, no daily series. Runs only when
ANTHROPIC_API_KEY is set (GitHub Actions secret). Logs carry counts only, never the
facts nor the text. Each analysis stores its token usage and estimated cost (S-5.8).
"""

from __future__ import annotations

import csv
import json
import logging
import math
import re
import unicodedata
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from statistics import median

from .storage import Store
from .weather import degree_days

log = logging.getLogger(__name__)

MODEL = "claude-opus-5-5"
# Public list prices, USD per million tokens (input, output), checked 2026-10. Cache reads
# cost 0.1x the input price, cache writes 1.25x. A model the server fell back to is priced
# with its own row (longest matching prefix), an unknown one with MODEL's.
PRICES_USD = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-fable-5-1": (10.0, 50.0),
}
EUR_PER_USD = 0.87  # indicative rate for the cost shown in euros
TARIFFS_DIR = Path(__file__).resolve().parent.parent / "web" / "public" / "tarifs"
OFFER_FILES = {"edf-trv-hphc": "Option_HPHC.csv", "edf-trv-base": "Option_Base.csv"}
MONTHS = [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
]

SYSTEM = """Tu es l'analyste énergie d'un foyer français équipé de radiateurs électriques connectés \
(Intuis / Muller Intuitiv) et d'un chauffe-eau piloté. Tu rédiges chaque mois un court bilan \
pour toute la famille, en français simple et chaleureux, sans jargon.

Règles impératives :
- N'utilise QUE les chiffres présents dans les données fournies (en JSON). N'invente, n'extrapole \
et ne recalcule aucun chiffre. Tu peux arrondir un chiffre fourni à l'entier, rien d'autre.
- Distingue toujours l'effet de la météo (degrés-jours, DJU) de l'effet des usages (kWh par DJU).
- Si des jours sont « estimés » ou « manquants », dis-le en une phrase.
- Pas de conseil générique : chaque conseil s'appuie sur un chiffre fourni (une pièce, une heure, \
une consigne, une part heures pleines, un coût, un jour inhabituel, une mesure de confort).
- Les pièces et capteurs sont désignés par des pseudonymes (« Pièce A », « Capteur B ») : \
reprends-les tels quels, sans chercher à deviner de quelle pièce il s'agit.
- Les coûts en euros sont des estimations (tarif réglementé, abonnement exclu) : dis « environ ».
- « fenetres_et_boost » : heures du mois où le radiateur a détecté une fenêtre ouverte (chute \
rapide de température, pas un capteur) et heures de boost, par pièce ; les chambres sont regroupées. \
Une fenêtre ouverte est une explication possible d'une pièce froide ou d'un jour inhabituel, jamais \
une certitude ; ne parle pas des chambres une par une.

Format Markdown, 120 à 250 mots :
### <titre en une phrase qui donne le verdict>
Un paragraphe de bilan (mois vs même mois l'an dernier, à climat comparable si les DJU sont fournis).
### Ce qui a compté
2 à 4 puces sur les pièces ou usages qui expliquent l'évolution.
### À essayer
2 ou 3 puces de conseils concrets et chiffrés."""


def _month_bounds(month: str) -> tuple[str, str]:
    y, m = int(month[:4]), int(month[5:7])
    first = date(y, m, 1)
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return first.isoformat(), (nxt - timedelta(days=1)).isoformat()


def _minus_year(day: str) -> str:
    return f"{int(day[:4]) - 1}{day[4:]}" if day[5:] != "02-29" else f"{int(day[:4]) - 1}-02-28"


def _long_day(day: str) -> str:
    return f"{int(day[8:10])} {MONTHS[int(day[5:7]) - 1]}"


# ------------------------------------------------------------------ pseudonyms (S-5.7)
def _letters(i: int) -> str:
    """0 → A, 25 → Z, 26 → AA."""
    out = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        out = chr(65 + r) + out
    return out


def pseudonyms(store: Store) -> tuple[dict[str, str], dict[str, str]]:
    """Room id → "Pièce A…", indoor station module key → "Capteur A…" (stable order)."""
    rooms = [r for r in store.meta.get("rooms", []) if r.get("category") != "ignore"]
    room_alias = {r["id"]: f"Pièce {_letters(i)}" for i, r in enumerate(rooms)}
    modules = store.doc("station").get("modules", {})
    indoor = [k for k in sorted(modules) if modules[k].get("indoor")]
    module_alias = {k: f"Capteur {_letters(i)}" for i, k in enumerate(indoor)}
    return room_alias, module_alias


def restore_names(text: str, names: dict[str, str]) -> str:
    """Put the real names back in place of the pseudonyms ("pièce A" too)."""
    for alias in sorted(names, key=len, reverse=True):
        head, rest = alias[0], alias[1:]
        pattern = re.compile(rf"(?<!\w)[{head.upper()}{head.lower()}]{re.escape(rest)}(?!\w)")
        text = pattern.sub(lambda _m, n=names[alias]: n, text)
    return text


# ------------------------------------------------------------------ estimated cost (S-5.6)
_offer_cache: dict[str, list[tuple[str, str | None, int, float, float, float]]] = {}


def _fr_date(s: str) -> str | None:
    return f"{s[6:10]}-{s[3:5]}-{s[:2]}" if s else None


def _offer_rows(offer: str) -> list[tuple[str, str | None, int, float, float, float]]:
    """[(from, to, kVA, € per year, €/kWh off-peak, €/kWh peak)] from the bundled CRE file."""
    if offer not in _offer_cache:
        rows = []
        path = TARIFFS_DIR / OFFER_FILES.get(offer, "-")
        if path.is_file():
            with path.open(encoding="utf-8") as fh:
                for c in csv.DictReader(fh, delimiter=";"):
                    single = c.get("PART_VARIABLE_TTC")
                    hc = single or c.get("PART_VARIABLE_HC_TTC")
                    hp = single or c.get("PART_VARIABLE_HP_TTC")
                    if not (c.get("DATE_DEBUT") and hc and hp and c.get("PART_FIXE_TTC")):
                        continue
                    num = lambda v: float(v.replace(",", "."))  # noqa: E731
                    rows.append(
                        (
                            _fr_date(c["DATE_DEBUT"]) or "",
                            _fr_date(c.get("DATE_FIN") or ""),
                            int(c["P_SOUSCRITE"]),
                            num(c["PART_FIXE_TTC"]),
                            num(hc),
                            num(hp),
                        )
                    )
        _offer_cache[offer] = rows
    return _offer_cache[offer]


def _price_at(contract: list[dict], day: str) -> tuple[float, float, float] | None:
    """(€/year, €/kWh off-peak, €/kWh peak) in force that day under the shared contract."""
    period = contract[0]
    for p in contract:
        if p["from"] <= day:
            period = p
    found = None
    for frm, to, kva, fixed, hc, hp in _offer_rows(period["offer"]):
        if kva == period["kva"] and frm <= day and (to is None or day <= to):
            found = (fixed, hc, hp)
    return found


def _energy_cost(store: Store, rooms: dict, contract: list[dict], first: str, last: str) -> float | None:
    """Energy cost (€, subscription excluded) of the rooms over [first, last], as the app
    computes it: tariff detail when known, else the room's usual off-peak share."""
    years = sorted({int(first[:4]), int(last[:4])})
    tariffs = [store.doc(str(y)).get("tariffs", {}) for y in years]
    water = {rid for rid, r in rooms.items() if r["category"] == "water_heater"}
    c1 = c2 = 0.0
    for t in tariffs:
        for rid in water:
            for v in t.get(rid, {}).values():
                c1, c2 = c1 + v[1], c2 + v[2]
    off = 1 if c1 > c2 else 2
    on = 3 - off
    shares: dict[str, float] = {}
    all_off = all_tot = 0.0
    for t in tariffs:
        for rid, days in t.items():
            o = sum(v[off] for v in days.values())
            tot = sum(v[0] + v[1] + v[2] for v in days.values())
            if tot:
                shares[rid] = o / tot
            all_off, all_tot = all_off + o, all_tot + tot
    overall = all_off / all_tot if all_tot else 0.3
    cost, priced = 0.0, False
    for y, t in zip(years, tariffs, strict=True):
        for rid, days in store.year(y).items():
            if rid not in rooms:
                continue
            for d, wh in days.items():
                if not first <= d <= last:
                    continue
                p = _price_at(contract, d)
                if not p:
                    continue
                priced = True
                v = t.get(rid, {}).get(d)
                if v and v[1] + v[2] > 0:
                    cost += (v[off] * p[1] + (v[on] + v[0]) * p[2]) / 1000
                else:
                    s = shares.get(rid, overall)
                    cost += wh / 1000 * (s * p[1] + (1 - s) * p[2])
    return cost if priced else None


# ------------------------------------------------------------------ unusual days (S-5.6)
def _unusual_days(store: Store, rooms: dict, weather: dict, first: str, last: str) -> list[dict]:
    """Heating days of the month far from the season's energy signature (same rule as the
    app's "Jours inhabituels": residual > 2 σ and > 3 kWh)."""
    y, m = int(first[:4]), int(first[5:7])
    s0 = y if m >= 9 else y - 1
    a, b = f"{s0}-09-01", f"{s0 + 1}-08-31"
    heat: dict[str, float] = {}
    for yy in (s0, s0 + 1):
        for rid, days in store.year(yy).items():
            if rooms.get(rid, {}).get("category") != "heating":
                continue
            for d, wh in days.items():
                if a <= d <= b:
                    heat[d] = heat.get(d, 0) + wh / 1000
    pts = [(weather[d][2], k, d) for d, k in heat.items() if d in weather and weather[d][2] < 15 and k > 0.2]
    n = len(pts)
    if n < 10:
        return []
    sx = sum(p[0] for p in pts)
    sy = sum(p[1] for p in pts)
    sxx = sum(p[0] ** 2 for p in pts)
    sxy = sum(p[0] * p[1] for p in pts)
    den = n * sxx - sx * sx
    if not den:
        return []
    slope = (n * sxy - sx * sy) / den
    intercept = (sy - slope * sx) / n
    res = [(k - (slope * t + intercept), t, k, d) for t, k, d in pts]
    sigma = math.sqrt(sum(r[0] ** 2 for r in res) / max(1, n - 2))
    out = [r for r in res if first <= r[3] <= last and abs(r[0]) > 2 * sigma and abs(r[0]) > 3]
    out = sorted(out, key=lambda r: -abs(r[0]))[:5]
    return [
        {
            "jour": _long_day(d),
            "chauffage_kwh": round(k, 1),
            "attendu_kwh": round(max(0.0, k - r), 1),
            "temperature_exterieure": round(t, 1),
        }
        for r, t, k, d in sorted(out, key=lambda r: r[3])
    ]


# ------------------------------------------------------------------ windows and boost (S-5.10)
# #234: the bedroom rule of the app (web/src/household.ts BEDROOM_WORDS / isBedroom), word for word;
# both sides are tested against web/src/__fixtures__/bedroom-names.json.
BEDROOM_WORDS = ("chambre", "bedroom", "dortoir", "suite parentale")
_BEDROOM = re.compile(r"\b(" + "|".join(BEDROOM_WORDS) + ")", re.ASCII)  # JS \b is ASCII-only
BEDROOMS_ALIAS = "Chambres (regroupées)"


def _fold(name: str) -> str:
    """Lower case without accents, as foldName() in the app (NFD, combining marks U+0300–U+036F dropped)."""
    return "".join(c for c in unicodedata.normalize("NFD", name) if not 0x300 <= ord(c) <= 0x36F).lower()


def is_bedroom(name: str) -> bool:
    """Same rule as the app (web/src/household.ts isBedroom)."""
    return bool(_BEDROOM.search(_fold(name or "")))


def _windows_boost(store: Store, rooms: dict, room_alias: dict[str, str], first: str, last: str) -> dict:
    """Monthly open-window and boost hours per pseudonym, from roomstate.enc.json (S-13.2).
    S-13.5: the bedrooms are merged into one line, whatever their number; nothing daily is sent."""
    doc = store.doc("roomstate")
    seen = [bin(m & 0xFFFFFF).count("1") for d, m in doc.get("seen", {}).items() if first <= d <= last]
    if not seen:
        return {}
    days = (date.fromisoformat(last) - date.fromisoformat(first)).days + 1
    out: dict[str, dict] = {}
    for rid, cells in doc.get("rooms", {}).items():
        room = rooms.get(rid)
        if not room or room.get("category") != "heating":
            continue
        alias = BEDROOMS_ALIAS if is_bedroom(room.get("name", "")) else room_alias.get(rid)
        if not alias:
            continue
        month = [c for d, c in cells.items() if first <= d <= last]
        if not month:
            continue
        e = out.setdefault(alias, {"fenetre_ouverte_h": 0.0, "boost_h": 0.0, "jours_fenetre_ouverte_1h_ou_plus": 0})
        e["fenetre_ouverte_h"] += sum(c.get("open_window_h", 0) for c in month)
        e["boost_h"] += sum(c.get("boost_h", 0) for c in month)
        e["jours_fenetre_ouverte_1h_ou_plus"] += sum(1 for c in month if c.get("open_window_h", 0) >= 1)
    pieces = [
        {"piece": alias, **{k: round(v, 1) if isinstance(v, float) else v for k, v in e.items()}}
        for alias, e in sorted(out.items(), key=lambda kv: -kv[1]["fenetre_ouverte_h"])
        if e["fenetre_ouverte_h"] or e["boost_h"]
    ]
    if not pieces:
        return {}
    return {"couverture_releve_pct": round(sum(seen) / (24 * days) * 100), "pieces": pieces}


# ------------------------------------------------------------------ station comfort (S-5.6)
def _station_comfort(store: Store, module_alias: dict[str, str], first: str, last: str) -> dict:
    st = store.doc("station")
    out: dict[str, dict] = {}
    for key, alias in module_alias.items():
        days = [v for d, v in st.get("daily", {}).get(key, {}).items() if first <= d <= last]
        if len(days) <= 20:
            continue
        mean = lambda vals: sum(vals) / len(vals)  # noqa: E731
        temps = [v[2] for v in days if v[2] is not None]
        hums = [v[3] for v in days if len(v) > 3 and v[3] is not None]
        co2 = [v[4] for v in days if len(v) > 4 and v[4] is not None]
        entry: dict = {}
        if temps:
            entry["temperature_moyenne"] = round(mean(temps), 1)
        if hums:
            entry["humidite_moyenne_pct"] = round(mean(hums))
        if co2:
            entry["co2_moyen_ppm"] = round(mean(co2))
            entry["jours_co2_moyen_sup_1000_ppm"] = sum(1 for c in co2 if c > 1000)
        hours = [h for d, h in st.get("hours", {}).get(key, {}).items() if first <= d <= last]
        if hours:
            entry["heures_humidite_sup_65_pct"] = sum(h.get("humid", 0) for h in hours)
            if any("cold" in h for h in hours):
                entry["heures_sous_19_degres"] = sum(h.get("cold", 0) for h in hours)
        nights = [h for d, h in st.get("nightly", {}).get(key, {}).items() if first <= d <= last]
        if nights:
            entry["heures_nuit_co2_sup_1000_ppm"] = sum(h.get("h_co2_1000", 0) for h in nights)
            entry["co2_max_nuit_ppm"] = max(h.get("co2_max", 0) for h in nights)
        if entry:
            out[alias] = entry
    return out


def compute_facts(store: Store, month: str) -> dict:
    """All the numbers the model may use, computed here, with pseudonyms only."""
    meta = store.meta
    rooms = {r["id"]: r for r in meta.get("rooms", []) if r.get("category") != "ignore"}
    room_alias, module_alias = pseudonyms(store)
    first, last = _month_bounds(month)
    pfirst, plast = _minus_year(first), _minus_year(last)

    def sums(a: str, b: str) -> tuple[dict[str, float], dict[str, float]]:
        per_room: dict[str, float] = {}
        per_cat: dict[str, float] = {}
        for y in {int(a[:4]), int(b[:4])}:
            for rid, days in store.year(y).items():
                if rid not in rooms:
                    continue
                v = sum(wh for d, wh in days.items() if a <= d <= b) / 1000
                if v:
                    per_room[rid] = per_room.get(rid, 0) + v
                    cat = rooms[rid]["category"]
                    per_cat[cat] = per_cat.get(cat, 0) + v
        return per_room, per_cat

    now_r, now_c = sums(first, last)
    prev_r, prev_c = sums(pfirst, plast)
    weather = store.doc("weather").get("outdoor", {})

    def dju(a: str, b: str) -> float | None:
        vals = [degree_days(w[0], w[1]) for d, w in weather.items() if a <= d <= b]
        return round(sum(vals)) if len(vals) > 20 else None

    def tmean(a: str, b: str) -> float | None:
        vals = [w[2] for d, w in weather.items() if a <= d <= b]
        return round(sum(vals) / len(vals), 1) if len(vals) > 20 else None

    r1 = lambda v: round(v, 1)  # noqa: E731
    facts: dict = {
        "mois": f"{MONTHS[int(month[5:7]) - 1]} {month[:4]}",
        "comparaison": f"{MONTHS[int(month[5:7]) - 1]} {int(month[:4]) - 1}",
        "total_kwh": r1(sum(now_c.values())),
        "total_kwh_annee_precedente": r1(sum(prev_c.values())),
        "chauffage_kwh": r1(now_c.get("heating", 0)),
        "chauffage_kwh_annee_precedente": r1(prev_c.get("heating", 0)),
        "chauffe_eau_kwh": r1(now_c.get("water_heater", 0)),
        "chauffe_eau_kwh_annee_precedente": r1(prev_c.get("water_heater", 0)),
        "pieces": [
            {
                "piece": room_alias[rid],
                "usage": "chauffe-eau" if rooms[rid]["category"] == "water_heater" else "chauffage",
                "kwh": r1(now_r.get(rid, 0)),
                "kwh_annee_precedente": r1(prev_r.get(rid, 0)),
                "evolution_kwh": r1(now_r.get(rid, 0) - prev_r.get(rid, 0)),
            }
            for rid in sorted(rooms, key=lambda r: -now_r.get(r, 0))
            if now_r.get(rid) or prev_r.get(rid)
        ],
    }
    d_now, d_prev = dju(first, last), dju(pfirst, plast)
    if d_now is not None and d_prev is not None:
        facts["dju"] = d_now
        facts["dju_annee_precedente"] = d_prev
        facts["temperature_exterieure_moyenne"] = tmean(first, last)
        facts["temperature_exterieure_moyenne_annee_precedente"] = tmean(pfirst, plast)
        if d_now > 20 and d_prev > 20 and prev_c.get("heating"):
            a, b = now_c.get("heating", 0) / d_now, prev_c["heating"] / d_prev
            facts["chauffage_kwh_par_dju"] = round(a, 2)
            facts["chauffage_kwh_par_dju_annee_precedente"] = round(b, 2)
            facts["evolution_a_climat_egal_pct"] = round((a / b - 1) * 100)
    # Estimated cost under the shared contract (S-12.1), when there is one
    contract = meta.get("contract")
    if contract:
        cost = _energy_cost(store, rooms, contract, first, last)
        if cost is not None:
            facts["cout_energie_estime_eur"] = round(cost)
            prev = _energy_cost(store, rooms, contract, pfirst, plast) if facts["total_kwh_annee_precedente"] else None
            if prev:
                facts["cout_energie_estime_eur_annee_precedente"] = round(prev)
            p = _price_at(contract, last)
            if p:
                facts["abonnement_eur_par_mois"] = round(p[0] / 12, 2)
                if p[1] != p[2]:
                    facts["prix_kwh_heures_creuses_eur"] = round(p[1], 4)
                    facts["prix_kwh_heures_pleines_eur"] = round(p[2], 4)
                else:
                    facts["prix_kwh_eur"] = round(p[1], 4)
    # Tariff split and room temperatures over the month
    t1 = t2 = 0.0
    temps: dict[str, list[float | None]] = {}
    estimated = 0
    doc = store.doc(month[:4])
    for days in doc.get("tariffs", {}).values():
        for d, v in days.items():
            if first <= d <= last:
                t1 += v[1] / 1000
                t2 += v[2] / 1000
    for rid, days in doc.get("temps", {}).items():
        if rid in rooms:
            vals = [v for d, v in days.items() if first <= d <= last]
            if vals:
                sp = [v[1] for v in vals if v[1] is not None]
                temps[room_alias[rid]] = [
                    r1(sum(v[0] for v in vals) / len(vals)),
                    r1(sum(sp) / len(sp)) if sp else None,
                ]
    for days in doc.get("estimated", {}).values():
        estimated += sum(1 for d in days if first <= d <= last)
    if t1 + t2:
        facts["tarif_1_kwh"], facts["tarif_2_kwh"] = r1(t1), r1(t2)
    if temps:
        facts["temperatures_pieces_moyenne_et_consigne"] = temps
    if estimated:
        facts["jours_pieces_estimes"] = estimated
    # Data quality (S-1.10 coverage): real / estimated / missing room-days
    cov = [months[month] for rid, months in doc.get("coverage", {}).items() if rid in rooms and month in months]
    if cov:
        facts["qualite_donnees"] = {
            "jours_pieces_reels": sum(c[0] for c in cov),
            "jours_pieces_estimes": sum(c[1] for c in cov),
            "jours_pieces_manquants": sum(c[2] for c in cov),
        }
    # Unusual heating days
    if weather:
        unusual = _unusual_days(store, rooms, weather, first, last)
        if unusual:
            facts["jours_inhabituels"] = unusual
    # Whole home (Linky): total, baseload from the 30-min curve, max power drawn
    linky_doc = store.doc("linky")
    linky = {d: v for d, v in linky_doc.get("daily", {}).items() if first <= d <= last}
    if len(linky) > 20 and facts["total_kwh"]:
        home = sum(linky.values()) / 1000
        facts["logement_total_kwh_linky"] = r1(home)
        facts["part_chauffage_et_chauffe_eau_pct"] = round(facts["total_kwh"] / home * 100)
    mins: dict[str, float] = {}
    for k, wh in store.doc(f"{month[:4]}.linky30").get("curve", {}).items():
        d = k[:10]
        if first <= d <= last:
            mins[d] = min(mins.get(d, wh), wh)
    if len(mins) > 20:
        facts["talon_logement_w"] = round(median(mins.values()) * 2)  # Wh per half hour → W
    pmax = [v for d, v in linky_doc.get("pmax", {}).items() if first <= d <= last]
    if pmax:
        facts["puissance_max_appelee_kva"] = r1(max(pmax))
    # Open windows and boost (S-5.10), bedrooms merged (S-13.5)
    wb = _windows_boost(store, rooms, room_alias, first, last)
    if wb:
        facts["fenetres_et_boost"] = wb
    # Netatmo station comfort, indoor modules
    comfort = _station_comfort(store, module_alias, first, last)
    if comfort:
        facts["station_confort"] = comfort
    return facts


_NUM = re.compile(r"(?<![\w.])[-−]?\d[\d\s  ]*(?:[.,]\d+)?")


def _numbers(text: str) -> list[float]:
    out = []
    for m in _NUM.finditer(text):
        raw = m.group(0).replace("−", "-").replace(" ", "").replace(" ", "").replace(" ", "").replace(",", ".")
        try:
            out.append(float(raw))
        except ValueError:
            continue
    return out


def unknown_numbers(markdown: str, facts: dict) -> list[float]:
    """Numbers in the text that are not (a rounding of) a number in the facts."""
    allowed: set[float] = set()

    def walk(o: object) -> None:
        if isinstance(o, bool):
            return
        if isinstance(o, int | float):
            for v in (o, abs(o)):
                allowed.update({round(v, 2), round(v, 1), float(round(v))})
        elif isinstance(o, dict):
            for k, v in o.items():
                walk(v)
                walk(_numbers(str(k)))
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, str):
            walk(_numbers(o))

    walk(facts)
    # Calendar words and small counts ("2 conseils", "18 °C" base) are fine.
    allowed.update({float(n) for n in range(0, 32)} | {18.0})
    return [n for n in _numbers(markdown) if round(n, 2) not in allowed and round(abs(n), 2) not in allowed]


# ------------------------------------------------------------------ usage and cost (S-5.8)
def _price_of(model: str) -> tuple[float, float]:
    keys = [k for k in PRICES_USD if model.startswith(k)]
    return PRICES_USD[max(keys, key=len)] if keys else PRICES_USD[MODEL]


def _add_usage(acc: dict, response: object) -> None:
    usage = getattr(response, "usage", None)
    acc["requests"] += 1
    if usage is None:
        return
    model = getattr(response, "model", None) or MODEL
    if model not in acc["served_by"]:
        acc["served_by"].append(model)
    n = {
        k: int(getattr(usage, k, 0) or 0)
        for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
    }
    for k, v in n.items():
        acc[k] += v
    pin, pout = _price_of(model)
    acc["cost_usd"] += (
        n["input_tokens"] * pin
        + n["cache_read_input_tokens"] * pin * 0.1
        + n["cache_creation_input_tokens"] * pin * 1.25
        + n["output_tokens"] * pout
    ) / 1e6


def generate(store: Store, today: date | None = None, force: bool = False, client=None) -> bool:
    """Write the analysis of the last complete month, once per month."""
    today = today or datetime.now(UTC).date()
    last_month = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    current = store.doc("insights")
    if current.get("period") == last_month and not force:
        log.info("Analyse IA déjà rédigée pour %s", last_month)
        return False
    facts = compute_facts(store, last_month)
    if not facts["total_kwh"]:
        log.info("Pas de consommation en %s : pas d'analyse", last_month)
        return False
    room_alias, module_alias = pseudonyms(store)
    rooms = {r["id"]: r.get("name", "") for r in store.meta.get("rooms", [])}
    modules = store.doc("station").get("modules", {})
    names = {a: rooms[rid] for rid, a in room_alias.items()} | {
        a: modules[k].get("name", "") for k, a in module_alias.items()
    }

    if client is None:
        import anthropic

        client = anthropic.Anthropic()
    messages = [
        {"role": "user", "content": "Données du mois (JSON) :\n" + json.dumps(facts, ensure_ascii=False, indent=1)}
    ]
    usage: dict = {
        "requests": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cost_usd": 0.0,
        "served_by": [],
    }
    text = ""
    for attempt in range(2):
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "medium"},
            system=SYSTEM,
            messages=messages,
        )
        _add_usage(usage, response)
        if response.stop_reason == "refusal":
            category = getattr(getattr(response, "stop_details", None), "category", None)
            log.warning("Analyse IA refusée par le modèle (catégorie %s)", category)
            return False
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        bad = unknown_numbers(text, facts)
        if not bad:
            break
        # Count only: the numbers come from the generated text (public log).
        log.warning("%d nombre(s) du texte absent(s) des données", len(bad))
        if attempt == 0:
            messages += [
                {"role": "assistant", "content": response.content},
                {
                    "role": "user",
                    "content": f"Ces nombres ne figurent pas dans les données : {bad}. Réécris le bilan en "
                    "n'utilisant que les chiffres fournis.",
                },
            ]
    verified = not unknown_numbers(text, facts)  # on the text as received, before names are restored
    usage["cost_usd"] = round(usage["cost_usd"], 4)
    usage["cost_eur"] = round(usage["cost_usd"] * EUR_PER_USD, 4)
    usage["eur_per_usd"] = EUR_PER_USD
    store.replace(
        "insights",
        {
            "period": last_month,
            "generated": datetime.now(UTC).isoformat(timespec="seconds"),
            "model": MODEL,
            "markdown": restore_names(text, names),
            "verified": verified,
            "facts": facts,
            "pseudonyms": names,
            "usage": usage,
        },
    )
    log.info(
        "Analyse IA rédigée pour %s (%d requête(s), %d jetons)",
        last_month,
        usage["requests"],
        usage["input_tokens"] + usage["output_tokens"],
    )
    return True
