"""E13: probe of history types (S-13.1), hourly room states (S-13.2, S-13.4, S-13.6), minimisation (S-13.5)."""

import argparse
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from collector import roomstate
from collector.api import IntuisClient
from collector.budget import METER
from collector.config import Settings
from collector.crypto import decrypt_json
from collector.storage import Store

FIX = Path(__file__).parent / "fixtures"
SETTINGS = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
TZ = "Europe/Paris"
PARIS = ZoneInfo(TZ)


@pytest.fixture(autouse=True)
def _fresh_meter():
    METER.reset()
    yield
    METER.reset()


def load(name):
    return json.loads((FIX / name).read_text())


def status(open_window=False, boost="disabled", mode="schedule", radiator="idle", offload=False, presence=True):
    rooms = [
        {
            "id": "100",
            "name": "Salon",
            "open_window": open_window,
            "presence": presence,
            "boost_status": boost,
            "therm_setpoint_mode": mode,
            "therm_measured_temperature": 19.5,
            "therm_setpoint_end_time": 1700000000,
        },
        {"id": "200", "open_window": False, "therm_setpoint_mode": "away", "presence": False},
    ]
    modules = [
        {"id": "m1", "type": "NMH", "radiator_state": radiator, "offload": offload, "reachable": True},
        {"id": "wh", "type": "NMW", "contactor_mode": "Auto"},
    ]
    return {"body": {"home": {"id": "home1", "rooms": rooms, "modules": modules}}}


def ts(day: str, hour: int) -> int:
    y, m, d = map(int, day.split("-"))
    return int(datetime(y, m, d, hour, 23, tzinfo=PARIS).timestamp())


MOD_ROOM = {"m1": "100", "wh": "300"}


# ---------------------------------------------------------------- snapshot (S-13.2, S-13.5)
def test_snapshot_keeps_only_whitelisted_fields_and_never_presence_by_default():
    snap = roomstate.snapshot(status(open_window=True), 1700000000)
    assert snap["rooms"]["100"] == {"open_window": True, "boost_status": "disabled", "therm_setpoint_mode": "schedule"}
    assert snap["modules"]["m1"] == {"radiator_state": "idle", "offload": False}
    assert snap["modules"]["wh"] == {"contactor_mode": "auto"}
    text = json.dumps(snap)
    for absent in ("presence", "Salon", "19.5", "therm_setpoint_end_time", "home1"):
        assert absent not in text
    with_presence = roomstate.snapshot(status(), 1700000000, presence=True)
    assert with_presence["rooms"]["100"]["presence"] is True


def test_norm_turns_free_text_into_an_identifier_or_autre():
    assert roomstate.norm("Frost-Guard") == "frost_guard"
    assert roomstate.norm("Chambre de Léa") == "autre"
    assert roomstate.norm(3) == 3 and roomstate.norm(None) is None


def test_is_on():
    assert roomstate.is_on(True) and roomstate.is_on("heating") and roomstate.is_on(40)
    for off in (False, None, 0, "off", "disabled", "idle", "", "stand_by"):
        assert not roomstate.is_on(off)


def test_snapshot_is_encrypted_and_read_back(tmp_path):
    store = Store(tmp_path / "data", "pw")
    snap = roomstate.snapshot(status(), 1700000000, calls=2)
    path = roomstate.write_snapshot(tmp_path / "out", snap, "pw", store.salt, 1000)
    raw = path.read_text()
    assert "open_window" not in raw
    assert set(json.loads(raw)) == {"v", "kdf", "iter", "salt", "iv", "ct"}
    (tmp_path / "out" / "etat-bad.enc.json").write_text("{}")
    snaps, bad = roomstate.read_snapshots(tmp_path / "out", "pw")
    assert snaps == [snap] and bad == 1
    assert roomstate.read_snapshots(tmp_path / "out", "other")[1] == 2


# ---------------------------------------------------------------- daily aggregate
def test_merge_counts_hours_pro_rata_and_skips_today_and_duplicates(tmp_path):
    store = Store(tmp_path, "pw")
    day = "2025-01-15"
    snaps = []
    for h in range(24):
        if h in (3, 4):  # two missed cron runs
            continue
        boost = "enabled" if h == 18 else "disabled"
        s = status(open_window=h in (10, 11), boost=boost, radiator="heating" if h < 6 else "idle", offload=h == 19)
        snaps.append(roomstate.snapshot(s, ts(day, h), calls=2))
    snaps.append(roomstate.snapshot(status(open_window=True), ts(day, 10) + 600))  # same hour: once
    snaps.append(roomstate.snapshot(status(), ts("2025-01-16", 1)))  # day not over: next night
    stats = roomstate.merge_snapshots(store, snaps, TZ, MOD_ROOM, today="2025-01-16")
    assert stats == {"snapshots": 24, "added": 22, "duplicates": 1, "pending": 1, "days": 1, "calls": 44}
    cell = store.doc("roomstate")["rooms"]["100"][day]
    # 2 of 22 snapshots with the window open -> 2 × 24 / 22 h
    assert cell["n"] == 22
    assert cell["open_window_h"] == round(2 * 24 / 22, 1)
    assert cell["boost_h"] == round(24 / 22, 1)
    assert cell["heating_h"] == round(4 * 24 / 22, 1)  # hours 0, 1, 2, 5
    assert cell["offload_h"] == round(24 / 22, 1)
    assert "mode_h" not in cell and "presence_h" not in cell
    assert store.doc("roomstate")["rooms"]["200"][day]["mode_h"] == {"away": 24.0}
    assert store.doc("roomstate")["rooms"]["300"][day]["contactor_h"] == {"auto": 24.0}
    assert bin(store.doc("roomstate")["seen"][day]).count("1") == 22
    assert store.doc("roomstate")["values"]["radiator_state"] == ["heating", "idle"]
    # Read again the next night (artifact not expired yet): nothing changes.
    again = roomstate.merge_snapshots(store, snaps, TZ, MOD_ROOM, today="2025-01-17")
    assert again["added"] == 1 and again["duplicates"] == 23  # only the 16th, now complete
    assert store.doc("roomstate")["rooms"]["100"][day] == cell


def test_late_snapshot_completes_a_day_already_aggregated(tmp_path):
    store = Store(tmp_path, "pw")
    day = "2025-03-03"
    first = [roomstate.snapshot(status(open_window=h == 8), ts(day, h)) for h in range(12)]
    roomstate.merge_snapshots(store, first, TZ, MOD_ROOM, today="2025-03-04")
    assert store.doc("roomstate")["rooms"]["100"][day]["open_window_h"] == 2.0  # 1 of 12
    late = [roomstate.snapshot(status(open_window=h == 20), ts(day, h)) for h in range(12, 24)]
    roomstate.merge_snapshots(store, late, TZ, MOD_ROOM, today="2025-03-05")
    cell = store.doc("roomstate")["rooms"]["100"][day]
    assert cell["n"] == 24 and cell["open_window_h"] == 2.0  # 2 of 24


def test_daylight_saving_day_has_23_hours(tmp_path):
    assert roomstate.day_hours("2025-03-30", TZ) == 23
    assert roomstate.day_hours("2025-10-26", TZ) == 25
    store = Store(tmp_path, "pw")
    day = "2025-03-30"
    snaps = [roomstate.snapshot(status(open_window=True), ts(day, h)) for h in range(24) if h != 2]
    roomstate.merge_snapshots(store, snaps, TZ, MOD_ROOM, today="2025-03-31")
    assert store.doc("roomstate")["rooms"]["100"][day]["open_window_h"] == 23.0


def test_presence_only_with_opt_in_and_only_daily(tmp_path):
    snaps = [roomstate.snapshot(status(presence=h >= 18), ts("2025-01-15", h), presence=True) for h in range(24)]
    off = Store(tmp_path / "a", "pw")
    roomstate.merge_snapshots(off, snaps, TZ, MOD_ROOM, today="2025-01-16")
    assert "presence" not in json.dumps(off.doc("roomstate"))
    on = Store(tmp_path / "b", "pw")
    roomstate.merge_snapshots(on, snaps, TZ, MOD_ROOM, today="2025-01-16", presence=True)
    assert on.doc("roomstate")["rooms"]["100"]["2025-01-15"]["presence_h"] == 6.0
    assert "values" in on.doc("roomstate") and "presence" not in on.doc("roomstate")["values"]


def test_module_rooms_and_coverage(tmp_path):
    raw = load("homesdata.json")
    mapping = roomstate.module_rooms(raw, {"wh": "300"})
    assert mapping["wh"] == "300"
    assert all(isinstance(k, str) and isinstance(v, str) for k, v in mapping.items())
    store = Store(tmp_path, "pw")
    roomstate.merge_snapshots(
        store, [roomstate.snapshot(status(), ts("2025-01-15", h)) for h in range(12)], TZ, {}, today="2025-01-16"
    )
    assert roomstate.coverage(store, "2025-01-16") == (12, 168)


# ---------------------------------------------------------------- end to end: snapshot command + nightly sync
def intuis_handler(calls):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        calls.append(path)
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=load("homesdata.json"))
        if path == "/api/gethomemeasure":
            return httpx.Response(200, json=load("gethomemeasure.json"))
        if path == "/syncapi/v1/homestatus":
            return httpx.Response(200, json=status(open_window=True))
        return httpx.Response(404)

    return handler


def client_of(calls):
    return IntuisClient(
        SETTINGS, http=httpx.Client(transport=httpx.MockTransport(intuis_handler(calls))), min_interval=0
    )


def test_snapshot_command_makes_one_homestatus_request_and_writes_nothing_in_data(tmp_path, monkeypatch, capsys):
    from collector import __main__ as cli

    calls: list[str] = []
    data = tmp_path / "data"
    store = Store(data, "pw")
    store.merge("100", "2025-01-01", 1.0)
    store.save({"id": "home1", "name": "Maison", "timezone": TZ}, [])
    before = sorted(p.name for p in data.iterdir())
    client = IntuisClient(
        SETTINGS, http=httpx.Client(transport=httpx.MockTransport(intuis_handler(calls))), min_interval=0
    )
    monkeypatch.setattr(cli, "_client", lambda s: client)
    s = Settings(passphrase="pw", data_dir=data)
    cli.cmd_snapshot(s, argparse.Namespace(out=str(tmp_path / "out")))
    assert calls == ["/oauth2/token", "/syncapi/v1/homestatus"]  # home id from the encrypted meta
    assert sorted(p.name for p in data.iterdir()) == before
    (f,) = (tmp_path / "out").iterdir()
    snap = decrypt_json(json.loads(f.read_text()), "pw")
    assert snap["calls"] == 2 and snap["rooms"]["100"]["open_window"] is True
    out = capsys.readouterr().out
    assert "home1" not in out and "100" not in out


def test_nightly_sync_aggregates_snapshots_and_reports_counts_only(tmp_path, monkeypatch, capsys):
    from collector import __main__ as cli

    calls: list[str] = []
    data = tmp_path / "data"
    store = Store(data, "pw")
    folder = tmp_path / "etat" / "123"
    yesterday = (datetime.now(PARIS).date().toordinal()) - 1
    day = datetime.fromordinal(yesterday).date().isoformat()
    for h in range(20):
        roomstate.write_snapshot(
            folder, roomstate.snapshot(status(open_window=h < 2), ts(day, h), calls=2), "pw", store.salt, 1000
        )
    client = IntuisClient(
        SETTINGS, http=httpx.Client(transport=httpx.MockTransport(intuis_handler(calls))), min_interval=0
    )
    monkeypatch.setattr(cli, "_client", lambda s: client)
    monkeypatch.setenv("ROOM_STATE_DIR", str(tmp_path / "etat"))
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    cli.cmd_sync(Settings(passphrase="pw", data_dir=data), argparse.Namespace(days=10))
    out = capsys.readouterr().out
    assert "Relevé horaire : 20 relevés lus, 20 ajoutés" in out
    assert "Appels API intuis-horaire : 40" in out
    after = Store(data, "pw")
    assert after.meta["has_roomstate"] is True
    assert after.meta["sources"]["releve-horaire"]["note"].startswith("20 relevés sur 168 heures")
    rooms = after.doc("roomstate")["rooms"]
    assert rooms["100"][day]["open_window_h"] == round(2 * 24 / 20, 1)
    text = summary.read_text()
    assert "Relevé horaire des pièces | 20 relevés sur 168 heures" in text
    for leak in ("Salon", "home1"):
        assert leak not in out and leak not in text


def test_nightly_sync_without_snapshots_flags_the_source(tmp_path, monkeypatch):
    from collector import __main__ as cli

    client = IntuisClient(
        SETTINGS, http=httpx.Client(transport=httpx.MockTransport(intuis_handler([]))), min_interval=0
    )
    monkeypatch.setattr(cli, "_client", lambda s: client)
    monkeypatch.setenv("ROOM_STATE_DIR", str(tmp_path / "absent"))
    cli.cmd_sync(Settings(passphrase="pw", data_dir=tmp_path / "data"), argparse.Namespace(days=10))
    st = Store(tmp_path / "data", "pw").meta["sources"]["releve-horaire"]
    assert "aucun relevé" in st["message"]


# ---------------------------------------------------------------- S-13.1 probe
def test_probe_history_prints_accepted_refused_and_point_counts_only(capsys):
    from collector.diagnose import probe_history

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=load("homesdata.json"))
        if path == "/api/gethomemeasure":
            mtype = json.loads(request.content)["home"]["rooms"][0]["type"]
            if mtype == "open_window":
                rooms = [{"id": "100", "measures": [{"beg_time": 1, "step_time": 3600, "value": [[1], [None], [0]]}]}]
                return httpx.Response(200, json={"body": {"home": {"rooms": rooms}}})
            return httpx.Response(400, json={"error": {"code": 21, "message": "Invalid type sum_boost 4521"}})
        if path == "/api/getroommeasure":
            return httpx.Response(200, json={"body": {"1700000000": [17.5], "1700003600": [None]}})
        return httpx.Response(404)

    client = IntuisClient(SETTINGS, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)
    res = probe_history(client, types=("open_window", "sum_boost"))
    assert res["open_window"] == ("accepté, 2 points", "accepté, 1 points")
    assert res["sum_boost"][0] == "refusé (HTTP 400)"
    out = capsys.readouterr().out
    assert "historique possible avec open_window" in out
    for leak in ("17.5", "4521", "Invalid", "1700000000", "Salon", "100 "):
        assert leak not in out
