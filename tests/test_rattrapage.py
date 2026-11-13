"""#569: the catch-up of the missing days ADDS the absent days a source still keeps, and never
rewrites a present one (real, estimated, or a day with at least one half hour). Fictitious data
only: the shapes (keys, units, holes) follow the collector and the public quality report."""

import copy
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from collector.api import IntuisClient
from collector.budget import METER
from collector.config import Settings
from collector.enedis import CURVE_SERIE, catch_up_curve
from collector.rattrapage import Tally, public_lines, run
from collector.station import STATION_SERIE, Station
from collector.storage import Store
from collector.sync import SERIES, Syncer

FIX = Path(__file__).parent / "fixtures"
TZ = ZoneInfo("Europe/Paris")
DAY = 86400
VALUE = 12345.6  # what the fake source answers for EVERY day it is asked, present days included


def _days(first: str, last: str) -> list[str]:
    d, end, out = date.fromisoformat(first), date.fromisoformat(last), []
    while d <= end:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _midnight(day: str) -> int:
    return int(datetime.fromisoformat(day).replace(tzinfo=TZ).timestamp())


# ---------------------------------------------------------------- Intuis
def _intuis(tmp_path, asked: list):
    """Fake Intuis: every room asked gets VALUE (as $1 + $2) for every day of the range."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if path == "/api/homesdata":
            return httpx.Response(200, json=json.loads((FIX / "homesdata.json").read_text()))
        if path == "/api/gethomemeasure":
            req = json.loads(request.content)
            rooms = [r["id"] for r in req["home"]["rooms"]]
            mtype = req["home"]["rooms"][0]["type"] if rooms else ""
            asked.append((mtype, req["date_begin"], req["date_end"], tuple(rooms)))
            first = datetime.fromtimestamp(req["date_begin"], TZ).date() + timedelta(days=1)
            last = datetime.fromtimestamp(req["date_end"] - 1, TZ).date()
            days = _days(first.isoformat(), last.isoformat())
            tariffs = mtype.startswith("sum_energy_elec$0")
            row = [None, VALUE - 1000, 1000] if tariffs else [0]
            measures = (
                [{"beg_time": _midnight(days[0]), "step_time": DAY, "value": [row for _ in days]}] if days else []
            )
            return httpx.Response(
                200, json={"body": {"home": {"id": "home1", "rooms": [{"id": r, "measures": measures} for r in rooms]}}}
            )
        return httpx.Response(404)

    settings = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
    client = IntuisClient(settings, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)
    syncer = Syncer(client, Store(tmp_path, "pw"))
    syncer.strategy = ("home", "ALL")
    return syncer


def _archive(store: Store) -> None:
    """Living room 100: January 2024 with a 3-day hole (4 → 6) and one estimated day (8);
    water heater 300: the same month with a hole on the 20th, and a day at 0 kWh (the 25th)."""
    store.meta["rooms"] = [
        {"id": "100", "name": "Salon", "category": "heating"},
        {"id": "200", "name": "Chambre", "category": "heating"},
        {"id": "300", "name": "Chauffe-eau", "category": "water_heater"},
    ]
    for d in _days("2024-01-01", "2024-01-31"):
        if d not in ("2024-01-04", "2024-01-05", "2024-01-06"):
            store.merge("100", d, 1000.0)
        store.merge("200", d, 2000.0)
        if d != "2024-01-20":
            store.merge("300", d, 0.0 if d == "2024-01-25" else 3000.0)
    store.put("2024", "estimated", "100", "2024-01-08", 1)
    store.put("2024", "tariffs", "100", "2024-01-03", [0.0, 600.0, 400.0])
    store.put("2024", "tariffs", "100", "2024-01-05", [0.0, 1.0, 2.0])  # tariffs kept, day lost


def test_catch_up_adds_only_the_missing_days_and_never_a_present_one(tmp_path):
    asked: list = []
    syncer = _intuis(tmp_path, asked)
    _archive(syncer.store)
    before = copy.deepcopy(syncer.store.doc("2024"))
    home = syncer.home()
    tally = run(syncer.store, syncer, home, [])
    after = syncer.store.doc("2024")
    added = {(rid, d) for rid, days in after["daily"].items() for d in days if d not in before["daily"].get(rid, {})}
    assert added == {("100", "2024-01-04"), ("100", "2024-01-05"), ("100", "2024-01-06"), ("300", "2024-01-20")}
    assert after["daily"]["100"]["2024-01-05"] == VALUE and after["daily"]["300"]["2024-01-20"] == VALUE
    # every day present before is exactly as it was: real, estimated, at 0 kWh, and its tariffs
    for rid, days in before["daily"].items():
        for d, v in days.items():
            assert after["daily"][rid][d] == v, (rid, d)
    assert after["estimated"] == before["estimated"]
    assert after["tariffs"]["100"]["2024-01-03"] == [0.0, 600.0, 400.0]
    assert after["tariffs"]["100"]["2024-01-05"] == [0.0, 1.0, 2.0]
    assert after["tariffs"]["100"]["2024-01-04"] == [0.0, VALUE - 1000, 1000.0]  # tariffs of an added day
    # only the rooms with a hole were asked, in one range (holes 14 days apart at most share it)
    assert {rooms for _t, _b, _e, rooms in asked} == {("100", "300")} and len(asked) == 4
    assert tally.months == {SERIES["heating"]: {"2024-01": [3, 3]}, SERIES["water"]: {"2024-01": [1, 1]}}


def test_catch_up_is_idempotent(tmp_path):
    asked: list = []
    syncer = _intuis(tmp_path, asked)
    _archive(syncer.store)
    home = syncer.home()
    run(syncer.store, syncer, home, [])
    snapshot = copy.deepcopy(syncer.store.doc("2024"))
    asked.clear()
    tally = run(syncer.store, syncer, home, [])
    assert asked == [] and tally.total_added() == 0
    assert syncer.store.doc("2024") == snapshot


def test_a_zero_is_not_added_and_a_stopped_room_is_not_asked(tmp_path):
    """A 0 may be a placeholder of the backend: the day stays missing. A room switched off on
    purpose (#346) has no missing day to ask."""

    def zero(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/gethomemeasure":
            req = json.loads(request.content)
            rooms = [r["id"] for r in req["home"]["rooms"]]
            first = datetime.fromtimestamp(req["date_begin"], TZ).date() + timedelta(days=1)
            measures = [{"beg_time": _midnight(first.isoformat()), "step_time": DAY, "value": [[0], [0], [0]]}]
            body = {"body": {"home": {"id": "home1", "rooms": [{"id": r, "measures": measures} for r in rooms]}}}
            return httpx.Response(200, json=body)
        if request.url.path == "/api/homesdata":
            return httpx.Response(200, json=json.loads((FIX / "homesdata.json").read_text()))
        return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})

    settings = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
    client = IntuisClient(settings, http=httpx.Client(transport=httpx.MockTransport(zero)), min_interval=0)
    syncer = Syncer(client, Store(tmp_path, "pw"))
    syncer.strategy = ("home", "sum_energy_elec")
    _archive(syncer.store)
    stopped = [{"room": "300", "from": "2024-01-15", "reason": "retires", "label": ""}]
    tally = run(syncer.store, syncer, syncer.home(), stopped)
    assert "2024-01-04" not in syncer.store.year(2024)["100"]
    assert tally.months == {SERIES["heating"]: {"2024-01": [3, 0]}}  # the water heater: not asked


def test_the_call_cap_stops_cleanly_and_keeps_what_was_added(tmp_path):
    asked: list = []
    syncer = _intuis(tmp_path, asked)
    _archive(syncer.store)
    home = syncer.home()
    METER.reset({"intuis": len(asked) + 1})  # homesdata done: one measure call left (of four families)
    try:
        tally = run(syncer.store, syncer, home, [])
    finally:
        METER.reset()
    assert "plafond" in tally.notes[SERIES["heating"]]
    assert tally.total_added() == 0  # the four families are needed to pick the largest: nothing half-read


# ---------------------------------------------------------------- Netatmo station
def _station(tmp_path, calls: list) -> Station:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/getstationsdata":
            modules = [{"_id": "kids", "type": "NAModule4", "module_name": "Chambre"}]
            device = {"_id": "main", "type": "NAMain", "module_name": "Salon", "modules": modules}
            return httpx.Response(200, json={"body": {"devices": [device]}})
        if request.url.path == "/api/getmeasure":
            p = request.url.params
            begin, end = int(p["date_begin"]), int(p["date_end"])
            calls.append((p.get("module_id") or "main", begin, end))
            # a generous source: one day more on each side of the range (present days, never rewritten)
            first = (datetime.fromtimestamp(begin, TZ).date() - timedelta(days=1)).isoformat()
            last = (datetime.fromtimestamp(end - 1, TZ).date() + timedelta(days=1)).isoformat()
            days = _days(first, last)
            value = [[1.0, 9.0, 5.0, 50, 900] for _ in days]
            return httpx.Response(
                200, json={"body": [{"beg_time": _midnight(days[0]), "step_time": DAY, "value": value}]}
            )
        return httpx.Response(404)

    st = Station(
        Store(tmp_path, "pw"), "id", "secret", "seed", http=httpx.Client(transport=httpx.MockTransport(handler))
    )
    st.api.min_interval = 0
    st.access = "token"
    return st


def test_station_catch_up_fills_the_hole_of_one_module_only(tmp_path):
    calls: list = []
    st = _station(tmp_path, calls)
    keys = st.module_keys(st.modules())  # m0 = main, m1 = the bedroom module
    row = [18.0, 21.0, 19.5, 45, 600]
    for d in _days("2026-01-01", "2026-01-31"):
        st.store.put("station", "daily", keys[0], d, row)
        if d not in ("2026-01-10", "2026-01-11", "2026-01-12"):
            st.store.put("station", "daily", keys[1], d, row)
    before = copy.deepcopy(st.store.doc("station")["daily"])
    calls.clear()
    tally = Tally()
    st.catch_up("Europe/Paris", tally)
    after = st.store.doc("station")["daily"]
    assert after[keys[0]] == before[keys[0]]  # no hole: not even asked
    assert [c[0] for c in calls] == ["kids"]
    assert set(after[keys[1]]) - set(before[keys[1]]) == {"2026-01-10", "2026-01-11", "2026-01-12"}
    assert after[keys[1]]["2026-01-11"] == [1.0, 9.0, 5.0, 50, 900]
    assert all(after[keys[1]][d] == row for d in before[keys[1]])
    assert tally.months == {STATION_SERIE: {"2026-01": [3, 3]}}
    calls.clear()
    st.catch_up("Europe/Paris", Tally())  # idempotent
    assert calls == []


# ---------------------------------------------------------------- Linky load curve
def _curve_handler(calls: list, refuse: dict | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        p = request.url.params
        calls.append((p["dateDebut"], p["dateFin"]))
        code = (refuse or {}).get(p["dateDebut"][:7])
        if code:
            return httpx.Response(code, json={"error": "x"})
        points = []
        # a generous source: the day before the range too (a present day, never rewritten)
        first = (date.fromisoformat(p["dateDebut"]) - timedelta(days=1)).isoformat()
        for day in _days(first, (date.fromisoformat(p["dateFin"]) - timedelta(days=1)).isoformat()):
            start = datetime.fromisoformat(f"{day}T00:00:00").replace(tzinfo=TZ)
            for i in range(1, 49):
                points.append({"d": (start + timedelta(minutes=30 * i)).isoformat(), "v": "2000", "p": "PT30M"})
        return httpx.Response(200, json={"grandeur": [{"unite": "W", "points": points}]})

    return handler


def test_linky_curve_catch_up_goes_back_24_months_and_skips_present_days(tmp_path):
    store = Store(tmp_path, "pw")
    today = date(2026, 1, 20)
    # the curve exists from 2025-12-01 (first night), with one half hour on 2025-11-15 (partial day)
    for d in _days("2025-12-01", "2026-01-19"):
        store.put(f"{d[:4]}.linky30", "curve", f"{d}T12:00", None, 111.0)
    store.put("2025.linky30", "curve", "2025-11-15T08:00", None, 222.0)
    before = {y: copy.deepcopy(store.doc(f"{y}.linky30")) for y in (2025, 2026)}
    calls: list = []
    tally = Tally()
    http = httpx.Client(transport=httpx.MockTransport(_curve_handler(calls)))
    catch_up_curve(store, "tok", "1", "2022-10-01", "Europe/Paris", tally, http=http, min_interval=0, today=today)
    assert calls[0][0] == "2024-01-21"  # 730 days before today, not the first day of the archive
    asked = {d for b, e in calls for d in _days(b, (date.fromisoformat(e) - timedelta(days=1)).isoformat())}
    assert "2025-11-15" not in asked and "2025-12-01" not in asked and max(asked) == "2025-11-30"
    curve25 = store.doc("2025.linky30")["curve"]
    assert curve25["2025-11-15T08:00"] == 222.0 and "2025-11-15T09:00" not in curve25  # partial day untouched
    assert curve25["2025-11-14T09:00"] == 1000.0  # 2000 W over 30 min
    for y, doc in before.items():
        for k, v in doc["curve"].items():
            assert store.doc(f"{y}.linky30")["curve"][k] == v
    assert sum(c[1] for c in tally.months[CURVE_SERIE].values()) == len(asked)


def test_linky_curve_refusals_are_noted_with_their_code_only(tmp_path):
    today = date(2026, 1, 20)
    calls: list = []
    tally = Tally()
    http = httpx.Client(transport=httpx.MockTransport(_curve_handler(calls, {"2024-01": 400, "2024-02": 400})))
    store = Store(tmp_path, "pw")
    catch_up_curve(store, "tok", "1", "2022-10-01", "Europe/Paris", tally, http=http, min_interval=0, today=today)
    assert tally.notes[CURVE_SERIE] == "refus d'Enedis dès 2024-01 (HTTP 400)"
    assert tally.months[CURVE_SERIE]["2024-03"][1] > 0  # the next ranges were still asked and added
    calls.clear()
    tally = Tally()
    http = httpx.Client(transport=httpx.MockTransport(_curve_handler(calls, {"2024-01": 401})))
    catch_up_curve(
        Store(tmp_path / "b", "pw"),
        "tok",
        "1",
        "2022-10-01",
        "Europe/Paris",
        tally,
        http=http,
        min_interval=0,
        today=today,
    )
    assert len(calls) == 1  # a refused token: stop at once


# ---------------------------------------------------------------- public log
def test_public_lines_hold_counts_and_months_only(tmp_path):
    asked: list = []
    syncer = _intuis(tmp_path, asked)
    _archive(syncer.store)
    tally = run(syncer.store, syncer, syncer.home(), [])
    tally.note(CURVE_SERIE, "refus d'Enedis dès 2024-01 (HTTP 400)")
    text = "\n".join(public_lines(tally))
    assert "chauffage (pièces-jours) : 3 ajoutés sur 3 demandés (2024-01 3/3)" in text
    assert "chauffe-eau (jours) : 1 ajoutés sur 1 demandés (2024-01 1/1)" in text
    for secret in ("Salon", "Chambre", "Chauffe-eau", "100", "300", "home1", "12345", "2024-01-04"):
        assert secret not in text
    assert not re.search(r"\d{4}-\d{2}-\d{2}", text)  # never a day, the month at most
    assert public_lines(Tally())[-1].endswith("aucun jour manquant dans les séries suivies.")


# ---------------------------------------------------------------- wiring
def test_the_collection_runs_the_catch_up_only_when_the_case_is_ticked(tmp_path, monkeypatch):
    """Case « rattrapage » of collect.yml → RATTRAPAGE on the step « Collecte » → `_catch_up`."""
    import collector.__main__ as main

    wf = (Path(__file__).parent.parent / ".github" / "workflows" / "collect.yml").read_text()
    assert re.search(r"\n      rattrapage:\n        description: .+\n        type: boolean\n        default: false", wf)
    step = wf.split("- name: Collecte\n", 1)[1].split("- name:", 1)[0]
    assert "RATTRAPAGE: ${{ inputs.rattrapage && 'true' || '' }}" in step
    assert "run: python -m collector -v ${{ inputs.backfill && 'backfill' || 'sync' }}" in step
    src = Path(main.__file__).read_text()
    assert '_catch_up(s, store, syncer, kept) if _flag("RATTRAPAGE") else []' in src
    asked: list = []
    syncer = _intuis(tmp_path, asked)
    _archive(syncer.store)
    syncer.last_home = syncer.home()  # as the night's collection (Syncer.run) does
    lines = main._catch_up(Settings(), syncer.store, syncer, {})
    assert any("chauffage (pièces-jours) : 3 ajoutés sur 3 demandés" in line for line in lines), lines
