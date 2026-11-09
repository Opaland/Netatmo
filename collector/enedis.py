"""Whole-home consumption from the Linky meter, through Conso API (https://conso.boris.sh).

Enedis' own API is reserved to companies; Conso API is the free relay used by the
Home Assistant "ha-linky" integration. The owner consents on the Enedis website and
gets a personal token. Optional: needs ENEDIS_TOKEN and ENEDIS_PRM (14-digit point id).
"""

from __future__ import annotations

import contextlib
import logging
import statistics
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from .storage import Store

log = logging.getLogger(__name__)

API = "https://conso.boris.sh/api/consommation_quotidienne"
API_PMAX = "https://conso.boris.sh/api/puissance_conso_max_quotidienne"
USER_AGENT = "intuis-history/1.0 (+https://github.com/Opaland/Netatmo)"
DATE_KEYS = ("date", "dateDebut", "date_debut", "debut", "horodatage", "start")
VALUE_KEYS = ("value", "valeur", "val", "consommation")


class LinkyError(RuntimeError):
    pass


def _readings(obj: object) -> list[tuple[str, float]]:
    """Find (day, value) pairs anywhere in the response (its format changed in 2026)."""
    out: list[tuple[str, float]] = []
    if isinstance(obj, dict):
        dk = next((k for k in DATE_KEYS if isinstance(obj.get(k), str)), None)
        vk = next((k for k in VALUE_KEYS if k in obj), None)
        if dk and vk is not None:
            with contextlib.suppress(TypeError, ValueError):
                out.append((obj[dk][:10], float(obj[vk])))
        for v in obj.values():
            out += _readings(v)
    elif isinstance(obj, list):
        for v in obj:
            out += _readings(v)
    return out


def collect(store: Store, token: str, prm: str, first_day: str, tz: str, http: httpx.Client | None = None) -> int:
    http = http or httpx.Client(timeout=60.0, headers={"User-Agent": USER_AGENT})
    have = store.doc("linky").get("daily", {})
    today = datetime.now(ZoneInfo(tz)).date()
    # Enedis keeps about 3 years; refresh the last 10 days, fetch the rest once.
    start = max(date.fromisoformat(first_day), today - timedelta(days=3 * 365))
    if have:
        start = max(start, date.fromisoformat(max(have)) - timedelta(days=10))
    rows: list[tuple[str, float]] = []
    chunk_start = start
    while chunk_start < today:
        chunk_end = min(chunk_start + timedelta(days=365), today)
        resp = http.get(
            API,
            params={"pointId": prm, "dateDebut": chunk_start.isoformat(), "dateFin": chunk_end.isoformat()},
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            raise LinkyError(f"Linky (Conso API) : HTTP {resp.status_code} {resp.text[:150]}")
        found = _readings(resp.json())
        if not found:
            log.warning("Linky : réponse sans mesure reconnue (clés : %s)", list(resp.json())[:8])
        rows += found
        chunk_start = chunk_end
    _collect_pmax(store, token, prm, start, today, http)
    if not rows:
        return 0
    # Values are Wh; tolerate a kWh payload (a house uses well over 500 Wh a day).
    factor = 1000.0 if statistics.median(v for _d, v in rows) < 500 else 1.0
    for day, v in rows:
        store.put("linky", "daily", day, None, round(v * factor, 1))
    log.info("Linky : %d jours", len(rows))
    return len(rows)


def _collect_pmax(store: Store, token: str, prm: str, start: date, today: date, http: httpx.Client) -> None:
    """Daily maximum power drawn (kVA): tells whether the subscribed power fits. Best effort."""
    rows: list[tuple[str, float]] = []
    chunk_start = start
    while chunk_start < today:
        chunk_end = min(chunk_start + timedelta(days=365), today)
        resp = http.get(
            API_PMAX,
            params={"pointId": prm, "dateDebut": chunk_start.isoformat(), "dateFin": chunk_end.isoformat()},
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            log.warning("Linky : puissance max indisponible (HTTP %s)", resp.status_code)
            return
        rows += _readings(resp.json())
        chunk_start = chunk_end
    if not rows:
        return
    # Enedis gives VA; tolerate kVA.
    factor = 0.001 if statistics.median(v for _d, v in rows) > 100 else 1.0
    for day, v in rows:
        store.put("linky", "pmax", day, None, round(v * factor, 2))
    log.info("Linky : puissance max sur %d jours", len(rows))
