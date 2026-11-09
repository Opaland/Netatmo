"""S-12.5: prolonged cold in a living room, checked by the nightly collection.

Configuration: the repository variable COLD_ALERT_JSON (not a secret, disabled when unset),
for example ``{"threshold": 14, "days": 1, "rooms": ["1234567890", "70:ee:50:00:00:01"]}``:
Intuis room ids (radiator probe, daily mean) or indoor station modules (daily mean).

A room is « cold » when its daily mean stayed below the threshold on its last ``days``
measured days (a daily mean covers 24 h). Same rule as the web app (web/src/cold.ts).

Public output only: the alert file lists pseudonyms (« Pièce A » = first room of the list),
never a room name, an id or a temperature; the log prints counts. The real names are shown
by the app (Paramètres → Alerte froid prolongé), on the owner's devices only.
"""

from __future__ import annotations

import json
import os
from datetime import date, timedelta
from pathlib import Path

from .storage import Store

MAX_ROOMS = 10


class ColdError(ValueError):
    """Invalid COLD_ALERT_JSON. Messages never quote the values (public log)."""


def parse_cold_alert(raw: str) -> dict | None:
    """Validated configuration, None when disabled (empty list of rooms)."""
    try:
        data = json.loads(raw)
    except ValueError as err:
        raise ColdError("JSON illisible") from err
    if not isinstance(data, dict):
        raise ColdError("objet attendu")
    threshold = data.get("threshold")
    days = data.get("days", 1)
    rooms = data.get("rooms")
    if isinstance(threshold, bool) or not isinstance(threshold, int | float) or not 5 <= threshold <= 22:
        raise ColdError("seuil hors de 5 à 22 °C")
    if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 7:
        raise ColdError("durée hors de 1 à 7 jours")
    if not isinstance(rooms, list) or not all(isinstance(r, str) and 0 < len(r) <= 64 for r in rooms):
        raise ColdError("liste de pièces attendue")
    rooms = list(dict.fromkeys(rooms))
    if len(rooms) > MAX_ROOMS:
        raise ColdError(f"plus de {MAX_ROOMS} pièces")
    if not rooms:
        return None
    return {"threshold": threshold, "days": days, "rooms": rooms}


def cold_config(warn) -> dict | None:
    """COLD_ALERT_JSON if set and valid; None otherwise (an invalid value is reported, not quoted)."""
    raw = os.environ.get("COLD_ALERT_JSON", "").strip()
    if not raw:
        return None
    try:
        return parse_cold_alert(raw)
    except ColdError as err:
        warn(f"Variable COLD_ALERT_JSON ignorée ({err}) : alerte froid désactivée")
        return None


def pseudonym(i: int) -> str:
    return f"Pièce {chr(65 + i % 26)}"


def daily_means(store: Store, room: str) -> dict[str, float]:
    """Daily mean temperature of an Intuis room (radiator probe) or of a station module."""
    out: dict[str, float] = {}
    for year in store.years():
        for day, v in store.doc(str(year)).get("temps", {}).get(room, {}).items():
            if isinstance(v, list) and v and isinstance(v[0], int | float):
                out[day] = float(v[0])
    for day, v in store.doc("station").get("daily", {}).get(room, {}).items():
        if isinstance(v, list) and len(v) > 2 and isinstance(v[2], int | float):
            out[day] = float(v[2])
    return out


def cold_status(means: dict[str, float], threshold: float, days: int, archive_last: str) -> tuple[str, int]:
    """("cold" | "ok" | "stale", consecutive days below the threshold ending on the last reading)."""
    if not means:
        return "stale", 0
    ordered = sorted(means)
    last = ordered[-1]
    if date.fromisoformat(last) < date.fromisoformat(archive_last) - timedelta(days=2):
        return "stale", 0
    streak = 0
    expected = date.fromisoformat(last)
    for day in reversed(ordered):
        if date.fromisoformat(day) != expected or means[day] >= threshold:
            break
        streak += 1
        expected -= timedelta(days=1)
    return ("cold" if streak >= days else "ok"), streak


def cold_alerts(store: Store, cfg: dict | None) -> tuple[list[str], dict[str, int]]:
    """Lines for the public issue (pseudonyms only) and counts for the log."""
    counts = {"suivies": 0, "froides": 0, "sans_mesure": 0}
    last = store.last_day()
    if not cfg or not last:
        return [], counts
    lines = []
    for i, room in enumerate(cfg["rooms"]):
        counts["suivies"] += 1
        status, streak = cold_status(daily_means(store, room), cfg["threshold"], cfg["days"], last)
        if status == "stale":
            counts["sans_mesure"] += 1
        elif status == "cold":
            counts["froides"] += 1
            plural = "s" if streak > 1 else ""
            lines.append(f"{pseudonym(i)} : sous le seuil choisi depuis {streak} jour{plural} (moyenne journalière)")
    return lines, counts


def write_cold_file(lines: list[str]) -> None:
    """One line per cold room for the workflow's alert issue (never a name or a value)."""
    path = os.environ.get("COLD_FILE")
    if path:
        Path(path).write_text("".join(f"- {line}\n" for line in lines), encoding="utf-8")
