"""S-1.32 (#336): `diagnose --qualite` reads a synthetic encrypted archive and prints counts only.

The archive holds room names, ids and energy values that are easy to spot: none of them, nor a
date finer than the month, may reach the output (the log of a public repository is public).
"""

import re
from datetime import date, timedelta

import pytest

from collector import __main__ as cli
from collector.quality import Report
from collector.storage import Store

PASSPHRASE = "phrase-qualite-123"
A, B, W = "1234500100", "1234500200", "1234500300"
NAMES = {A: "Salon Zorglub", B: "Chambre Zorglub", W: "Ballon Zorglub"}
VALUES = ("7777", "3333", "50000", "5000", "19.5", "4321", "-5")


def _days(first: str, last: str) -> list[str]:
    d, end, out = date.fromisoformat(first), date.fromisoformat(last), []
    while d <= end:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def build(path) -> None:
    store = Store(path, PASSPHRASE)
    lost = set(_days("2024-01-10", "2024-01-12"))  # lost at Intuis for every room present
    for day in _days("2024-01-01", "2024-02-29"):
        if day not in lost:
            store.merge(A, day, -5 if day == "2024-02-05" else 7777)  # one impossible value
            store.merge(W, day, 3333)
        if day >= "2024-01-15":
            store.merge(B, day, 7777)
            if "2024-02-10" <= day <= "2024-02-14":
                store.put("2024", "estimated", B, day, 1)
        if day not in ("2024-01-20", "2024-01-21"):  # two days missing at Linky
            # 5 January: Linky far below what Intuis alone recorded (impossible)
            store.put("linky", "daily", day, None, 5000 if day == "2024-01-05" else 50000)
        store.put("station", "daily", "m0", day, [18.1, 21.2, 19.5, 50, 800])
        if day >= "2024-02-01" and day != "2024-02-15":
            store.put("station", "daily", "m1", day, [1.0, 9.0, 4.5, 80, None])
    store.set_top("station", "modules", {"m0": {"name": "Station Zorglub"}, "m1": {"name": "Jardin Zorglub"}})
    for hh in range(24):  # Linky 30 min: 28 Feb complete, 29 Feb half → 72 / 96 = 75 %
        for mm in ("00", "30"):
            store.put("2024.linky30", "curve", f"2024-02-28T{hh:02d}:{mm}", None, 4321)
            if hh < 12:
                store.put("2024.linky30", "curve", f"2024-02-29T{hh:02d}:{mm}", None, 4321)
    hp = [None] * 12 + [4321] * 36  # rooms 30 min: 36 + 48 of 96 half hours → 88 %
    store.put("2024.room30", "rooms", A, "2024-02-29", [hp, None, None, None])
    store.put("2024.room30", "rooms", B, "2024-02-29", [0, 0, None, None])
    store.put("roomstate", "seen", "2024-02-28", None, (1 << 24) - 1)  # 24 + 12 of 48 hours → 75 %
    store.put("roomstate", "seen", "2024-02-29", None, (1 << 12) - 1)
    store.update_coverage()
    rooms = [
        {"id": A, "name": NAMES[A], "category": "heating"},
        {"id": B, "name": NAMES[B], "category": "heating"},
        {"id": W, "name": NAMES[W], "category": "water_heater"},
    ]
    store.save({"name": "Famille Zorglub", "timezone": "Europe/Paris"}, rooms)


@pytest.fixture
def archive(tmp_path):
    build(tmp_path)
    return tmp_path


def run_cli(archive, monkeypatch, capsys) -> str:
    monkeypatch.chdir(archive)  # no stray .env
    monkeypatch.setenv("DATA_PASSPHRASE", PASSPHRASE)
    monkeypatch.setenv("DATA_DIR", str(archive))
    cli.main(["diagnose", "--qualite"])
    return capsys.readouterr().out


def test_output_has_no_value_name_id_or_day(archive, monkeypatch, capsys):
    out = run_cli(archive, monkeypatch, capsys)
    assert "Bilan qualité" in out
    for secret in [A, B, W, PASSPHRASE, "Zorglub", *NAMES.values(), *VALUES]:
        assert secret not in out, secret
    assert not re.search(r"\d{4}-\d{2}-\d{2}", out), "a date finer than the month"


def test_counts(archive, monkeypatch, capsys):
    out = run_cli(archive, monkeypatch, capsys)
    rows = {line.split()[0]: line.split() for line in out.splitlines() if re.match(r"\d{4}-\d{2} ", line)}
    # mois, chauffage r/e/m/s, pièces, chauffe-eau, Linky j, Linky 30, %, pièces 30, %, relevé, %, I>L/L-I, station…
    assert rows["2024-01"][:6] == ["2024-01", "45/0/3/0", "2", "28/0/3", "29/2", "—"]
    assert rows["2024-01"][6:] == ["—", "—", "1/3", "m0", "31/31"]
    assert rows["2024-02"][:5] == ["2024-02", "53/5/0/1", "2", "29/0/0", "29/0"]
    assert rows["2024-02"][5:] == ["75", "%", "88", "%", "75", "%", "0/0", "m0", "29/29", "m1", "28/29"]
    assert "Total 2024 : chauffage 98/5/3/1 pièces-jours ; Linky 58/2 jours" in out
    assert "1 jours Intuis > Linky, 3 jours Linky sans Intuis" in out
    assert "plus long trou (Intuis, toutes les pièces) : 3 j, à partir de 2024-01" in out
    assert "plus long trou (Intuis, au moins une pièce) : 3 j, à partir de 2024-01" in out
    assert "plus long trou (Linky jour) : 2 j, à partir de 2024-01" in out
    assert "plus long trou (station (tous modules)) : aucun" in out
    assert "Pièces suivies : 2 chauffage, 1 chauffe-eau ; modules de la station : 2." in out


def test_report_reads_without_writing(archive):
    before = {p.name: p.read_bytes() for p in archive.iterdir()}
    Report(Store(archive, PASSPHRASE)).lines()
    assert {p.name: p.read_bytes() for p in archive.iterdir()} == before


def test_wrong_passphrase_and_empty_archive(tmp_path, archive, monkeypatch, capsys):
    monkeypatch.chdir(archive)
    monkeypatch.setenv("DATA_DIR", str(archive))
    monkeypatch.setenv("DATA_PASSPHRASE", "pas-la-bonne")
    with pytest.raises(SystemExit, match="déchiffrement impossible"):
        cli.main(["diagnose", "--qualite"])
    empty = tmp_path / "vide"
    empty.mkdir()
    monkeypatch.setenv("DATA_DIR", str(empty))
    with pytest.raises(SystemExit, match="aucune archive"):
        cli.main(["diagnose", "--qualite"])
    assert not (empty / "keyinfo.json").exists()  # nothing created
