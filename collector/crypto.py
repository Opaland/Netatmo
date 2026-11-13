"""AES-256-GCM encryption with a key derived by PBKDF2-SHA256 or, since #139, Argon2id.

The envelope is deliberately simple so the PWA can decrypt it with WebCrypto:
{"v": 1, "kdf": "PBKDF2-SHA256", "iter": N, "salt": b64, "iv": b64, "ct": b64}
{"v": 1, "kdf": "Argon2id", "m": KiB, "t": passes, "p": 1, "salt": b64, "iv": b64, "ct": b64}
`ct` includes the 16-byte GCM tag at the end (WebCrypto's layout). `v` is the layout of the
envelope (AES-GCM, no associated data); `kdf` says how the key is derived, and only the fields of
that derivation follow it.

keyinfo.json (public): {"salt": b64, "iter": N} for PBKDF2 (version 1, no "v"), and
{"v": 2, "kdf": "Argon2id", "salt": b64, "m": KiB, "t": passes, "p": 1} for Argon2id.
A data folder only changes derivation through `rekey` (collector/rekey.py), never by itself.

#138: the plaintext is padded with ASCII spaces up to a size step (`padded_length`) before
encryption, so the published size of a file follows a coarse ladder instead of the household's
activity. JSON parsers ignore trailing whitespace (Python `json.loads`, the browser's
`JSON.parse`): padded and unpadded files read the same, in both directions, without a format change.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# #139: what is written and the bounds accepted on read live in collector/kdf.json, read here and
# checked against web/src/crypto.ts by web/src/crypto.test.ts: one rule on both sides (AGENTS.md §5).
# S-1.16 #271: an envelope read from outside (an artifact) must not choose its own cost: too low
# is a downgrade, too high blocks the collection (or freezes the phone).
#
# Argon2id (RFC 9106), one lane so that every implementation gives the same key (argon2-cffi
# here, hash-wasm in the app). 64 MiB and 2 passes: measured in Chromium with hash-wasm on the main
# thread, CPU throttled x6 (a modest phone), about 1 s; 3 passes took 1.5 to 1.8 s, too close to
# the 2 s aimed at (PR of #139). These are also libsodium's "interactive" limits, above OWASP's
# minimum (19 MiB, 2 passes).
_KDF = json.loads((Path(__file__).with_name("kdf.json")).read_text(encoding="utf-8"))
VERSION = 1
KDF = "PBKDF2-SHA256"
ITERATIONS: int = _KDF["pbkdf2"]["iter"]
MIN_ITERATIONS: int = _KDF["pbkdf2"]["min_iter"]
MAX_ITERATIONS: int = _KDF["pbkdf2"]["max_iter"]
ARGON2 = "Argon2id"
ARGON2_MEMORY_KIB: int = _KDF["argon2id"]["m"]
ARGON2_TIME: int = _KDF["argon2id"]["t"]
ARGON2_LANES: int = _KDF["argon2id"]["p"]
ARGON2_MIN_MEMORY_KIB: int = _KDF["argon2id"]["min_m"]
ARGON2_MAX_MEMORY_KIB: int = _KDF["argon2id"]["max_m"]
ARGON2_MIN_TIME: int = _KDF["argon2id"]["min_t"]
ARGON2_MAX_TIME: int = _KDF["argon2id"]["max_t"]


# #138: padding steps. A presentation threshold (it changes the size published, never what is
# computed), chosen by judgement:
# - below 32 KiB, steps of 4 KiB (the issue's example): the small documents (meta, devices,
#   insights, room30 progress) all show 4, 8 or 12 KiB whatever was collected;
# - above, steps of one eighth of the largest power of two below the size (32-64 KiB: 4 KiB,
#   128-256 KiB: 16 KiB, 1-2 MiB: 128 KiB): the overhead stays under 12.5 %, and a year document
#   that grows by a few hundred bytes to a few KiB a day changes step about once a month.
# Discarded: a single power-of-two ladder (up to 100 % more in every committed blob, the repository
# grows twice as fast) and a fixed 4 KiB step everywhere (on a 1 MiB file, a step crossed every
# day or two follows the activity again).
PAD_MIN = 4096
PAD_FINE_BELOW = 32 * 1024


def padded_length(n: int) -> int:
    """Smallest size step >= n (bytes of plaintext)."""
    if n <= PAD_MIN:
        return PAD_MIN
    step = PAD_MIN if n < PAD_FINE_BELOW else (1 << (n.bit_length() - 1)) // 8
    return -(-n // step) * step


def pad(plaintext: bytes) -> bytes:
    """Plaintext followed by spaces up to its step (JSON ignores trailing whitespace)."""
    return plaintext + b" " * (padded_length(len(plaintext)) - len(plaintext))


class DecryptError(ValueError):
    pass


@dataclass(frozen=True)
class Kdf:
    """How a key is derived from the passphrase and the salt (hashable: derive_key is cached)."""

    name: str = KDF
    iter: int = ITERATIONS  # PBKDF2
    m: int = 0  # Argon2id: memory (KiB), passes, lanes
    t: int = 0
    p: int = 0

    @staticmethod
    def pbkdf2(iterations: int = ITERATIONS) -> Kdf:
        return Kdf(KDF, iterations)

    @staticmethod
    def argon2id(m: int = ARGON2_MEMORY_KIB, t: int = ARGON2_TIME, p: int = ARGON2_LANES) -> Kdf:
        return Kdf(ARGON2, 0, m, t, p)

    def fields(self) -> dict:
        """The fields that describe this derivation in an envelope (and in keyinfo.json)."""
        if self.name == ARGON2:
            return {"kdf": ARGON2, "m": self.m, "t": self.t, "p": self.p}
        return {"kdf": KDF, "iter": self.iter}

    @staticmethod
    def parse(doc: object) -> Kdf:
        """The derivation announced by an envelope or a keyinfo.json, checked before any use."""
        if not isinstance(doc, dict):
            raise DecryptError("Format de fichier chiffré inconnu (version ou dérivation)")
        name = doc.get("kdf", KDF)
        if name == KDF:
            return Kdf.pbkdf2(_int_in(doc.get("iter"), MIN_ITERATIONS, MAX_ITERATIONS, "Nombre d'itérations PBKDF2"))
        if name == ARGON2:
            m = _int_in(doc.get("m"), ARGON2_MIN_MEMORY_KIB, ARGON2_MAX_MEMORY_KIB, "Mémoire Argon2id (Kio)")
            t = _int_in(doc.get("t"), ARGON2_MIN_TIME, ARGON2_MAX_TIME, "Nombre de passes Argon2id")
            return Kdf.argon2id(m, t, _int_in(doc.get("p"), ARGON2_LANES, ARGON2_LANES, "Parallélisme Argon2id"))
        raise DecryptError("Format de fichier chiffré inconnu (version ou dérivation)")


def _int_in(n: object, lo: int, hi: int, what: str) -> int:
    if isinstance(n, bool) or not isinstance(n, int) or not lo <= n <= hi:
        raise DecryptError(f"{what} hors de [{lo} ; {hi}]")
    return n


def as_kdf(kdf: Kdf | int) -> Kdf:
    """An int is a PBKDF2 iteration count (the callers written before #139)."""
    return kdf if isinstance(kdf, Kdf) else Kdf.pbkdf2(kdf)


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


@lru_cache(maxsize=8)
def derive_key(passphrase: str, salt: bytes, kdf: Kdf | int = ITERATIONS) -> bytes:
    kdf = as_kdf(kdf)
    if kdf.name == ARGON2:
        from argon2.low_level import Type, hash_secret_raw  # only when a folder uses Argon2id

        return hash_secret_raw(passphrase.encode("utf-8"), salt, kdf.t, kdf.m, kdf.p, 32, Type.ID)
    pbkdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=kdf.iter)
    return pbkdf.derive(passphrase.encode("utf-8"))


def encrypt_json(obj: object, passphrase: str, salt: bytes, kdf: Kdf | int = ITERATIONS) -> dict:
    kdf = as_kdf(kdf)
    key = derive_key(passphrase, salt, kdf)
    iv = os.urandom(12)
    plaintext = pad(json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, plaintext, None)
    return {"v": VERSION, **kdf.fields(), "salt": _b64(salt), "iv": _b64(iv), "ct": _b64(ct)}


def envelope_kdf(envelope: object) -> Kdf:
    """The derivation of an envelope, checked before any derivation."""
    # Same checks as the PWA (web/src/crypto.ts checkEnvelope): an unknown format is refused
    # instead of being misread.
    if not isinstance(envelope, dict) or envelope.get("v") != VERSION or envelope.get("kdf") not in (KDF, ARGON2):
        raise DecryptError("Format de fichier chiffré inconnu (version ou dérivation)")
    return Kdf.parse(envelope)


def decrypt_json(envelope: dict, passphrase: str) -> object:
    return json.loads(decrypt_bytes(envelope, passphrase))


def decrypt_bytes(envelope: dict, passphrase: str) -> bytes:
    """The plaintext of an envelope (the data audit, #532, parses it itself to see duplicate keys)."""
    kdf = envelope_kdf(envelope)
    try:
        salt = base64.b64decode(envelope["salt"])
    except (KeyError, TypeError, ValueError) as exc:
        raise DecryptError("Enveloppe chiffrée illisible") from exc
    key = derive_key(passphrase, salt, kdf)
    try:
        pt = AESGCM(key).decrypt(base64.b64decode(envelope["iv"]), base64.b64decode(envelope["ct"]), None)
    except Exception as exc:  # cryptography raises InvalidTag
        raise DecryptError("Phrase de passe incorrecte ou fichier corrompu") from exc
    return pt


# ----------------------------------------------------------------- keyinfo.json
KEYINFO_V2 = 2


def keyinfo_doc(salt: bytes, kdf: Kdf | int) -> dict:
    """keyinfo.json: version 1 (no "v") for PBKDF2, as before #139; version 2 for Argon2id."""
    kdf = as_kdf(kdf)
    if kdf.name == ARGON2:
        return {"v": KEYINFO_V2, **kdf.fields(), "salt": _b64(salt)}
    return {"salt": _b64(salt), "iter": kdf.iter}


def parse_keyinfo(info: object) -> tuple[bytes, Kdf]:
    """Salt and derivation of a keyinfo.json (a file or a backup's copy), checked."""
    if not isinstance(info, dict) or "salt" not in info:
        raise DecryptError("keyinfo.json illisible")
    version = info.get("v", 1)
    if version == 1 and "kdf" in info:
        raise DecryptError("keyinfo.json illisible")
    if version not in (1, KEYINFO_V2) or (version == KEYINFO_V2 and info.get("kdf") != ARGON2):
        raise DecryptError(f"keyinfo.json de version inconnue ({version!r})")
    try:
        salt = base64.b64decode(info["salt"], validate=True)
    except (TypeError, ValueError) as exc:
        raise DecryptError("keyinfo.json illisible") from exc
    return salt, Kdf.parse(info)
