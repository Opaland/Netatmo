"""#202: the plan of the house drawn in the app (⚙ Mon logement → « Plan de la maison »).

Configuration: the repository secret FLOOR_PLAN_JSON, sealed in the browser like the other household
settings (never written in clear, never readable back). The collection copies it into the encrypted
meta (`meta.floor_plan`) so that every device of the household reads the same plan.

The app is the one reader of a plan (web/src/floorplan.ts parsePlan: grid, levels, rooms, devices,
names): here, only the shape is checked (a JSON object with a list of levels, of a bounded size), so
that the rule of what a plan holds lives in one place (AGENTS.md §5). Nothing of the plan is ever
printed: an error says what is wrong, never a value (public log).
"""

from __future__ import annotations

import json

# A plan of 3 levels x 30 rooms and 60 devices, at its longest, stays under 30 kB; GitHub refuses a
# secret above 48 kB anyway.
MAX_BYTES = 48 * 1024


class PlanError(ValueError):
    """Invalid FLOOR_PLAN_JSON. Messages never quote the values (public log)."""


def parse_floor_plan(raw: str) -> dict:
    """The plan as the app wrote it: {"levels": [{"id": "rdc", "rooms": [...], "devices": [...]}]}."""
    if len(raw.encode("utf-8")) > MAX_BYTES:
        raise PlanError(f"plus de {MAX_BYTES // 1024} ko")
    try:
        data = json.loads(raw)
    except ValueError as err:
        raise PlanError("JSON illisible") from err
    if not isinstance(data, dict) or not isinstance(data.get("levels"), list):
        raise PlanError("objet avec une liste de niveaux attendu")
    if not data["levels"]:
        raise PlanError("aucun niveau")
    return {"levels": data["levels"]}
