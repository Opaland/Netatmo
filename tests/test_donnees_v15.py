"""v1.5 data additions: #214 (modules not answering), #215 (station batteries), #216 (firmware),
#218 (anticipation / lowering hours), #219 (time of the Linky peak), #276 (gateway restarts and
Wi-Fi), #277 (Linky index per rate period), #278 (contract and Tempo colour seen by Intuis),
#279 (Shelly clamp meters, one series per channel). Every source is simulated."""

import argparse
import json
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from collector import devices, enedis, roomstate, shelly
from collector.api import IntuisClient
from collector.budget import METER
from collector.config import Settings
from collector.station import Station, health_note, store_health
from collector.storage import Store

FIX = Path(__file__).parent / "fixtures"
TZ = "Europe/Paris"
PARIS = ZoneInfo(TZ)
SETTINGS = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
PRM = "12345678901234"


@pytest.fixture(autouse=True)
def _fresh_meter():
    METER.reset()
    yield
    METER.reset()


def at(day: str, hour: int, minute: int = 0) -> int:
    y, m, d = map(int, day.split("-"))
    return int(datetime(y, m, d, hour, minute, tzinfo=PARIS).timestamp())


def homestatus(
    *,
    reachable=True,
    uptime=3600,
    wifi=60,
    color="blue",
    fw="105",
    anticipating=False,
    lowering=False,
    last_seen=None,
):
    rooms = [
        {"id": "100", "name": "Salon", "open_window": False, "anticipating": anticipating, "lowering": lowering},
        {"id": "300", "name": "Chauffe-eau"},
    ]
    modules = [
        {
            "id": "gw",
            "type": "NMG",
            "name": "Passerelle Dupont",
            "uptime": uptime,
            "wifi_strength": wifi,
            "therm_setpoint_day_color_type": color,
            "firmware_revision": 300,
        },
        {"id": "m1", "type": "NMH", "radiator_state": "idle", "reachable": reachable, "firmware_revision": fw},
        {"id": "m4", "type": "NMW", "contactor_mode": "auto", "reachable": True, "connection_status": "connected"},
    ]
    if last_seen is not None:
        modules[1]["last_seen"] = last_seen
    return {"body": {"home": {"id": "home1", "rooms": rooms, "modules": modules}}}


def homesdata():
    data = json.loads((FIX / "homesdata.json").read_text())
    home = data["body"]["homes"][0]
    home["modules"][1]["setup_date"] = at("2022-10-03", 14)
    home["contract_power_unit"] = "kVA"
    home["contract_power"] = 9
    home["schedules"] = [
        {"selected": False, "zones": [{"tariff": "edf", "tariff_option": "base", "price_type": "base"}]},
        {
            "selected": True,
            "zones": [
                {"tariff": "edf", "tariff_option": "peak_and_off_peak", "price_type": "peak", "price": 0.27},
                {"tariff": "edf", "tariff_option": "peak_and_off_peak", "price_type": "off_peak", "price": 0.2},
            ],
        },
    ]
    return data


MOD_ROOM = {"m1": "100", "m2": "100", "m3": "200", "m4": "300"}


# ---------------------------------------------------------------- hourly snapshots (#214, #218, #276)
def test_snapshot_keeps_gateway_fields_without_any_id_or_name():
    snap = roomstate.snapshot(homestatus(anticipating=True), 1_700_000_000)
    assert snap["gateway"] == {"uptime": 3600, "wifi_strength": 60, "day_color": "blue"}
    assert "gw" not in snap["modules"]
    assert snap["rooms"]["100"]["anticipating"] is True and snap["rooms"]["100"]["lowering"] is False
    assert snap["modules"]["m1"]["reachable"] is True
    assert snap["modules"]["m4"]["connection_status"] == "connected"
    text = json.dumps(snap)
    for absent in ("Passerelle", "Dupont", "Salon", "home1", "firmware"):
        assert absent not in text


def test_merge_counts_offline_anticipating_and_lowering_hours(tmp_path):
    store = Store(tmp_path, "pw")
    day = "2025-01-10"
    snaps = []
    for h in range(24):
        status = homestatus(reachable=h >= 6, anticipating=h in (5, 6), lowering=h >= 22, uptime=h * 3600 + 600)
        snaps.append(roomstate.snapshot(status, at(day, h, 23)))
    stats = roomstate.merge_snapshots(store, snaps, TZ, MOD_ROOM, today="2025-01-11")
    cell = store.doc("roomstate")["rooms"]["100"][day]
    assert cell["offline_h"] == 6.0  # m1 unreachable from 0 h to 5 h
    assert cell["anticipating_h"] == 2.0
    assert cell["lowering_h"] == 2.0
    assert store.doc("roomstate")["rooms"]["300"][day]["offline_h"] == 0.0
    assert stats["boots"] == 0  # same start time all day long (first one: start before monitoring)
    gw = store.doc("devices")["gateway"]
    assert len(gw["boots"]) == 1
    assert gw["wifi"][day] == [60, 60, 60, 24]
    assert store.doc("devices")["tempo"][day] == "blue"


def test_restart_is_detected_once_when_uptime_starts_again_and_snapshots_are_read_twice(tmp_path):
    store = Store(tmp_path, "pw")
    day = "2025-01-10"
    snaps = [roomstate.snapshot(homestatus(uptime=50_000 + h * 3600), at(day, h)) for h in range(10)]
    # Power cut at 10:40: the gateway started again, uptime counts from there.
    snaps += [roomstate.snapshot(homestatus(uptime=(h - 11) * 3600 + 1200), at(day, h)) for h in range(11, 20)]
    snaps.append(roomstate.snapshot(homestatus(), at(day, 20)))  # no uptime field: nothing inferred
    snaps[-1]["gateway"].pop("uptime")
    stats = roomstate.merge_snapshots(store, snaps, TZ, MOD_ROOM, today="2025-01-11")
    assert stats["boots"] == 1
    boots = store.doc("devices")["gateway"]["boots"]
    assert boots[-1] == f"{day}T10:40"
    again = roomstate.merge_snapshots(store, snaps, TZ, MOD_ROOM, today="2025-01-11")
    assert again["boots"] == 0 and store.doc("devices")["gateway"]["boots"] == boots


def test_tempo_colour_of_the_gateway_follows_the_tempo_day():
    assert devices.tempo_day(at("2025-01-10", 5), PARIS) == "2025-01-09"
    assert devices.tempo_day(at("2025-01-10", 7), PARIS) == "2025-01-10"


# ---------------------------------------------------------------- nightly status (#214, #216, #276)
def test_nightly_status_daily_reach_firmware_changes_and_alert_lines(tmp_path):
    store = Store(tmp_path, "pw")
    start = at("2025-01-01", 0)  # the gateway runs since then
    night1 = at("2025-01-10", 5)
    c1 = devices.collect_status(store, homesdata(), homestatus(uptime=night1 - start), TZ, MOD_ROOM, now=night1)
    assert c1["unreachable"] == 0 and c1["firmware"] == 0 and c1["alerts"] == []
    doc = store.doc("devices")
    key = devices.module_keys(store, ["m1"])["m1"]
    assert "ids" not in doc and "m1" not in json.dumps(doc["module_keys"])
    assert doc["modules"][key] == {"type": "NMH", "room": "100", "setup": "2022-10-03", "fw": "105"}
    assert doc["reach"][key] == {"2025-01-10": 1}
    # Next night: firmware updated, the radiator stopped answering; the night after, silent too.
    night2 = at("2025-01-11", 5)
    status2 = homestatus(reachable=False, fw="106", uptime=night2 - start)
    c2 = devices.collect_status(store, homesdata(), status2, TZ, MOD_ROOM, now=night2)
    assert c2["unreachable"] == 1 and c2["firmware"] == 1
    assert doc["firmware"][key] == [["2025-01-11", "105", "106"]]
    night3 = at("2025-01-12", 5)
    old = night3 - 7 * 3600
    status3 = homestatus(fw="106", last_seen=old, uptime=night3 - start)
    c3 = devices.collect_status(store, homesdata(), status3, TZ, MOD_ROOM, now=night3)
    assert c3["alerts"] == ["1 radiateur injoignable depuis le 2025-01-11"]
    assert doc["reach"][key] == {"2025-01-10": 1, "2025-01-11": 0, "2025-01-12": 0}
    for line in c3["alerts"]:
        for leak in ("m1", "Salon", "100", "home1"):
            assert leak not in line
    # Gateway: the start time moved by a day: a restart.
    c4 = devices.collect_status(store, homesdata(), homestatus(uptime=60), TZ, MOD_ROOM, now=at("2025-01-13", 5))
    assert c4["boots"] == 1
    assert devices.boots_since(store, 7, at("2025-01-13", 6), TZ) == 1  # the start of 01-01 is older


def test_intuis_contract_from_the_selected_schedule():
    got = devices.intuis_contract(homesdata())
    assert got == {
        "tariff": "edf",
        "tariff_option": "peak_and_off_peak",
        "price_type": ["off_peak", "peak"],
        "power_unit": "kva",
        "kva": 9.0,
    }
    assert devices.intuis_contract({"body": {"homes": [{"id": "h"}]}}) is None


def test_nightly_sync_reads_status_once_and_reports_counts_only(tmp_path, monkeypatch, capsys):
    from collector import __main__ as cli

    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        calls.append(path)
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=homesdata())
        if path == "/api/gethomemeasure":
            return httpx.Response(200, json=json.loads((FIX / "gethomemeasure.json").read_text()))
        if path == "/syncapi/v1/homestatus":
            return httpx.Response(200, json=homestatus(reachable=False))
        return httpx.Response(404)

    client = IntuisClient(SETTINGS, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)
    monkeypatch.setattr(cli, "_client", lambda s: client)
    alert = tmp_path / "devices.txt"
    monkeypatch.setenv("DEVICE_FILE", str(alert))
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    cli.cmd_sync(Settings(passphrase="pw", data_dir=tmp_path / "data"), argparse.Namespace(days=10))
    assert calls.count("/syncapi/v1/homestatus") == 1
    out = capsys.readouterr().out
    after = Store(tmp_path / "data", "pw")
    note = after.meta["sources"]["appareils"]["note"]
    assert "1 module(s) injoignable(s)" in note
    assert after.meta["intuis_contract"]["tariff_option"] == "peak_and_off_peak"
    assert alert.read_text().startswith("- 1 radiateur injoignable depuis le ")
    text = summary.read_text() + out + alert.read_text()
    assert "Appareils Intuis" in summary.read_text()
    for leak in ("m1", "Salon", "home1", "Passerelle", "Dupont", "peak_and_off_peak"):
        assert leak not in text


def test_nightly_status_failure_is_never_fatal(tmp_path, monkeypatch):
    from collector import __main__ as cli

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=homesdata())
        if path == "/api/gethomemeasure":
            return httpx.Response(200, json=json.loads((FIX / "gethomemeasure.json").read_text()))
        return httpx.Response(400, json={"error": {"code": 21, "message": "home1 invalid"}})

    client = IntuisClient(SETTINGS, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)
    monkeypatch.setattr(cli, "_client", lambda s: client)
    cli.cmd_sync(Settings(passphrase="pw", data_dir=tmp_path / "data"), argparse.Namespace(days=10))
    st = Store(tmp_path / "data", "pw").meta["sources"]
    assert "intuis" in st and st["appareils"]["message"] and "home1" not in st["appareils"]["message"]


# ---------------------------------------------------------------- station (#215, #216)
def stations_body(battery=80, rf=70, last_seen=None, fw=200, now=None):
    now = now or at("2025-01-10", 5)
    return {
        "body": {
            "devices": [
                {
                    "_id": "70:ee:50:aa:bb:cc",
                    "type": "NAMain",
                    "module_name": "Salon",
                    "wifi_status": 55,
                    "reachable": True,
                    "last_status_store": now - 300,
                    "firmware": 181,
                    "modules": [
                        {
                            "_id": "02:00:00:aa:bb:cc",
                            "type": "NAModule1",
                            "module_name": "Jardin",
                            "battery_percent": battery,
                            "rf_status": rf,
                            "reachable": True,
                            "last_seen": last_seen or now - 600,
                            "firmware": fw,
                        }
                    ],
                }
            ]
        }
    }


def station_with(tmp_path, body):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    st = Station(Store(tmp_path, "pw"), "id", "s", "seed", http=httpx.Client(transport=httpx.MockTransport(handler)))
    st.api.min_interval = 0
    return st


def test_station_health_battery_signal_and_low_battery_warning(tmp_path):
    st = station_with(tmp_path, stations_body(battery=12))
    mods = st.modules()
    counts = store_health(st.store, mods, st.module_keys(mods), TZ, now=at("2025-01-10", 5))
    health = st.store.doc("station")["health"]
    assert health["m0"]["2025-01-10"] == [None, 55, 1]
    assert health["m1"]["2025-01-10"] == [12, 70, 1]
    assert counts == {"low_battery": 1, "silent": 0, "firmware": 0}
    note = health_note(counts)
    assert note == "pile faible : 1 module(s)"
    for leak in ("Jardin", "70:ee", "02:00"):
        assert leak not in note
    # Next night: the outdoor module is silent for 7 h and got a new firmware.
    body = stations_body(battery=11, last_seen=at("2025-01-10", 22), fw=201, now=at("2025-01-11", 5))
    st2 = station_with(tmp_path, body)
    st2.store = st.store
    mods = st2.modules()
    counts = store_health(st.store, mods, st2.module_keys(mods), TZ, now=at("2025-01-11", 5))
    assert counts == {"low_battery": 1, "silent": 1, "firmware": 1}
    assert st.store.doc("devices")["firmware"]["m1"] == [["2025-01-11", "200", "201"]]
    assert st.store.doc("devices")["modules"]["m1"]["type"] == "NAModule1"


# ---------------------------------------------------------------- Linky (#219, #277)
def linky_client(routes: dict, asked: list | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        ep = request.url.path.rsplit("/", 1)[-1]
        if asked is not None:
            asked.append((ep, dict(request.url.params)))
        status, body = routes.get(ep, (404, {}))
        return httpx.Response(status, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_peak_time_is_kept_in_local_time_without_changing_pmax(tmp_path):
    store = Store(tmp_path, "pw")
    daily = {"grandeur": [{"unite": "Wh", "points": [{"d": "2026-11-01", "v": "12000"}]}]}
    pmax = {
        "grandeur": [
            {
                "unite": "VA",
                "points": [
                    {"d": "2026-11-01T18:42:00+01:00", "v": "7200"},
                    {"d": "2026-11-02T06:10:00Z", "v": "6100"},
                    {"d": "2026-11-03", "v": "5000"},
                ],
            }
        ]
    }
    routes = {"consommation_quotidienne": (200, daily), "puissance_conso_max_quotidienne": (200, pmax)}
    enedis.collect(store, "tok", PRM, "2026-10-30", TZ, http=linky_client(routes), min_interval=0)
    linky = store.doc("linky")
    assert linky["pmax"] == {"2026-11-01": 7.2, "2026-11-02": 6.1, "2026-11-03": 5.0}
    assert linky["pmax_at"] == {"2026-11-01": "18:42", "2026-11-02": "07:10"}


def index_body():
    def pts(start):
        return [{"d": f"2026-11-0{i}", "v": str(start + 1000 * i)} for i in range(1, 4)]

    return {
        "grandeur": [
            {
                "unite": "Wh",
                "calendrier": [
                    {
                        "idCalendrier": "distributeur",
                        "classeTemporelle": [
                            {"idClasseTemporelle": "HPH", "points": pts(1_000_000)},
                            {"idClasseTemporelle": "HCH", "points": pts(2_000_000)},
                        ],
                    }
                ],
            }
        ]
    }


def test_index_per_rate_period_is_collected_then_refreshed(tmp_path, caplog):
    store = Store(tmp_path, "pw")
    asked: list = []
    http = linky_client({"index_consommation": (200, index_body())}, asked)
    n = enedis.collect_index(store, "tok", PRM, "2020-01-01", TZ, http=http, min_interval=0, today=date(2026, 11, 9))
    assert n == 6
    index = store.doc("linky")["index"]
    assert sorted(index) == ["distributeur.hch", "distributeur.hph"]
    assert index["distributeur.hph"]["2026-11-02"] == 1_002_000
    assert asked[0][1]["dateDebut"] == "2025-11-09"  # first run: 12 months, one request
    enedis.collect_index(store, "tok", PRM, "2020-01-01", TZ, http=http, min_interval=0, today=date(2026, 11, 10))
    assert asked[1][1]["dateDebut"] == "2026-10-24"  # then the last stored day − 10 days
    assert PRM not in caplog.text


def test_index_not_served_is_not_an_error(tmp_path):
    store = Store(tmp_path, "pw")
    http = linky_client({"index_consommation": (400, {"error": PRM})})
    assert enedis.collect_index(store, "tok", PRM, "2026-01-01", TZ, http=http, min_interval=0) == 0
    assert store.doc("linky")["index_status"] == 400 and "index" not in store.doc("linky")


def test_index_labels_are_identifiers_only():
    body = {"points": [{"d": "2026-11-01", "v": 5}], "libelle": PRM}
    assert enedis.parse_index(body) == {"total": {"2026-11-01": 5.0}}


def test_linky_inventory_lists_index_series_names_and_pmax_tout(capsys):
    from collector.diagnose import inventory_linky

    pmax = {"grandeur": [{"points": [{"d": "2026-11-01T18:42:00+01:00", "v": "7200"}]}]}
    routes = {"index_consommation": (200, index_body()), "puissance_conso_max_quotidienne": (200, pmax)}
    res = inventory_linky("tok", PRM, http=linky_client(routes), today=date(2026, 11, 9), min_interval=0)
    out = capsys.readouterr().out
    assert res["index_series"] == ["distributeur.hch", "distributeur.hph"]
    assert res["pmax_tout"] == (200, 1)
    assert "1 sur 1 points portent une heure" in out
    for leak in (PRM, "7200", "1002000", "tok"):
        assert leak not in out


# ---------------------------------------------------------------- Shelly clamp meters (#279)
EM_GEN3 = {  # Shelly EM Gen3 (documentation example shape, no real id)
    "sys": {"unixtime": 0},
    "em1:0": {"id": 0, "current": 2.1, "voltage": 230.1, "act_power": 480.0},
    "em1:1": {"id": 1, "current": 0.4, "voltage": 230.1, "act_power": 90.0},
    "em1data:0": {"id": 0, "total_act_energy": 0.0, "total_act_ret_energy": 5000.0},
    "em1data:1": {"id": 1, "total_act_energy": 0.0, "total_act_ret_energy": 0.0},
}
PRO_3EM = {
    "sys": {"unixtime": 0},
    "em:0": {"id": 0, "total_act_power": 1500.0},
    "emdata:0": {"id": 0, "total_act": 0.0, "total_act_ret": 900.0},
}


def shelly_cloud(totals: dict, t: int):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/interface/device/list":
            devices_ = {
                "plug": {"name": "Frigo", "type": "SNPL-00112EU"},
                "emg3": {"name": "Tableau", "type": "S3EM-002CXCEU"},
                "pro3em": {"name": "Général", "type": "SPEM-003CEBEU"},
            }
            return httpx.Response(200, json={"isok": True, "data": {"devices": devices_}})
        out = []
        for did in json.loads(request.content)["ids"]:
            if did == "plug":
                status = {"sys": {"unixtime": t}, "switch:0": {"apower": 80, "aenergy": {"total": totals["plug"]}}}
            elif did == "emg3":
                status = json.loads(json.dumps(EM_GEN3))
                status["sys"]["unixtime"] = t
                status["em1data:0"]["total_act_energy"] = totals["ch0"]
                status["em1data:1"]["total_act_energy"] = totals["ch1"]
            else:
                status = json.loads(json.dumps(PRO_3EM))
                status["sys"]["unixtime"] = t
                status["emdata:0"]["total_act"] = totals["pro"]
            out.append({"id": did, "online": 1, "status": status})
        return httpx.Response(200, json=out)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_clamp_meter_channels_are_separate_series_and_returned_energy_is_ignored(tmp_path):
    store = Store(tmp_path, "pw")
    store.put("shelly", "plugs", "p0", None, {"id": "plug", "name": "Frigo", "usable": True})  # existing plug
    first = {"plug": 1000.0, "ch0": 10_000.0, "ch1": 50_000.0, "pro": 7000.0}
    shelly.collect(store, "K", "a.shelly.cloud", TZ, http=shelly_cloud(first, at("2025-01-10", 5)), min_interval=0)
    second = {"plug": 2000.0, "ch0": 13_000.0, "ch1": 62_000.0, "pro": 9000.0}
    counts = shelly.collect(
        store, "K", "a.shelly.cloud", TZ, http=shelly_cloud(second, at("2025-01-11", 5)), min_interval=0
    )
    doc = store.doc("shelly")
    assert counts["channels"] == 2 and counts["readings"] == 3
    keys = shelly.plug_keys(store)
    assert keys.get("plug") == "p0"  # the existing plug keeps its key, its id is no longer stored
    assert not any("id" in p for p in doc["plugs"].values())
    em = keys.get("emg3")
    assert doc["plugs"][em]["channels"] == 2
    assert doc["plugs"][f"{em}c0"]["name"] == "Tableau · canal 1"
    assert doc["plugs"][f"{em}c1"]["channel"] == "em1data:1"
    total = lambda key: round(sum(doc["daily"][key].values()))  # noqa: E731
    assert total(f"{em}c0") == 3000 and total(f"{em}c1") == 12_000  # never summed together
    assert em not in doc.get("daily", {})
    pro = keys.get("pro3em")
    assert total(pro) == 2000 and "channels" not in doc["plugs"][pro]
    assert total("p0") == 1000


def test_channels_reading_of_each_family():
    found, power = shelly.channels(EM_GEN3)
    assert found == {"em1data:0": 0.0, "em1data:1": 0.0} and power
    assert shelly.channels(PRO_3EM)[0] == {"emdata:0": 0.0}
    gen1_em = {"emeters": [{"power": 10, "total": 1200.0}, {"power": 0, "total": 300.0, "total_returned": 50}]}
    assert shelly.channels(gen1_em)[0] == {"emeters:0": 1200.0, "emeters:1": 300.0}
    assert shelly.reading(gen1_em) == (1500.0, True)


def test_silent_rooms_alert_after_48_hours_without_reading(tmp_path):
    """#346: a room without a daily reading for 48 h while the others have theirs: one alert
    line, module type and date only (public issue), never the room."""
    store = Store(tmp_path, "pw")
    rooms = [
        {"id": "100", "category": "heating"},
        {"id": "200", "category": "heating"},
        {"id": "300", "category": "water_heater"},
        {"id": "400", "category": "ignore"},
    ]
    for d in ("2026-01-08", "2026-01-09", "2026-01-10"):
        store.merge("100", d, 1200.0)
        store.merge("300", d, 3000.0)
    store.merge("200", "2026-01-08", 900.0)  # silent since the 9th: 2 days on the 10th
    store.merge("400", "2025-12-01", 1.0)  # ignored room: never an alert
    lines = devices.silent_rooms(store, rooms)
    assert lines == ["1 radiateur sans relevé de consommation depuis le 2026-01-09 (48 h ou plus)"]
    assert not any("200" in line for line in lines)
    store.merge("200", "2026-01-09", 0.0)  # a reading at 0 Wh is a reading: 1 day only
    assert devices.silent_rooms(store, rooms) == []
    assert devices.silent_rooms(store, rooms[:1]) == []  # a single room: nothing to compare with


def test_stopped_rooms_variable_and_no_alert_for_them(tmp_path):
    """#346: a radiator switched off on purpose (STOPPED_ROOMS_JSON, set from ⚙ Mon logement) is
    expected to be silent: no alert; an invalid value is refused without quoting it."""
    store = Store(tmp_path, "pw")
    rooms = [{"id": "100", "category": "heating"}, {"id": "200", "category": "heating"}]
    for d in ("2026-01-08", "2026-01-09", "2026-01-10"):
        store.merge("100", d, 1200.0)
    store.merge("200", "2026-01-08", 900.0)
    raw = json.dumps([{"room": "200", "from": "2026-01-09", "reason": "poele", "label": "chauffé par un poêle"}])
    stopped = devices.parse_stopped(raw)
    assert stopped == [{"room": "200", "from": "2026-01-09", "reason": "poele", "label": "chauffé par un poêle"}]
    assert devices.silent_rooms(store, rooms, stopped=stopped) == []
    # stopped later than the silence began: the first days are still a room out of reach
    late = [{**stopped[0], "from": "2026-01-10"}]
    assert len(devices.silent_rooms(store, rooms, stopped=late)) == 1
    for bad in (
        "{",
        '{"room": "1"}',
        '[{"room": "1", "from": "9 janvier"}]',
        '[{"room": "1", "from": "2026-01-09", "reason": "x"}]',
    ):
        with pytest.raises(devices.StoppedError) as err:
            devices.parse_stopped(bad)
        assert "9 janvier" not in str(err.value)


def test_demo_has_a_room_stopped_and_a_room_offline(tmp_path):
    """#346 / #337: in the demo the living room radiator is switched off on purpose (a stove, in
    meta.stopped_rooms: the meter sees nothing of it), the kitchen one answers no more without
    explanation (the meter still sees it): only the kitchen raises the alert."""
    from collector.demo import OFFLINE_ROOM, STOPPED, STOPPED_ROOM, generate

    generate(tmp_path)
    s = Store(tmp_path, "demo")
    for rid, since in (OFFLINE_ROOM, STOPPED_ROOM):
        days = [d for y in s.years() for d in s.year(y).get(rid, {})]
        assert max(days) < since.isoformat()
        temps = [d for y in s.years() for d in s.doc(str(y)).get("temps", {}).get(rid, {})]
        assert not any(d >= since.isoformat() for d in temps)
    assert max(d for y in s.years() for d in s.year(y).get("r-bureau", {})) > OFFLINE_ROOM[1].isoformat()
    assert s.meta["stopped_rooms"] == STOPPED
    assert devices.silent_rooms(s, s.meta["rooms"], stopped=s.meta["stopped_rooms"]) == [
        f"1 radiateur sans relevé de consommation depuis le {OFFLINE_ROOM[1].isoformat()} (48 h ou plus)"
    ]
    assert len(devices.silent_rooms(s, s.meta["rooms"])) == 1  # both, as two radiators
    assert devices.silent_rooms(s, s.meta["rooms"])[0].startswith("2 radiateurs")
