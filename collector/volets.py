"""Shutter positions read by the owner's NAS from the Wiser hub (issue #200), read only.

The NAS (scripts/nas/volets.sh) polls the local API of the hub every 10 minutes and keeps, per
day, a journal of the CHANGES (position 0-100 and movement of each shutter). Once a night it
encrypts the journal of the finished day with a PUBLIC key (CMS, AES-256 + RSA, certificate
scripts/nas/volets-certificat.pem or the one given with the private key) and starts the workflow
« Volets » with it as an input. The workflow (`python -m collector volets`):

1. decrypts it with the private key (secret VOLETS_PRIVATE_KEY, given to that step only);
2. validates it STRICTLY: a fixed grammar, bounded sizes, white-listed codes; one bad line and
   the whole journal is refused, nothing is written (the input is untrusted: anyone holding the
   public certificate can encrypt);
3. aggregates it per day and per shutter (closing and opening times, mean position, position at
   22 h, the start of the night compared by the « volets fermés » card), shutter ids replaced by
   stable keys "v0", "v1"… (salted hash of the hub id, like the station modules);
4. merges it into data/volets.enc.json, encrypted with DATA_PASSPHRASE like every document.

Public logs: the day and counts only, never a name, a position or an id.

volets.enc.json:
  {"v": 1,
   "shutters": {"v0": {"name": "Salon"}},           names as the hub gives them (encrypted)
   "days": {"YYYY-MM-DD": {
       "cov": [24 ints],      successful readings per local hour (6 = every 10 min)
       "ko": 3,               failed readings that day
       "err": ["hub_injoignable"],                     failure codes reported by the NAS
       "shutters": {"v0": {"open": "07:42",            first opening (from closed) before noon
                           "close": "18:05",           last closing (to closed) after noon
                           "close_src": "FromSchedule", origin of that closing, as the hub says
                           "mean": 54.2,               mean position over the readings, 0-100
                           "at22": 0,                  position at 22 h (null when unknown)
                           "moves": 4}},               changes of position that day
       "evening": [2, 3]}},   shutters closed at 22 h, shutters known at 22 h
   "received": "YYYY-MM-DD",  last day received
   "module_keys": {...}}      salted hashes of the hub ids (storage.KeyMap)

A day without readings around 22 h has no "evening": the app leaves it out of the comparison,
it never guesses it.
"""

from __future__ import annotations

import base64
import binascii
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .storage import KeyMap, Store
from .texte import nombre

DOC = "volets"
VERSION = 1
# Sizes (the NAS refuses to send more than 40 000 bytes of journal; base64 of CMS adds ≈ 40 %).
MAX_INPUT = 60_000
MAX_JOURNAL = 40_000
MAX_LINES = 5_000
MAX_SHUTTERS = 40
MAX_NAME = 60
# Readings per hour: 6 every 10 min. More is accepted (a manual `volets.sh releve`), bounded.
MAX_PER_HOUR = 60
MAX_FAILED = 2_000
MOVEMENTS = {"Stopped", "Opening", "Closing", "Other"}
# Failure codes of a reading (journal line E) and of a whole send (workflow input `erreur`).
READING_ERRORS = {"hub_injoignable", "secret_refuse", "http_erreur", "reponse_illisible", "aucun_volet"}
SEND_ERRORS = READING_ERRORS | {"aucun_releve", "journal_trop_gros", "certificat_absent", "chiffrement_impossible"}
ERROR_TEXT = {
    "hub_injoignable": "passerelle injoignable depuis le NAS",
    "secret_refuse": "secret de la passerelle refusé",
    "http_erreur": "réponse inattendue de la passerelle",
    "reponse_illisible": "réponse illisible de la passerelle",
    "aucun_volet": "aucun volet dans la réponse de la passerelle",
    "aucun_releve": "aucun relevé ce jour-là (tâche planifiée arrêtée ?)",
    "journal_trop_gros": "journal trop gros pour être envoyé",
    "certificat_absent": "certificat absent sur le NAS",
    "chiffrement_impossible": "chiffrement impossible sur le NAS (openssl)",
}
# Closed = 0 (fully down), as the hub and aioWiserHeatAPI (`is_closed`) define it; a shutter
# left at 10 % counts as not closed. The evening is read at 22 h, start of the night that the
# « volets fermés » card compares (web/src/shutters.ts, nightHours). Both are definitions, not
# measured thresholds: written here, in one place, and in docs/etudes/volets-wiser.md.
CLOSED = 0
EVENING_MINUTE = 22 * 60
NOON = 12 * 60

_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
_B64 = re.compile(r"[A-Za-z0-9+/]+={0,2}")
_ID = re.compile(r"[0-9]{1,6}")
_EPOCH = re.compile(r"[0-9]{9,11}")
_LIFT = re.compile(r"[0-9]{1,3}")
_SRC = re.compile(r"[A-Za-z]{1,24}")
_NAME = re.compile(r"[^\x00-\x1f\x7f;\\]{0,60}")  # MAX_NAME
_COUNTS = re.compile(r"[0-9]{1,3}(,[0-9]{1,3}){23}")


class VoletsError(ValueError):
    """A refused input. The message never carries a value of the input (public logs)."""


@dataclass
class Journal:
    day: str
    names: dict[str, str] = field(default_factory=dict)  # hub id -> name (last one given)
    events: list[tuple[int, str, int, str, str]] = field(default_factory=list)  # epoch, id, lift, move, src
    errors: list[str] = field(default_factory=list)
    cov: list[int] = field(default_factory=lambda: [0] * 24)
    failed: int = 0


# ------------------------------------------------------------------ decryption
def load_key(secret_pem: str, cert_path: Path | None = None):
    """Private key and certificate from the secret (PEM; the certificate may follow the key in
    it) or from the certificate published in the repository."""
    from cryptography import x509
    from cryptography.hazmat.primitives.serialization import load_pem_private_key

    data = secret_pem.replace("\\n", "\n").encode()
    try:
        key = load_pem_private_key(data, None)
    except (ValueError, TypeError) as exc:
        raise VoletsError("VOLETS_PRIVATE_KEY : clé privée PEM illisible (sans phrase de passe)") from exc
    certs = []
    if cert_path is not None and cert_path.is_file():
        certs = x509.load_pem_x509_certificates(cert_path.read_bytes())
    elif b"CERTIFICATE" in data:
        certs = x509.load_pem_x509_certificates(data[data.index(b"-----BEGIN CERTIFICATE") :])
    if not certs:
        raise VoletsError("certificat introuvable (ni dans le dépôt, ni dans VOLETS_PRIVATE_KEY)")
    if certs[0].public_key().public_numbers() != key.public_key().public_numbers():  # type: ignore[union-attr]
        raise VoletsError("la clé privée ne correspond pas au certificat publié")
    return key, certs[0]


def decrypt(b64: str, key, cert) -> str:
    """The journal text of a base64 CMS envelope, or VoletsError (sizes checked first)."""
    from cryptography.hazmat.primitives.serialization import pkcs7

    b64 = b64.strip()
    if not b64 or len(b64) > MAX_INPUT or not _B64.fullmatch(b64):
        raise VoletsError("journal reçu vide, trop long ou pas en base64")
    try:
        der = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise VoletsError("journal reçu : base64 invalide") from exc
    try:
        raw = pkcs7.pkcs7_decrypt_der(der, cert, key, [])
    except Exception as exc:  # malformed DER, wrong recipient, bad padding: one message for all
        raise VoletsError("déchiffrement impossible (mauvais certificat sur le NAS, ou envoi abîmé)") from exc
    if len(raw) > MAX_JOURNAL:
        raise VoletsError("journal déchiffré trop long")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise VoletsError("journal déchiffré : texte non UTF-8") from exc


# ------------------------------------------------------------------ validation
def parse(text: str, day: str, tz: str) -> Journal:
    """The journal of `day`, checked line by line; any line outside the grammar refuses it all."""
    if not _DAY.fullmatch(day):
        raise VoletsError("jour invalide")
    try:
        d0 = date.fromisoformat(day)
    except ValueError as exc:
        raise VoletsError("jour invalide") from exc
    zone = ZoneInfo(tz)
    # Readings belong to that local day; one hour of slack for a clock a little off.
    lo = int(datetime.combine(d0, datetime.min.time(), zone).timestamp()) - 3600
    hi = int(datetime.combine(d0 + timedelta(days=1), datetime.min.time(), zone).timestamp()) + 3600
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    if not lines or len(lines) > MAX_LINES:
        raise VoletsError("journal vide ou trop long")
    if lines[0] != f"J;{VERSION};{day}":
        raise VoletsError("ligne 1 : en-tête absent, d'une autre version ou d'un autre jour")
    j = Journal(day)
    seen_counts = False
    ids: set[str] = set()
    for n, line in enumerate(lines[1:], start=2):
        if seen_counts:
            raise VoletsError(f"ligne {n} : rien n'est attendu après le décompte des relevés")
        f = line.split(";")
        kind = f[0]
        if kind == "N" and len(f) == 3 and _ID.fullmatch(f[1]) and _NAME.fullmatch(f[2]):
            ids.add(f[1])
            j.names[f[1]] = f[2].strip()
        elif kind == "S" and len(f) == 6 and _EPOCH.fullmatch(f[1]) and _ID.fullmatch(f[2]) and _LIFT.fullmatch(f[3]):
            t, lift = int(f[1]), int(f[3])
            if not (lo <= t < hi and lift <= 100 and f[4] in MOVEMENTS and _SRC.fullmatch(f[5])):
                raise VoletsError(f"ligne {n} : relevé hors du jour ou valeur hors liste")
            ids.add(f[2])
            j.events.append((t, f[2], lift, f[4], f[5]))
        elif kind == "E" and len(f) == 3 and _EPOCH.fullmatch(f[1]) and f[2] in READING_ERRORS:
            if not lo <= int(f[1]) < hi:
                raise VoletsError(f"ligne {n} : erreur datée hors du jour")
            j.errors.append(f[2])
        elif kind == "C" and len(f) == 4 and f[1] == day and _COUNTS.fullmatch(f[2]) and f[3].isdigit():
            j.cov = [int(x) for x in f[2].split(",")]
            j.failed = int(f[3])
            if max(j.cov) > MAX_PER_HOUR or j.failed > MAX_FAILED:
                raise VoletsError(f"ligne {n} : décompte des relevés hors bornes")
            seen_counts = True
        else:
            raise VoletsError(f"ligne {n} : forme inconnue")
        if len(ids) > MAX_SHUTTERS:
            raise VoletsError(f"ligne {n} : plus de {MAX_SHUTTERS} volets")
    if not seen_counts:
        raise VoletsError("décompte des relevés absent (journal tronqué ?)")
    j.events.sort(key=lambda e: e[0])
    return j


# ------------------------------------------------------------------ aggregation
def _hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def aggregate(j: Journal, tz: str) -> dict:
    """{hub id: daily figures} and the evening counts, from the changes of one day."""
    zone = ZoneInfo(tz)
    midnight = datetime.combine(date.fromisoformat(j.day), datetime.min.time(), zone)
    covered = [h for h in range(24) if j.cov[h] > 0]
    # The day is observed up to the end of the last hour with a successful reading.
    end = (covered[-1] + 1) * 60 if covered else 0
    evening_known = j.cov[21] > 0 and j.cov[22] > 0
    per: dict[str, list[tuple[int, int, str]]] = {}
    for t, sid, lift, _move, src in j.events:
        minute = max(0, min(24 * 60 - 1, int((t - midnight.timestamp()) // 60)))
        per.setdefault(sid, []).append((minute, lift, src))
    out: dict[str, dict] = {}
    closed = known = 0
    for sid, evs in per.items():
        rec: dict = {"moves": sum(1 for a, b in zip(evs, evs[1:], strict=False) if a[1] != b[1])}
        # time-weighted mean from the first reading to the end of the observed day
        stop = max(end, evs[-1][0] + 1)
        ends = [e[0] for e in evs[1:]] + [stop]
        total = sum(lift * (max(nxt, m) - m) for (m, lift, _), nxt in zip(evs, ends, strict=True))
        span = stop - evs[0][0]
        rec["mean"] = round(total / span, 1) if span > 0 else float(evs[-1][1])
        for (_m0, l0, _), (m1, l1, src) in zip(evs, evs[1:], strict=False):
            if l0 > CLOSED and l1 == CLOSED and m1 >= NOON:
                rec["close"], rec["close_src"] = _hhmm(m1), src
            if l0 == CLOSED and l1 > CLOSED and m1 < NOON and "open" not in rec:
                rec["open"] = _hhmm(m1)
        at22 = None
        if evening_known:
            before = [lift for m, lift, _ in evs if m <= EVENING_MINUTE]
            at22 = before[-1] if before else None
        rec["at22"] = at22
        if at22 is not None:
            known += 1
            closed += at22 == CLOSED
        out[sid] = rec
    return {"shutters": out, "evening": [closed, known] if known else None}


# ------------------------------------------------------------------ storage
def merge(store: Store, j: Journal | None, day: str, error: str | None, tz: str) -> dict:
    """Write one day (a journal, or a failure code alone) into volets.enc.json. A failure code
    never erases a day already received with its readings."""
    doc = store.doc(DOC)
    doc["v"] = VERSION
    keys = KeyMap(store, DOC, "v")
    days = doc.setdefault("days", {})
    if j is None:
        rec = days.setdefault(day, {})
        if error and error not in rec.setdefault("err", []):
            rec["err"].append(error)
    else:
        agg = aggregate(j, tz)
        rec = {"cov": j.cov, "ko": j.failed}
        if j.errors:
            rec["err"] = sorted(set(j.errors))
        rec["shutters"] = {keys.key(sid): v for sid, v in agg["shutters"].items()}
        if agg["evening"]:
            rec["evening"] = agg["evening"]
        days[day] = rec
        names = doc.setdefault("shutters", {})
        for sid, name in j.names.items():
            names.setdefault(keys.key(sid), {})["name"] = name
        doc["received"] = max(doc.get("received", ""), day)
    keys.save()
    store.replace(DOC, dict(doc))
    store.flush(DOC)
    return rec


def receive(
    store: Store, day: str, journal_b64: str, error: str, secret_pem: str, cert_path: Path | None, tz: str
) -> tuple[str, dict]:
    """Validate and merge what the NAS sent. Returns (summary for the public log, day record).
    Raises VoletsError when the input is refused (nothing written)."""
    if not _DAY.fullmatch(day or ""):
        raise VoletsError("jour invalide")
    error = (error or "").strip()
    if error:
        if error not in SEND_ERRORS:
            raise VoletsError("code d'erreur inconnu")
        if journal_b64.strip():
            raise VoletsError("un journal et une erreur à la fois")
        rec = merge(store, None, day, error, tz)
        return f"le NAS signale pour le {day} : {ERROR_TEXT[error]}", rec
    key, cert = load_key(secret_pem, cert_path)
    j = parse(decrypt(journal_b64, key, cert), day, tz)
    rec = merge(store, j, day, None, tz)
    hours = sum(1 for c in j.cov if c)
    summary = f"relevé du {day} enregistré : {hours}/24 heures relevées"
    if j.errors:
        summary += f", {nombre(len(set(j.errors)), "type d'échec signalé", "types d'échec signalés")}"
    return summary, rec
