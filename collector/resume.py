"""The public job summary of a collection (GitHub Actions ``GITHUB_STEP_SUMMARY``), and its labels (#641).

AGENTS.md § 1: the job's log and summary are public, so they say sources, counts and dates only, never a
name or a value. Gathered here so that what the public summary can say reads in one place. Moved out of
``collector/__main__.py`` without a change (#641); ``__main__`` imports these names back.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

from . import redact
from .budget import METER, CallCapReached
from .errors import SourceError
from .reglages import expiry_alerts
from .schema import FormatError
from .storage import Store
from .sync import Syncer
from .texte import nombre


def _cold_label(cfg: dict | None, counts: dict[str, int]) -> str:
    # Counts only: neither the rooms, nor the threshold, nor a temperature (public log).
    if not cfg:
        return "Alerte froid : désactivée"
    followed = nombre(counts["suivies"], "pièce suivie", "pièces suivies")
    return f"Alerte froid : {followed}, {counts['froides']} sous le seuil, {counts['sans_mesure']} sans mesure récente"


def _room30_label(h: dict | None) -> str:
    """S-1.26: counters only (rooms with their whole history, oldest month reached)."""
    if not h:
        return "—"
    return f"historique complet {h.get('done', 0)}/{h.get('rooms', 0)} pièces, depuis {str(h.get('oldest', ''))[:7]}"


def _expiry_label(st: dict) -> str:
    if st.get("auth_expired"):
        return "refusé, à renouveler"
    if st.get("expires"):
        return st["expires"] + (" (estimée)" if st.get("expires_estimated") else "")
    return "inconnue" if "credential" in st else "—"


def _contract_label(contract: list | None) -> str:
    # Only a count: the contract itself is not secret but stays out of public logs.
    return f"oui ({len(contract)} période{'s' if len(contract) > 1 else ''})" if contract else "non"


def _call_lines() -> list[str]:
    """S-1.14: calls and time per source (counts only)."""
    out = []
    for name, calls, cap, seconds in METER.rows():
        limit = f"plafond {cap}" if cap is not None else "sans plafond"
        stop = " — plafond atteint, arrêt" if name in METER.capped else ""
        out.append(f"Appels API {name} : {calls} ({limit}, {seconds:.1f} s){stop}")
    return out


def _calls_table() -> list[str]:
    rows = METER.rows()
    if not rows:
        return []
    return [
        "",
        "### Appels API",
        "",
        "| Source | Appels | Plafond | Durée des appels |",
        "|---|---|---|---|",
        *(
            f"| {name} | {calls}{' ⛔' if name in METER.capped else ''} | {cap if cap is not None else '—'} "
            f"| {seconds:.1f} s |"
            for name, calls, cap, seconds in rows
        ),
    ]


def _format_lines(sources: dict[str, dict]) -> list[str]:
    """S-1.13: sources whose answer no longer has the expected shape (source and field only)."""
    changed = [
        f"- ⚠️ {name} : {v['format']}"
        for name, v in sorted(sources.items())
        if v.get("format") and v.get("error", "") > v.get("ok", "")
    ]
    if not changed:
        return []
    return ["", "### Format de réponse changé", "", *changed, "", "Voir docs/api-notes.md (schémas de référence)."]


def _failure_summary(err: Exception) -> None:
    """Fatal error: what is safe to say in the public job summary."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    if isinstance(err, SourceError | FormatError | CallCapReached):
        why = redact.safe_message(err)
    else:
        why = f"erreur {type(err).__name__} (détail dans le journal)"
    lines = ["## Collecte interrompue", "", f"- {why}", *_calls_table()]
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def _job_summary(store: Store, syncer: Syncer, changed: list[str], extra_rows: list[str] | None = None) -> None:
    """GitHub job summary: sources and counts only, never names or values (public log)."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    m = store.meta
    yes = lambda b: "✅" if b else "—"  # noqa: E731
    lines = [
        "## Collecte",
        "",
        "| Élément | État |",
        "|---|---|",
        f"| Méthode de mesure | `{' '.join(syncer.strategy or ('?', '?'))}` |",
        f"| Couverture | {m.get('first_day')} → {m.get('last_day')} |",
        f"| Pièces suivies | {len([r for r in m.get('rooms', []) if r.get('category') != 'ignore'])} |",
        f"| Météo | {m.get('weather_source') or '—'} |",
        f"| Station Netatmo (tous modules) | {yes(m.get('has_station'))} |",
        f"| Linky | {yes(m.get('has_linky'))} |",
        f"| Linky, courbe de charge 30 min | {yes(m.get('linky_curve_years'))} |",
        f"| Pièces au pas 30 min | {_room30_label(m.get('room30_history'))} |",
        f"| Prises Shelly | {yes(m.get('has_shelly'))} |",
        f"| Analyse IA | {yes(store.doc('insights').get('period'))} |",
        f"| Contrat partagé | {_contract_label(m.get('contract'))} |",
        *(extra_rows or []),
        f"| Fichiers chiffrés modifiés | {len(changed)} |",
        "",
        "| Source | Dernier succès | Dernier échec | Expiration du jeton |",
        "|---|---|---|---|",
        *(
            f"| {name} | {v.get('ok', '—')} | {v.get('error', '—') if v.get('error', '') > v.get('ok', '') else '—'} "
            f"| {_expiry_label(v)} |"
            for name, v in sorted(m.get("sources", {}).items())
        ),
    ]
    lines += _format_lines(m.get("sources", {}))
    lines += _calls_table()
    alerts = expiry_alerts(m.get("sources", {}), datetime.now(UTC).date())
    if alerts:
        lines += ["", "### À renouveler", "", *(f"- ⚠️ {a}" for a in alerts)]
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
