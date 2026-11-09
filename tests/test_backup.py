"""S-1.15: restore the encrypted backup downloaded from the app."""

import base64
import json

import pytest

from collector.__main__ import main
from collector.backup import FORMAT, BackupError, restore
from collector.crypto import encrypt_json
from collector.storage import Store

PASS = "phrase de test"


def _data(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "keyinfo.json").write_text(json.dumps({"salt": base64.b64encode(b"s" * 16).decode(), "iter": 1000}))
    store = Store(src, PASS)
    store.merge("r1", "2025-01-02", 1500.0)
    store.merge("r1", "2026-01-02", 700.0)
    store.put("2026.linky30", "curve", "2026-01-02T19:00", None, 900.0)
    store.put("linky", "daily", "2026-01-02", None, 12000.0)
    store.save({"id": "h", "name": "Maison"}, [{"id": "r1", "name": "Salon", "category": "heating"}])
    (src / "netatmo-token.enc.json").write_text(json.dumps(encrypt_json({"t": "x"}, PASS, b"s" * 16, 1000)))
    return src


def _bundle(src, tmp_path, names=None):
    """What the app builds: the envelopes listed in meta, as served, plus keyinfo."""
    names = names or [p.name for p in src.glob("*.enc.json")]
    bundle = {
        "format": FORMAT,
        "created": "2026-11-09T10:00:00Z",
        "keyinfo": json.loads((src / "keyinfo.json").read_text()),
        "files": {n: json.loads((src / n).read_text()) for n in names},
    }
    path = tmp_path / "sauvegarde-energie-2026-11-09.json"
    path.write_text(json.dumps(bundle))
    return path


def test_round_trip_gives_same_totals(tmp_path, monkeypatch, capsys):
    src = _data(tmp_path)
    path = _bundle(src, tmp_path)
    assert "Salon" not in path.read_text()  # still encrypted
    out = tmp_path / "restored"
    names = restore(path, out, PASS)
    assert "keyinfo.json" in names and "2026.linky30.enc.json" in names
    assert "netatmo-token.enc.json" not in names
    assert not (out / "netatmo-token.enc.json").exists()
    for n in ("2025.enc.json", "2026.enc.json", "meta.enc.json", "linky.enc.json"):
        assert (out / n).read_text() == (src / n).read_text()  # envelopes untouched
    restored = Store(out, PASS)
    assert restored.year(2026) == {"r1": {"2026-01-02": 700.0}}
    assert restored.doc("2026.linky30")["curve"] == {"2026-01-02T19:00": 900.0}
    # same output from `verify` on both sides
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATA_PASSPHRASE", PASS)
    outputs = []
    for d in (src, out):
        monkeypatch.setenv("DATA_DIR", str(d))
        capsys.readouterr()
        main(["verify"])
        outputs.append(capsys.readouterr().out)
    assert outputs[0] == outputs[1] and "2026 : heating 1 kWh" in outputs[1]


def test_cli_dry_run_writes_nothing_and_wrong_passphrase_is_refused(tmp_path, monkeypatch, capsys):
    src = _data(tmp_path)
    path = _bundle(src, tmp_path)
    out = tmp_path / "data"
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATA_PASSPHRASE", PASS)
    main(["restore-backup", str(path), "--dry-run"])
    assert "seraient écrits" in capsys.readouterr().out
    assert not out.exists()
    monkeypatch.setenv("DATA_PASSPHRASE", "mauvaise phrase")
    with pytest.raises(SystemExit, match="phrase de passe incorrecte"):
        main(["restore-backup", str(path)])
    assert not out.exists()
    monkeypatch.setenv("DATA_PASSPHRASE", PASS)
    main(["restore-backup", str(path)])
    assert (out / "meta.enc.json").exists() and (out / "keyinfo.json").exists()
    assert not (out / "netatmo-token.enc.json").exists()


def test_refuses_foreign_files_and_unsafe_names(tmp_path):
    src = _data(tmp_path)
    path = _bundle(src, tmp_path)
    bundle = json.loads(path.read_text())
    bundle["files"]["../evil.enc.json"] = bundle["files"]["meta.enc.json"]
    path.write_text(json.dumps(bundle))
    with pytest.raises(BackupError, match="Nom de fichier refusé"):
        restore(path, tmp_path / "out", PASS)
    path.write_text(json.dumps({"format": "autre", "files": {}}))
    with pytest.raises(BackupError, match="Format inconnu"):
        restore(path, tmp_path / "out", PASS)
    assert not (tmp_path / "out").exists()
