import json
from pathlib import Path

import httpx
import pytest

from collector.api import IntuisClient, chunk_ranges
from collector.config import Settings
from collector.crypto import DecryptError, decrypt_json, encrypt_json
from collector.model import HEATING, WATER_HEATER, classify_room, parse_homes, parse_room_measures, to_local_day
from collector.storage import Store
from collector.sync import Syncer

FIX = Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIX / name).read_text())


def test_parse_homes_classifies_rooms():
    (home,) = parse_homes(load("homesdata.json"))
    assert home.bridge_id == "gw"
    cats = {r.name: r.category for r in home.rooms}
    assert cats == {
        "Salon": HEATING,
        "Chambre": HEATING,
        "Chauffe-eau": WATER_HEATER,
    }


def test_override_and_name_heuristics():
    assert classify_room("Ballon d'eau chaude", ["NMH"]) == WATER_HEATER
    assert classify_room("Salon", ["NMH"], override="ignore") == "ignore"


def test_parse_measures_sums_tariff_columns():
    data = parse_room_measures(load("gethomemeasure.json"), 86400)
    assert data["100"] == [(1704063600, 1200.0), (1704150000, 1500.0)]
    assert data["300"] == []


def test_local_day_handles_midnight_buckets():
    # 2024-01-01 00:00 Paris == 2023-12-31 23:00 UTC
    assert to_local_day(1704063600, "Europe/Paris") == "2024-01-01"
    # Bucket reported at noon stays on the same day
    assert to_local_day(1704063600 + 12 * 3600, "Europe/Paris") == "2024-01-01"


def test_chunk_ranges_respects_point_limit():
    chunks = chunk_ranges(0, 3000 * 86400, "1day")
    assert all((e - b) / 86400 < 1024 for b, e in chunks)
    assert chunks[0][0] == 0 and chunks[-1][1] == 3000 * 86400


def test_crypto_roundtrip_and_wrong_passphrase():
    env = encrypt_json({"a": 1}, "secret", b"0" * 16, iterations=1000)
    assert decrypt_json(env, "secret") == {"a": 1}
    with pytest.raises(DecryptError):
        decrypt_json(env, "nope")


def test_store_is_idempotent(tmp_path):
    s = Store(tmp_path, "pw")
    s.merge("100", "2024-01-01", 1200.0)
    assert set(s.save({"id": "h"}, [])) == {"2024.enc.json", "meta.enc.json"}
    s2 = Store(tmp_path, "pw")
    s2.merge("100", "2024-01-01", 1200.0)
    assert s2.save({"id": "h"}, []) == []
    assert s2.year(2024) == {"100": {"2024-01-01": 1200.0}}


def test_sync_end_to_end_with_mock_api(tmp_path):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            body = dict(x.split("=") for x in request.content.decode().split("&"))
            assert body["grant_type"] == "password" and body["user_prefix"] == "muller"
            return httpx.Response(200, json={"access_token": "t", "refresh_token": "r", "expires_in": 10800})
        assert request.headers["Authorization"] == "Bearer t"
        if path == "/api/homesdata":
            return httpx.Response(200, json=load("homesdata.json"))
        if path == "/api/gethomemeasure":
            req = json.loads(request.content)
            seen.append(req["home"]["rooms"][0]["type"])
            assert req["home"]["rooms"][0]["bridge"] == "gw"
            return httpx.Response(200, json=load("gethomemeasure.json"))
        return httpx.Response(404)

    settings = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
    client = IntuisClient(settings, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)
    store = Store(tmp_path, "pw")
    changed = Syncer(client, store).run(days=10)
    assert "2024.enc.json" in changed
    assert store.year(2024)["100"]["2024-01-01"] == 1200.0
    assert store.meta["rooms"][2]["category"] == WATER_HEATER
    assert seen[0].count("sum_energy_elec") == 3


def test_fallback_to_room_endpoint_when_home_measure_is_empty(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=load("homesdata.json"))
        if path == "/api/gethomemeasure":
            return httpx.Response(200, json={"body": {"home": {"rooms": [{"id": "100", "measures": []}]}}})
        if path == "/api/getroommeasure":
            form = dict(x.split("=") for x in request.content.decode().split("&"))
            if form["room_id"] != "100":
                return httpx.Response(200, json={"body": []})
            return httpx.Response(200, json={"body": {"1704063600": [500], "1704150000": [None]}})
        return httpx.Response(404)

    settings = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
    client = IntuisClient(settings, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)
    syncer = Syncer(client, Store(tmp_path, "pw"))
    syncer.run()
    assert syncer.strategy[0] == "room"
    assert syncer.store.year(2024)["100"] == {"2024-01-01": 500.0}


def test_water_heater_is_read_at_module_level(tmp_path):
    """The room holding an NMW returns nothing; the module itself carries the energy."""
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=load("homesdata.json"))
        if path == "/api/gethomemeasure":
            req = json.loads(request.content)
            requests.append(req)
            body = load("gethomemeasure.json")
            body["body"]["home"]["modules"] = [
                {"id": m["id"], "measures": [{"beg_time": 1704063600, "step_time": 86400, "value": [[None, 700, 50]]}]}
                for m in req["home"].get("modules", [])
            ]
            return httpx.Response(200, json=body)
        return httpx.Response(404)

    settings = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
    client = IntuisClient(settings, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)
    store = Store(tmp_path, "pw")
    Syncer(client, store).run(days=10)
    assert requests[0]["home"]["modules"] == [
        {"id": "m4", "bridge": "gw", "type": requests[0]["home"]["rooms"][0]["type"]}
    ]
    assert store.year(2024)["300"] == {"2024-01-01": 750.0}
    assert store.year(2024)["100"]["2024-01-01"] == 1200.0


def test_water_heater_combines_room_and_module_levels_without_double_count(tmp_path):
    """Old installation measured at room level, the new Aqua Manager at module level."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=load("homesdata.json"))
        req = json.loads(request.content)
        rooms = [
            {"id": r["id"], "measures": [{"beg_time": 1704063600, "step_time": 86400, "value": [[400], [300]]}]}
            for r in req["home"]["rooms"]
        ]
        modules = [
            {"id": m["id"], "measures": [{"beg_time": 1704150000, "step_time": 86400, "value": [[500], [600]]}]}
            for m in req["home"].get("modules", [])
        ]
        return httpx.Response(200, json={"body": {"home": {"rooms": rooms, "modules": modules}}})

    settings = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
    client = IntuisClient(settings, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)
    store = Store(tmp_path, "pw")
    store.merge("300", "2023-06-01", 999.0)  # stale value from an older run: rebuilt on backfill
    Syncer(client, store).run(backfill=True)
    assert "300" not in store.year(2023)
    # day 1: room only; day 2: max(room 300, module 500); day 3: module only
    assert store.year(2024)["300"] == {"2024-01-01": 400.0, "2024-01-02": 500.0, "2024-01-03": 600.0}


def test_water_heater_outside_any_room_becomes_virtual_room():
    payload = load("homesdata.json")
    home = payload["body"]["homes"][0]
    home["rooms"] = [r for r in home["rooms"] if r["id"] != "300"]
    home["modules"][-1]["name"] = "Ballon"
    (parsed,) = parse_homes(payload)
    assert parsed.water_heaters == {"m4": "m4"}
    virtual = parsed.rooms[-1]
    assert (virtual.id, virtual.category, virtual.virtual) == ("m4", WATER_HEATER, True)
    assert "m4" not in parsed.api_room_ids()


def test_measure_families_are_combined_with_max_not_sum(tmp_path):
    """Old days answer only under _heating, recent ones under tariffs; overlaps keep the max."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=load("homesdata.json"))
        mtype = json.loads(request.content)["home"]["rooms"][0]["type"]
        values = {
            "sum_energy_elec_heating": [[100], [None]],  # 1 Jan only
            "sum_energy_elec": [[90], [200]],  # overlaps 1 Jan, has 2 Jan
            "sum_energy_elec$0,sum_energy_elec$1,sum_energy_elec$2": [[None, None, None], [150, 60, None]],
            "temperature,sp_temperature": [[19.46, 19], [None, None]],
        }.get(mtype, [])
        room = {"id": "100", "measures": [{"beg_time": 1704063600, "step_time": 86400, "value": values}]}
        return httpx.Response(200, json={"body": {"home": {"rooms": [room]}}})

    settings = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
    client = IntuisClient(settings, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)
    syncer = Syncer(client, Store(tmp_path, "pw"))
    syncer.run(days=10)
    assert syncer.strategy == ("home", "ALL")
    assert syncer.store.year(2024)["100"] == {"2024-01-01": 100.0, "2024-01-02": 210.0}
    # tariff columns kept apart for the cost, temperatures stored per room and day
    assert syncer.store.doc("2024")["tariffs"]["100"] == {"2024-01-02": [150.0, 60.0, 0.0]}
    assert syncer.store.doc("2024")["temps"]["100"] == {"2024-01-01": [19.5, 19.0]}
    assert syncer.store.meta["has_tariffs"] and syncer.store.meta["has_temps"]


def test_open_meteo_fills_outdoor_temperatures(tmp_path):
    from collector.weather import open_meteo

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["latitude"] == "48.85"
        daily = {
            "time": ["2024-01-01", "2024-01-02"],
            "temperature_2m_min": [1.0, None],
            "temperature_2m_max": [7.0, 9.0],
            "temperature_2m_mean": [None, 5.0],
        }
        return httpx.Response(200, json={"daily": daily})

    store = Store(tmp_path, "pw")
    http = httpx.Client(transport=httpx.MockTransport(handler))
    open_meteo(store, 48.8534, 2.3488, "Europe/Paris", "2024-01-01", http=http)
    weather = store.doc("weather")
    assert weather["source"] == "open-meteo"
    assert weather["outdoor"] == {"2024-01-01": [1.0, 7.0, 4.0]}  # mean computed, incomplete day dropped


def test_station_rotates_refresh_token_and_reads_every_module(tmp_path):
    from collector.station import Station

    tokens = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            form = dict(x.split("=") for x in request.content.decode().split("&"))
            tokens.append(form["refresh_token"])
            return httpx.Response(200, json={"access_token": "a", "refresh_token": f"r{len(tokens)}"})
        if path == "/api/getstationsdata":
            modules = [
                {"_id": "out", "type": "NAModule1", "module_name": "Extérieur"},
                {"_id": "kids", "type": "NAModule4", "module_name": "Chambre enfants"},
                {"_id": "cave", "type": "NAModule4", "module_name": "Cave"},
            ]
            return httpx.Response(
                200,
                json={
                    "body": {"devices": [{"_id": "main", "type": "NAMain", "module_name": "Salon", "modules": modules}]}
                },
            )
        if path == "/api/getmeasure":
            module = request.url.params.get("module_id")
            assert ("co2" in request.url.params["type"]) == (module != "out")
            values = {
                "out": [-2.0, 6.0, None, 85],
                "kids": [18.0, 20.0, 19.1, 55, 900],
                "cave": [12.0, 13.0, 12.5, 70, 500],
            }
            return httpx.Response(200, json={"body": {"1704063600": values.get(module, [19.0, 21.0, 20.2, 50, 700])}})
        return httpx.Response(404)

    store = Store(tmp_path, "pw")
    http = httpx.Client(transport=httpx.MockTransport(handler))
    Station(store, "id", "secret", "seed", http=http).collect("Europe/Paris", "2024-01-01")
    Station(store, "id", "secret", "seed", http=http).collect("Europe/Paris", "2024-01-01")
    assert tokens == ["seed", "r1"]  # second run uses the rotated token
    weather = store.doc("weather")
    assert weather["source"] == "netatmo"
    assert weather["outdoor"]["2024-01-01"] == [-2.0, 6.0, 2.0]
    assert weather["indoor"]["2024-01-01"] == 20.2
    station = store.doc("station")
    assert [m["name"] for m in station["modules"].values()] == ["Salon", "Extérieur", "Chambre enfants", "Cave"]
    assert station["daily"]["m2"]["2024-01-01"] == [18.0, 20.0, 19.1, 55, 900]
    assert station["daily"]["m1"]["2024-01-01"] == [-2.0, 6.0, 2.0, 85, None]


def test_linky_parser_accepts_unknown_shapes_and_kwh(tmp_path):
    from collector.enedis import collect

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer tok"
        assert request.url.params["pointId"] == "12345678901234"
        if request.url.path.endswith("puissance_conso_max_quotidienne"):
            return httpx.Response(200, json={"mesures": [{"date": "2024-01-01", "valeur": 7350}]})
        return httpx.Response(
            200,
            json={
                "mesures": [
                    {"date": "2024-01-01", "valeur": 21.5},
                    {"date": "2024-01-02T00:00:00+01:00", "valeur": "18"},
                ]
            },
        )

    store = Store(tmp_path, "pw")
    n = collect(
        store,
        "tok",
        "12345678901234",
        "2024-01-01",
        "Europe/Paris",
        http=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    assert n > 0
    assert store.doc("linky")["daily"]["2024-01-01"] == 21500.0  # kWh payload converted to Wh
    assert store.doc("linky")["pmax"]["2024-01-01"] == 7.35  # VA converted to kVA


def test_monthly_totals_fill_days_lost_by_the_backend(tmp_path):
    """Daily values missing for part of a month, monthly total intact: spread the gap."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=load("homesdata.json"))
        req = json.loads(request.content)
        if req["home"]["rooms"][0]["type"] != "sum_energy_elec":
            return httpx.Response(200, json={"body": {"home": {"rooms": []}}})
        if req["scale"] == "1month":
            measures = [{"beg_time": 1706742000, "step_time": 2592000, "value": [[31000]]}]  # Feb 2024
        elif req["scale"] == "1day":
            # only 1-27 Feb 2024 at 1000 Wh, 28-29 lost
            measures = [{"beg_time": 1706742000, "step_time": 86400, "value": [[1000]] * 27}]
        else:
            measures = []
        rooms = [{"id": "100", "measures": measures}]
        return httpx.Response(200, json={"body": {"home": {"rooms": rooms}}})

    settings = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
    client = IntuisClient(settings, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)
    store = Store(tmp_path, "pw")
    Syncer(client, store).run(backfill=True)
    feb = {d: v for d, v in store.year(2024)["100"].items() if d.startswith("2024-02")}
    assert sum(feb.values()) == 31000.0
    assert feb["2024-02-28"] == feb["2024-02-29"] == 2000.0
    assert store.doc("2024")["estimated"]["100"] == {"2024-02-28": 1, "2024-02-29": 1}


def test_insights_use_only_computed_numbers(tmp_path):
    from datetime import date
    from types import SimpleNamespace

    from collector.insights import compute_facts, generate, unknown_numbers

    store = Store(tmp_path, "pw")
    for d in range(1, 32):
        store.merge("100", f"2024-01-{d:02d}", 10000.0)
        store.merge("100", f"2023-01-{d:02d}", 12000.0)
    store.save({"id": "h"}, [{"id": "100", "name": "Salon", "category": HEATING}])
    facts = compute_facts(store, "2024-01")
    assert facts["chauffage_kwh"] == 310.0 and facts["chauffage_kwh_annee_precedente"] == 372.0
    assert unknown_numbers("Salon : 310 kWh contre 372 kWh", facts) == []
    assert unknown_numbers("soit 999 kWh", facts) == [999.0]

    calls = []

    def create(**kw):
        calls.append(kw)
        text = "### Bien\n310 kWh, 999 kWh" if len(calls) == 1 else "### Bien\nSalon : 310 kWh contre 372 kWh."
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=text)])

    client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))
    assert generate(store, today=date(2024, 2, 10), client=client)
    assert len(calls) == 2  # invented number → one rewrite
    assert calls[0]["model"] == "claude-opus-5-5" and calls[0]["fallbacks"] == "default"
    doc = store.doc("insights")
    assert doc["period"] == "2024-01" and doc["verified"]
    assert not generate(store, today=date(2024, 2, 11), client=client)  # once per month
