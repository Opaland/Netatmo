"""S-1.19: `diagnose --inventory` prints field names, type names, counts and statuses only."""

from __future__ import annotations

from datetime import date

import httpx
import pytest

from collector.api import ApiError
from collector.budget import METER
from collector.config import Settings
from collector.diagnose import inventory, inventory_intuis, inventory_linky, inventory_station, shape

NOW = 1_762_000_000
MAC_MAIN = "70:ee:50:aa:bb:cc"
MAC_OUT = "02:00:00:aa:bb:cc"
MAC_WIND = "06:00:00:aa:bb:cc"
PRM = "12345678901234"


@pytest.fixture(autouse=True)
def _fresh_meter():
    METER.reset()
    yield
    METER.reset()


def test_shape_lists_names_and_counts_but_hides_id_or_name_keyed_dicts():
    obj = {
        "rooms": [{"id": "1", "name": "Salon"}, {"id": "2", "name": "Chambre"}],
        "by_id": {"1234": {"temp": 19}, "5678": {"temp": 20}},
        "by_name": {"Salon": 1},
    }
    s = shape(obj, "home", None)
    assert s["home"]["keys"] == ["by_id", "by_name", "rooms"]
    assert s["home.rooms[]"]["n"] == 2 and s["home.rooms[]"]["keys"] == ["id", "name"]
    assert s["home.by_id"]["keys"] == ["{*}"] and s["home.by_id.{*}"]["keys"] == ["temp"]
    # "Salon" is a value elsewhere in the answer: never printed as a key.
    assert s["home.by_name"]["keys"] == ["{*}"]
    assert "Salon" not in repr(s)


HOMESDATA = {
    "body": {
        "user": {"email": "cedric@example.org", "language": "fr-FR"},
        "homes": [
            {
                "id": "5f00home",
                "name": "Maison de Cédric",
                "coordinates": [2.3522, 48.8566],
                "altitude": 35,
                "timezone": "Europe/Paris",
                "rooms": [
                    {"id": "1111", "name": "Salon", "type": "livingroom", "module_ids": ["09:00:00:01"]},
                    {"id": "2222", "name": "Chambre Léa", "type": "bedroom", "module_ids": ["09:00:00:02"]},
                ],
                "modules": [
                    {"id": "gw-0001", "type": "NMG", "name": "Passerelle", "setup_date": 1600000000},
                    {
                        "id": "09:00:00:01",
                        "type": "NMH",
                        "name": "Radiateur salon",
                        "bridge": "gw-0001",
                        "room_id": "1111",
                        "capabilities": [{"name": "heating", "available": True}],
                    },
                    {"id": "09:00:00:02", "type": "NMW", "name": "Ballon", "bridge": "gw-0001", "room_id": "2222"},
                ],
                "schedules": [
                    {
                        "id": "sched-1",
                        "name": "Hiver",
                        "selected": True,
                        "timetable": [{"zone_id": 0, "m_offset": 0}, {"zone_id": 1, "m_offset": 420}],
                        "zones": [
                            {"id": 0, "name": "Nuit", "type": 1, "rooms_temp": [{"room_id": "1111", "temp": 17}]},
                            {
                                "id": 1,
                                "name": "Confort",
                                "type": 0,
                                "rooms": [{"id": "1111", "therm_setpoint_temperature": 20}],
                            },
                        ],
                    }
                ],
            }
        ],
    }
}
HOMESTATUS = {
    "body": {
        "home": {
            "id": "5f00home",
            "rooms": [
                {"id": "1111", "open_window": False, "anticipating": False, "therm_measured_temperature": 19.4},
                {"id": "2222", "presence": True, "therm_setpoint_mode": "away"},
            ],
            "modules": [
                {
                    "id": "09:00:00:01",
                    "type": "NMH",
                    "radiator_state": "chauffe_x",
                    "firmware_revision": 9871,
                    "reachable": True,
                },
                {"id": "09:00:00:02", "type": "NMW", "contactor_mode": "auto", "last_seen": 1761999000},
            ],
        }
    }
}


class FakeIntuis:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def homesdata(self):
        return HOMESDATA

    def homestatus(self, home_id):
        assert home_id == "5f00home"
        return HOMESTATUS

    def home_measure(self, home_id, bridge, rooms, *, measure_type, scale, date_begin, date_end, module_ids=None):
        self.calls.append((measure_type, scale))
        assert bridge == "gw-0001" and "gw-0001" not in (module_ids or [])
        if scale == "5min":
            raise ApiError("/api/gethomemeasure → HTTP 400 : {'error': 'bad scale for home 5f00home'}")
        if measure_type == "sp_temperature" or (scale == "1hour" and date_end < NOW - 200 * 86400):
            return {"body": {"home": {"rooms": [{"id": "1111", "measures": []}]}}}
        block = [{"beg_time": date_begin, "step_time": 3600, "value": [[1234.5], [None], [987.0]]}]
        return {
            "body": {
                "home": {
                    "rooms": [{"id": "1111", "measures": block}],
                    "modules": [{"id": "09:00:00:02", "measures": block}],
                }
            }
        }


SECRETS_INTUIS = (
    "5f00home",
    "Cédric",
    "cedric@example.org",
    "48.85",
    "2.35",
    "Salon",
    "Léa",
    "09:00:00",
    "gw-0001",
    "1111",
    "Hiver",
    "Confort",
    "19.4",
    "1234.5",
    "away",
    "chauffe_x",
    "9871",
)


def test_intuis_inventory_lists_fields_schedules_types_and_scales_without_values(capsys):
    client = FakeIntuis()
    res = inventory_intuis(client, now=NOW)  # type: ignore[arg-type]
    out = capsys.readouterr().out
    for name in (
        "coordinates",
        "home.schedules[]",
        "home.schedules[].timetable[]",
        "m_offset",
        "home.schedules[].zones[].rooms_temp[]",
        "capabilities",
        "setup_date",
        "anticipating",
        "therm_setpoint_mode",
        "firmware_revision",
        "contactor_mode",
        "last_seen",
        "NMH ×1",
        "NMW ×1",
        "Plannings : 1",
        "sum_energy_elec_hot_water",
    ):
        assert name in out, name
    for secret in SECRETS_INTUIS:
        assert secret not in out, secret
    assert res["measures"][("sum_energy_elec", "5min")] == "refusé (HTTP 400)"
    assert res["measures"][("sum_energy_elec", "1hour")] == "pièces 2 / modules 2"
    assert res["measures"][("sp_temperature", "1day")] == "pièces 0 / modules 0"
    assert res["depth"]["1hour"] == 180 and res["depth"]["1day"] == 1825 and res["depth"]["5min"] is None
    assert ("sum_energy_elec_heating", "30min") in client.calls


def _station_handler(seen: list):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/api/getstationsdata":
            main = {
                "_id": MAC_MAIN,
                "type": "NAMain",
                "station_name": "Maison de Cédric",
                "module_name": "Salon",
                "firmware": 181,
                "wifi_status": 52,
                "reachable": True,
                "data_type": ["Temperature", "CO2", "Humidity", "Noise", "Pressure"],
                "place": {"city": "Paris", "location": [2.3522, 48.8566], "altitude": 35, "timezone": "Europe/Paris"},
                "dashboard_data": {
                    "time_utc": 1761999999,
                    "Temperature": 20.3,
                    "CO2": 812,
                    "Noise": 41,
                    "Pressure": 1013.2,
                },
                "modules": [
                    {
                        "_id": MAC_OUT,
                        "type": "NAModule1",
                        "module_name": "Jardin",
                        "battery_percent": 64,
                        "rf_status": 71,
                        "last_seen": 1761999990,
                        "data_type": ["Temperature", "Humidity"],
                        "dashboard_data": {"Temperature": 7.1, "Humidity": 88},
                    },
                    {"_id": MAC_WIND, "type": "NAModule2", "module_name": "Anémomètre", "battery_percent": 12},
                ],
            }
            return httpx.Response(200, json={"body": {"devices": [main], "user": {"mail": "cedric@example.org"}}})
        if request.url.path == "/api/getmeasure":
            p = request.url.params
            if p.get("module_id") == MAC_WIND and p["type"] == "temperature":
                return httpx.Response(400, json={"error": {"code": 21, "message": f"Invalid type for {MAC_WIND}"}})
            if p["scale"] == "1month":
                return httpx.Response(400, json={"error": {"code": 21, "message": "bad scale"}})
            begin = int(p["date_begin"])
            if begin < NOW - 1000 * 86400:
                return httpx.Response(200, json={"body": []})
            return httpx.Response(
                200, json={"body": [{"beg_time": begin, "step_time": 3600, "value": [[20.3], [20.1]]}]}
            )
        return httpx.Response(404)

    return handler


def test_station_inventory_lists_fields_health_types_and_refusals_without_values(capsys):
    seen: list = []
    http = httpx.Client(transport=httpx.MockTransport(_station_handler(seen)))
    res = inventory_station("access", http=http, now=NOW, min_interval=0)
    out = capsys.readouterr().out
    for name in (
        "Temperature",
        "CO2",
        "Noise",
        "Pressure",
        "battery_percent",
        "rf_status",
        "wifi_status",
        "firmware",
        "body.devices[].place",
        "body.devices[].modules[]",
        "NAModule2",
        "windstrength accepté, 2 points",
        "temperature refusé (HTTP 400)",
        "1month=refusé (HTTP 400)",
    ):
        assert name in out, name
    for secret in (
        MAC_MAIN,
        MAC_OUT,
        MAC_WIND,
        "70:ee",
        "Cédric",
        "Salon",
        "Jardin",
        "Paris",
        "48.85",
        "20.3",
        "1013",
        "cedric@",
    ):
        assert secret not in out, secret
    assert res["types"][(0, "noise")] == "accepté, 2 points"
    assert res["depth"][0] == 365  # 1095 days ago answers empty
    assert all(r.headers["Authorization"] == "Bearer access" for r in seen)
    assert not any("refresh_token" in str(r.url) or r.url.path == "/oauth2/token" for r in seen)


def test_linky_inventory_prints_status_and_point_counts_never_the_prm(capsys):
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        ep = request.url.path.rsplit("/", 1)[-1]
        asked.append(ep)
        assert request.url.params["pointId"] == PRM
        if ep in (
            "daily_consumption",
            "consumption_load_curve",
            "consumption_max_power",
            "daily_production",
            "production_load_curve",
        ):
            return httpx.Response(404, text=f"not found for {PRM}")
        if ep.startswith("production") or "production" in ep:
            return httpx.Response(200, json={"grandeur": [{"points": []}]})
        pts = [{"d": f"2026-11-0{i}", "v": "12345"} for i in range(1, 4)]
        return httpx.Response(200, json={"grandeur": [{"points": pts}]})

    res = inventory_linky(
        "tok", PRM, http=httpx.Client(transport=httpx.MockTransport(handler)), today=date(2026, 11, 9), min_interval=0
    )
    out = capsys.readouterr().out
    assert res["consommation_quotidienne"] == (200, 3)
    assert res["production_quotidienne"] == (200, 0)
    assert res["daily_production"] == (404, 0)
    assert "production_quotidienne" in out and "HTTP 404" in out
    for secret in (PRM, "12345", "tok"):
        assert secret not in out
    assert not any(ep in asked for ep in ("identite", "adresse", "contrats", "contracts", "identity", "addresses"))


def test_inventory_skips_sources_without_secrets_and_survives_a_failing_one(capsys):
    class Broken(FakeIntuis):
        def homesdata(self):
            raise RuntimeError("https://example/api?pointId=" + PRM)

    inventory(Settings(), Broken())  # type: ignore[arg-type]
    out = capsys.readouterr().out
    assert "Intuis : interrompu (RuntimeError)" in out
    assert "Station Netatmo : pas ici" in out and "Linky : ignoré" in out
    assert PRM not in out


def test_cli_inventory_needs_no_intuis_secret(capsys, monkeypatch, tmp_path):
    from collector.__main__ import main

    monkeypatch.chdir(tmp_path)
    for var in (
        "INTUIS_USERNAME",
        "INTUIS_PASSWORD",
        "INTUIS_CLIENT_ID",
        "INTUIS_CLIENT_SECRET",
        "ENEDIS_TOKEN",
        "ENEDIS_PRM",
    ):
        monkeypatch.delenv(var, raising=False)
    main(["diagnose", "--inventory"])
    out = capsys.readouterr().out
    assert "Intuis : ignoré" in out


def test_collection_inventories_the_station_with_its_own_access_token(tmp_path, monkeypatch, capsys):
    """S-1.19: `sync` with STATION_INVENTORY=true reuses the access token of the collection: one
    login only, the rotated refresh token saved in the archive, names and counts only."""
    import argparse
    import json
    from pathlib import Path

    import collector.__main__ as cli
    from collector.api import IntuisClient
    from collector.storage import Store

    fixtures = Path(__file__).parent / "fixtures"

    def intuis_handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=json.loads((fixtures / "homesdata.json").read_text()))
        if path == "/api/gethomemeasure":
            return httpx.Response(200, json=json.loads((fixtures / "gethomemeasure.json").read_text()))
        return httpx.Response(404)

    seen: list = []
    station_api = _station_handler(seen)
    logins: list = []

    def netatmo(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            logins.append(1)
            return httpx.Response(200, json={"access_token": "access", "refresh_token": "rotated"})
        return station_api(request)

    real_client = httpx.Client
    intuis = IntuisClient(
        Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x"),
        http=real_client(transport=httpx.MockTransport(intuis_handler)),
        min_interval=0,
    )
    monkeypatch.setattr(cli, "_client", lambda s: intuis)
    monkeypatch.setattr(
        "collector.station.httpx.Client", lambda **kw: real_client(transport=httpx.MockTransport(netatmo))
    )
    monkeypatch.setattr("collector.station.Station.__init__.__defaults__", (None, 0.0))
    monkeypatch.setattr("collector.diagnose.inventory_station.__defaults__", (None, None, 0.0))
    monkeypatch.setenv("STATION_INVENTORY", "true")
    monkeypatch.delenv("ROOM_STATE_DIR", raising=False)
    data = tmp_path / "data"
    s = Settings(
        passphrase="pw",
        data_dir=data,
        netatmo_client_id="id",
        netatmo_client_secret="sec",
        netatmo_refresh_token="seed",
    )
    cli.cmd_sync(s, argparse.Namespace(days=10))
    out = capsys.readouterr().out
    assert len(logins) == 1  # the inventory does not log in again
    assert "==== Station Netatmo ====" in out and "noise accepté" in out
    assert Store(data, "pw").doc("netatmo-token")["refresh_token"] == "rotated"
    for secret in (MAC_MAIN, MAC_OUT, MAC_WIND, "Jardin", "Paris", "1013", "rotated", "access"):
        assert secret not in out, secret


def test_collection_without_station_skips_the_inventory(capsys):
    from collector.__main__ import _station_inventory

    _station_inventory(None)
    assert "Inventaire de la station : ignoré" in capsys.readouterr().out
