"""AES-256-GCM encryption with a PBKDF2-SHA256 derived key.

The envelope is deliberately simple so the PWA can decrypt it with WebCrypto:
{"v": 1, "kdf": "PBKDF2-SHA256", "iter": N, "salt": b64, "iv": b64, "ct": b64}
`ct` includes the 16-byte GCM tag at the end (WebCrypto's layout).
"""

from __future__ import annotations

import base64
import json
import os
from functools import lru_cache

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 600_000
VERSION = 1
KDF = "PBKDF2-SHA256"
# S-1.16 #271: an envelope read from outside (an artifact) must not choose its own cost: too low
# is a downgrade, too high blocks the collection in PBKDF2 for hours. The web app writes 600 000.
MIN_ITERATIONS = 100_000
MAX_ITERATIONS = 2_000_000


class DecryptError(ValueError):
    pass


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


@lru_cache(maxsize=8)
def derive_key(passphrase: str, salt: bytes, iterations: int = ITERATIONS) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return kdf.derive(passphrase.encode("utf-8"))


def encrypt_json(obj: object, passphrase: str, salt: bytes, iterations: int = ITERATIONS) -> dict:
    key = derive_key(passphrase, salt, iterations)
    iv = os.urandom(12)
    plaintext = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ct = AESGCM(key).encrypt(iv, plaintext, None)
    return {"v": VERSION, "kdf": KDF, "iter": iterations, "salt": _b64(salt), "iv": _b64(iv), "ct": _b64(ct)}


def _iterations(envelope: object) -> int:
    """The PBKDF2 cost of an envelope, checked before any derivation."""
    # Same checks as the PWA (web/src/crypto.ts checkEnvelope): an unknown format is refused
    # instead of being misread.
    if not isinstance(envelope, dict) or envelope.get("v") != VERSION or envelope.get("kdf") != KDF:
        raise DecryptError("Format de fichier chiffré inconnu (version ou dérivation)")
    n = envelope.get("iter")
    if isinstance(n, bool) or not isinstance(n, int) or not MIN_ITERATIONS <= n <= MAX_ITERATIONS:
        raise DecryptError(f"Nombre d'itérations PBKDF2 hors de [{MIN_ITERATIONS} ; {MAX_ITERATIONS}]")
    return n


def decrypt_json(envelope: dict, passphrase: str) -> object:
    iterations = _iterations(envelope)
    try:
        salt = base64.b64decode(envelope["salt"])
    except (KeyError, TypeError, ValueError) as exc:
        raise DecryptError("Enveloppe chiffrée illisible") from exc
    key = derive_key(passphrase, salt, iterations)
    try:
        pt = AESGCM(key).decrypt(base64.b64decode(envelope["iv"]), base64.b64decode(envelope["ct"]), None)
    except Exception as exc:  # cryptography raises InvalidTag
        raise DecryptError("Phrase de passe incorrecte ou fichier corrompu") from exc
    return json.loads(pt)
