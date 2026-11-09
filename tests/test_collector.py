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
            if request.url.params["scale"] == "1hour":
                return httpx.Response(200, json={"body": []})
            values = {
                "out": [-2.0, 6.0, None, 85],
                "kids": [18.0, 20.0, 19.1, 55, 900],
                "cave": [12.0, 13.0, 12.5, 70, 500],
            }
            return httpx.Response(200, json={"body": {"1704063600": values.get(module, [19.0, 21.0, 20.2, 50, 700])}})
        return httpx.Response(404)

    store = Store(tmp_path, "pw")
    http = httpx.Client(transport=httpx.MockTransport(handler))
    Station(store, "id", "secret", "seed", http=http, min_interval=0).collect("Europe/Paris", "2024-01-01")
    Station(store, "id", "secret", "seed", http=http, min_interval=0).collect("Europe/Paris", "2024-01-01")
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
        min_interval=0,
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
    # S-1.10: coverage per month, written at save time
    assert store.doc("2024")["coverage"]["100"]["2024-02"] == [27, 2, 0]


def test_coverage_counts_real_estimated_and_missing_days_of_stored_years(tmp_path):
    """Years stored before coverage existed get it on the next save (S-1.10)."""
    store = Store(tmp_path, "pw")
    for d in range(1, 11):  # 1-10 March real
        store.merge("r1", f"2024-03-{d:02d}", 500.0)
    for d in range(11, 16):  # 11-15 estimated from the monthly total
        store.merge("r1", f"2024-03-{d:02d}", 700.0)
        store.put("2024", "estimated", "r1", f"2024-03-{d:02d}", 1)
    store.merge("r1", "2024-04-02", 500.0)  # 16 Mar - 1 Apr lost, nothing after 2 Apr
    store.merge("r2", "2024-04-01", 100.0)  # a room that starts later
    store.merge("r2", "2024-04-02", 100.0)
    store.save({"id": "h"}, [])
    assert "coverage" not in Store(tmp_path, "pw").doc("2024")  # plain save: unchanged format

    again = Store(tmp_path, "pw")
    again.update_coverage()
    again.save({"id": "h"}, [])
    cov = Store(tmp_path, "pw").doc("2024")["coverage"]
    assert cov["r1"] == {"2024-03": [10, 5, 16], "2024-04": [1, 0, 1]}
    assert cov["r2"] == {"2024-04": [2, 0, 0]}


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
    assert unknown_numbers("Pièce A : 310 kWh contre 372 kWh", facts) == []
    assert unknown_numbers("soit 999 kWh", facts) == [999.0]

    calls = []

    def create(**kw):
        calls.append(kw)
        text = "### Bien\n310 kWh, 999 kWh" if len(calls) == 1 else "### Bien\nPièce A : 310 kWh contre 372 kWh."
        usage = SimpleNamespace(input_tokens=1000, output_tokens=500, cache_read_input_tokens=None)
        return SimpleNamespace(
            stop_reason="end_turn",
            model="claude-opus-5-5",
            usage=usage,
            content=[SimpleNamespace(type="text", text=text)],
        )

    client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))
    assert generate(store, today=date(2024, 2, 10), client=client)
    assert len(calls) == 2  # invented number → one rewrite
    assert calls[0]["model"] == "claude-opus-5-5" and calls[0]["fallbacks"] == "default"
    assert calls[0]["betas"] == ["server-side-fallback-2026-07-01"]
    assert calls[0]["output_config"] == {"effort": "medium"}
    doc = store.doc("insights")
    assert doc["period"] == "2024-01" and doc["verified"]
    assert doc["markdown"] == "### Bien\nSalon : 310 kWh contre 372 kWh."  # real name restored locally
    assert doc["pseudonyms"] == {"Pièce A": "Salon"}
    # S-5.8: 2 requests × (1000 in × $4 + 500 out × $20) / 1e6 = $0.028
    u = doc["usage"]
    assert u["requests"] == 2 and u["input_tokens"] == 2000 and u["output_tokens"] == 1000
    assert u["cost_usd"] == pytest.approx(0.028) and u["served_by"] == ["claude-opus-5-5"]
    assert u["cost_eur"] == pytest.approx(0.028 * u["eur_per_usd"], abs=1e-4)
    assert not generate(store, today=date(2024, 2, 11), client=client)  # once per month


def test_insights_never_send_room_or_module_names(tmp_path):
    """S-5.7: pseudonyms in everything sent; real names only in the stored text."""
    from datetime import date
    from types import SimpleNamespace

    from collector.insights import generate, restore_names

    store = Store(tmp_path, "pw")
    for d in range(1, 32):
        store.merge("id-kids", f"2024-01-{d:02d}", 8000.0)
        store.merge("id-kids", f"2023-01-{d:02d}", 6000.0)
        store.merge("id-ce", f"2024-01-{d:02d}", 3000.0)
        store.put("2024", "temps", "id-kids", f"2024-01-{d:02d}", [19.5, 19.0])
        store.put("station", "daily", "m2", f"2024-01-{d:02d}", [18.0, 20.0, 19.0, 55, 1100 if d < 10 else 800])
        store.put("station", "nightly", "m2", f"2024-01-{d:02d}", {"n": 9, "co2_max": 1500, "h_co2_1000": 2})
        store.put("station", "hours", "m2", f"2024-01-{d:02d}", {"n": 24, "humid": 1, "cold": 3})
    store.set_top(
        "station",
        "modules",
        {
            "m1": {"name": "Jardin", "type": "NAModule1", "indoor": False},
            "m2": {"name": "Chambre des enfants", "type": "NAModule4", "indoor": True},
        },
    )
    store.save(
        {"id": "home-xyz", "name": "Villa Rose"},
        [
            {"id": "id-kids", "name": "Chambre des enfants", "category": HEATING},
            {"id": "id-ce", "name": "Chauffe-eau", "category": WATER_HEATER},
        ],
    )
    sent = []

    def create(**kw):
        sent.append(json.dumps(kw["messages"], ensure_ascii=False) + kw["system"])
        text = "### Bilan\nLa pièce A a consommé 248 kWh ; Capteur A : 1500 ppm au plus fort."
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=text)])

    client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))
    assert generate(store, today=date(2024, 2, 3), client=client)
    blob = "".join(sent)
    for secret in ("Chambre des enfants", "Chauffe-eau", "id-kids", "id-ce", "Villa Rose", "home-xyz", "Jardin", "m2"):
        assert secret not in blob
    assert "Pièce A" in blob and "Pièce B" in blob and "Capteur A" in blob
    doc = store.doc("insights")
    facts = doc["facts"]
    comfort = facts["station_confort"]["Capteur A"]
    assert comfort["co2_moyen_ppm"] == 887 and comfort["jours_co2_moyen_sup_1000_ppm"] == 9
    assert comfort["heures_nuit_co2_sup_1000_ppm"] == 62 and comfort["heures_sous_19_degres"] == 93
    assert facts["temperatures_pieces_moyenne_et_consigne"] == {"Pièce A": [19.5, 19.0]}
    assert "Chambre des enfants" not in json.dumps(facts, ensure_ascii=False)
    assert (
        doc["markdown"]
        == "### Bilan\nLa Chambre des enfants a consommé 248 kWh ; Chambre des enfants : 1500 ppm au plus fort."
    )
    assert doc["verified"]  # checked on the text as received
    assert "usage" in doc and doc["usage"]["requests"] == 1  # no usage in the response: counted, no tokens
    # "Pièce AB" is not "Pièce A" + "B"
    assert restore_names("Pièce AB et Pièce A.", {"Pièce A": "Salon", "Pièce AB": "Cave"}) == "Cave et Salon."


def test_insights_facts_cost_unusual_days_linky_and_quality(tmp_path):
    """S-5.6: euros under the shared contract, unusual days, Linky baseload, coverage."""
    from collector.insights import compute_facts, unknown_numbers

    store = Store(tmp_path, "pw")
    for d in range(1, 32):
        day = f"2025-01-{d:02d}"
        tmean = -2 + d % 10  # varied outdoor temperatures for the signature
        store.put("weather", "outdoor", day, None, [tmean - 3, tmean + 3, tmean])
        kwh = 40 - 2 * tmean + (25 if d == 15 else 0)  # the 15th: 25 kWh more than the signature
        store.merge("h", day, kwh * 1000)
        store.merge("w", day, 4000.0)
        store.put("2025", "tariffs", "w", day, [0, 1000, 3000])  # water heater mostly in $2 → $2 is off-peak
        store.put("linky", "daily", day, None, 60000)
        store.put("linky", "pmax", day, None, 7.5 if d == 20 else 5.0)
        for h in range(48):
            store.put("2025.linky30", "curve", f"{day}T{h // 2:02d}:{30 * (h % 2):02d}", None, 150 if h == 8 else 400)
    for d in range(1, 32):
        store.merge("h", f"2024-01-{d:02d}", 30000.0)
    store.put("2025", "coverage", "h", "2025-01", [29, 2, 0])
    store.put("2025", "coverage", "w", "2025-01", [31, 0, 0])
    store.save(
        {"id": "x"},
        [{"id": "h", "name": "Séjour", "category": HEATING}, {"id": "w", "name": "Cumulus", "category": WATER_HEATER}],
        {"contract": [{"from": "2020-01-01", "offer": "edf-trv-hphc", "kva": 9}]},
    )
    facts = compute_facts(store, "2025-01")
    assert facts["cout_energie_estime_eur"] > 0 and facts["cout_energie_estime_eur_annee_precedente"] > 0
    assert facts["prix_kwh_heures_creuses_eur"] < facts["prix_kwh_heures_pleines_eur"]
    assert facts["abonnement_eur_par_mois"] > 0
    assert [u["jour"] for u in facts["jours_inhabituels"]] == ["15 janvier"]
    assert facts["talon_logement_w"] == 300 and facts["puissance_max_appelee_kva"] == 7.5
    assert facts["qualite_donnees"] == {
        "jours_pieces_reels": 60,
        "jours_pieces_estimes": 2,
        "jours_pieces_manquants": 0,
    }
    # the new numbers are verified like the others
    cost = facts["cout_energie_estime_eur"]
    assert unknown_numbers(f"environ {cost} € ce mois-ci, talon de 300 W", facts) == []
    assert unknown_numbers(f"environ {cost + 57} €", facts) == [float(cost + 57)]
    # no shared contract → no euros (never a made-up price)
    store.meta.pop("contract")
    assert "cout_energie_estime_eur" not in compute_facts(store, "2025-01")


def test_rekey_reencrypts_everything_and_rates_strength(tmp_path):
    from collector.rekey import rekey, strength_bits

    store = Store(tmp_path, "ancienne phrase")
    store.merge("100", "2024-01-01", 1200.0)
    store.save({"id": "h"}, [])
    old_salt = (tmp_path / "keyinfo.json").read_text()
    files = rekey(tmp_path, "ancienne phrase", "pivoine tracteur lagune moustache onze")
    assert "2024.enc.json" in files and (tmp_path / "keyinfo.json").read_text() != old_salt
    assert Store(tmp_path, "pivoine tracteur lagune moustache onze").year(2024) == {"100": {"2024-01-01": 1200.0}}
    with pytest.raises(DecryptError):
        Store(tmp_path, "ancienne phrase")
    assert strength_bits("motdepasse") < 50 <= strength_bits("pivoine tracteur lagune moustache onze")


def test_linky_reads_the_2026_enedis_format(tmp_path):
    from collector.enedis import collect

    def handler(request: httpx.Request) -> httpx.Response:
        meta = {"idPrm": "12345678901234", "etapeMetier": "BRUT", "periode": {}, "typeValeur": "x", "pas": "P1D"}
        if request.url.path.endswith("puissance_conso_max_quotidienne"):
            points = [{"d": "2024-01-01T19:20:00+01:00", "v": "8120", "p": "P1D"}]
        else:
            points = [{"d": "2024-01-01", "v": "23500"}, {"d": "2024-01-02", "v": None}]
        return httpx.Response(200, json={**meta, "grandeur": [{"unite": "Wh", "points": points}], "contexte": {}})

    store = Store(tmp_path, "pw")
    http = httpx.Client(transport=httpx.MockTransport(handler))
    collect(store, "tok", "12345678901234", "2024-01-01", "Europe/Paris", http=http, min_interval=0)
    assert store.doc("linky")["daily"] == {"2024-01-01": 23500.0}
    assert store.doc("linky")["pmax"]["2024-01-01"] == 8.12


def test_sources_keep_last_success_and_failure():
    from collector.__main__ import Sources

    s = Sources({"linky": {"ok": "2026-01-01T00:00:00+00:00"}})
    s.ok("intuis")
    s.failed("linky", "HTTP 401 " + "x" * 300)
    assert s.state["intuis"]["ok"] == s.now
    assert s.state["linky"]["ok"] == "2026-01-01T00:00:00+00:00"
    assert s.state["linky"]["error"] == s.now and len(s.state["linky"]["message"]) == 160
    s.ok("linky")
    assert "message" not in s.state["linky"]


def test_settings_strip_pasted_whitespace(monkeypatch):
    monkeypatch.setenv("NETATMO_REFRESH_TOKEN", " abc|def \n")
    monkeypatch.setenv("INTUIS_USERNAME", "moi@example.com ")
    s = Settings.from_env()
    assert s.netatmo_refresh_token == "abc|def" and s.username == "moi@example.com"


def test_station_explains_which_credential_is_refused(tmp_path):
    from collector.station import Station, StationError

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_client"})

    st = Station(
        Store(tmp_path, "pw"), "id", "secret", "seed", http=httpx.Client(transport=httpx.MockTransport(handler))
    )
    with pytest.raises(StationError, match="NETATMO_CLIENT_ID"):
        st.login()


# ---------------------------------------------------------------- S-1.11 Linky load curve
def _curve_points(day: str, step: str = "PT30M", watts: int = 1000) -> list[dict]:
    """One day of points stamped at the END of each step, Enedis style (winter, +01:00)."""
    from datetime import datetime, timedelta

    minutes = int(step[2:-1])
    start = datetime.fromisoformat(f"{day}T00:00:00+01:00")
    return [
        {"d": (start + timedelta(minutes=minutes * (i + 1))).isoformat(), "v": str(watts), "p": step}
        for i in range(24 * 60 // minutes)
    ]


def test_load_curve_converts_watts_to_wh_for_30_and_10_minute_steps():
    from collector.enedis import parse_curve

    half = parse_curve({"grandeur": [{"points": _curve_points("2024-01-01", "PT30M", 1000)}]}, "Europe/Paris")
    assert len(half) == 48
    assert half["2024-01-01T00:00"] == 500.0  # 1000 W over 30 min, stamped 00:30 = start 00:00
    assert half["2024-01-01T23:30"] == 500.0
    ten = parse_curve({"grandeur": [{"points": _curve_points("2024-01-01", "PT10M", 600)}]}, "Europe/Paris")
    assert len(ten) == 48 and ten["2024-01-01T00:00"] == 300.0  # 3 × 600 W × 10 min
    # Point without step: 30 min assumed; UTC stamps converted to Paris time; bare days ignored.
    body = [{"date": "2024-07-01T10:00:00Z", "value": 2000}, {"d": "2024-07-01", "v": "9"}]
    assert parse_curve(body, "Europe/Paris") == {"2024-07-01T11:30": 1000.0}


def _curve_handler(calls: list, empty: bool = False):
    from datetime import date, timedelta

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/courbe_de_charge_consommation"
        assert request.headers["Authorization"] == "Bearer tok"
        start, end = request.url.params["dateDebut"], request.url.params["dateFin"]
        calls.append((start, end))
        points = []
        d = date.fromisoformat(start)
        while not empty and d < date.fromisoformat(end):
            points += _curve_points(d.isoformat())
            d += timedelta(days=1)
        return httpx.Response(200, json={"grandeur": [{"unite": "W", "points": points}]})

    return handler


# ------------------------------------------------------------------ station: hourly readings (S-11)
PARIS = "Europe/Paris"


def _ts(local: str) -> int:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    return int(datetime.fromisoformat(local).replace(tzinfo=ZoneInfo(PARIS)).timestamp())


def test_station_hourly_points_land_on_local_hours_across_dst():
    from zoneinfo import ZoneInfo

    from collector.station import local_hours

    zone = ZoneInfo(PARIS)
    # 2025-03-30: 01:00 UTC is 03:00 CEST, there is no 02 h local.
    spring = [(1743292800 + i * 3600, [10.0 + i, 50.0, 600.0]) for i in range(3)]  # 00:00 → 02:00 UTC
    hours = local_hours(spring, zone, indoor=True)
    assert sorted(hours) == ["2025-03-30T01", "2025-03-30T03", "2025-03-30T04"]
    assert hours["2025-03-30T03"] == [11.0, 50, 600]
    # 2025-10-26: 00:00 and 01:00 UTC are both 02 h local → averaged; timestamps mid-hour stay in it.
    autumn = [(1761436800 + 1800, [10.0, 60.0, 1000.0]), (1761440400 + 1800, [12.0, 70.0, 1200.0])]
    assert local_hours(autumn, zone, indoor=True) == {"2025-10-26T02": [11.0, 65, 1100]}
    # Outdoor module: never a CO₂ value, even if a column comes back.
    assert local_hours([(1761436800, [3.04, 88.4, 400.0])], zone, indoor=False) == {"2025-10-26T02": [3.0, 88, None]}


def _hourly_station(calls):
    """Mock: one main module (living room), kids' bedroom, outdoor. Hourly values depend on
    the local hour: the kids' CO₂ is 1600 ppm from 23 h to 2 h, 1200 at 22 h and 6 h, 600
    otherwise; the living room is 18 °C from 0 h to 5 h; outdoor is humid."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    zone = ZoneInfo(PARIS)

    def value(module, ts):
        h = datetime.fromtimestamp(ts, zone).hour
        if module == "out":
            return [5.0, 90.0]
        if module == "kids":
            co2 = 1600 if h in (23, 0, 1, 2) else 1200 if h in (22, 6) else 600
            return [19.5, 55.0, co2]
        return [18.0 if h < 6 else 20.0, 66.0 if h == 12 else 50.0, 700]

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "a", "refresh_token": "r"})
        if path == "/api/getstationsdata":
            modules = [
                {"_id": "out", "type": "NAModule1", "module_name": "Extérieur"},
                {"_id": "kids", "type": "NAModule4", "module_name": "Chambre enfants"},
                {"_id": "wind", "type": "NAModule2", "module_name": "Vent"},
            ]
            device = {"_id": "main", "type": "NAMain", "module_name": "Salon", "modules": modules}
            return httpx.Response(200, json={"body": {"devices": [device]}})
        if path == "/api/getmeasure":
            p = request.url.params
            module = p.get("module_id") or "main"
            if p["scale"] != "1hour":
                return httpx.Response(200, json={"body": {}})
            assert module != "wind"
            assert ("co2" in p["type"]) == (module != "out")
            begin, end = int(p["date_begin"]), int(p["date_end"])
            calls.append((module, begin, end))
            t0 = begin - begin % 3600
            values = [value(module, t) for t in range(t0, end, 3600)]
            return httpx.Response(200, json={"body": [{"beg_time": t0, "step_time": 3600, "value": values}]})
        return httpx.Response(404)

    return handler


def test_load_curve_backfills_by_7_days_then_only_missing_days(tmp_path):
    from datetime import date

    from collector.enedis import collect_curve

    calls: list = []
    store = Store(tmp_path, "pw")
    kw = {"http": httpx.Client(transport=httpx.MockTransport(_curve_handler(calls))), "min_interval": 0}
    n = collect_curve(store, "tok", "1", "2023-12-15", "Europe/Paris", today=date(2024, 1, 2), **kw)
    assert n == 18 * 48
    assert calls == [("2023-12-15", "2023-12-22"), ("2023-12-22", "2023-12-29"), ("2023-12-29", "2024-01-02")]
    assert store.doc("2023.linky30")["curve"]["2023-12-31T23:30"] == 500.0
    assert store.doc("linky")["curve_scan"] == "2024-01-01"
    store.merge("100", "2024-01-01", 1.0)
    store.save({"id": "h"}, [])
    assert store.meta["linky_curve_years"] == [2023, 2024] and store.meta["years"] == [2024]

    calls.clear()
    collect_curve(Store(tmp_path, "pw"), "tok", "1", "2023-12-15", "Europe/Paris", today=date(2024, 1, 3), **kw)
    assert calls == [("2023-12-31", "2024-01-03")]  # the last 3 days again, nothing older


def test_load_curve_initial_backfill_is_capped_to_a_year_and_tolerates_empty_answers(tmp_path):
    from datetime import date

    from collector.enedis import collect_curve

    calls: list = []
    kw = {"http": httpx.Client(transport=httpx.MockTransport(_curve_handler(calls, empty=True))), "min_interval": 0}
    store = Store(tmp_path, "pw")
    assert collect_curve(store, "tok", "1", "2020-01-01", "Europe/Paris", today=date(2024, 6, 1), **kw) == 0
    assert calls[0][0] == "2023-06-02" and len(calls) == 53
    # Empty answer (curve collection not enabled): not an error, and not asked again.
    calls.clear()
    collect_curve(store, "tok", "1", "2020-01-01", "Europe/Paris", today=date(2024, 6, 2), **kw)
    assert calls == [("2024-05-30", "2024-06-02")]
    assert store.linky_curve_years() == []


def test_sync_keeps_going_without_load_curve_consent_and_flags_expired_token(tmp_path, monkeypatch):
    import collector.enedis as enedis
    from collector.__main__ import Sources, _linky

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("courbe_de_charge_consommation"):
            return httpx.Response(403, json={"error": "no consent"})
        return httpx.Response(200, json={"grandeur": [{"points": [{"d": "2024-01-01", "v": "23500"}]}]})

    def refused(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "expired"})

    monkeypatch.setattr(enedis, "MIN_INTERVAL", 0)
    monkeypatch.setattr(enedis, "_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    store = Store(tmp_path, "pw")
    store.merge("100", "2024-01-01", 1.0)
    settings = Settings(enedis_token="tok", enedis_prm="1")
    sources = Sources(None)
    _linky(settings, store, "Europe/Paris", sources)
    assert sources.state["linky"]["ok"] and "auth_expired" not in sources.state["linky"]
    assert "HTTP 403" in sources.state["linky-30min"]["message"]
    assert store.doc("linky")["daily"]["2024-01-01"] == 23500.0
    assert "tok" not in json.dumps(sources.state)  # only a hash of the secret

    monkeypatch.setattr(enedis, "_client", lambda: httpx.Client(transport=httpx.MockTransport(refused)))
    _linky(settings, store, "Europe/Paris", sources)
    assert sources.state["linky"]["auth_expired"] is True
    assert any(a.startswith("Renouveler le jeton linky") for a in sources.alerts())


# ---------------------------------------------------------------- S-1.12 expiry reminders
def test_expiry_is_estimated_and_announced_30_days_ahead():
    import base64
    from datetime import date

    from collector.__main__ import LINKY_CONSENT_DAYS, Sources
    from collector.enedis import token_dates

    s = Sources(None)
    s.credential("linky", "secret-a")
    s.ok("linky")
    s.state["linky"]["since"] = "2023-12-01"
    s.expiry("linky", None, None, LINKY_CONSENT_DAYS)
    assert s.state["linky"]["expires"] == "2026-11-30" and s.state["linky"]["expires_estimated"]
    assert s.alerts(date(2026, 10, 1)) == []
    assert "dans 29 jours" in s.alerts(date(2026, 11, 1))[0]
    # A new token restarts the clock.
    s.credential("linky", "secret-b")
    assert "since" not in s.state["linky"] and "expires" not in s.state["linky"]
    # A JWT carrying exp gives the real date.
    payload = base64.urlsafe_b64encode(json.dumps({"iat": 1700000000, "exp": 1794700000}).encode()).decode()
    assert token_dates(f"h.{payload.rstrip('=')}.sig") == ("2023-11-14", "2026-11-14")
    assert token_dates("not-a-jwt") == (None, None)


def test_netatmo_invalid_grant_marks_the_token_expired(tmp_path):
    from collector.__main__ import Sources
    from collector.station import Station, StationError

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant"})

    st = Station(
        Store(tmp_path, "pw"), "id", "secret", "seed", http=httpx.Client(transport=httpx.MockTransport(handler))
    )
    with pytest.raises(StationError) as err:
        st.login()
    assert err.value.auth
    s = Sources(None)
    s.credential("netatmo", "seed")
    s.failed("netatmo", str(err.value), auth=err.value.auth)
    assert "NETATMO_REFRESH_TOKEN" in s.alerts()[0]
    s.ok("netatmo")
    assert s.alerts() == [] and s.state["netatmo"]["since"]


def test_station_hourly_backfills_a_year_in_chunks_then_three_days(tmp_path):
    from collector.station import DAY, HOURLY_CHUNK_DAYS, Station

    calls = []
    store = Store(tmp_path, "pw")
    station = Station(
        store,
        "id",
        "secret",
        "seed",
        http=httpx.Client(transport=httpx.MockTransport(_hourly_station(calls))),
        min_interval=0,
    )
    station.login()
    now = _ts("2026-01-15T12:00")
    station.collect_hourly(PARIS, now=now)
    for module in ("main", "kids", "out"):
        ranges = [(b, e) for m, b, e in calls if m == module]
        assert len(ranges) == 10  # 365 days / 40
        assert ranges[0][0] == now - 365 * DAY and ranges[-1][1] == now
        assert all(e - b <= HOURLY_CHUNK_DAYS * DAY for b, e in ranges)
        assert all(ranges[i][1] == ranges[i + 1][0] for i in range(len(ranges) - 1))
        assert all((e - b) // 3600 <= 1024 for b, e in ranges)
    # Stored per year and local hour; the outdoor module has no CO₂ (m0 main, m1 out, m2 kids).
    assert store.doc("2025.station_h")["hourly"]["m2"]["2025-12-01T23"] == [19.5, 55, 1600]
    assert store.doc("2026.station_h")["hourly"]["m1"]["2026-01-10T03"] == [5.0, 90, None]
    assert "m3" not in store.doc("2026.station_h")["hourly"]  # wind gauge: no hourly readings
    assert store.station_hourly_years() == [2025, 2026]

    # Next night: only the last 3 days.
    calls.clear()
    station.collect_hourly(PARIS, now=now + DAY)
    assert sorted(m for m, _b, _e in calls) == ["kids", "main", "out"]
    assert all(b == now - 2 * DAY and e == now + DAY for _m, b, e in calls)

    # Daily aggregates in the station document.
    doc = store.doc("station")
    night = doc["nightly"]["m2"]["2025-12-01"]  # 1 Dec 22:00 → 2 Dec 07:00
    assert night == {"n": 9, "co2_max": 1600, "h_co2_1000": 6, "h_co2_1400": 4, "h_co2_1500": 4}
    assert "m1" not in doc["nightly"]  # outdoor: no CO₂
    assert doc["hours"]["m0"]["2025-12-01"] == {"n": 24, "humid": 1, "cold": 6}
    assert doc["hours"]["m1"]["2025-12-01"] == {"n": 24, "humid": 24}  # outdoor: no « cold »

    # Saved: meta lists the years, yearly energy years are not polluted by "YYYY.station_h".
    store.save({"id": "h", "name": "n", "timezone": PARIS}, [])
    assert (tmp_path / "2025.station_h.enc.json").exists()
    assert store.meta["station_hourly_years"] == [2025, 2026]
    assert store.meta["years"] == []


def test_station_night_crosses_midnight_and_counts_thresholds(tmp_path):
    from datetime import date

    from collector.station import aggregate_days

    store = Store(tmp_path, "pw")
    # Night of 31 Dec 2025: 22 h and 23 h of the 31st, 0 h to 6 h of 1 Jan 2026 (other year
    # document); 7 h and 21 h fall outside.
    readings = {
        "2025-12-31T21": [18.0, 70, 2500],
        "2025-12-31T22": [18.5, 66, 1000],  # not above 1000
        "2025-12-31T23": [19.0, 60, 1001],
        "2026-01-01T00": [19.2, 60, 1400],
        "2026-01-01T01": [19.2, 60, 1401],
        "2026-01-01T03": [19.2, 60, 1501],
        "2026-01-01T06": [19.2, 60, None],
        "2026-01-01T07": [19.2, 60, 3000],
    }
    for hour, v in readings.items():
        store.put(f"{hour[:4]}.station_h", "hourly", "m2", hour, v)
    aggregate_days(store, "m2", True, date(2025, 12, 30), date(2026, 1, 1))
    nightly = store.doc("station")["nightly"]["m2"]
    assert nightly["2025-12-31"] == {"n": 5, "co2_max": 1501, "h_co2_1000": 4, "h_co2_1400": 2, "h_co2_1500": 1}
    assert "2025-12-30" not in nightly  # no reading that night
    assert "2026-01-01" not in nightly  # 7 h (3000 ppm) is morning, not night
    hours = store.doc("station")["hours"]["m2"]
    assert hours["2025-12-31"] == {"n": 3, "humid": 2, "cold": 2}  # 70, 66 > 65; 19.0 is not < 19
    assert hours["2026-01-01"] == {"n": 5, "humid": 0, "cold": 0}


# ---------------------------------------------------------------- S-12.1 shared contract
def test_contract_json_is_validated_without_quoting_values():
    from collector.__main__ import ContractError, parse_contract

    ok = (
        '[{"from": "2022-01-01", "offer": "edf-trv-hphc", "kva": 12},'
        ' {"from": "2025-10-14", "offer": "edf-trv-hphc", "kva": 9.0}]'
    )
    assert parse_contract(ok) == [
        {"from": "2022-01-01", "offer": "edf-trv-hphc", "kva": 12},
        {"from": "2025-10-14", "offer": "edf-trv-hphc", "kva": 9},
    ]
    p = lambda day, offer="edf-trv-base", kva="9": f'{{"from": "{day}", "offer": "{offer}", "kva": {kva}}}'  # noqa: E731
    bad = {
        "{": "illisible",
        "[]": "liste",
        p("2022-01-01"): "liste",
        f"[{p('2022-13-01')}]": "date",
        f"[{p('1/1/2022')}]": "date",
        f"[{p('2022-01-01', 'secret-offer')}]": "offre inconnue",
        f"[{p('2022-01-01', kva='10')}]": "puissance",
        f"[{p('2022-01-01', kva='true')}]": "puissance",
        f"[{p('2023-01-01')}, {p('2022-01-01')}]": "triées",
    }
    for raw, why in bad.items():
        with pytest.raises(ContractError, match=why) as err:
            parse_contract(raw)
        assert "secret-offer" not in str(err.value) and "2022-13-01" not in str(err.value)


def test_shared_contract_goes_into_the_encrypted_meta_and_only_a_count_in_the_summary(tmp_path, monkeypatch, capsys):
    from collector.__main__ import _job_summary, shared_contract

    store = Store(tmp_path, "pw")
    store.merge("100", "2024-01-01", 1.0)
    previous = [{"from": "2022-01-01", "offer": "edf-trv-hphc", "kva": 12}]
    monkeypatch.delenv("CONTRACT_JSON", raising=False)
    assert shared_contract(previous) is None  # variable removed: no shared contract any more
    monkeypatch.setenv("CONTRACT_JSON", "not json")
    assert shared_contract(previous) == previous  # invalid: keep the last good one
    assert "not json" not in capsys.readouterr().out
    monkeypatch.setenv(
        "CONTRACT_JSON",
        '[{"from": "2022-01-01", "offer": "edf-trv-hphc", "kva": 12},'
        ' {"from": "2025-10-14", "offer": "edf-trv-hphc", "kva": 9}]',
    )
    contract = shared_contract(None)
    store.save({"id": "h"}, [], {"contract": contract})
    assert Store(tmp_path, "pw").meta["contract"][1] == {"from": "2025-10-14", "offer": "edf-trv-hphc", "kva": 9}
    assert "2025-10-14" not in (tmp_path / "meta.enc.json").read_text()  # encrypted
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    _job_summary(store, Syncer(None, store), [])  # type: ignore[arg-type]
    text = summary.read_text()
    assert "| Contrat partagé | oui (2 périodes) |" in text
    assert "2025-10-14" not in text and "edf-trv" not in text


def test_renew_file_lists_only_what_must_be_renewed(tmp_path, monkeypatch):
    from collector.__main__ import Sources, write_renew_file

    path = tmp_path / "renew.txt"
    monkeypatch.setenv("RENEW_FILE", str(path))
    s = Sources(None)
    s.credential("netatmo", "seed-secret")
    s.failed("netatmo", "invalid_grant", auth=True)
    write_renew_file(s.alerts())
    text = path.read_text()
    assert text.startswith("- Renouveler le jeton netatmo") and text.count("\n") == 1
    assert "seed-secret" not in text
    s.ok("netatmo")
    write_renew_file(s.alerts())
    assert path.read_text() == ""
    monkeypatch.delenv("RENEW_FILE")
    write_renew_file(["x"])  # no file asked: nothing written, no error


def test_demo_shows_every_data_quality_case_and_the_contract(tmp_path):
    """S-1.8 / S-1.10: the demo has lost, estimated and suspect days, a contract and Linky."""
    from collector.__main__ import parse_contract
    from collector.demo import generate

    generate(tmp_path)
    s = Store(tmp_path, "demo")
    cov = s.doc("2024")["coverage"]
    assert cov["r-salon"]["2024-02"][2] == 18  # lost at Intuis, every room
    assert cov["r-ch1"]["2024-11"] == [30, 0, 0]  # the second gap touches two rooms only
    assert cov["r-salon"]["2024-11"][2] == 14
    assert "2024-02-20" not in s.year(2024)["r-salon"]
    assert s.doc("linky")["daily"]["2024-02-20"] > 20000  # the meter saw the lost day
    est = s.doc("2023")["estimated"]["r-salon"]
    assert sorted(est) == [f"2023-12-0{d}" for d in range(4, 9)]
    assert len({s.year(2023)["r-salon"][d] for d in est}) == 1  # spread evenly
    assert s.year(2025)["r-salon"]["2025-01-14"] < 0.3 * s.year(2025)["r-salon"]["2025-01-13"]
    assert parse_contract(json.dumps(s.meta["contract"])) == s.meta["contract"]
    assert s.meta["sources"]["linky"]["expires_estimated"] is True


def test_station_keys_stay_stable_when_a_module_is_added(tmp_path):
    from collector.station import Station

    store = Store(tmp_path, "pw")
    st = Station(store, "id", "secret", "tok", http=object())
    main = {"id": "70:ee", "module": None, "type": "NAMain"}
    out = {"id": "70:ee", "module": "02:aa", "type": "NAModule1"}
    kids = {"id": "70:ee", "module": "03:bb", "type": "NAModule4"}
    cellar = {"id": "70:ee", "module": "03:cc", "type": "NAModule4"}
    # First run after the change: keys follow today's order, like before.
    assert st.module_keys([main, out, kids, cellar]) == ["m0", "m1", "m2", "m3"]
    # A new indoor module listed in the middle by the API gets the next free key.
    new = {"id": "70:ee", "module": "03:dd", "type": "NAModule4"}
    assert st.module_keys([main, out, new, kids, cellar]) == ["m0", "m1", "m4", "m2", "m3"]
    # Still the same after a save and reload.
    store.save({"id": "h"}, [])
    st2 = Station(Store(tmp_path, "pw"), "id", "secret", "tok", http=object())
    assert st2.module_keys([cellar, new, main, out, kids]) == ["m3", "m4", "m0", "m1", "m2"]


def _changing_station(modules: list[dict], days: dict[str, list]):
    """Mock station whose radio module list (``modules``) and daily values per module id
    (``days``: id → [(ts, [min, max, mean, hum, co2?])]) can change between collects."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "a", "refresh_token": "r"})
        if path == "/api/getstationsdata":
            device = {"_id": "70:ee:50:00:00:01", "type": "NAMain", "module_name": "Salon", "modules": modules}
            return httpx.Response(200, json={"body": {"devices": [device]}})
        if path == "/api/getmeasure":
            p = request.url.params
            if p["scale"] == "1hour":
                return httpx.Response(200, json={"body": []})
            module = p.get("module_id") or "70:ee:50:00:00:01"
            begin, end = int(p["date_begin"]), int(p["date_end"])
            body = {str(ts): v for ts, v in days.get(module, []) if begin <= ts <= end}
            return httpx.Response(200, json={"body": body})
        return httpx.Response(404)

    return handler


def _day_ts(day: str) -> int:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    return int(datetime.fromisoformat(f"{day}T12:00").replace(tzinfo=ZoneInfo(PARIS)).timestamp())


def test_station_module_inserted_or_removed_keeps_every_key_and_history(tmp_path):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    from collector.station import Station

    today = datetime.now(ZoneInfo(PARIS)).date()
    d1, d2, d3 = ((today - timedelta(days=n)).isoformat() for n in (30, 20, 1))
    main, out, kids, cellar, new = (
        "70:ee:50:00:00:01",
        "02:00:00:00:00:aa",
        "03:00:00:00:00:bb",
        "03:00:00:00:00:cc",
        "03:00:00:00:00:dd",
    )
    mod = lambda i, t, n: {"_id": i, "type": t, "module_name": n}  # noqa: E731
    radio = [mod(out, "NAModule1", "Extérieur"), mod(kids, "NAModule4", "Chambre"), mod(cellar, "NAModule4", "Cave")]
    value = {main: 20.0, out: 5.0, kids: 19.0, cellar: 12.0, new: 17.0}
    days = {i: [(_day_ts(d1), [v - 1, v + 1, v, 50, 600])] for i, v in value.items() if i != new}
    store = Store(tmp_path, "pw")
    http = httpx.Client(transport=httpx.MockTransport(_changing_station(radio, days)))
    run = lambda: Station(store, "id", "secret", "seed", http=http, min_interval=0).collect(PARIS, d1)  # noqa: E731

    run()
    daily = store.doc("station")["daily"]
    before = {k: dict(v) for k, v in daily.items()}
    assert {k: v[d1][2] for k, v in before.items()} == {"m0": 20.0, "m1": 5.0, "m2": 19.0, "m3": 12.0}

    # The last free indoor module is installed and listed by the API in the middle.
    radio.insert(1, mod(new, "NAModule4", "Bureau"))
    for i, v in value.items():
        days.setdefault(i, []).append((_day_ts(d2), [v - 1, v + 1, v, 50, 600]))
    run()
    station = store.doc("station")
    daily = station["daily"]
    for k, hist in before.items():  # every existing key keeps its history, then its own new day
        assert daily[k][d1] == hist[d1]
        assert daily[k][d2][2] == hist[d1][2]
    assert daily["m4"] == {d2: [16.0, 18.0, 17.0, 50, 600]}  # the newcomer: next free key, own data only
    assert {k: m["name"] for k, m in station["modules"].items()} == {
        "m0": "Salon",
        "m4": "Bureau",
        "m1": "Extérieur",
        "m2": "Chambre",
        "m3": "Cave",
    }

    # The kids' module is removed: no key shifts, its history stays, the others go on.
    radio[:] = [m for m in radio if m["_id"] != kids]
    for i, v in value.items():
        days[i].append((_day_ts(d3), [v - 1, v + 1, v, 50, 600]))
    store.save({"id": "h"}, [])
    store = Store(tmp_path, "pw")
    run()
    station = store.doc("station")
    daily = station["daily"]
    assert {k: daily[k][d3][2] for k in ("m0", "m1", "m3", "m4")} == {"m0": 20.0, "m1": 5.0, "m3": 12.0, "m4": 17.0}
    assert d3 not in daily["m2"] and daily["m2"][d2][2] == 19.0
    assert "m2" not in station["modules"]
    # Next run: the removed module's older last day does not pull the others back to it.
    calls = []
    http = httpx.Client(transport=httpx.MockTransport(lambda r: calls.append(r) or _changing_station(radio, days)(r)))
    run()
    begins = [int(r.url.params["date_begin"]) for r in calls if r.url.params.get("scale") == "1day"]
    assert len(begins) == 4 and min(begins) >= _day_ts(d3) - 11 * 86400

    # Back again later: it finds its own key.
    radio.append(mod(kids, "NAModule4", "Chambre"))
    st = Station(store, "id", "secret", "seed", http=http, min_interval=0)
    assert st.module_keys(st.modules()) == ["m0", "m1", "m4", "m3", "m2"]

    # Module ids are never written in clear, only salted hashes.
    raw = json.dumps(store.doc("station"))
    assert not any(i in raw for i in value)
    assert set(station["module_keys"]) == {"salt", "keys"}


def test_station_key_map_of_the_previous_version_is_hashed_once(tmp_path):
    from collector.station import Station

    store = Store(tmp_path, "pw")
    # Written by the previous version: raw id → key, with a module added in the middle.
    store.set_top("station", "ids", {"main": "m0", "out": "m1", "new": "m2", "kids": "m3"})
    st = Station(store, "id", "secret", "tok", http=object())
    mods = [{"id": "main", "module": None}] + [{"id": "main", "module": i} for i in ("out", "kids", "new")]
    assert st.module_keys(mods) == ["m0", "m1", "m3", "m2"]
    assert "ids" not in store.doc("station")
    assert "kids" not in json.dumps(store.doc("station"))
