"""S-1.17 (Shelly plugs through the Shelly Cloud) and S-1.18 (Home Assistant import)."""

import argparse
import json
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import pytest

from collector import shelly
from collector.budget import METER
from collector.config import Settings
from collector.homeassistant import ImportFormatError, import_file, parse
from collector.schema import FormatError
from collector.storage import Store

TZ = "Europe/Paris"
KEY = "SECRETKEY123"
DEV_FRIDGE = "a0b1c2d3e4f5"
DEV_GEN1 = "1a2b3c"
DEV_SENSOR = "ffeedd"
DEV_POWER_ONLY = "998877"


@pytest.fixture(autouse=True)
def _fresh_meter():
    METER.reset()
    yield
    METER.reset()


def ts(day: str, hh: int = 5) -> int:
    return int(datetime.fromisoformat(f"{day}T{hh:02d}:00").replace(tzinfo=ZoneInfo(TZ)).timestamp())


def cloud(totals: dict, *, online=None, listing=True, status_code=200, calls=None):
    """Mock Shelly Cloud: device list, all_status fallback and v2 state."""
    online = online or {}

    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request)
        if status_code != 200:
            return httpx.Response(status_code, json={"error": "UNAUTHORIZED"})
        path = request.url.path
        if path == "/interface/device/list":
            if not listing:
                return httpx.Response(404)
            devices = {
                DEV_FRIDGE: {"id": DEV_FRIDGE, "name": "Réfrigérateur", "type": "SNPL-00112EU", "gen": 2},
                DEV_GEN1: {"id": DEV_GEN1, "name": "Lave-linge", "type": "SHPLG-S", "gen": 1},
                DEV_SENSOR: {"id": DEV_SENSOR, "name": "Porte", "type": "SHDW-2"},
                DEV_POWER_ONLY: {"id": DEV_POWER_ONLY, "name": "Box", "type": "X"},
            }
            return httpx.Response(200, json={"isok": True, "data": {"devices": devices}})
        if path == "/device/all_status":
            return httpx.Response(200, json={"isok": True, "data": {"devices_status": {DEV_FRIDGE: {}, DEV_GEN1: {}}}})
        if path == "/v2/devices/api/get":
            body = json.loads(request.content)
            out = []
            for did in body["ids"]:
                t = totals.get("ts", 1_700_000_000)
                if did == DEV_FRIDGE:
                    status = {
                        "sys": {"unixtime": t, "uptime": 1000},
                        "switch:0": {"apower": 80.0, "aenergy": {"total": totals[DEV_FRIDGE]}},
                    }
                elif did == DEV_GEN1:
                    status = {"unixtime": t, "meters": [{"power": 0, "total": totals[DEV_GEN1]}]}
                elif did == DEV_POWER_ONLY:
                    status = {"switch:0": {"apower": 12.0}}
                else:
                    status = {"sensor": {"state": "close"}}
                out.append({"id": did, "gen": "G2", "online": online.get(did, 1), "status": status})
            return httpx.Response(200, json=out)
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def run(store, totals, **kw):
    return shelly.collect(store, KEY, "shelly-103-eu.shelly.cloud", TZ, http=cloud(totals, **kw), min_interval=0)


def test_server_must_be_a_shelly_cloud_host():
    assert shelly.server_url("https://shelly-103-eu.shelly.cloud/") == "https://shelly-103-eu.shelly.cloud"
    assert shelly.server_url("shelly-103-eu.shelly.cloud") == "https://shelly-103-eu.shelly.cloud"
    for bad in ("evil.example.com", "shelly.cloud.evil.com", "https://x.shelly.cloud.evil"):
        with pytest.raises(shelly.ShellyError):
            shelly.server_url(bad)


def test_spread_splits_energy_across_local_days():
    parts = shelly.spread(ts("2025-01-10", 18), ts("2025-01-11", 6), 1200.0, TZ)
    assert parts == pytest.approx({"2025-01-10": 600.0, "2025-01-11": 600.0})


def test_daily_energy_from_counter_differences_with_reset_and_gap(tmp_path):
    store = Store(tmp_path, "pw")
    # 1st night: baseline only. Fridge Wh, Gen1 plug in watt-minutes.
    counts = run(store, {"ts": ts("2025-01-10"), DEV_FRIDGE: 10_000.0, DEV_GEN1: 60_000.0})
    assert counts == {"plugs": 3, "readings": 2, "offline": 0, "unusable": 1}
    doc = store.doc("shelly")
    assert {p["name"] for p in doc["plugs"].values()} == {"Réfrigérateur", "Lave-linge", "Box"}
    assert not doc.get("daily")
    fridge = next(k for k, p in doc["plugs"].items() if p["id"] == DEV_FRIDGE)
    gen1 = next(k for k, p in doc["plugs"].items() if p["id"] == DEV_GEN1)
    box = next(k for k, p in doc["plugs"].items() if p["id"] == DEV_POWER_ONLY)
    assert doc["plugs"][box]["usable"] is False

    # 2nd night, 24 h later: 1.2 kWh for the fridge, 600 watt-minutes = 10 Wh for the washer.
    run(store, {"ts": ts("2025-01-11"), DEV_FRIDGE: 11_200.0, DEV_GEN1: 60_600.0})
    daily = doc["daily"][fridge]
    assert sum(daily.values()) == pytest.approx(1200, abs=0.2)
    assert daily["2025-01-10"] == pytest.approx(1200 * 19 / 24, abs=0.2)  # 05:00 → midnight
    assert sum(doc["daily"][gen1].values()) == pytest.approx(10, abs=0.2)
    assert doc["until"][fridge] == "2025-01-11"

    # Reset (reboot): the counter restarts, only what was counted since is added (estimated).
    run(store, {"ts": ts("2025-01-12"), DEV_FRIDGE: 300.0, DEV_GEN1: 61_200.0})
    assert sum(daily.values()) == pytest.approx(1500, abs=0.3)
    assert "2025-01-11" in doc["estimated"][fridge]

    # Offline: no reading; the next one covers 2 days, spread and flagged estimated.
    run(store, {"ts": ts("2025-01-13"), DEV_FRIDGE: 9_999.0, DEV_GEN1: 0}, online={DEV_FRIDGE: 0, DEV_GEN1: 0})
    run(store, {"ts": ts("2025-01-14"), DEV_FRIDGE: 2_700.0, DEV_GEN1: 61_200.0})
    assert sum(daily.values()) == pytest.approx(3900, abs=0.5)
    assert doc["estimated"][fridge].get("2025-01-13") == 1


def test_device_list_fallback_and_auth_error_never_leak_the_key(tmp_path):
    store = Store(tmp_path, "pw")
    counts = run(store, {"ts": ts("2025-01-10"), DEV_FRIDGE: 1.0, DEV_GEN1: 1.0}, listing=False)
    assert counts["plugs"] == 2
    calls: list = []
    with pytest.raises(shelly.ShellyError) as err:
        run(store, {}, status_code=401, calls=calls)
    assert err.value.auth and KEY not in str(err.value)
    assert all(KEY not in str(c.url) for c in calls)  # list call: key in the form body, not the URL


def test_unreachable_host_message_has_no_url(tmp_path):
    def boom(request):
        raise httpx.ConnectError(f"failed {request.url}")

    with pytest.raises(shelly.ShellyError) as err:
        shelly.collect(
            Store(tmp_path, "pw"),
            KEY,
            "a.shelly.cloud",
            TZ,
            http=httpx.Client(transport=httpx.MockTransport(boom)),
            min_interval=0,
        )
    assert KEY not in str(err.value) and "ConnectError" in str(err.value)


def test_v2_format_change_is_reported(tmp_path):
    def handler(request):
        if request.url.path == "/interface/device/list":
            return httpx.Response(200, json={"isok": True, "data": {"devices": {DEV_FRIDGE: {}}}})
        return httpx.Response(200, json={"devices": []})

    with pytest.raises(FormatError) as err:
        shelly.collect(
            Store(tmp_path, "pw"),
            KEY,
            "a.shelly.cloud",
            TZ,
            http=httpx.Client(transport=httpx.MockTransport(handler)),
            min_interval=0,
        )
    assert "v2/devices/api/get" in str(err.value)


def test_sync_records_shelly_failure_without_breaking_and_skips_when_unconfigured(tmp_path, monkeypatch, capsys):
    import collector.__main__ as main

    sources = main.Sources(None)
    store = Store(tmp_path, "pw")
    monkeypatch.setattr(
        shelly, "collect", lambda *a, **k: (_ for _ in ()).throw(shelly.ShellyError("Shelly : x", auth=True))
    )
    main._shelly(Settings(shelly_auth_key=KEY, shelly_server="a.shelly.cloud"), store, TZ, sources)
    assert sources.state["shelly"]["auth_expired"] is True
    assert sources.state["shelly"]["credential"] != KEY
    assert KEY not in capsys.readouterr().out
    assert any("SHELLY_AUTH_KEY" in a for a in sources.alerts())


# ---------------------------------------------------------------- Home Assistant
def history_json():
    def st(entity, state, t, attrs=None):
        d = {"entity_id": entity, "state": state, "last_changed": t}
        if attrs:
            d["attributes"] = attrs
        return d

    window = [
        st("binary_sensor.fenetre_salon", "off", "2025-01-09T22:00:00+00:00", {"device_class": "window"}),
        st("binary_sensor.fenetre_salon", "on", "2025-01-10T07:00:00+00:00"),
        st("binary_sensor.fenetre_salon", "off", "2025-01-10T07:30:00+00:00"),
        st("binary_sensor.fenetre_salon", "on", "2025-01-10T12:00:00+00:00"),
        st("binary_sensor.fenetre_salon", "off", "2025-01-10T13:00:00+00:00"),
        st("binary_sensor.fenetre_salon", "off", "2025-01-12T01:00:00+00:00"),
    ]
    energy = [
        {"entity_id": "sensor.prise_frigo_energy", "state": "100.0", "last_changed": "2025-01-09T22:30:00+00:00",
         "attributes": {"unit_of_measurement": "kWh", "device_class": "energy"}},
        {"state": "101.0", "last_changed": "2025-01-10T22:30:00+00:00"},  # minimal_response
        {"state": "102.5", "last_changed": "2025-01-11T22:30:00+00:00"},
        {"state": "unavailable", "last_changed": "2025-01-12T02:00:00+00:00"},
        {"state": "103.0", "last_changed": "2025-01-12T22:30:00+00:00"},
    ]  # fmt: skip
    temp = [
        st("sensor.sonde_chambre", "18.0", "2025-01-09T22:10:00+00:00", {"unit_of_measurement": "°C"}),
        st("sensor.sonde_chambre", "19.0", "2025-01-10T06:00:00+00:00"),
        st("sensor.sonde_chambre", "21.0", "2025-01-10T18:00:00+00:00"),
        st("sensor.sonde_chambre", "20.0", "2025-01-11T23:30:00+00:00"),
    ]
    return [window, energy, temp]


def test_import_history_json_daily_aggregates(tmp_path):
    f = tmp_path / "export.json"
    f.write_text(json.dumps(history_json()))
    store = Store(tmp_path / "data", "pw")
    counts = import_file(store, f, TZ)
    assert counts == {"sensors": 3, "days": 5, "skipped": 0}
    doc = store.doc("ha")
    by_entity = {v["entity"]: k for k, v in doc["sensors"].items()}
    w = by_entity["binary_sensor.fenetre_salon"]
    assert doc["sensors"][w]["kind"] == "opening"
    assert doc["daily"][w]["2025-01-10"] == {"on_h": 1.5, "n": 2}
    assert doc["daily"][w]["2025-01-11"] == {"on_h": 0.0, "n": 0}
    e = by_entity["sensor.prise_frigo_energy"]
    assert doc["sensors"][e]["kind"] == "energy"
    assert doc["daily"][e]["2025-01-11"]["kwh"] == pytest.approx(1.5, abs=0.05)  # spread in proportion to time
    t = by_entity["sensor.sonde_chambre"]
    assert doc["daily"][t] == {"2025-01-10": {"min": 19.0, "max": 21.0, "mean": 20.0}}


def test_import_csv_and_statistics_and_errors_never_quote_content(tmp_path):
    csv_file = tmp_path / "history.csv"
    csv_file.write_text(
        "entity_id,state,last_changed\n"
        "binary_sensor.porte_entree,off,2025-01-09T20:00:00Z\n"
        "binary_sensor.porte_entree,on,2025-01-10T10:00:00Z\n"
        "binary_sensor.porte_entree,off,2025-01-10T10:06:00Z\n"
        "binary_sensor.porte_entree,off,2025-01-11T23:30:00Z\n"
    )
    store = Store(tmp_path / "data", "pw")
    assert import_file(store, csv_file, TZ)["sensors"] == 1
    stats = tmp_path / "stats.json"
    stats.write_text(
        json.dumps(
            {
                "units": {"sensor.compteur": "Wh"},
                "statistics": {
                    "sensor.compteur": [
                        {"start": 1736463600000, "sum": 1000.0},
                        {"start": 1736550000000, "sum": 3000.0, "change": 2000.0},
                    ],
                    "sensor.temp": [{"start": "2025-01-10T00:00:00+01:00", "mean": 19.5, "min": 18.0, "max": 21.0}],
                },
            }
        )
    )
    assert import_file(store, stats, TZ)["sensors"] == 2
    doc = store.doc("ha")
    k = next(k for k, v in doc["sensors"].items() if v["entity"] == "sensor.compteur")
    assert doc["daily"][k]["2025-01-11"] == {"kwh": 2.0}
    # Errors: positions only, never the content.
    for content in ("entity_id,state\nsecret.value,1\n", '[{"entity_id": "Secret Name!", "state": "1"}]', "{oops"):
        with pytest.raises(ImportFormatError) as err:
            parse(content.encode())
        assert "Secret" not in str(err.value) and "secret" not in str(err.value)


def test_cmd_import_ha_writes_encrypted_doc_and_prints_counts_only(tmp_path, capsys):
    import collector.__main__ as main

    data = tmp_path / "data"
    store = Store(data, "pw")
    store.save(
        {"id": "h", "name": "Maison", "timezone": TZ}, [], {"has_linky": True, "sources": {"intuis": {"ok": "x"}}}
    )
    f = tmp_path / "export.json"
    f.write_text(json.dumps(history_json()))
    main.cmd_import_ha(Settings(passphrase="pw", data_dir=data), argparse.Namespace(file=str(f), dry_run=False))
    out = capsys.readouterr().out
    assert "3 capteurs" in out and "fenetre" not in out and "frigo" not in out
    store = Store(data, "pw")
    assert store.meta["has_ha"] and store.meta["has_linky"] and "home-assistant" in store.meta["sources"]
    assert store.doc("ha")["daily"]
    assert "fenetre" not in (data / "ha.enc.json").read_text()


def test_imported_document_follows_the_published_schema(tmp_path):
    jsonschema = pytest.importorskip("jsonschema")
    from pathlib import Path

    f = tmp_path / "export.json"
    f.write_text(json.dumps(history_json()))
    store = Store(tmp_path / "data", "pw")
    import_file(store, f, TZ)
    schema = json.loads((Path(__file__).parent.parent / "docs" / "import-ha.schema.json").read_text())
    jsonschema.validate(store.doc("ha"), schema)
