"""#138: encrypted files are padded to size steps inside the envelope, read with and without padding."""

import base64
import json
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from collector.crypto import PAD_MIN, decrypt_json, derive_key, encrypt_json, pad, padded_length
from collector.storage import Store

FIXTURES = Path(__file__).resolve().parent.parent / "web" / "src" / "__fixtures__"


def _ct_len(env: dict) -> int:
    return len(base64.b64decode(env["ct"]))


def test_ladder_is_coarse_and_bounded():
    assert padded_length(0) == padded_length(1) == padded_length(PAD_MIN) == PAD_MIN
    assert padded_length(PAD_MIN + 1) == 2 * PAD_MIN
    assert padded_length(20_000) == 20_480  # 4 KiB steps below 32 KiB
    assert padded_length(140_000) == 147_456  # 128-256 KiB: steps of 16 KiB
    assert padded_length(1_100_000) == 1_179_648  # 1-2 MiB: steps of 128 KiB
    previous = 0
    for n in range(1, 3_000_000, 997):
        p = padded_length(n)
        assert p >= n and p >= previous  # never smaller, never decreasing
        assert p - n < max(PAD_MIN, n // 8 + 1)  # overhead: under 4 KiB or 12.5 %
        assert padded_length(p) == p  # a step is its own step
        previous = p


def test_published_size_does_not_follow_a_small_change():
    """Two documents a few hundred bytes apart (a day at home, a day away) publish the same size."""
    salt = b"0" * 16
    present = {"daily": {"100": {f"2025-01-{d:02}": 1234.5 for d in range(1, 32)}}}
    away = {"daily": {"100": {f"2025-01-{d:02}": 0 for d in range(1, 32)}}}
    a, b = encrypt_json(present, "pw", salt, 100_000), encrypt_json(away, "pw", salt, 100_000)
    assert len(json.dumps(a)) == len(json.dumps(b))
    assert _ct_len(a) == PAD_MIN + 16  # GCM tag after the padded plaintext
    assert decrypt_json(a, "pw") == present and decrypt_json(b, "pw") == away


def test_padding_is_inside_the_ciphertext():
    env = encrypt_json({"a": 1}, "pw", b"0" * 16, 100_000)
    assert set(env) == {"v", "kdf", "iter", "salt", "iv", "ct"}  # same envelope, nothing in clear
    assert pad(b'{"a":1}').rstrip(b" ") == b'{"a":1}'


def test_shared_vectors_read_with_and_without_padding():
    """The same vectors are decrypted by the app (web/src/aggregate.test.ts): one written before
    #138 (no padding), one after; both give the same document."""
    old = json.loads((FIXTURES / "python-vector.json").read_text())
    new = json.loads((FIXTURES / "python-vector-padded.json").read_text())
    assert _ct_len(old) < PAD_MIN  # written before #138
    assert _ct_len(new) - 16 == padded_length(_ct_len(old) - 16)
    assert decrypt_json(old, "test") == decrypt_json(new, "test")


def test_store_reads_unpadded_files_and_compares_plaintext(tmp_path):
    """A data folder written before #138 still opens; an unchanged document is not rewritten."""
    s = Store(tmp_path, "pw")
    s.put("2024", "daily", "100", "2024-01-01", 1200.0)
    assert s.flush("2024")
    path = tmp_path / "2024.enc.json"
    doc = s._read("2024")
    raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
    env = json.loads(path.read_text())
    key = derive_key("pw", s.salt, s.iterations)
    env["ct"] = base64.b64encode(AESGCM(key).encrypt(base64.b64decode(env["iv"]), raw, None)).decode()
    path.write_text(json.dumps(env) + "\n")  # unpadded, as written before #138
    before = path.read_text()
    s2 = Store(tmp_path, "pw")
    assert s2._read("2024") == doc
    assert s2._write("2024", doc) is False  # same plaintext once the padding is ignored
    assert path.read_text() == before
