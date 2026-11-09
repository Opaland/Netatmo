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
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": iterations, "salt": _b64(salt), "iv": _b64(iv), "ct": _b64(ct)}


def decrypt_json(envelope: dict, passphrase: str) -> object:
    salt = base64.b64decode(envelope["salt"])
    key = derive_key(passphrase, salt, int(envelope["iter"]))
    try:
        pt = AESGCM(key).decrypt(base64.b64decode(envelope["iv"]), base64.b64decode(envelope["ct"]), None)
    except Exception as exc:  # cryptography raises InvalidTag
        raise DecryptError("Phrase de passe incorrecte ou fichier corrompu") from exc
    return json.loads(pt)
