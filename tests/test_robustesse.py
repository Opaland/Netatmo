"""S-1.13 (format changes of the source APIs), S-1.14 (call counters and caps), #162 (homestatus keys)."""

import argparse
import json
from pathlib import Path

import httpx
import pytest

from collector import schema
from collector.api import IntuisClient
from collector.budget import METER, CallCapReached, Meter, caps_from_env
from collector.config import Settings
from collector.schema import FormatError
from collector.storage import Store
from collector.sync import Syncer

FIX = Path(__file__).parent / "fixtures"
SETTINGS = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")


def load(name):
    return json.loads((FIX / name).read_text())


@pytest.fixture(autouse=True)
def _fresh_meter():
    METER.reset()
    yield
    METER.reset()


def intuis(handler) -> IntuisClient:
    return IntuisClient(SETTINGS, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)


def intuis_handler(homesdata=None, measure=None):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=homesdata or load("homesdata.json"))
        if path == "/api/gethomemeasure":
            return httpx.Response(200, json=measure or load("gethomemeasure.json"))
        if path == "/syncapi/v1/homestatus":
            rooms = [
                {"id": "100", "name": "Salon", "open_window": False, "therm_measured_temperature": 19.5},
                {"id": "200", "reachable": True, "therm_setpoint_temperature": 21},
            ]
            modules = [{"id": "m1", "type": "NMH", "reachable": True, "2024-01-01": 3, "Salon détaillé": 1}]
            return httpx.Response(200, json={"body": {"home": {"id": "home1", "rooms": rooms, "modules": modules}}})
        return httpx.Response(404)

    return handler


# ---------------------------------------------------------------- S-1.13 reference schemas
def test_reference_schemas_accept_the_simulated_responses():
    schema.check("Intuis", "homesdata", schema.INTUIS_HOMESDATA, load("homesdata.json"))
    schema.check("Intuis", "gethomemeasure", schema.INTUIS_HOMEMEASURE, load("gethomemeasure.json"))
    schema.check("Intuis", "getroommeasure", schema.INTUIS_ROOMMEASURE, {"body": {"1704063600": [500]}})
    schema.check("Intuis", "getroommeasure", schema.INTUIS_ROOMMEASURE, {"body": []})
    schema.check("Netatmo", "getmeasure", schema.NETATMO_MEASURE, {"body": [{"beg_time": 1, "value": [[1.0]]}]})
    device = {"_id": "main", "type": "NAMain", "modules": [{"_id": "out", "type": "NAModule1"}]}
    schema.check("Netatmo", "getstationsdata", schema.NETATMO_STATIONS, {"body": {"devices": [device]}})
    daily = {"time": ["2024-01-01"], "temperature_2m_min": [1], "temperature_2m_max": [None]}
    schema.check("Open-Meteo", "archive", schema.OPEN_METEO_DAILY, {"daily": {**daily, "temperature_2m_mean": [2.5]}})


def test_no_data_is_not_a_format_change():
    schema.check("Intuis", "homesdata", schema.INTUIS_HOMESDATA, {"body": {"homes": []}})
    schema.check("Intuis", "gethomemeasure", schema.INTUIS_HOMEMEASURE, {"body": {"home": {"rooms": []}}})
    room = {"id": "100", "measures": None}
    schema.check("Intuis", "gethomemeasure", schema.INTUIS_HOMEMEASURE, {"body": {"home": {"rooms": [room]}}})


def test_renamed_field_names_source_endpoint_and_field_but_no_value():
    payload = load("homesdata.json")
    for room in payload["body"]["homes"][0]["rooms"]:
        room["room_id"] = room.pop("id")
    with pytest.raises(FormatError) as err:
        schema.check("Intuis", "/api/homesdata", schema.INTUIS_HOMESDATA, payload)
    assert (err.value.source, err.value.field) == ("Intuis", "body.homes[].rooms[].id")
    assert str(err.value) == (
        "Intuis : format de réponse inattendu (/api/homesdata), champ « body.homes[].rooms[].id » absent"
    )
    wrong_type = {"body": {"homes": [{"id": 12345, "rooms": []}]}}
    with pytest.raises(FormatError, match="body.homes\\[\\].id » n'est plus du type attendu \\(texte\\)") as err:
        schema.check("Intuis", "/api/homesdata", schema.INTUIS_HOMESDATA, wrong_type)
    assert "12345" not in str(err.value)


def test_intuis_format_change_stops_the_sync_instead_of_looking_like_no_data(tmp_path):
    # gethomemeasure: "home" renamed. Not an ApiError, so not swallowed as "this type does not answer".
    client = intuis(intuis_handler(measure={"body": {"maison": {"rooms": []}}}))
    with pytest.raises(FormatError, match="/api/gethomemeasure.*body.home » absent"):
        Syncer(client, Store(tmp_path, "pw")).run(days=10)


def test_sync_failure_on_format_change_writes_a_safe_job_summary(tmp_path, monkeypatch):
    import collector.__main__ as main

    payload = load("homesdata.json")
    payload["body"]["foyers"] = payload["body"].pop("homes")
    monkeypatch.setattr(main, "_client", lambda s: intuis(intuis_handler(homesdata=payload)))
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    with pytest.raises(FormatError):
        main.cmd_sync(Settings(passphrase="pw", data_dir=tmp_path / "data"), argparse.Namespace(days=10))
    text = summary.read_text()
    assert "## Collecte interrompue" in text and "Intuis" in text and "body.homes" in text
    assert "| intuis | 2 |" in text  # token + homesdata
    assert "Salon" not in text and "home1" not in text


def test_netatmo_format_change_is_reported_with_its_field(tmp_path):
    from collector.__main__ import Sources, _format_lines
    from collector.station import Station

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "a", "refresh_token": "r"})
        return httpx.Response(200, json={"body": {"devices": [{"id": "70:ee:50:00:00:01", "type": "NAMain"}]}})

    station = Station(
        Store(tmp_path, "pw"),
        "id",
        "s",
        "seed",
        http=httpx.Client(transport=httpx.MockTransport(handler)),
        min_interval=0,
    )
    with pytest.raises(FormatError) as err:
        station.collect("Europe/Paris", "2024-01-01")
    assert err.value.field == "body.devices[]._id" and "70:ee" not in str(err.value)
    sources = Sources(None)
    sources.error("netatmo", err.value)
    assert sources.state["netatmo"]["format"] == "/api/getstationsdata · body.devices[]._id"
    assert _format_lines(sources.state)[3] == "- ⚠️ netatmo : /api/getstationsdata · body.devices[]._id"
    sources.ok("netatmo")
    assert "format" not in sources.state["netatmo"] and _format_lines(sources.state) == []


def test_netatmo_token_without_refresh_token_is_a_format_change(tmp_path):
    from collector.station import Station

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"access_token": "a"})

    station = Station(
        Store(tmp_path, "pw"), "id", "s", "seed", http=httpx.Client(transport=httpx.MockTransport(handler))
    )
    with pytest.raises(FormatError, match="refresh_token » absent"):
        station.login()


def _linky(tmp_path, body):
    from collector.enedis import collect

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    http = httpx.Client(transport=httpx.MockTransport(handler))
    return collect(Store(tmp_path, "pw"), "tok", "1", "2024-01-01", "Europe/Paris", http=http, min_interval=0)


def test_linky_renamed_fields_are_a_format_change_but_an_empty_answer_is_not(tmp_path):
    renamed = {"grandeur": [{"unite": "Wh", "points": [{"jour": "2024-01-01", "wh": "12345"}]}]}
    with pytest.raises(FormatError) as err:
        _linky(tmp_path, renamed)
    assert "consommation_quotidienne" in str(err.value) and "champs vus : jour, wh" in str(err.value)
    assert "12345" not in str(err.value) and "2024-01-01" not in str(err.value)
    assert _linky(tmp_path, {"grandeur": [{"unite": "Wh", "points": []}]}) == 0
    # Known fields with a null value: no data, not a format change.
    assert _linky(tmp_path, {"grandeur": [{"points": [{"d": "2024-01-01", "v": None}]}]}) == 0


def test_linky_curve_format_change(tmp_path):
    from datetime import date

    from collector.enedis import collect_curve

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"interval_reading": [{"horodate": "2024-05-31 00:30:00", "w": "800"}]})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(FormatError, match="courbe_de_charge_consommation.*champs vus : horodate, w"):
        collect_curve(Store(tmp_path, "pw"), "t", "1", "2024-05-25", "Europe/Paris", http, 0, today=date(2024, 6, 1))


def test_open_meteo_format_change(tmp_path):
    from collector.weather import open_meteo

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"daily": {"date": ["2024-01-01"], "temperature_2m_min": [1.0]}})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(FormatError, match="Open-Meteo.*daily.time » absent"):
        open_meteo(Store(tmp_path, "pw"), 48.85, 2.35, "Europe/Paris", "2024-01-01", http=http)


# ---------------------------------------------------------------- S-1.14 call counters and caps
def test_meter_counts_calls_and_stops_at_the_cap(monkeypatch):
    m = Meter({"intuis": 2})
    for _ in range(2):
        with m.call("intuis"):
            pass
    with m.call("linky"):  # no cap for this source here
        pass
    with pytest.raises(CallCapReached, match="plafond de 2 appels.*MAX_CALLS_INTUIS"), m.call("intuis"):
        pass
    assert [(n, c, cap) for n, c, cap, _s in m.rows()] == [("intuis", 2, 2), ("linky", 1, None)]
    assert m.capped == {"intuis"}
    monkeypatch.setenv("MAX_CALLS_OPEN_METEO", "7")
    monkeypatch.setenv("MAX_CALLS_LINKY", "beaucoup")  # ignored
    caps = caps_from_env()
    assert caps["open-meteo"] == 7 and caps["linky"] == 200 and caps["intuis"] == 300
    assert caps_from_env(backfill=True)["intuis"] == 3000


def test_intuis_cap_stops_cleanly_saves_and_resumes_the_backfill_next_time(tmp_path, monkeypatch):
    import collector.__main__ as main

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CONTRACT_JSON", raising=False)
    monkeypatch.setattr(main, "_client", lambda s: intuis(intuis_handler()))
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.setenv("MAX_CALLS_INTUIS", "6")
    settings = Settings(passphrase="pw", data_dir=tmp_path / "data")
    main.cmd_sync(settings, argparse.Namespace(days=10))  # no exception: clean stop
    store = Store(tmp_path / "data", "pw")
    assert store.meta["backfill_pending"] is True
    assert "plafond de 6 appels" in store.meta["sources"]["intuis"]["message"]
    text = summary.read_text()
    assert "### Appels API" in text and "| intuis | 6 ⛔ | 6 |" in text

    # Next night, cap lifted: the backfill goes on and the flag is cleared.
    monkeypatch.delenv("MAX_CALLS_INTUIS")
    main.cmd_sync(settings, argparse.Namespace(days=10))
    store = Store(tmp_path / "data", "pw")
    assert "backfill_pending" not in store.meta
    assert store.year(2024)["100"]["2024-01-01"] == 1200.0
    assert "message" not in store.meta["sources"]["intuis"]  # success clears the cap message


def test_every_source_is_counted(tmp_path):
    from collector.weather import open_meteo

    def handler(request: httpx.Request) -> httpx.Response:
        daily = {
            "time": ["2024-01-01"],
            "temperature_2m_min": [1.0],
            "temperature_2m_max": [3.0],
            "temperature_2m_mean": [2.0],
        }
        return httpx.Response(200, json={"daily": daily})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    open_meteo(Store(tmp_path, "pw"), 48.85, 2.35, "Europe/Paris", "2024-01-01", http=http)
    Syncer(intuis(intuis_handler()), Store(tmp_path / "i", "pw")).run(days=10)
    counts = {n: c for n, c, _cap, _s in METER.rows()}
    assert counts["open-meteo"] == 2  # archive + forecast
    assert counts["intuis"] >= 3


# ---------------------------------------------------------------- #162 homestatus key names
def test_diagnose_prints_only_key_names_of_homestatus(capsys):
    from collector.diagnose import run, status_keys

    client = intuis(intuis_handler())
    keys = status_keys(client.homestatus("home1"))
    assert keys["rooms"] == ["id", "name", "open_window", "reachable", "therm_measured_temperature",
                             "therm_setpoint_temperature"]  # fmt: skip
    assert keys["modules"] == ["id", "reachable", "type"]  # date-like or free-text keys dropped
    run(client, status_only=True)
    out = capsys.readouterr().out
    assert "fenêtre ouverte : open_window présent" in out
    for secret in ("Salon", "19.5", "home1", "100", "m1", "2024-01-01"):
        assert secret not in out


def test_diagnose_without_open_window():
    from collector.diagnose import status_keys

    assert status_keys({"body": {"home": {"rooms": [{"id": "1"}]}}}) == {"rooms": ["id"], "modules": []}
    assert status_keys({}) == {"rooms": [], "modules": []}
