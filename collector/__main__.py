"""Command line: python -m collector <command>.

discover    Connexion + inventaire de la maison (pièces, modules, catégories)
sync        Récupère les derniers jours (ou tout l'historique au premier lancement)
backfill    Force la récupération de tout l'historique disponible
verify      Déchiffre les données locales et affiche un résumé
export-csv  Exporte les données déchiffrées en CSV
demo        Génère des données de démonstration chiffrées (phrase « demo »)
restore-backup FICHIER  Restaure dans data/ une sauvegarde chiffrée téléchargée depuis l'appli
import-ha FICHIER  Verse un export Home Assistant (statistiques) dans l'archive chiffrée
snapshot    Relevé horaire de l'état des pièces, chiffré dans un dossier (workflow « Relevé horaire »)
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import os
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from .api import IntuisClient
from .budget import METER, CallCapReached, caps_from_env
from .cold import cold_alerts, cold_config, write_cold_file
from .config import Settings
from .schema import FormatError
from .storage import Store
from .sync import Syncer


def _client(s: Settings) -> IntuisClient:
    s.require("username", "password", "client_id", "client_secret")
    return IntuisClient(s)


def cmd_discover(s: Settings, args: argparse.Namespace) -> None:
    syncer = Syncer(_client(s), store=None, overrides=s.room_categories)  # type: ignore[arg-type]
    raw = syncer.client.homesdata()
    if args.save_raw:
        Path(args.save_raw).write_text(json.dumps(raw, indent=2, ensure_ascii=False))
        print(f"Réponse brute enregistrée dans {args.save_raw} (contient des identifiants : ne pas commiter)")
    home = syncer.home()
    print(f"Maison : {home.name}  (fuseau {home.timezone}, passerelle {'trouvée' if home.bridge_id else 'ABSENTE'})")
    for r in home.rooms:
        print(f"  - {r.name:<28} id={r.id:<14} modules={','.join(r.module_types) or '-':<12} → {r.category}")
    print("\nSi une pièce est mal classée, définir INTUIS_ROOM_CATEGORIES, ex. :")
    print('  INTUIS_ROOM_CATEGORIES={"<id>": "water_heater"}   (valeurs : heating, water_heater, ignore)')


def cmd_diagnose(s: Settings, args: argparse.Namespace) -> None:
    from .diagnose import history, history_deep, probe_history, run

    client = _client(s)
    if args.probe_history:
        probe_history(client)
    elif args.history:
        history(client)
        history_deep(client)
    else:
        run(client, status_only=args.status)


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "oui", "yes")


def cmd_snapshot(s: Settings, args: argparse.Namespace) -> None:
    """S-13.2: one homestatus request, encrypted into --out. Never writes to data/."""
    from .roomstate import take

    s.require("passphrase")
    store = Store(s.data_dir, s.passphrase)
    # Token + homestatus (+ homesdata before the first collection, + one retry): 4 at most.
    raw = os.environ.get("MAX_CALLS_INTUIS_HOURLY", "").strip()
    METER.reset({"intuis": int(raw) if raw.isdigit() else 4})
    take(_client(s), store, Path(args.out), presence=_flag("ROOM_STATE_PRESENCE"))
    print(f"Relevé chiffré enregistré ({METER.calls.get('intuis', 0)} appels Intuis)")


def _room_states(s: Settings, store: Store, syncer: Syncer, sources: Sources) -> list[str]:
    """S-13.2: hourly snapshots downloaded by the workflow -> daily hours per room. Never fatal.
    Returns rows for the job summary (counts only)."""
    folder = os.environ.get("ROOM_STATE_DIR", "").strip()
    if not folder or syncer.last_home is None:
        return []
    from .roomstate import coverage, merge_snapshots, module_rooms, read_snapshots

    home = syncer.last_home
    try:
        snaps, bad = read_snapshots(Path(folder), s.passphrase) if Path(folder).is_dir() else ([], 0)
        stats = merge_snapshots(
            store,
            snaps,
            home.timezone,
            module_rooms(syncer.last_homesdata, home.water_heaters),
            presence=_flag("ROOM_STATE_PRESENCE"),
        )
    except Exception as err:  # never lose the night's energy data because of this optional step
        sources.failed("releve-horaire", f"agrégation impossible ({type(err).__name__})")
        _warn(f"Relevé horaire non agrégé : {type(err).__name__}")
        return []
    if stats["calls"]:
        METER.calls["intuis-horaire"] = stats["calls"]
    got, expected = coverage(store, datetime.now(ZoneInfo(home.timezone)).date().isoformat())
    note = f"{got} relevés sur {expected} heures (7 derniers jours)"
    if snaps or got:
        sources.ok("releve-horaire", note)
    else:
        sources.failed("releve-horaire", "aucun relevé horaire reçu (workflow « Relevé horaire » actif ?)")
    print(
        f"Relevé horaire : {stats['snapshots']} relevés lus, {stats['added']} ajoutés, "
        f"{stats['duplicates']} déjà comptés, {stats['pending']} du jour en cours, {bad} illisibles ; {note}"
    )
    return [f"| Relevé horaire des pièces | {note} |"]


def _warn(msg: str) -> None:
    # "::warning::" shows up as an annotation on the GitHub Actions run.
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
        self.failed(name, str(err), auth=getattr(err, "auth", False), err=err)

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


# S-12.1: contract shared between devices, from the repository variable CONTRACT_JSON.
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
    """CONTRACT_JSON if valid; the previous contract if invalid; None when the variable is unset."""
    raw = os.environ.get("CONTRACT_JSON", "").strip()
    if not raw:
        return None
    try:
        return parse_contract(raw)
    except ContractError as err:
        _warn(f"Variable CONTRACT_JSON ignorée ({err}) : le contrat partagé précédent est conservé")
        return previous


def write_renew_file(alerts: list[str]) -> None:
    """S-1.12: credentials to renew, one per line, for the workflow's alert issue (never a value)."""
    path = os.environ.get("RENEW_FILE")
    if path:
        Path(path).write_text("".join(f"- {a}\n" for a in alerts), encoding="utf-8")


def _weather(s: Settings, store: Store, home, sources: Sources) -> str | None:
    """Outdoor temperatures: the Netatmo station if configured, else Open-Meteo. Never fatal."""
    first = store.first_day()
    if not first:
        return None
    if s.netatmo_client_id and s.netatmo_refresh_token:
        from .station import Station, StationError

        sources.credential("netatmo", s.netatmo_refresh_token)
        try:
            Station(store, s.netatmo_client_id, s.netatmo_client_secret, s.netatmo_refresh_token).collect(
                home.timezone, first
            )
            sources.ok("netatmo")
            return "netatmo"
        except (StationError, httpx.HTTPError, FormatError, CallCapReached) as err:
            sources.error("netatmo", err)
            _warn(f"{err} — repli sur Open-Meteo")
    if home.latitude is None or home.longitude is None:
        _warn("Coordonnées de la maison inconnues : pas de météo")
        return None
    from .weather import open_meteo

    try:
        open_meteo(store, home.latitude, home.longitude, home.timezone, first)
        sources.ok("open-meteo")
        return store.doc("weather").get("source")
    except (httpx.HTTPError, FormatError, CallCapReached) as err:
        sources.error("open-meteo", err)
        _warn(f"Météo Open-Meteo indisponible : {err}")
        return store.meta.get("weather_source")


def _linky(s: Settings, store: Store, tz: str, sources: Sources) -> None:
    """Daily totals then the 30-min load curve (S-1.11). Never fatal."""
    from .enedis import LinkyError, collect, collect_curve, token_dates

    first = store.first_day() or ""
    sources.credential("linky", s.enedis_token)
    try:
        collect(store, s.enedis_token, s.enedis_prm, first, tz)
        sources.ok("linky")
    except (LinkyError, httpx.HTTPError, FormatError, CallCapReached) as err:
        sources.error("linky", err)
        _warn(str(err))
    issued, expires = token_dates(s.enedis_token)
    sources.expiry("linky", expires, issued, LINKY_CONSENT_DAYS)
    if sources.state["linky"].get("auth_expired") or "linky" in METER.capped:
        return  # same token (or no call left): the curve would fail too
    try:
        n = collect_curve(store, s.enedis_token, s.enedis_prm, first, tz)
        has_curve = any(store.doc(f"{y}.linky30").get("curve") for y in store.linky_curve_years())
        note = (
            None
            if n or has_curve
            else ("aucune mesure : activez la collecte de la courbe de charge dans votre espace Enedis")
        )
        sources.ok("linky-30min", note)
    except (LinkyError, httpx.HTTPError, FormatError, CallCapReached) as err:
        # Usually no consent for the load curve: the daily totals are unaffected.
        sources.failed("linky-30min", str(err), err=err)
        _warn(f"{err} — la consommation quotidienne Linky n'est pas affectée")


def _shelly(s: Settings, store: Store, tz: str, sources: Sources) -> None:
    """S-1.17: one counter reading per Shelly plug. Never fatal."""
    from .shelly import ShellyError, collect, note

    sources.credential("shelly", s.shelly_auth_key)
    try:
        sources.ok("shelly", note(collect(store, s.shelly_auth_key, s.shelly_server, tz)))
    except (ShellyError, FormatError, CallCapReached) as err:
        sources.error("shelly", err)
        _warn(str(err))


def cmd_sync(s: Settings, args: argparse.Namespace, backfill: bool = False) -> None:
    s.require("passphrase")
    store = Store(s.data_dir, s.passphrase)
    syncer = Syncer(_client(s), store, s.room_categories)
    sources = Sources(store.meta.get("sources"))
    # S-1.14: a backfill stopped by the call cap goes on at the next collection.
    backfill = backfill or bool(store.meta.get("backfill_pending"))
    first_run = backfill or store.last_day() is None
    METER.reset(caps_from_env(backfill=first_run))
    pending = False
    try:
        syncer.run(days=args.days, backfill=backfill, save=False)
        sources.ok("intuis")
    except CallCapReached as err:
        if syncer.last_home is None:
            _failure_summary(err)
            raise
        # Clean stop: keep what was fetched, resume tomorrow.
        sources.error("intuis", err)
        _warn(str(err))
        pending = first_run
    except Exception as err:
        sources.failed("intuis", str(err), err=err)
        _failure_summary(err)
        raise
    home = syncer.last_home
    source = _weather(s, store, home, sources)
    extra = {"weather_source": source} if source else {}
    if s.enedis_token and s.enedis_prm and store.first_day():
        _linky(s, store, home.timezone, sources)
    if s.shelly_auth_key and s.shelly_server:
        _shelly(s, store, home.timezone, sources)
    rs_rows = _room_states(s, store, syncer, sources)
    if store.doc("roomstate").get("rooms"):
        extra["has_roomstate"] = True
    if store.doc("linky").get("daily"):
        extra["has_linky"] = True
    if store.doc("shelly").get("daily"):
        extra["has_shelly"] = True
    if store.doc("ha").get("daily"):
        extra["has_ha"] = True
    if store.doc("station").get("daily"):
        extra["has_station"] = True
    if os.environ.get("ANTHROPIC_API_KEY"):
        from .insights import generate

        try:
            generate(store)
            sources.ok("ia")
        except Exception as err:  # never lose a night of data because of the optional AI step
            sources.failed("ia", str(err))
            _warn(f"Analyse IA non rédigée : {err}")
    extra["sources"] = sources.state
    if pending:
        extra["backfill_pending"] = True
    contract = shared_contract(store.meta.get("contract"))
    if contract:
        extra["contract"] = contract
    alerts = sources.alerts()
    for alert in alerts:
        _warn(alert)
    write_renew_file(alerts)
    # S-12.5: prolonged cold in the rooms chosen (repository variable), pseudonyms only.
    cold = cold_config(_warn)
    if cold:
        extra["cold_alert"] = cold
    cold_lines, cold_counts = cold_alerts(store, cold)
    write_cold_file(cold_lines)
    changed = syncer.save(home, extra)
    print("Fichiers modifiés : " + (", ".join(changed) if changed else "aucun"))
    print(f"Couverture : {store.first_day()} → {store.last_day()}")
    for line in _call_lines():
        print(line)
    print(_cold_label(cold, cold_counts))
    _job_summary(store, syncer, changed, rs_rows)


def _cold_label(cfg: dict | None, counts: dict[str, int]) -> str:
    # Counts only: neither the rooms, nor the threshold, nor a temperature (public log).
    if not cfg:
        return "Alerte froid : désactivée"
    return (
        f"Alerte froid : {counts['suivies']} pièce(s) suivie(s), {counts['froides']} sous le seuil, "
        f"{counts['sans_mesure']} sans mesure récente"
    )


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
    if isinstance(err, FormatError | CallCapReached):
        why = str(err)
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


# Meta keys that a command other than sync keeps as they are.
KEPT_META = ("weather_source", "sources", "contract", "cold_alert", "backfill_pending")


def cmd_insights(s: Settings, args: argparse.Namespace) -> None:
    from .insights import generate

    s.require("passphrase")
    store = Store(s.data_dir, s.passphrase)
    if generate(store, force=args.force):
        store.save(
            store.meta.get("home", {}),
            store.meta.get("rooms", []),
            {k: v for k, v in store.meta.items() if k.startswith("has_") or k in KEPT_META},
        )
        print(store.doc("insights")["markdown"])


def cmd_import_ha(s: Settings, args: argparse.Namespace) -> None:
    """S-1.18: Home Assistant export → daily aggregates in data/ha.enc.json (counts printed only)."""
    from .homeassistant import ImportFormatError, import_file

    s.require("passphrase")
    store = Store(s.data_dir, s.passphrase)
    if not store.meta:
        raise SystemExit("Aucune donnée dans data/ : lancez d'abord une collecte.")
    tz = store.meta.get("home", {}).get("timezone") or "Europe/Paris"
    try:
        counts = import_file(store, Path(args.file), tz)
    except (ImportFormatError, UnicodeDecodeError, OSError) as err:
        why = str(err) if isinstance(err, ImportFormatError) else type(err).__name__
        raise SystemExit(f"Import refusé : {why}") from None
    print(f"{counts['sensors']} capteurs, {counts['days']} jours agrégés, {counts['skipped']} sans jour complet.")
    if args.dry_run or not counts["sensors"]:
        print("Rien n'est écrit.")
        return
    sources = Sources(store.meta.get("sources"))
    sources.ok("home-assistant", f"import manuel : {counts['sensors']} capteurs")
    keep = {k: v for k, v in store.meta.items() if k.startswith("has_") or k in KEPT_META}
    changed = store.save(
        store.meta.get("home", {}), store.meta.get("rooms", []), {**keep, "has_ha": True, "sources": sources.state}
    )
    print("Fichiers modifiés : " + (", ".join(changed) if changed else "aucun"))
    print("Contrôle puis commit de data/ (fichiers chiffrés uniquement).")


def cmd_rekey(s: Settings, args: argparse.Namespace) -> None:
    from .rekey import rekey, strength_bits, verdict

    s.require("passphrase")
    new = os.environ.get("NEW_DATA_PASSPHRASE", "")
    if not new:
        raise SystemExit("Variable manquante : NEW_DATA_PASSPHRASE")
    bits = strength_bits(new)
    print(f"Robustesse estimée de la nouvelle phrase : {bits:.0f} bits — {verdict(bits)}")
    if bits < 50 and not args.force:
        raise SystemExit("Phrase trop faible : choisissez-en une plus longue (ou --force).")
    files = rekey(s.data_dir, s.passphrase, new)
    print(f"{len(files)} fichiers rechiffrés. Mettez maintenant la nouvelle phrase dans le secret DATA_PASSPHRASE.")


def cmd_strength(s: Settings, args: argparse.Namespace) -> None:
    from .rekey import strength_bits, verdict

    s.require("passphrase")
    bits = strength_bits(s.passphrase)
    print(f"Robustesse estimée : {bits:.0f} bits — {verdict(bits)}")


def cmd_verify(s: Settings, args: argparse.Namespace) -> None:
    s.require("passphrase")
    store = Store(s.data_dir, s.passphrase)
    rooms = {r["id"]: r for r in store.meta.get("rooms", [])}
    print(f"Maison : {store.meta.get('home', {}).get('name')}  — mise à jour {store.meta.get('updated')}")
    for y in store.years():
        per_cat: dict[str, float] = {}
        for rid, days in store.year(y).items():
            cat = rooms.get(rid, {}).get("category", "?")
            per_cat[cat] = per_cat.get(cat, 0) + sum(days.values())
        print(f"  {y} : " + ", ".join(f"{c} {v / 1000:.0f} kWh" for c, v in sorted(per_cat.items())))


def cmd_export(s: Settings, args: argparse.Namespace) -> None:
    s.require("passphrase")
    store = Store(s.data_dir, s.passphrase)
    rooms = {r["id"]: r for r in store.meta.get("rooms", [])}
    rows = [["date", "piece", "categorie", "kwh"]]
    for y in store.years():
        for rid, days in sorted(store.year(y).items()):
            room = rooms.get(rid, {"name": rid, "category": "?"})
            for day, wh in sorted(days.items()):
                rows.append([day, room["name"], room["category"], f"{wh / 1000:.3f}".replace(".", ",")])
    if args.output == "-":
        csv.writer(sys.stdout, delimiter=";").writerows(rows)
    else:
        with open(args.output, "w", newline="", encoding="utf-8") as fh:
            csv.writer(fh, delimiter=";").writerows(rows)


def cmd_restore_backup(s: Settings, args: argparse.Namespace) -> None:
    from .backup import BackupError, read_bundle, restore

    s.require("passphrase")
    try:
        created = read_bundle(Path(args.file)).get("created", "?")
        names = restore(Path(args.file), s.data_dir, s.passphrase, dry_run=args.dry_run)
    except BackupError as err:
        raise SystemExit(f"Restauration refusée : {err}") from err
    verb = "seraient écrits" if args.dry_run else "écrits"
    print(f"Sauvegarde du {created} : {len(names)} fichiers vérifiés avec DATA_PASSPHRASE, {verb} dans {s.data_dir}/")
    for name in names:
        print(f"  {name}")
    if not args.dry_run:
        print("Contrôle : python -m collector verify (mêmes totaux que dans l'appli).")


def cmd_demo(s: Settings, args: argparse.Namespace) -> None:
    from .demo import generate

    out = Path(args.output)
    for f in out.glob("*.json"):
        f.unlink()
    print("Fichiers : " + ", ".join(generate(out, args.passphrase)))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(
        prog="collector", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("discover")
    d.add_argument("--save-raw", metavar="FICHIER")
    dg = sub.add_parser("diagnose", help="diagnostic anonyme (sans noms ni valeurs)")
    dg.add_argument("--history", action="store_true", help="profondeur d'historique par échelle")
    dg.add_argument("--status", action="store_true", help="seulement les noms des champs de homestatus")
    dg.add_argument(
        "--probe-history", action="store_true", help="types de mesure candidats pour l'historique des fenêtres (S-13.1)"
    )
    sn = sub.add_parser("snapshot", help="relevé horaire chiffré de l'état des pièces (S-13.2)")
    sn.add_argument("--out", required=True, metavar="DOSSIER")
    for name in ("sync", "backfill"):
        sp = sub.add_parser(name)
        sp.add_argument("--days", type=int, default=35, help="jours re-téléchargés à chaque sync (défaut 35)")
    sub.add_parser("verify")
    rk = sub.add_parser("rekey", help="changer la phrase de passe (NEW_DATA_PASSPHRASE)")
    rk.add_argument("--force", action="store_true")
    sub.add_parser("strength", help="robustesse estimée de DATA_PASSPHRASE")
    ins = sub.add_parser("insights", help="analyse du mois rédigée par Claude (ANTHROPIC_API_KEY)")
    ins.add_argument("--force", action="store_true")
    e = sub.add_parser("export-csv")
    e.add_argument("-o", "--output", default="-")
    rb = sub.add_parser("restore-backup", help="restaurer une sauvegarde chiffrée téléchargée depuis l'appli")
    rb.add_argument("file", metavar="FICHIER")
    rb.add_argument("--dry-run", action="store_true", help="vérifier sans rien écrire")
    ih = sub.add_parser("import-ha", help="verser un export Home Assistant dans l'archive chiffrée")
    ih.add_argument("file", metavar="FICHIER")
    ih.add_argument("--dry-run", action="store_true", help="vérifier sans rien écrire")
    dm = sub.add_parser("demo")
    dm.add_argument("-o", "--output", default="web/public/demo")
    dm.add_argument("--passphrase", default="demo")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s %(message)s")
    # httpx logs each request URL at INFO: query strings (Shelly key, Linky PRM) stay out of public logs.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    s = Settings.from_env()
    {
        "discover": cmd_discover,
        "diagnose": cmd_diagnose,
        "sync": cmd_sync,
        "backfill": lambda s, a: cmd_sync(s, a, backfill=True),
        "verify": cmd_verify,
        "rekey": cmd_rekey,
        "strength": cmd_strength,
        "insights": cmd_insights,
        "export-csv": cmd_export,
        "demo": cmd_demo,
        "restore-backup": cmd_restore_backup,
        "import-ha": cmd_import_ha,
        "snapshot": cmd_snapshot,
    }[args.cmd](s, args)


if __name__ == "__main__":
    main()
