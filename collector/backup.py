"""Restore the encrypted backup downloaded from the app (S-1.15).

The bundle is {"format": "intuis-history-backup/1", "created": iso, "keyinfo": {...},
"files": {"<name>.enc.json": <envelope>, ...}}: every document is still encrypted. Before
writing anything, each file is decrypted in memory with DATA_PASSPHRASE (a wrong phrase or a
damaged file stops the restore), then the envelopes are written back unchanged.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .crypto import DecryptError, decrypt_json, keyinfo_doc, parse_keyinfo

FORMAT = "intuis-history-backup/1"
# Plain file names only (no path), and never the Netatmo refresh token: it rotates at every
# collection, an old copy would be refused and would overwrite the current one.
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.enc\.json$")
EXCLUDED = {"netatmo-token.enc.json"}


class BackupError(ValueError):
    pass


def read_bundle(path: Path) -> dict:
    try:
        bundle = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise BackupError(f"Sauvegarde illisible : {exc}") from exc
    if not isinstance(bundle, dict) or bundle.get("format") != FORMAT:
        raise BackupError(f"Format inconnu (attendu {FORMAT})")
    info = bundle.get("keyinfo")
    if not isinstance(info, dict) or "salt" not in info:
        raise BackupError("keyinfo absent de la sauvegarde")
    try:
        parse_keyinfo(info)  # version 1 (PBKDF2) or 2 (Argon2id, #139)
    except DecryptError as exc:
        raise BackupError(f"keyinfo de la sauvegarde refusé : {exc}") from exc
    if not isinstance(bundle.get("files"), dict) or "meta.enc.json" not in bundle["files"]:
        raise BackupError("meta.enc.json absent de la sauvegarde")
    return bundle


def restore(path: Path, data_dir: Path, passphrase: str, dry_run: bool = False) -> list[str]:
    """Check every file decrypts, then write keyinfo.json and the envelopes into data_dir.

    Returns the names written (or that would be written with dry_run)."""
    bundle = read_bundle(path)
    files: dict[str, dict] = {}
    for name, env in bundle["files"].items():
        if name in EXCLUDED:
            continue
        if not _NAME.match(name):
            raise BackupError(f"Nom de fichier refusé : {name!r}")
        try:
            decrypt_json(env, passphrase)
        except DecryptError as exc:
            raise BackupError(f"{name} : phrase de passe incorrecte ou fichier abîmé") from exc
        except (KeyError, TypeError, ValueError) as exc:
            raise BackupError(f"{name} : enveloppe invalide") from exc
        files[name] = env
    names = ["keyinfo.json", *sorted(files)]
    if dry_run:
        return names
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "keyinfo.json").write_text(json.dumps(keyinfo_doc(*parse_keyinfo(bundle["keyinfo"]))) + "\n")
    for name, env in files.items():
        (data_dir / name).write_text(json.dumps(env) + "\n")
    return names
