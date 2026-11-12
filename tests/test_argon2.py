"""#139: Argon2id key derivation, read beside PBKDF2, and the migration by `rekey` (fictitious data)."""

import argparse
import base64
import json
import time
from pathlib import Path

import pytest

from collector.backup import restore
from collector.crypto import (
    ARGON2_LANES,
    ARGON2_MEMORY_KIB,
    ARGON2_TIME,
    DecryptError,
    Kdf,
    decrypt_json,
    derive_key,
    encrypt_json,
    keyinfo_doc,
    parse_keyinfo,
)
from collector.rekey import RekeyError, rekey
from collector.storage import Store

VECTOR = json.loads(
    (Path(__file__).resolve().parent.parent / "web" / "src" / "__fixtures__" / "kdf-vector.json").read_text()
)
PASS = "ancienne phrase fictive"


def test_shared_vector_is_the_key_the_app_derives():
    """Same vector as web/src/crypto.test.ts (hash-wasm): one key, two implementations."""
    salt, kdf = parse_keyinfo(VECTOR["keyinfo"])
    assert kdf == Kdf.argon2id(ARGON2_MEMORY_KIB, ARGON2_TIME, ARGON2_LANES)  # the vector uses the defaults
    assert derive_key(VECTOR["passphrase"], salt, kdf).hex() == VECTOR["key_hex"]
    assert decrypt_json(VECTOR["envelope"], VECTOR["passphrase"]) == VECTOR["doc"]


def test_argon2_envelope_and_keyinfo_say_their_derivation():
    env = encrypt_json({"a": 1}, "pw", b"0" * 16, Kdf.argon2id())
    assert {k: env[k] for k in ("v", "kdf", "m", "t", "p")} == {"v": 1, "kdf": "Argon2id", "m": 65536, "t": 2, "p": 1}
    assert "iter" not in env
    assert decrypt_json(env, "pw") == {"a": 1}
    with pytest.raises(DecryptError):
        decrypt_json(env, "nope")
    assert keyinfo_doc(b"0" * 16, 600_000) == {"salt": base64.b64encode(b"0" * 16).decode(), "iter": 600_000}
    for kdf in (Kdf.pbkdf2(), Kdf.argon2id()):
        assert parse_keyinfo(keyinfo_doc(b"1" * 16, kdf)) == (b"1" * 16, kdf)


@pytest.mark.parametrize(
    "bad",
    [
        {"m": 1024},  # below OWASP's minimum: a downgrade
        {"m": 10**9},  # would block the collection
        {"t": 0},
        {"t": 1000},
        {"p": 4},
        {"m": True},
        {"t": "2"},
        {"kdf": "scrypt"},
    ],
)
def test_argon2_parameters_out_of_bounds_are_refused_without_deriving(bad):
    env = encrypt_json({"a": 1}, "pw", b"0" * 16, Kdf.argon2id())
    start = time.monotonic()
    with pytest.raises(DecryptError):
        decrypt_json({**env, **bad}, "pw")
    info = {**keyinfo_doc(b"0" * 16, Kdf.argon2id()), **bad}
    with pytest.raises(DecryptError):
        parse_keyinfo(info)
    assert time.monotonic() - start < 0.5


def test_keyinfo_of_an_unknown_version_is_refused():
    for bad in ({"v": 3, "kdf": "Argon2id", "salt": "AAAA", "m": 65536, "t": 2, "p": 1}, {"salt": "AAAA"}, []):
        with pytest.raises(DecryptError):
            parse_keyinfo(bad)
    with pytest.raises(DecryptError):  # version 2 is Argon2id only
        parse_keyinfo({"v": 2, "kdf": "PBKDF2-SHA256", "salt": "AAAA", "iter": 600_000})


def _folder(path: Path) -> Store:
    store = Store(path, PASS)
    for day, wh in (("2024-01-01", 1200.0), ("2024-06-01", 300.5), ("2025-01-01", 2000.0)):
        store.merge("100", day, wh)
    store.merge("200", "2025-01-01", 800.0)
    rooms = [{"id": "100", "category": "heating"}, {"id": "200", "category": "water"}]
    store.save({"id": "h", "name": "Maison fictive"}, rooms)
    return store


def _verify(path: Path, passphrase: str, capsys) -> str:
    from collector.__main__ import cmd_verify

    class S:
        data_dir = path

        def require(self, *_):
            pass

    S.passphrase = passphrase
    capsys.readouterr()
    cmd_verify(S(), argparse.Namespace())
    return capsys.readouterr().out


def test_rekey_migrates_to_argon2id_with_the_same_totals_and_a_backup(tmp_path, capsys):
    data = tmp_path / "data"
    _folder(data)
    assert "v" not in json.loads((data / "keyinfo.json").read_text())  # a new folder stays PBKDF2
    before_verify = _verify(data, PASS, capsys)
    before_files = {p.name: p.read_text() for p in data.iterdir()}

    files = rekey(data, PASS, PASS, Kdf.argon2id(), tmp_path / "copie")

    assert "2024.enc.json" in files and "meta.enc.json" in files
    info = json.loads((data / "keyinfo.json").read_text())
    assert info["v"] == 2 and info["kdf"] == "Argon2id"
    for name in files:
        assert json.loads((data / name).read_text())["kdf"] == "Argon2id"
    assert _verify(data, PASS, capsys) == before_verify  # `verify` gives the same totals
    # the copy holds the files of before, unchanged: going back is copying it over data/
    assert {p.name: p.read_text() for p in (tmp_path / "copie").iterdir()} == before_files
    for p in (tmp_path / "copie").iterdir():
        (data / p.name).write_text(p.read_text())
    assert _verify(data, PASS, capsys) == before_verify
    assert Store(data, PASS).kdf == Kdf.pbkdf2()


def test_a_folder_in_argon2id_keeps_writing_argon2id(tmp_path):
    data = tmp_path / "data"
    _folder(data)
    rekey(data, PASS, PASS, Kdf.argon2id(), tmp_path / "copie")
    store = Store(data, PASS)
    store.merge("100", "2025-01-02", 10.0)
    store.save(store.meta["home"], store.meta["rooms"])
    assert json.loads((data / "2025.enc.json").read_text())["kdf"] == "Argon2id"


def test_rekey_writes_nothing_on_a_wrong_passphrase_or_an_existing_backup(tmp_path):
    data = tmp_path / "data"
    _folder(data)
    before = {p.name: p.read_text() for p in data.iterdir()}
    with pytest.raises(DecryptError):
        rekey(data, "pas la bonne", PASS, Kdf.argon2id(), tmp_path / "copie")
    (tmp_path / "copie").mkdir()
    (tmp_path / "copie" / "x").write_text("déjà là")
    with pytest.raises(RekeyError, match="existe déjà"):
        rekey(data, PASS, PASS, Kdf.argon2id(), tmp_path / "copie")
    with pytest.raises(RekeyError, match="identique"):
        rekey(data, PASS, PASS, None, tmp_path / "autre")
    assert {p.name: p.read_text() for p in data.iterdir()} == before
    assert not (tmp_path / "autre").exists() and not (tmp_path / ".data.rekey").exists()


def test_rekey_replaces_nothing_when_the_new_files_do_not_read_back(tmp_path, monkeypatch):
    """The check happens on the staged copy, before data/ is touched."""
    import collector.rekey as rk

    data = tmp_path / "data"
    _folder(data)
    before = {p.name: p.read_text() for p in data.iterdir()}
    real = rk.encrypt_json
    monkeypatch.setattr(rk, "encrypt_json", lambda obj, *a: real({**obj, "abîmé": 1} if "daily" in obj else obj, *a))
    with pytest.raises(RekeyError, match="rien n'a été remplacé"):
        rekey(data, PASS, PASS, Kdf.argon2id(), tmp_path / "copie")
    assert {p.name: p.read_text() for p in data.iterdir()} == before
    assert not (tmp_path / "copie").exists()


def test_cli_migrates_without_a_new_passphrase_and_logs_no_value(tmp_path, monkeypatch, capsys):
    from collector.__main__ import cmd_rekey

    data = tmp_path / "data"
    _folder(data)

    class S:
        data_dir = data
        passphrase = PASS

        def require(self, *_):
            pass

    monkeypatch.delenv("NEW_DATA_PASSPHRASE", raising=False)
    with pytest.raises(SystemExit, match="NEW_DATA_PASSPHRASE"):
        cmd_rekey(S(), argparse.Namespace(kdf=None, force=False, sauvegarde=None))
    cmd_rekey(S(), argparse.Namespace(kdf="argon2id", force=False, sauvegarde=str(tmp_path / "copie")))
    out = capsys.readouterr().out
    assert "totaux identiques" in out and "kWh" not in out and "Maison fictive" not in out
    assert "DATA_PASSPHRASE" not in out  # same passphrase: no secret to change
    assert parse_keyinfo(json.loads((data / "keyinfo.json").read_text()))[1] == Kdf.argon2id()


def test_backup_of_an_argon2id_folder_restores(tmp_path):
    data = tmp_path / "data"
    _folder(data)
    rekey(data, PASS, PASS, Kdf.argon2id(), tmp_path / "copie")
    bundle = {
        "format": "intuis-history-backup/1",
        "created": "2026-11-12T10:00:00Z",
        "keyinfo": json.loads((data / "keyinfo.json").read_text()),
        "files": {p.name: json.loads(p.read_text()) for p in data.glob("*.enc.json")},
    }
    (tmp_path / "b.json").write_text(json.dumps(bundle))
    restore(tmp_path / "b.json", tmp_path / "out", PASS)
    assert json.loads((tmp_path / "out" / "keyinfo.json").read_text()) == bundle["keyinfo"]
    assert Store(tmp_path / "out", PASS).totals() == Store(data, PASS).totals()
