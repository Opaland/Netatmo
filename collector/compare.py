"""Compare two copies of the encrypted data (S-8.3, #23: the move to a `data` branch and back).

Every document of both folders is decrypted with DATA_PASSPHRASE; the copy is accepted only when
both hold the same file names, the same keyinfo.json, the same decrypted documents and the same
totals (`verify`). Public logs: the result says how many files and years, never a value, a name
of a room or a total.
"""

from __future__ import annotations

import json
from pathlib import Path

from .crypto import DecryptError, decrypt_json
from .storage import Store


class CompareError(SystemExit):
    pass


def compare_dirs(source: Path, copy: Path, passphrase: str) -> tuple[int, int]:
    """(files, years) when `copy` holds exactly the data of `source`; CompareError otherwise."""
    if not (source / "keyinfo.json").is_file():
        raise CompareError("keyinfo.json absent de la source")
    names = {p.name for p in source.glob("*.json")}
    other = {p.name for p in copy.glob("*.json")}
    if names != other:
        missing, extra = sorted(names - other), sorted(other - names)
        raise CompareError(f"Fichiers différents : manquants {missing}, en trop {extra}")
    if json.loads((source / "keyinfo.json").read_text()) != json.loads((copy / "keyinfo.json").read_text()):
        raise CompareError("keyinfo.json différent")
    for name in sorted(n for n in names if n.endswith(".enc.json")):
        expected = decrypt_json(json.loads((source / name).read_text()), passphrase)  # a wrong phrase stops here
        if decrypt_json(json.loads((copy / name).read_text()), passphrase) != expected:
            raise CompareError(f"{name} : contenu déchiffré différent")
    before, after = Store(source, passphrase).all_totals(), Store(copy, passphrase).all_totals()
    if before != after:
        raise CompareError("Totaux différents")
    return len(names), len(before[1])


def compare_before(before: Path, copy: Path, passphrase: str) -> int:
    """The destination before the copy (#523 review): every file it had is still in the copy, and
    both open with the passphrase. Returns how many years have other totals (a forward copy adds
    nights); CompareError when a file would be lost. No destination before: 0."""
    if not (before / "keyinfo.json").is_file():
        return 0
    lost = sorted({p.name for p in before.glob("*.json")} - {p.name for p in copy.glob("*.json")})
    if lost:
        raise CompareError(f"La copie perdrait des fichiers de la destination : {lost}")
    try:
        old = Store(before, passphrase).file_totals()
    except DecryptError as exc:
        # #529: the destination was rekeyed (or the source) between two copies. Prudent refusal,
        # said in words: nothing is sent, the owner decides (README, « Branche des données »).
        raise CompareError(
            "La destination d'avant ne s'ouvre pas avec la phrase de passe actuelle (phrase changée "
            "depuis la dernière copie ?) : rien n'est envoyé."
        ) from exc
    new = Store(copy, passphrase).file_totals()
    return sum(1 for y in set(old) | set(new) if old.get(y) != new.get(y))
