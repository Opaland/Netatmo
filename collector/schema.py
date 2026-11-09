"""Reference shapes of the source APIs (S-1.13): see a format change before it leaves gaps.

Each response the collector relies on is checked against a small schema. A missing or
renamed field raises FormatError, whose message names the source, the endpoint and the
field (a path such as `body.home.rooms[].measures`) and never a value: GitHub Actions
logs of a public repository are public.

"No data" is not a format change: an empty list where a list is expected is valid.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

NUMBER = (int, float)
SCALAR = (str, int, float, bool, type(None))
# A field name that may be printed: an identifier, never a date, an id or a free text.
_SAFE_KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_$]{0,39}")
_DATE_LIKE = re.compile(r"\d{4}-\d{2}-\d{2}")


class FormatError(RuntimeError):
    """The response no longer has the expected shape. `field` is a path in the schema."""

    def __init__(self, source: str, endpoint: str, field: str, problem: str) -> None:
        self.source, self.endpoint, self.field, self.problem = source, endpoint, field, problem
        super().__init__(f"{source} : format de réponse inattendu ({endpoint}), champ « {field} » {problem}")


class Optional:
    """A field that may be absent (checked only when present)."""

    def __init__(self, spec: Any) -> None:
        self.spec = spec


class AnyOf:
    """One of several shapes (e.g. "optimized" measure blocks or a plain dict)."""

    def __init__(self, *specs: Any) -> None:
        self.specs = specs


def _type_name(spec: Any) -> str:
    if isinstance(spec, dict):
        return "objet"
    if isinstance(spec, list):
        return "liste"
    if isinstance(spec, AnyOf):
        return " ou ".join(_type_name(s) for s in spec.specs)
    types = spec if isinstance(spec, tuple) else (spec,)
    names = {str: "texte", int: "nombre", float: "nombre", bool: "booléen", type(None): "null"}
    return " ou ".join(dict.fromkeys(names.get(t, t.__name__) for t in types))


class _Mismatch(Exception):
    def __init__(self, path: str, problem: str) -> None:
        self.path, self.problem = path, problem


def _check(spec: Any, value: Any, path: str) -> None:
    if isinstance(spec, AnyOf):
        for s in spec.specs:
            try:
                _check(s, value, path)
                return
            except _Mismatch:
                continue
        raise _Mismatch(path, f"n'a plus la forme attendue ({_type_name(spec)})")
    if isinstance(spec, dict):
        if not isinstance(value, dict):
            raise _Mismatch(path, "n'est plus un objet")
        for key, sub in spec.items():
            where = f"{path}.{key}" if path else key
            if key not in value:
                if isinstance(sub, Optional):
                    continue
                raise _Mismatch(where, "absent")
            _check(sub.spec if isinstance(sub, Optional) else sub, value[key], where)
        return
    if isinstance(spec, list):
        if not isinstance(value, list):
            raise _Mismatch(path, "n'est plus une liste")
        for item in value:  # an empty list is "no data", not a format change
            _check(spec[0], item, f"{path}[]")
        return
    types = spec if isinstance(spec, tuple) else (spec,)
    if isinstance(value, bool) and bool not in types:
        raise _Mismatch(path, f"n'est plus du type attendu ({_type_name(spec)})")
    if not isinstance(value, types):
        raise _Mismatch(path, f"n'est plus du type attendu ({_type_name(spec)})")


def check(source: str, endpoint: str, spec: Any, payload: Any) -> Any:
    """Return `payload` unchanged, or raise FormatError naming the first unexpected field."""
    try:
        _check(spec, payload, "")
    except _Mismatch as m:
        raise FormatError(source, endpoint, m.path or "(réponse)", m.problem) from None
    return payload


def safe_keys(keys: Iterable[Any]) -> list[str]:
    """Sorted, deduplicated field names that look like identifiers (no id, date or text)."""
    return sorted({k for k in keys if isinstance(k, str) and _SAFE_KEY.fullmatch(k)})


def dated_records(obj: Any) -> list[dict]:
    """Flat objects (scalars only) carrying a date-like text: what a reading looks like,
    whatever its field names. Used to tell "format changed" from "no data"."""
    out: list[dict] = []
    if isinstance(obj, dict):
        if obj and all(isinstance(v, SCALAR) for v in obj.values()):
            if any(isinstance(v, str) and _DATE_LIKE.match(v) for v in obj.values()):
                out.append(obj)
        else:
            for v in obj.values():
                out += dated_records(v)
    elif isinstance(obj, list):
        for v in obj:
            out += dated_records(v)
    return out


# ---------------------------------------------------------------- reference schemas
# Measures: "optimized" blocks [{beg_time, step_time?, value: [[v, ...]]}] or {"<ts>": [v, ...]}.
MEASURES = AnyOf([{"beg_time": NUMBER, "value": list}], dict)

INTUIS_TOKEN = {"access_token": str}
INTUIS_HOMESDATA = {
    "body": {
        "homes": [
            {
                "id": str,
                "rooms": Optional([{"id": (str, int), "module_ids": Optional(list)}]),
                "modules": Optional([{"id": str, "type": Optional(str)}]),
            }
        ]
    }
}
INTUIS_HOMEMEASURE = {
    "body": {
        "home": {
            "rooms": Optional([{"id": (str, int), "measures": Optional(AnyOf(MEASURES, type(None)))}]),
            "modules": Optional(AnyOf([{"id": str, "measures": Optional(AnyOf(MEASURES, type(None)))}], type(None))),
        }
    }
}
INTUIS_ROOMMEASURE = {"body": MEASURES}
INTUIS_HOMESTATUS = {"body": {"home": {"rooms": Optional(list), "modules": Optional(list)}}}

NETATMO_TOKEN = {"access_token": str, "refresh_token": str}
NETATMO_STATIONS = {
    "body": {
        "devices": [
            {
                "_id": str,
                "type": Optional(str),
                "modules": Optional([{"_id": str, "type": Optional(str)}]),
            }
        ]
    }
}
NETATMO_MEASURE = {"body": MEASURES}

OPEN_METEO_DAILY = {
    "daily": {
        "time": [str],
        "temperature_2m_min": [(int, float, type(None))],
        "temperature_2m_max": [(int, float, type(None))],
        "temperature_2m_mean": [(int, float, type(None))],
    }
}

# Shelly Cloud (S-1.17): legacy form API envelope, and the v2 list of device states.
SHELLY_V1 = {"isok": bool, "data": Optional(AnyOf(dict, list, type(None))), "errors": Optional(AnyOf(dict, list))}
SHELLY_V2_STATE = [{"id": str, "online": Optional((int, bool)), "status": Optional(dict), "settings": Optional(dict)}]
