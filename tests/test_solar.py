"""#204 + #356: the home's location (secret HOME_LOCATION_JSON) and its PVGIS production profile.

No network: PVGIS is simulated (httpx.MockTransport); the real call is in test_sources_reelles.py
(`pytest -m reseau`, public place). The end-to-end leak test of a failing PVGIS call is in
test_fuites.py (every source failing).
"""

import json
from datetime import date
from pathlib import Path

import httpx
import pytest

from collector import redact
from collector.budget import METER
from collector.solar import LocationError, PvgisError, collect, digest, hours_of, parse_location, pvgis_params
from collector.storage import Store

FIXTURE = json.loads((Path(__file__).resolve().parent.parent / "web/src/__fixtures__/home-location.json").read_text())
LOC = {
    "v": 1,
    "lat": 46.12345,
    "lon": 4.98765,
    "precision": 3,
    "commune": "Exempleville",
    "roofs": [
        {"name": "Grand abri", "azimuth": 135, "tilt": 15, "kwc": 3.6, "loss": 14},
        {"name": "Petit abri", "azimuth": 225, "tilt": 20, "kwc": 1.3, "loss": 16},
    ],
}


def pvgis_body(watts: float = 500.0) -> dict:
    hourly = []
    for doy in range(365):
        d = date.fromordinal(date(2023, 1, 1).toordinal() + doy)
        for h in range(24):
            hourly.append({"time": f"{d:%Y%m%d}:{h:02d}10", "P": watts if 9 <= h <= 14 else 0.0, "G(i)": 0.0})
    return {"inputs": {"meteo_data": {"radiation_db": "PVGIS-SARAH3"}}, "outputs": {"hourly": hourly}}


def client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture(autouse=True)
def _meter():
    METER.reset({"pvgis": 8})
    yield
    METER.reset()


@pytest.mark.parametrize("case", FIXTURE["valid"], ids=lambda c: str(c["out"]["lat"]))
def test_same_rule_as_the_app_valid(case):
    assert parse_location(case["in"]) == case["out"]
    assert parse_location(json.dumps(case["in"])) == case["out"]


@pytest.mark.parametrize("case", FIXTURE["invalid"])
def test_same_rule_as_the_app_invalid(case):
    with pytest.raises(LocationError):
        parse_location(case)


def test_location_errors_never_quote_a_value():
    with pytest.raises(LocationError) as err:
        parse_location({**LOC, "lat": 123.456789})
    assert "123" not in str(err.value)
    with pytest.raises(LocationError) as err:
        parse_location("{not json 46.12345")
    assert "46.12" not in str(err.value)


def test_third_parties_get_one_kilometre_and_the_pvgis_azimuth():
    p = pvgis_params(parse_location(LOC), LOC["roofs"][0])
    assert (p["lat"], p["lon"]) == ("46.12", "4.99")  # ≈ 1 km, whatever the precision stored
    assert p["aspect"] == -45  # south-east: 0 = south, −90 = east
    assert (p["angle"], p["loss"], p["peakpower"]) == (15, 14, 1)
    assert pvgis_params(parse_location(LOC), {**LOC["roofs"][0], "azimuth": 270})["aspect"] == 90


def test_collect_writes_the_encrypted_profile_once_per_location(tmp_path):
    asked = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(dict(request.url.params))
        return httpx.Response(200, json=pvgis_body())

    store = Store(tmp_path, "pw")
    note = collect(store, json.dumps(LOC), client(handler), today=date(2026, 11, 10))
    assert note == "2 toit(s), profil PVGIS mis à jour"
    assert [a["aspect"] for a in asked] == ["-45", "45"]
    assert all(a["lat"] == "46.12" for a in asked)
    doc = store.doc("solar")
    assert doc["location"]["lat"] == 46.123
    assert [r["kwc"] for r in doc["roofs"]] == [3.6, 1.3]
    assert doc["roofs"][0]["hours"]["06-21"][9] == 500.0
    assert doc["database"] == "PVGIS-SARAH3"
    assert doc["digest"] == digest(parse_location(LOC))
    # same location: no call
    assert collect(store, json.dumps(LOC), client(handler)) == "2 toit(s), profil déjà à jour"
    assert len(asked) == 2
    # another roof: asked again
    collect(store, json.dumps({**LOC, "roofs": LOC["roofs"][:1]}), client(handler))
    assert len(asked) == 3
    assert len(store.doc("solar")["roofs"]) == 1


def test_a_failing_pvgis_keeps_the_previous_profile_and_says_only_the_status(tmp_path):
    store = Store(tmp_path, "pw")
    collect(store, json.dumps(LOC), client(lambda r: httpx.Response(200, json=pvgis_body())))
    before = json.dumps(store.doc("solar"))
    with pytest.raises(PvgisError) as err:
        collect(
            store,
            json.dumps({**LOC, "commune": "Ailleurs"}),
            client(lambda r: httpx.Response(503, text=f"lat={r.url.params['lat']}")),
        )
    assert str(err.value) == "PVGIS : /api/v5_3/seriescalc → HTTP 503 (erreur du serveur)"
    assert json.dumps(store.doc("solar")) == before


def test_coordinates_are_masked_in_any_log_once_parsed(tmp_path):
    collect(Store(tmp_path, "pw"), json.dumps(LOC), client(lambda r: httpx.Response(200, json=pvgis_body())))
    line = "lat 46.123 lon 4.988 ; arrondi 46.12 / 4.99 ; Exempleville"
    out = redact.redact(line)
    for v in ("46.123", "4.988", "46.12", "4.99", "Exempleville"):
        assert v not in out, out


def test_a_short_answer_is_a_format_error():
    with pytest.raises(PvgisError):
        hours_of({"outputs": {"hourly": [{"time": "20230101:1210", "P": 1.0}]}})


def test_the_demo_profile_is_read_by_the_app_rules(tmp_path):
    from collector.demo import SOLAR_LOCATION, _solar

    store = Store(tmp_path, "demo")
    _solar(store, date(2026, 11, 9))
    doc = store.doc("solar")
    assert parse_location(SOLAR_LOCATION) == SOLAR_LOCATION
    assert {len(r["hours"]) for r in doc["roofs"]} == {365}
    yearly = [sum(sum(v) for v in r["hours"].values()) / 1000 for r in doc["roofs"]]
    assert all(800 < y < 1500 for y in yearly), yearly
