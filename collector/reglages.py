"""The household settings the collector reads in its environment, and the state of its tokens (#641).

- the settings written by the app (⚙ Mon logement), sealed as repository secrets: radiators stopped on
  purpose, wood bought, shared contract, plan of the house (#459, #497, #202);
- per source, the last success or failure and the lifetime of its token (`Sources`, S-1.7, S-1.12),
  and what the owner must renew;
- the files the workflow turns into an alert issue (devices, tokens to renew).

Moved out of ``collector/__main__.py`` without a change (#641); ``__main__`` imports these names back,
so ``python -m collector`` and the tests that read them there see the same objects. Messages go to the
public log: names of settings and sources only, never a value.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from . import redact
from .schema import FormatError

# #459: the household settings written by the app (⚙ Mon logement; #497: the shared contract and
# the cold alert too), sealed in the browser and stored as repository secrets (env NAME). Until
# migrated, an older plaintext repository variable of the same name is still read (env
# NAME_VARIABLE, see collect.yml), after the secret.
HOUSEHOLD_SETTINGS = ("STOPPED_ROOMS_JSON", "WOOD_JSON", "CONTRACT_JSON", "COLD_ALERT_JSON")
PLAIN_SUFFIX = "_VARIABLE"


def household_setting(name: str, warn: bool = True) -> str:
    """#459: the secret `name` first, else the plaintext variable left from before; a plaintext
    variable still present is reported in the log by its name only, never its value."""
    secret = os.environ.get(name, "").strip()
    plain = os.environ.get(name + PLAIN_SUFFIX, "").strip()
    if plain and warn:
        _warn(f"Variable en clair {name} encore présente : à migrer en secret depuis ⚙ Paramètres")
    return secret or plain


def household_setting_set(name: str) -> bool:
    """The setting is configured (possibly empty): the collection then records it in the meta."""
    return name in os.environ or name + PLAIN_SUFFIX in os.environ


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "oui", "yes")


def stopped_config(warn: bool = True) -> list[dict]:
    """#346: STOPPED_ROOMS_JSON (radiators switched off on purpose); [] when unset or invalid."""
    from .devices import StoppedError, parse_stopped

    raw = household_setting("STOPPED_ROOMS_JSON", warn)
    if not raw:
        return []
    try:
        return parse_stopped(raw)
    except StoppedError as err:
        _warn(f"Réglage STOPPED_ROOMS_JSON ignoré ({err})")
        return []


def wood_config() -> dict | None:
    """#366: WOOD_JSON (the wood bought for a stove); None when unset or invalid."""
    from .devices import WoodError, parse_wood

    raw = household_setting("WOOD_JSON")
    if not raw:
        return None
    try:
        return parse_wood(raw)
    except WoodError as err:
        _warn(f"Réglage WOOD_JSON ignoré ({err})")
        return None


def write_device_file(lines: list[str]) -> None:
    """Optional alert issue (#214, #215): module types, counts and dates, never a name or an id."""
    path = os.environ.get("DEVICE_FILE")
    if path:
        Path(path).write_text("".join(f"- {line}\n" for line in lines), encoding="utf-8")


def _warn(msg: str) -> None:
    # "::warning::" shows up as an annotation on the GitHub Actions run (public log: redacted).
    msg = redact.redact(msg)
    print(f"::warning::{msg}" if os.environ.get("GITHUB_ACTIONS") else f"Attention : {msg}")


# Conso API consent / token lifetime when the token carries no date: 3 years (à vérifier).
LINKY_CONSENT_DAYS = 3 * 365
EXPIRY_WARNING_DAYS = 30
RENEW = {
    "linky": "nouvel accord sur conso.boris.sh, puis secret ENEDIS_TOKEN",
    "netatmo": "nouveau refresh token (scope read_station) sur dev.netatmo.com, puis secret NETATMO_REFRESH_TOKEN",
    "shelly": "nouvelle clé dans l'application Shelly (Clé d'autorisation cloud), puis secret SHELLY_AUTH_KEY",
}


class Sources:
    """Last success / failure per data source (S-1.7), kept in the encrypted meta.

    S-1.12: per credential, a short hash (never the secret), the date of its first success
    (`since`), `auth_expired` when the source refused it, and `expires` when known or
    estimated (`expires_estimated`)."""

    def __init__(self, previous: dict | None) -> None:
        self.state: dict[str, dict] = {k: dict(v) for k, v in (previous or {}).items()}
        self.now = datetime.now(UTC).isoformat(timespec="seconds")

    def credential(self, name: str, secret: str) -> None:
        """A new secret (hash changed) starts a new lifetime."""
        digest = hashlib.sha256(secret.encode()).hexdigest()[:12]
        st = self.state.setdefault(name, {})
        if st.get("credential") != digest:
            for key in ("since", "auth_expired", "expires", "expires_estimated"):
                st.pop(key, None)
            st["credential"] = digest

    def ok(self, name: str, note: str | None = None) -> None:
        st = self.state.setdefault(name, {})
        st["ok"] = self.now
        st.pop("message", None)
        st.pop("auth_expired", None)
        st.pop("note", None)
        st.pop("format", None)
        if "credential" in st:
            st.setdefault("since", self.now[:10])
        if note:
            st["note"] = note[:160]  # informative, not an error

    def failed(self, name: str, message: str, auth: bool = False, err: Exception | None = None) -> None:
        st = self.state.setdefault(name, {})
        st["error"] = self.now
        st["message"] = message[:160]
        if auth:
            st["auth_expired"] = True
        if isinstance(err, FormatError):
            # S-1.13: which field changed (a path in the reference schema, never a value).
            st["format"] = f"{err.endpoint} · {err.field}"[:120]

    def error(self, name: str, err: Exception) -> None:
        # S-1.16 #263: only the messages of the safe error types (never a URL, body or id).
        self.failed(name, redact.safe_message(err), auth=getattr(err, "auth", False), err=err)

    def expiry(self, name: str, expires: str | None, issued: str | None = None, days: int | None = None) -> None:
        """Expiry date from the token itself, else estimated from its issue date or first success."""
        st = self.state.setdefault(name, {})
        start = issued or st.get("since")
        if expires:
            st["expires"], st["expires_estimated"] = expires, False
        elif start and days:
            st["expires"] = (date.fromisoformat(start) + timedelta(days=days)).isoformat()
            st["expires_estimated"] = True

    def alerts(self, today: date | None = None) -> list[str]:
        return expiry_alerts(self.state, today or datetime.now(UTC).date())


def expiry_alerts(state: dict[str, dict], today: date) -> list[str]:
    """What the owner must renew: refused tokens, and tokens expiring within 30 days."""
    out = []
    for name, st in sorted(state.items()):
        how = RENEW.get(name, "mettre à jour le secret")
        if st.get("auth_expired"):
            out.append(f"Renouveler le jeton {name} : refusé depuis le {st.get('error', '?')[:10]} — {how}")
        elif st.get("expires"):
            left = (date.fromisoformat(st["expires"]) - today).days
            if left <= EXPIRY_WARNING_DAYS:
                kind = "estimée" if st.get("expires_estimated") else "indiquée par le jeton"
                when = f"dans {left} jours" if left >= 0 else f"dépassée de {-left} jours"
                out.append(f"Renouveler le jeton {name} : expiration {kind} le {st['expires']} ({when}) — {how}")
    return out


# S-12.1: contract shared between devices, from the repository secret CONTRACT_JSON (#497).
# Same lists as the web app (web/src/offers.ts and the CRE tariff files).
CONTRACT_OFFERS = ("edf-trv-hphc", "edf-trv-base")
CONTRACT_KVAS = (3, 6, 9, 12, 15, 18, 24, 30, 36)
CONTRACT_MAX_PERIODS = 50


class ContractError(ValueError):
    """Invalid CONTRACT_JSON. Messages never quote the values (public log)."""


def parse_contract(raw: str) -> list[dict]:
    """[{from, offer, kva}, ...] validated and normalised; raises ContractError."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        raise ContractError("JSON illisible") from err
    if not isinstance(data, list) or not data:
        raise ContractError("liste de périodes attendue")
    if len(data) > CONTRACT_MAX_PERIODS:
        raise ContractError(f"plus de {CONTRACT_MAX_PERIODS} périodes")
    out: list[dict] = []
    for i, p in enumerate(data, 1):
        if not isinstance(p, dict):
            raise ContractError(f"période {i} : objet attendu")
        day, offer, kva = p.get("from"), p.get("offer"), p.get("kva")
        try:
            if not isinstance(day, str) or len(day) != 10:
                raise ValueError
            date.fromisoformat(day)
        except ValueError:
            raise ContractError(f"période {i} : date AAAA-MM-JJ attendue") from None
        if offer not in CONTRACT_OFFERS:
            raise ContractError(f"période {i} : offre inconnue")
        if isinstance(kva, bool) or not isinstance(kva, int | float) or kva not in CONTRACT_KVAS:
            raise ContractError(f"période {i} : puissance non standard")
        if out and day <= out[-1]["from"]:
            raise ContractError(f"période {i} : dates non triées ou en double")
        out.append({"from": day, "offer": offer, "kva": int(kva)})
    return out


def shared_contract(previous: list[dict] | None) -> list[dict] | None:
    """CONTRACT_JSON if valid; the previous contract if invalid; None when the setting is unset."""
    raw = household_setting("CONTRACT_JSON")
    if not raw:
        return None
    try:
        return parse_contract(raw)
    except ContractError as err:
        _warn(f"Réglage CONTRACT_JSON ignoré ({err}) : le contrat partagé précédent est conservé")
        return previous


def floor_plan(previous: dict | None) -> dict | None:
    """#202: FLOOR_PLAN_JSON (the plan of the house) if valid; the previous plan if invalid (a bad
    write never erases the drawing); None when the secret is unset."""
    from .floorplan import PlanError, parse_floor_plan

    raw = os.environ.get("FLOOR_PLAN_JSON", "").strip()
    if not raw:
        return None
    try:
        return parse_floor_plan(raw)
    except PlanError as err:
        _warn(f"Secret FLOOR_PLAN_JSON ignoré ({err}) : le plan précédent est conservé")
        return previous


def write_renew_file(alerts: list[str]) -> None:
    """S-1.12: credentials to renew, one per line, for the workflow's alert issue (never a value)."""
    path = os.environ.get("RENEW_FILE")
    if path:
        Path(path).write_text("".join(f"- {a}\n" for a in alerts), encoding="utf-8")
