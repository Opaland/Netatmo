"""Change the data passphrase: re-encrypt every document with a new salt and key.

Usage (local or in the « Changer la phrase de passe » workflow):
    DATA_PASSPHRASE=<ancienne> NEW_DATA_PASSPHRASE=<nouvelle> python -m collector rekey
"""

from __future__ import annotations

import base64
import json
import math
import os
import re
from pathlib import Path

from .crypto import ITERATIONS, decrypt_json, encrypt_json

# ~7 800 common words in a French diceware list → ≈ 12.9 bits per word.
BITS_PER_WORD = 12.9


def strength_bits(passphrase: str) -> float:
    """Rough entropy estimate, conservative: the better of a words view and a characters view."""
    words = [w for w in re.split(r"[\s\-_.]+", passphrase.strip()) if w]
    by_words = len(words) * BITS_PER_WORD if len(words) >= 3 else 0.0
    pool = 0
    pool += 26 if re.search(r"[a-z]", passphrase) else 0
    pool += 26 if re.search(r"[A-Z]", passphrase) else 0
    pool += 10 if re.search(r"\d", passphrase) else 0
    pool += 33 if re.search(r"[^\w\s]", passphrase) else 0
    # characters count less than random: divide by 2 to account for human patterns
    by_chars = len(passphrase) * math.log2(pool) / 2 if pool else 0.0
    return max(by_words, by_chars)


def verdict(bits: float) -> str:
    if bits < 50:
        return "FAIBLE : le dépôt est public, une phrase aussi courte peut être devinée. Visez 5 mots ou plus."
    if bits < 64:
        return "MOYENNE : acceptable, 6 mots au hasard seraient plus sûrs."
    return "BONNE"


def rekey(data_dir: Path, old: str, new: str) -> list[str]:
    if old == new:
        raise SystemExit("La nouvelle phrase de passe est identique à l'ancienne.")
    docs = sorted(p for p in data_dir.glob("*.enc.json"))
    plain = {p: decrypt_json(json.loads(p.read_text()), old) for p in docs}  # fails before writing anything
    salt = os.urandom(16)
    for p, obj in plain.items():
        p.write_text(json.dumps(encrypt_json(obj, new, salt, ITERATIONS)) + "\n")
    (data_dir / "keyinfo.json").write_text(
        json.dumps({"salt": base64.b64encode(salt).decode(), "iter": ITERATIONS}) + "\n"
    )
    for p, obj in plain.items():  # verify
        assert decrypt_json(json.loads(p.read_text()), new) == obj
    return [p.name for p in docs]
