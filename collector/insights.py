"""Monthly analysis written by Claude, stored encrypted like the rest (data/insights.enc.json).

Principle: the CODE computes every number (facts below); the model only writes the
text around them. Every number in the text is then checked against the facts.

What is sent to the Anthropic API: aggregated monthly figures (kWh, °C, degree days,
percentages) and the room names. No address, no coordinates, no identifiers, no daily
series. Runs only when ANTHROPIC_API_KEY is set (GitHub Actions secret).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, date, datetime, timedelta

from .storage import Store

log = logging.getLogger(__name__)

MODEL = "claude-opus-5-5"
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
- Si des jours sont « estimés », dis-le en une phrase.
- Pas de conseil générique : chaque conseil s'appuie sur un chiffre fourni (une pièce, une heure, \
une consigne, une part heures pleines).

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


def compute_facts(store: Store, month: str) -> dict:
    """All the numbers the model may use, computed here."""
    meta = store.meta
    rooms = {r["id"]: r for r in meta.get("rooms", []) if r.get("category") != "ignore"}
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
        vals = [max(0.0, 18 - (w[0] + w[1]) / 2) for d, w in weather.items() if a <= d <= b]
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
                "piece": rooms[rid]["name"],
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
    # Tariff split and room temperatures over the month
    t1 = t2 = 0.0
    temps: dict[str, list[float]] = {}
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
                temps[rooms[rid]["name"]] = [
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
    linky = {d: v for d, v in store.doc("linky").get("daily", {}).items() if first <= d <= last}
    if len(linky) > 20 and facts["total_kwh"]:
        home = sum(linky.values()) / 1000
        facts["logement_total_kwh_linky"] = r1(home)
        facts["part_chauffage_et_chauffe_eau_pct"] = round(facts["total_kwh"] / home * 100)
    return facts


_NUM = re.compile(r"(?<![\w.])[-−]?\d[\d\s  ]*(?:[.,]\d+)?")


def _numbers(text: str) -> list[float]:
    out = []
    for m in _NUM.finditer(text):
        raw = m.group(0).replace("−", "-").replace(" ", "").replace(" ", "").replace(" ", "").replace(",", ".")
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

    if client is None:
        import anthropic

        client = anthropic.Anthropic()
    messages = [
        {"role": "user", "content": "Données du mois (JSON) :\n" + json.dumps(facts, ensure_ascii=False, indent=1)}
    ]
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
        if response.stop_reason == "refusal":
            log.warning("Analyse IA refusée par le modèle : %s", response.stop_details)
            return False
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        bad = unknown_numbers(text, facts)
        if not bad:
            break
        log.warning("Chiffres non présents dans les données : %s", bad)
        if attempt == 0:
            messages += [
                {"role": "assistant", "content": response.content},
                {
                    "role": "user",
                    "content": f"Ces nombres ne figurent pas dans les données : {bad}. Réécris le bilan en "
                    "n'utilisant que les chiffres fournis.",
                },
            ]
    store.replace(
        "insights",
        {
            "period": last_month,
            "generated": datetime.now(UTC).isoformat(timespec="seconds"),
            "model": MODEL,
            "markdown": text,
            "verified": not unknown_numbers(text, facts),
            "facts": facts,
        },
    )
    log.info("Analyse IA rédigée pour %s", last_month)
    return True
