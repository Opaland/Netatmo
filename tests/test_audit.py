"""#532: audit of the dates and overlaps (collector/audit.py), on synthetic archives only.

A clean archive (hours, half hours, days, tariffs, Linky, an estimated stretch, a plug, crossing the
spring change of 2024) gives no finding at all; each test then plants ONE defect and checks that its
check, and only the expected ones, sees it (each was seen red with its check switched off). The
public log keeps counts per month; the detail is encrypted with the data key.
"""

import json
import os
import re
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from collector import __main__ as cli
from collector import audit as au
from collector import room30
from collector.crypto import decrypt_json, derive_key, pad
from collector.storage import Store

PASSPHRASE = "phrase-audit-123"
A, W = "1234500100", "1234500300"
NAMES = {A: "Salon Zorglub", W: "Ballon Zorglub"}
TZ = ZoneInfo("Europe/Paris")
FIRST, LAST = date(2024, 3, 1), date(2024, 4, 30)
EST_DAYS = ("2024-04-10", "2024-04-11", "2024-04-12")
EST_SHARE = 1500.0


def factor(day: date) -> float:
    """Days that differ from one another (weekends heated more), so that shifted sums do not fit."""
    i = (day - FIRST).days
    return 1 + 2 * (day.weekday() >= 5) + 0.3 * ((i * 7) % 5) / 4


def energy(room: str, local: datetime) -> float:
    h = local.hour
    if room == W:
        return 900.0 if h in (2, 3, 4) else 0.0
    return round((40 + 300 * (h in (6, 7, 8)) + 400 * (18 <= h <= 21)) * factor(local.date()), 1)


def build(path: Path, *, hour_key=None, linky_shift=0, plug_like_water=False) -> Store:
    """The clean archive. `hour_key(utc, local) -> key` changes how Intuis hours are keyed (UTC,
    a day later…); `linky_shift` stores each Linky day under a later day."""
    store = Store(path, PASSPHRASE)
    start = datetime(FIRST.year, FIRST.month, FIRST.day, tzinfo=TZ).astimezone(UTC)
    end = datetime(LAST.year, LAST.month, LAST.day, tzinfo=TZ).astimezone(UTC) + timedelta(days=1)
    hours: dict[str, dict[str, float]] = {A: {}, W: {}}
    daily: dict[str, dict[str, float]] = {A: {}, W: {}}
    curve: dict[str, float] = {}
    t = start
    while t < end:
        local = t.astimezone(TZ)
        day = local.date().isoformat()
        for rid in (A, W):
            wh = energy(rid, local)
            key = hour_key(t, local) if hour_key else local.strftime("%Y-%m-%dT%H")
            hours[rid][key] = round(hours[rid].get(key, 0.0) + wh, 1)
            daily[rid][day] = round(daily[rid].get(day, 0.0) + wh, 1)
        for half in (0, 30):
            slot = (t + timedelta(minutes=half)).astimezone(TZ).strftime("%Y-%m-%dT%H:%M")
            curve[slot] = round(curve.get(slot, 0.0) + (energy(A, local) + energy(W, local)) / 2 + 80 + half / 3, 1)
        t += timedelta(hours=1)
    for rid in (A, W):
        for key, wh in hours[rid].items():
            store.put(f"{key[:4]}.hourly", "hourly", rid, key, wh)
        for day, wh in daily[rid].items():
            store.merge(rid, day, wh)
            if rid == A:
                store.put(day[:4], "tariffs", rid, day, [0.0, round(0.6 * wh, 1), round(0.4 * wh, 1)])
    for day in EST_DAYS:  # spread from a monthly total: the same share each day
        store.merge(A, day, EST_SHARE)
        store.put(day[:4], "estimated", A, day, 1)
    meter: dict[str, float] = {}
    for slot, wh in curve.items():
        store.put(f"{slot[:4]}.linky30", "curve", slot, None, wh)
        meter[slot[:10]] = meter.get(slot[:10], 0.0) + wh
    for day, wh in meter.items():
        shifted = (date.fromisoformat(day) + timedelta(days=linky_shift)).isoformat()
        store.put("linky", "daily", shifted, None, round(wh))
    for i, day in enumerate(sorted(daily[W])):
        store.put("shelly", "daily", "p0", day, daily[W][day] if plug_like_water else 500 + (i % 7) * 30)
    store.set_top("shelly", "plugs", {"p0": {"name": "Frigo Zorglub", "usable": True}})
    for day in ("2024-03-30", "2024-03-31", "2024-04-01"):  # 30 min, from the local hours
        hp = [hours[A].get(f"{day}T{i // 2:02d}", None) for i in range(48)]
        cols = [None if v is None else round(v / 2) for v in hp]
        store.put(
            "2024.room30",
            "rooms",
            A,
            day,
            [room30.pack(cols), room30.pack([None if v is None else 0 for v in hp]), None, None],
        )
    rooms = [
        {"id": A, "name": NAMES[A], "category": "heating"},
        {"id": W, "name": NAMES[W], "category": "water_heater"},
    ]
    store.save({"name": "Famille Zorglub", "timezone": "Europe/Paris"}, rooms)
    return Store(path, PASSPHRASE)


def found(store: Store) -> dict[str, list[au.Finding]]:
    out: dict[str, list[au.Finding]] = {}
    for f in au.audit(store).findings:
        out.setdefault(f.code, []).append(f)
    return out


@pytest.fixture
def clean(tmp_path) -> Store:
    return build(tmp_path)


def test_a_clean_archive_has_no_finding(clean):
    assert found(clean) == {}


def test_a_clean_archive_is_compared_at_all(clean):
    """The shift checks must have something to compare, or « no finding » proves nothing."""
    a = au.Audit.of(clean, au.read_docs(clean.dir, PASSPHRASE))
    seen: list[int] = []
    orig = au._pearson
    au._pearson = lambda pairs: seen.append(len(pairs)) or orig(pairs)  # type: ignore[assignment]
    try:
        a.hours_vs_linky()
    finally:
        au._pearson = orig
    assert seen and min(seen) >= 7 * 24


def _write_raw(store: Store, name: str, text: str) -> None:
    """An encrypted document from a JSON text (to plant a key written twice)."""
    key = derive_key(PASSPHRASE, store.salt, store.kdf)
    iv = os.urandom(12)
    env = encrypt_like(store, AESGCM(key).encrypt(iv, pad(text.encode()), None), iv)
    (store.dir / f"{name}.enc.json").write_text(json.dumps(env))


def encrypt_like(store: Store, ct: bytes, iv: bytes) -> dict:
    import base64

    from collector.crypto import encrypt_json

    env = encrypt_json({}, PASSPHRASE, store.salt, store.kdf)
    env["iv"], env["ct"] = base64.b64encode(iv).decode(), base64.b64encode(ct).decode()
    return env


def codes(store: Store) -> set[str]:
    return set(found(store))


def test_impossible_date(clean):
    clean.put("2024", "daily", A, "2024-02-30", 500.0)
    clean.save(clean.meta["home"], clean.meta["rooms"])
    f = found(clean)
    assert set(f) == {"cle-invalide"}
    assert f["cle-invalide"][0].at == "2024-02-30" and f["cle-invalide"][0].room == A


def test_same_day_written_twice(clean):
    clean.put("2024", "daily", A, "2024-4-5", 999.0)
    clean.save(clean.meta["home"], clean.meta["rooms"])
    f = found(clean)
    assert set(f) == {"doublon-horodatage"}
    assert (f["doublon-horodatage"][0].day, f["doublon-horodatage"][0].value) == ("2024-04-05", 999.0)


def test_key_twice_in_the_json(clean):
    _write_raw(clean, "weather", '{"outdoor": {"2024-03-02": [1, 5, 3], "2024-03-02": [2, 6, 4]}}')
    f = found(clean)
    assert set(f) == {"doublon-horodatage"}
    assert f["doublon-horodatage"][0].day == "2024-03-02" and f["doublon-horodatage"][0].doc == "weather"


def test_day_in_the_file_of_another_year(clean):
    clean.put("2024", "temps", A, "2023-12-31", [19.0, 19.5])
    clean.save(clean.meta["home"], clean.meta["rooms"])
    f = found(clean)
    assert set(f) == {"mauvais-fichier"}
    assert (f["mauvais-fichier"][0].day, f["mauvais-fichier"][0].doc) == ("2023-12-31", "2024")


def test_same_day_in_two_year_files(clean):
    clean.put("2025", "daily", A, "2024-03-05", 1234.0)
    clean.save(clean.meta["home"], clean.meta["rooms"])
    f = found(clean)
    assert set(f) == {"mauvais-fichier", "deux-fichiers"}
    two = f["deux-fichiers"][0]
    assert (two.day, two.room, two.value) == ("2024-03-05", A, 1234.0)


def test_hour_skipped_by_the_spring_change(clean):
    clean.put("2024.hourly", "hourly", A, "2024-03-31T02", 50.0)
    clean.save(clean.meta["home"], clean.meta["rooms"])
    f = found(clean)
    assert set(f) == {"heure-inexistante"}
    assert f["heure-inexistante"][0].at == "2024-03-31T02"


def test_half_hour_skipped_by_the_spring_change_in_30_min(clean):
    cols = clean.doc("2024.room30")["rooms"][A]["2024-03-31"]
    hp = room30.unpack(cols[0])
    assert hp[4] is None and hp[5] is None  # the clean archive leaves 02:00 and 02:30 empty
    hp[5] = 25
    clean.put("2024.room30", "rooms", A, "2024-03-31", [hp, 0, None, None])
    clean.save(clean.meta["home"], clean.meta["rooms"])
    f = found(clean)
    assert set(f) == {"heure-inexistante"}
    assert f["heure-inexistante"][0].at == "2024-03-31T02:30"


def test_hours_stored_under_the_next_day(tmp_path):
    store = build(tmp_path, hour_key=lambda _t, local: (local + timedelta(days=1)).strftime("%Y-%m-%dT%H"))
    f = found(store)
    assert "decalage-heures" in f
    months = {x.at for x in f["decalage-heures"] if x.room == A}
    assert months == {"2024-03", "2024-04"}
    assert all("d'un jour" in x.text for x in f["decalage-heures"])


def test_hours_stored_in_utc(tmp_path):
    store = build(tmp_path, hour_key=lambda t, _local: t.strftime("%Y-%m-%dT%H"))
    f = found(store)
    assert {x.at for x in f["decalage-fuseau"]} == {"2024-03", "2024-04"}
    assert "plus tard" in f["decalage-fuseau"][0].text or "plus tôt" in f["decalage-fuseau"][0].text


def test_linky_one_day_late(tmp_path):
    store = build(tmp_path, linky_shift=1)
    f = found(store)
    assert "decalage-jour-linky" in f
    assert all("le lendemain" in x.text for x in f["decalage-jour-linky"])


def test_real_value_under_an_estimated_flag(clean):
    clean.merge(A, EST_DAYS[1], 2222.0)  # merge (not merge_real): the flag stays
    clean.save(clean.meta["home"], clean.meta["rooms"])
    f = found(clean)
    assert set(f) == {"estime-sur-reel"}
    x = f["estime-sur-reel"][0]
    assert (x.day, x.value, x.other) == (EST_DAYS[1], 2222.0, EST_SHARE)


def test_estimated_flag_without_a_value(clean):
    clean.put("2024", "estimated", A, "2024-02-15", 1)
    clean.save(clean.meta["home"], clean.meta["rooms"])
    f = found(clean)
    assert set(f) == {"marque-sans-valeur"}
    assert f["marque-sans-valeur"][0].day == "2024-02-15"


def test_day_twice_its_tariffs(clean):
    day = "2024-03-12"
    cols = clean.doc("2024")["tariffs"][A][day]
    clean.merge(A, day, round(2 * sum(cols), 1))
    clean.save(clean.meta["home"], clean.meta["rooms"])
    f = found(clean)
    assert set(f) == {"tarifs-additionnes"}
    assert f["tarifs-additionnes"][0].day == day and "deux fois" in f["tarifs-additionnes"][0].text


def test_plug_measuring_an_intuis_room(tmp_path):
    f = found(build(tmp_path, plug_like_water=True))
    assert set(f) == {"deux-sources"}
    x = f["deux-sources"][0]
    assert x.room == W and "Frigo Zorglub" in x.text


# ---------------------------------------------------------------- outputs
def run_cli(path: Path, monkeypatch, capsys, *extra: str) -> str:
    monkeypatch.chdir(path)
    monkeypatch.setenv("DATA_PASSPHRASE", PASSPHRASE)
    monkeypatch.setenv("DATA_DIR", str(path))
    cli.main(["diagnose", "--qualite", *extra])
    return capsys.readouterr().out


def defective(path: Path) -> Store:
    store = build(path, plug_like_water=True)
    store.put("2024", "daily", A, "2024-4-5", 999.0)
    store.put("2024.hourly", "hourly", A, "2024-03-31T02", 50.0)
    store.put("2025", "daily", A, "2024-03-05", 1234.0)
    store.save(store.meta["home"], store.meta["rooms"])
    return Store(path, PASSPHRASE)


def test_public_log_has_counts_only(tmp_path, monkeypatch, capsys):
    data = tmp_path / "data"
    defective(data)
    out = run_cli(data, monkeypatch, capsys, "--rapport", str(tmp_path / "rapport"))
    assert "Audit des données (#532)" in out
    assert re.search(r"\[deux-sources\] : 1 \(2024-03 1\)", out), out
    assert re.search(r"\[heure-inexistante\] : 1 \(2024-03 1\)", out), out
    assert re.search(r"\[cle-invalide\] : 0$", out, re.M), out
    for secret in [A, W, PASSPHRASE, "Zorglub", "Frigo", "999", "1234", "p0"]:
        assert secret not in out, secret
    assert not re.search(r"\d{4}-\d{2}-\d{2}", out), "a date finer than the month"


def test_detail_encrypted_with_the_data_key(tmp_path, monkeypatch, capsys):
    data = tmp_path / "data"
    defective(data)
    before = {p.name: p.read_bytes() for p in data.iterdir()}
    run_cli(data, monkeypatch, capsys, "--rapport", str(tmp_path / "rapport"))
    assert {p.name: p.read_bytes() for p in data.iterdir()} == before  # nothing written back
    env = json.loads((tmp_path / "rapport" / au.REPORT_NAME).read_text())
    keyinfo = json.loads((data / "keyinfo.json").read_text())
    assert env["salt"] == keyinfo["salt"] and env["iter"] == keyinfo["iter"]  # the app's key opens it
    assert "Zorglub" not in json.dumps(env)
    doc = decrypt_json(env, PASSPHRASE)
    assert doc["kind"] == "audit-donnees" and doc["v"] == 1
    by_code = {c["code"]: c for c in doc["checks"]}
    assert set(by_code) == set(au.CHECKS)
    assert by_code["deux-fichiers"]["count"] == 1 and by_code["deux-fichiers"]["months"] == {"2024-03": 1}
    days = {(f["code"], f.get("day")) for f in doc["findings"]}
    assert ("deux-fichiers", "2024-03-05") in days and ("heure-inexistante", "2024-03-31") in days
    assert {t["name"] for t in doc["thresholds"]} == set(au.THRESHOLDS)


def test_detail_capped_per_check_counts_complete(clean, monkeypatch):
    monkeypatch.setattr(au, "MAX_SHOWN", 2)
    for i in range(1, 6):
        clean.put("2024", "daily", A, f"2024-4-{i}", 1.0)
    clean.save(clean.meta["home"], clean.meta["rooms"])
    doc = au.private_doc(au.audit(clean), "2024-05-01")
    check = next(c for c in doc["checks"] if c["code"] == "doublon-horodatage")
    assert (check["count"], check["shown"]) == (5, 2)
    assert sum(1 for f in doc["findings"] if f["code"] == "doublon-horodatage") == 2


def test_the_token_document_is_never_read(clean):
    (clean.dir / "netatmo-token.enc.json").write_text("pas du json")
    assert "netatmo-token" not in au.read_docs(clean.dir, PASSPHRASE)


# ---------------------------------------------------------------- one contract with the app (§5)
ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "web/src/__fixtures__/audit-report.json"


def test_the_app_reads_this_report(tmp_path):
    """web/src/audit-report.test.ts reads the same report: regenerate with AUDIT_FIXTURE=1."""
    doc = au.private_doc(au.audit(defective(tmp_path)), "2024-05-01")
    text = json.dumps(doc, ensure_ascii=False, indent=1) + "\n"
    if os.environ.get("AUDIT_FIXTURE"):
        FIXTURE.write_text(text, encoding="utf-8")
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == doc


def test_a_day_in_two_year_files_is_read_once_from_its_own_year(clean):
    """The quality report (and the app, aggregate.ts toRecords) never adds the two values."""
    from collector.quality import Report

    own = clean.year(2024)[A]["2024-03-05"]
    clean.put("2025", "daily", A, "2024-03-05", 1234.0)
    clean.save(clean.meta["home"], clean.meta["rooms"])
    store = Store(clean.dir, PASSPHRASE)
    real = Report(store, []).real_wh["2024-03-05"]
    assert real == pytest.approx(own + store.year(2024)[W]["2024-03-05"])
