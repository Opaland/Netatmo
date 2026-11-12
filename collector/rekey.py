"""Change the data passphrase or the key derivation: re-encrypt every document with a new salt and key.

Usage (local or in the « Changer la phrase de passe » workflow):
    DATA_PASSPHRASE=<ancienne> NEW_DATA_PASSPHRASE=<nouvelle> python -m collector rekey
    DATA_PASSPHRASE=<phrase> python -m collector rekey --kdf argon2id   (#139, same passphrase)
A copy of the current files is kept in data-avant-rekey/ (next to data/, ignored by git; or
--sauvegarde) before anything is replaced; going back = copying it over data/ (or `git revert` of
the rekey commit). If the replacement fails or is interrupted (Ctrl-C), the copy is put back by
itself; a process killed outright (power cut, kill -9) leaves data/ half migrated, readable by the
collector but not by the app: then `cp data-avant-rekey/* data/` (README, « Passer la clé à
Argon2id »).
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
from pathlib import Path

from .crypto import Kdf, decrypt_json, encrypt_json, keyinfo_doc, parse_keyinfo
from .storage import Store

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


class RekeyError(SystemExit):
    pass


def default_backup(data_dir: Path) -> Path:
    return data_dir.with_name(f"{data_dir.name}-avant-rekey")


def rekey(data_dir: Path, old: str, new: str, kdf: Kdf | None = None, backup_dir: Path | None = None) -> list[str]:
    """Re-encrypt every document with a new salt, a new passphrase and/or a new derivation (#139).

    Nothing in data_dir is overwritten before: every document decrypted with the old passphrase,
    every new envelope written aside and decrypted again with the new one to the same document,
    the totals of `verify` identical, and a copy of the current files in backup_dir. After the
    swap, the totals are compared once more; on any difference the copy is put back.
    """
    _, current_kdf = parse_keyinfo(json.loads((data_dir / "keyinfo.json").read_text()))
    kdf = kdf or current_kdf
    if old == new and kdf == current_kdf:
        raise RekeyError("La nouvelle phrase de passe est identique à l'ancienne (et la dérivation ne change pas).")
    backup_dir = backup_dir or default_backup(data_dir)
    if backup_dir.exists() and any(backup_dir.iterdir()):
        raise RekeyError(f"La sauvegarde {backup_dir} existe déjà : déplacez-la ou choisissez --sauvegarde.")
    docs = sorted(p for p in data_dir.glob("*.enc.json"))
    plain = {p: decrypt_json(json.loads(p.read_text()), old) for p in docs}  # fails before writing anything
    before = Store(data_dir, old).totals()

    staging = data_dir.with_name(f".{data_dir.name}.rekey")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir()
    try:
        salt = os.urandom(16)
        (staging / "keyinfo.json").write_text(json.dumps(keyinfo_doc(salt, kdf)) + "\n")
        for p, obj in plain.items():
            (staging / p.name).write_text(json.dumps(encrypt_json(obj, new, salt, kdf)) + "\n")
        for p, obj in plain.items():
            if decrypt_json(json.loads((staging / p.name).read_text()), new) != obj:
                raise RekeyError(f"{p.name} : relu différent après rechiffrement, rien n'a été remplacé.")
        if Store(staging, new).totals() != before:
            raise RekeyError("Totaux différents après rechiffrement, rien n'a été remplacé.")

        backup_dir.mkdir(parents=True, exist_ok=True)
        for p in [data_dir / "keyinfo.json", *docs]:
            shutil.copy2(p, backup_dir / p.name)
        # From here until keyinfo.json is replaced, data_dir holds both derivations: the collector
        # still reads it (each envelope says its own), the app does not (it derives from
        # keyinfo.json). Any failure, Ctrl-C included, puts the copy back; a process killed
        # outright cannot, hence the message (README, « Passer la clé à Argon2id »).
        print(f"Remplacement des fichiers… s'il est interrompu : cp {backup_dir}/* {data_dir}/")
        try:
            for p in docs:  # keyinfo.json last: until then, the old one still opens the old files
                os.replace(staging / p.name, p)
                _after_replace(p)
            os.replace(staging / "keyinfo.json", data_dir / "keyinfo.json")
            if Store(data_dir, new).totals() != before:  # the staged copy was checked: a failed write
                raise RekeyError("Totaux différents après remplacement.")
        except BaseException as exc:
            restore_backup(backup_dir, data_dir)
            if isinstance(exc, RekeyError):
                raise RekeyError(f"{exc} Fichiers d'origine remis depuis {backup_dir}.") from exc
            raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return [p.name for p in docs]


def _after_replace(path: Path) -> None:
    """Test hook: called after each file is replaced (an interruption is simulated here)."""


def restore_backup(backup_dir: Path, data_dir: Path) -> None:
    """Put the files of before back (the same as `cp backup_dir/* data_dir/`)."""
    for p in backup_dir.iterdir():
        shutil.copy2(p, data_dir / p.name)
