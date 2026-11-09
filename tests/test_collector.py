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
    assert cats == {"Salon": HEATING, "Chambre": HEATING, "Chauffe-eau": WATER_HEATER}


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
