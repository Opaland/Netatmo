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

import httpx
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
    if room == W:  # never the same day twice (a frozen value is a finding)
        return round(900.0 * (1 + 0.01 * ((local.date() - FIRST).days % 11)), 1) if h in (2, 3, 4) else 0.0
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
            if rid == A and key[:10] in EST_DAYS:
                continue  # days lost at Intuis, kept as a monthly total only: no hours either
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


def save(store: Store) -> Store:
    store.save(store.meta["home"], store.meta["rooms"])
    return Store(store.dir, PASSPHRASE)


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


def test_estimated_day_with_measured_hours(clean):
    for h in range(24):
        clean.put("2024.hourly", "hourly", A, f"{EST_DAYS[1]}T{h:02d}", 100.0)
    clean.save(clean.meta["home"], clean.meta["rooms"])
    f = found(clean)
    assert set(f) == {"estime-sur-reel"}
    x = f["estime-sur-reel"][0]
    assert (x.day, x.value, x.other) == (EST_DAYS[1], 2400.0, EST_SHARE)


def test_two_nights_spreading_one_month_are_not_a_finding(clean):
    """The backfill spreads a month cut by two yearly windows twice: two shares in one month."""
    for day in ("2024-04-20", "2024-04-21"):
        clean.merge(A, day, 2100.0)
        clean.put("2024", "estimated", A, day, 1)
        hours = clean.doc("2024.hourly")["hourly"][A]
        for k in [k for k in hours if k.startswith(day)]:
            del hours[k]
        clean._dirty.add("2024.hourly")
    assert found(save(clean)) == {}


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
    assert set(f) == {"tarifs-additionnes", "somme-jour"}  # its hours no longer make the day either
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


# ---------------------------------------------------------------- values (part 2 of #532)


def test_hours_that_do_not_make_the_day(clean):
    hour = clean.doc("2024.hourly")["hourly"][A]["2024-03-12T10"]
    clean.put("2024.hourly", "hourly", A, "2024-03-12T10", hour + 500)
    f = found(save(clean))
    assert set(f) == {"somme-jour"}
    x = f["somme-jour"][0]
    assert (x.day, x.room, x.doc) == ("2024-03-12", A, "2024.hourly")
    assert x.value == pytest.approx(x.other + 500)


def test_hours_twice_the_day(clean):
    hours = clean.doc("2024.hourly")["hourly"][A]
    for k in [k for k in hours if k.startswith("2024-03-12")]:
        clean.put("2024.hourly", "hourly", A, k, 2 * hours[k])
    f = found(save(clean))
    assert set(f) == {"somme-jour"} and "deux fois le jour" in f["somme-jour"][0].text


def test_public_log_says_which_series_does_not_make_its_day(clean):
    """#568: 77 `somme-jour` on the first real report, without saying which series: the public log
    now names the kind of series (fixed labels), per month, and whether the hours are above."""
    curve = clean.doc("2024.linky30")["curve"]
    for day in ("2024-03-12", "2024-03-13"):  # a second quantity added into each half hour: +20 %
        for k in [k for k in curve if k.startswith(day)]:
            clean.put("2024.linky30", "curve", k, None, round(curve[k] * 1.2, 1))
    hours = clean.doc("2024.hourly")["hourly"][A]
    for k in [k for k in hours if k.startswith("2024-04-02")]:
        clean.put("2024.hourly", "hourly", A, k, 2 * hours[k])
    lines = au.public_lines(au.audit(save(clean)))
    text = "\n".join(lines)
    assert "[somme-jour] : 3 (2024-03 2, 2024-04 1)" in text
    assert "      dont courbe de charge à la demi-heure (Linky) : 2 (2024-03 2)" in lines
    assert "      dont énergie par heure (Intuis) : 1 (2024-04 1)" in lines
    assert "      heures au-dessus du jour : 3, dont deux fois le jour : 1 ; au-dessous : 0" in lines
    for secret in (A, W, "Zorglub", "2024-03-12"):
        assert secret not in text


def test_the_day_gap_is_the_apps(clean):
    """#568: one rule for the audit and the app (web/src/curve.ts dayGapExceeded), held by the
    vector both test suites read."""
    vector = json.loads(
        (Path(__file__).resolve().parents[1] / "web/src/__fixtures__/somme-jour.json").read_text("utf-8")
    )
    assert au.THRESHOLDS["ecart_absolu"].value == vector["ecart_absolu_wh"]
    assert au.THRESHOLDS["ecart_relatif"].value / 100 == vector["ecart_relatif"]
    for fine, day, gap in vector["cases"]:
        assert (abs(fine - day) > au.tolerance(day)) is gap, (fine, day)


def test_rooms_above_the_meter(clean):
    clean.put("linky", "daily", "2024-03-12", None, 100)
    f = found(save(clean))
    assert set(f) == {"pieces-sur-linky", "somme-jour"}  # the curve of that day no longer makes it either
    assert [x.day for x in f["pieces-sur-linky"]] == ["2024-03-12"]


def test_impossible_energy(clean):
    clean.put("shelly", "daily", "p0", "2024-03-12", -3.0)
    f = found(save(clean))
    assert set(f) == {"valeur-impossible"}
    assert (f["valeur-impossible"][0].day, f["valeur-impossible"][0].text) == ("2024-03-12", "énergie négative")


def test_room_above_what_it_can_use_in_a_day(clean):
    clean.merge(A, "2024-03-12", 90_000.0)
    f = found(save(clean))
    assert "valeur-impossible" in f and "plus de 80 kWh" in f["valeur-impossible"][0].text


def test_kwh_stored_as_wh(clean):
    days = [f"2024-03-{d}" for d in range(12, 19)]
    for d in days:
        clean.put("shelly", "daily", "p0", d, round(clean.doc("shelly")["daily"]["p0"][d] / 1000, 3))
    f = found(save(clean))
    assert set(f) == {"unite"}
    assert [x.day for x in f["unite"]] == days


def test_six_days_almost_nothing_are_not_a_unit(clean):
    for d in range(12, 18):  # under jours_unite: a plug off for a few days, not a unit
        clean.put("shelly", "daily", "p0", f"2024-03-{d}", 0.4 + (d % 3) / 10)
    assert found(save(clean)) == {}


def test_a_day_a_thousand_times_too_large(clean):
    clean.put("shelly", "daily", "p0", "2024-03-12", clean.doc("shelly")["daily"]["p0"]["2024-03-12"] * 1000)
    f = found(save(clean))
    assert set(f) == {"unite"} and "plus grand" in f["unite"][0].text


def test_frozen_reading(clean):
    for i in range(6):
        clean.put("weather", "outdoor", f"2024-03-{10 + i:02d}", None, [1.0, 5.0, 3.0])
    clean.put("weather", "outdoor", "2024-03-16", None, [2.0, 6.0, 4.0])
    f = found(save(clean))
    assert set(f) == {"valeur-figee"}
    assert (f["valeur-figee"][0].at, f["valeur-figee"][0].other) == ("2024-03-10…2024-03-15", 6.0)


def test_the_values_carry_their_unit(clean):
    """#550: the report says the unit of each value (the app writes « 1 234 Wh »)."""
    clean.put("2025", "daily", A, "2024-03-05", 1234.0)  # deux-fichiers: energy in Wh
    for i in range(6):  # valeur-figee on the weather: °C, the length in days
        clean.put("weather", "outdoor", f"2024-03-{10 + i:02d}", None, 3.0)
    f = found(save(clean))
    two = f["deux-fichiers"][0]
    assert (two.unit, two.other_unit) == ("Wh", None)
    frozen = f["valeur-figee"][0]
    assert (frozen.value, frozen.unit, frozen.other, frozen.other_unit) == (3.0, "°C", 6.0, "jours")
    assert f["mauvais-fichier"][0].unit is None  # no value, no unit


def _steady_room(clean, half_hours):
    """Five days at 17.9 °C (setpoint 18), and their half hours (None: not collected)."""
    for i in range(5):
        day = f"2024-03-{10 + i:02d}"
        clean.put("2024", "temps", A, day, [17.9, 18.0])
        if half_hours is not None:
            clean.put("2024.room30", "rooms", A, day, [None, None, room30.pack(half_hours(i)), None])
    return {c for c in found(save(clean)) if c == "valeur-figee"}


def test_a_stable_room_is_not_a_frozen_sensor(clean):
    """#550 (revue v2.2): its half hours move within the day; a frozen sensor's do not."""
    moving = lambda i: [round(17.5 + (h % 9) / 10, 1) for h in range(48)]  # noqa: E731
    assert _steady_room(clean, moving) == set()


def test_a_sensor_frozen_within_the_day_is(clean):
    assert _steady_room(clean, lambda i: [17.9] * 48) == {"valeur-figee"}


def test_without_half_hours_the_days_are_compared_as_before(clean):
    assert _steady_room(clean, None) == {"valeur-figee"}


def test_a_plug_in_standby_is_not_frozen(clean):
    """#550: a few Wh a day, steady by nature, under the absolute gap (`ecart_absolu`)."""
    for i in range(7):
        clean.put("shelly", "daily", "p0", f"2024-03-{10 + i:02d}", 24.0)
    assert "valeur-figee" not in found(save(clean))
    for i in range(7):
        clean.put("shelly", "daily", "p0", f"2024-03-{10 + i:02d}", 480.0)
    assert "valeur-figee" in found(save(clean))


def test_four_equal_days_are_not_frozen(clean):
    for i in range(4):
        clean.put("weather", "outdoor", f"2024-03-{10 + i:02d}", None, [1.0, 5.0, 3.0])
    assert found(save(clean)) == {}


def test_peak_above_the_meter_maximum(clean):
    clean.put("linky", "pmax", "2024-03-12", None, 0.5)  # kVA: below the evening hours of the room
    f = found(save(clean))
    assert set(f) == {"pic-impossible"}
    assert {x.day for x in f["pic-impossible"]} == {"2024-03-12"}
    assert {x.doc for x in f["pic-impossible"]} == {"2024.hourly", "2024.linky30"}


def _pmax_as_collected(store: Store, va: float, unit: str | None = "VA") -> None:
    """The daily maximum written by the collector itself (enedis._collect_pmax), from an answer in
    VA as the Conso API contract gives it: values stored in kVA, `pmax_unit` keeps the RAW unit (#567)."""
    from collector import enedis

    days = [(FIRST + timedelta(days=i)).isoformat() for i in range((LAST - FIRST).days + 1)]
    # never the same maximum two days running (a frozen reading is a finding of its own)
    grandeur: dict = {"points": [{"d": d, "v": str(int(va) + 10 * (i % 7))} for i, d in enumerate(days)]}
    if unit:
        grandeur["unite"] = unit
    http = httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(200, json={"grandeur": [grandeur]})))
    enedis._collect_pmax(store, enedis._Paced(http, "tok", 0), "1", FIRST, LAST + timedelta(days=1))


def test_peaks_read_the_stored_maximum_in_kva_whatever_the_raw_unit(clean):
    """#567: 59 648 « pics impossibles » on the first real report. The collector converts the VA of
    the answer to kVA and keeps « VA » in `pmax_unit` (the raw unit); the check took the kVA values
    for VA, a limit of a few watts, and flagged almost every hour and half hour."""
    _pmax_as_collected(clean, 2500)
    store = save(clean)
    linky = store.doc("linky")
    assert linky["pmax_unit"] == "VA" and linky["pmax"]["2024-03-12"] == 2.54  # the real form
    assert found(store) == {}
    # A real peak still is one: 2.5 kVA cannot draw 4 kWh in an hour.
    store.put("2024.hourly", "hourly", A, "2024-03-12T19", 4000.0)
    f = found(save(store))
    assert [x.at for x in f["pic-impossible"]] == ["2024-03-12T19"]
    assert f["pic-impossible"][0].other == 2540 and f["pic-impossible"][0].unit == "W"


def test_maximum_values_are_reported_in_kva_whatever_the_raw_unit(clean):
    """#567: the report says the unit of the stored values (kVA), not the raw unit of the answer."""
    _pmax_as_collected(clean, 2500)
    a = au.Audit.of(clean, au.read_docs(save(clean).dir, PASSPHRASE))
    assert a.unit_of(au.SERIES_LABEL[("linky", "pmax")]) == "kVA"


def test_peak_above_any_home_without_maximum(clean):
    clean.put("2024.hourly", "hourly", A, "2024-03-12T10", 40_000.0)
    f = found(save(clean))
    assert {"pic-impossible", "somme-jour"} <= set(f)
    assert "36 kVA" in f["pic-impossible"][0].text


def test_meter_index_going_back(clean):
    for d, v in (("2024-03-10", 1_000_000), ("2024-03-11", 1_010_000), ("2024-03-12", 1_005_000)):
        clean.put("linky", "index", "total", d, v)
    f = found(save(clean))
    assert set(f) == {"compteur-recule"}
    assert (f["compteur-recule"][0].day, f["compteur-recule"][0].value) == ("2024-03-12", 1_005_000)


# ---------------------------------------------------------------- guards (each seen red with its mutation)
def bare(real=None, docs=None) -> au.Audit:
    return au.Audit(docs or {}, TZ, "2024-04-30", {}, real)


class FakeReport:
    def __init__(self, intuis: dict[str, float], linky: dict[str, float]):
        self.real_wh, self.linky = intuis, linky


def test_linky_lag_needs_the_shift_to_remove_most_days():
    """Above the meter 4 days at 0, still 2 with a day of shift: not a shift (4 x 2 > 4)."""
    days = [f"2024-03-{d:02d}" for d in range(1, 16)]
    intuis = dict.fromkeys(days, 5000.0)
    linky = dict.fromkeys(days, 9000.0)
    for d in ("2024-03-03", "2024-03-06", "2024-03-09", "2024-03-12"):
        linky[d] = 1000.0  # above at lag 0 on these days; the neighbours of two of them too
    linky["2024-03-02"] = 1000.0
    linky["2024-03-08"] = 1000.0
    a = bare(FakeReport(intuis, linky))
    a.linky_lag()
    assert a.findings == []


def test_a_curve_key_between_two_half_hours(clean):
    clean.put("2024.linky30", "curve", "2024-03-12T10:15", None, 50.0)
    f = found(save(clean))
    assert "cle-invalide" in f and f["cle-invalide"][0].at == "2024-03-12T10:15"


def test_a_small_gain_of_correlation_is_not_a_shift(clean, monkeypatch):
    """Lags -2..2 in order: the best (+1) only 0.05 above lag 0, under gain_correlation."""
    values = iter([0.5, 0.55, 0.6, 0.65, 0.5] * 10)
    monkeypatch.setattr(au, "_pearson", lambda pairs: next(values))
    a = au.Audit.of(clean, au.read_docs(clean.dir, PASSPHRASE))
    a.hours_vs_linky()
    assert a.findings == []


def test_a_plug_equal_to_a_room_half_the_days_is_not_the_same_energy(tmp_path):
    store = build(tmp_path, plug_like_water=True)
    days = sorted(store.doc("shelly")["daily"]["p0"])
    for d in days[::2]:
        store.put("shelly", "daily", "p0", d, 500.0 + len(d))
    assert "deux-sources" not in found(save(store))


# ---------------------------------------------------------------- robustness
def test_an_unexpected_structure_or_file_does_not_stop_the_report(tmp_path, monkeypatch, capsys):
    data = tmp_path / "data"
    store = build(data)
    store.doc("2024.hourly")["hourly"][W] = 5  # a number where a room's hours are expected
    store._dirty.add("2024.hourly")
    store.save(store.meta["home"], store.meta["rooms"])
    out = run_cli(data, monkeypatch, capsys, "--rapport", str(tmp_path / "rapport"))
    assert "Bilan qualité des données" in out and "Audit des données (#532)" in out
    assert re.search(r"Non vérifié : [^:]+ : AttributeError\.", out), out
    assert (tmp_path / "rapport" / au.REPORT_NAME).exists()
    assert not re.search(r"\d{4}-\d{2}-\d{2}", out)


def test_an_unreadable_file_is_named_and_the_others_are_audited(clean):
    (clean.dir / "linky.enc.json").write_text("pas une enveloppe")
    a = au.audit(Store(clean.dir, PASSPHRASE))
    assert a.errors == ["linky.enc.json illisible : JSONDecodeError"]
    assert "2024" in a.docs


def test_an_audit_that_fails_leaves_the_quality_report(clean, monkeypatch, capsys):
    def boom(_store):
        raise RuntimeError("valeur secrète 7777")

    monkeypatch.setattr(au, "audit", boom)
    out = run_cli(clean.dir, monkeypatch, capsys)
    assert "Bilan qualité des données" in out
    assert "Audit des données (#532) : impossible (RuntimeError)" in out and "7777" not in out


def test_an_audit_that_fails_says_why_there_is_no_report(clean, monkeypatch, capsys):
    """#550: with --rapport (the Diagnostic workflow), the step fails here and says the report is
    missing because the audit failed, instead of a later upload error that says nothing."""

    def boom(_store):
        raise RuntimeError("valeur secrète 7777")

    monkeypatch.setattr(au, "audit", boom)
    with pytest.raises(SystemExit) as exc:
        run_cli(clean.dir, monkeypatch, capsys, "--rapport", str(clean.dir / "rapport"))
    why = str(exc.value.code)
    assert "Audit des données : impossible (RuntimeError)" in why and au.REPORT_NAME in why
    assert "7777" not in why
    assert "Bilan qualité des données" in capsys.readouterr().out  # the quality report is printed first


def test_a_plug_off_then_used_is_not_a_unit(clean):
    """A few Wh of standby for weeks, then real use: the neighbours are too small to judge a unit."""
    for i in range(1, 31):
        clean.put("shelly", "daily", "p0", f"2024-03-{i:02d}", 2.0 + (i % 3) * 0.1)
    clean.put("shelly", "daily", "p0", "2024-03-15", 900.0)  # used once
    assert "unite" not in found(save(clean))


# Revue de fin de v2.2: the demo's generator drew the hours and the days independently (97
# `somme-jour`) and wrote the hour skipped by the spring change (10 `heure-inexistante`). The demo
# shows the audit to anyone who tries the app: it must be clean, but for one frozen reading drawn by
# chance (a bedroom at 17.9 °C five days in a row: the kind of case `valeur-figee` is there to show).
DEMO_TODAY = date(2026, 11, 9)  # the day the published demo was generated (--today)
DEMO_EXPECTED = {"valeur-figee": 1}


@pytest.mark.parametrize("where", ["generated", "generated-va", "published"])
def test_the_demo_audits_clean(tmp_path, where):
    if where.startswith("generated"):
        from collector import demo

        demo.generate(tmp_path, today=DEMO_TODAY)
        store = Store(tmp_path, "demo")
        if where == "generated-va":  # #567: the raw unit of a real archive (the Conso API contract)
            assert store.doc("linky")["pmax"]
            store.set_top("linky", "pmax_unit", "VA")
            store.save(store.meta["home"], store.meta["rooms"])
            store = Store(tmp_path, "demo")
    else:
        store = Store(Path(__file__).resolve().parents[1] / "web" / "public" / "demo", "demo")
    hours = store.doc("2026.hourly")["hourly"]["r-salon"]
    assert "2026-03-29T01" in hours and "2026-03-29T03" in hours  # the spring day was compared
    assert sum(1 for k in hours if k >= "2026-10-01") > 500  # and the fire evenings of October
    counts = {code: sum(by.values()) for code, by in au.audit(store).counts().items()}
    assert {code: n for code, n in counts.items() if n} == DEMO_EXPECTED
