"""Compare two copies of the encrypted data (S-8.3, #23: the move to a `data` branch and back).

Every document of both folders is decrypted with DATA_PASSPHRASE; the copy is accepted only when
both hold the same file names, the same keyinfo.json, the same decrypted documents and the same
totals (`verify`). Public logs: the result says how many files and years, never a value, a name
of a room or a total.
"""

from __future__ import annotations

import json
from pathlib import Path

from .crypto import decrypt_json
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
    before, after = Store(source, passphrase).totals(), Store(copy, passphrase).totals()
    if before != after:
        raise CompareError("Totaux différents")
    return len(names), len(before)
