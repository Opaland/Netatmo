"""S-1.26 (#224, #217): per-room 30-min energy, temperature and setpoint, progressive history."""

import json
import logging
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from collector import room30
from collector.api import ApiError
from collector.budget import METER
from collector.model import Home, Room
from collector.storage import Store
from collector.sync import Syncer

PARIS = ZoneInfo("Europe/Paris")
TODAY = date(2026, 11, 9)
NOW = int(datetime(2026, 11, 9, 12, tzinfo=PARIS).timestamp())


@pytest.fixture(autouse=True)
def _fresh_meter():
    METER.reset()
    yield
    METER.reset()


def _home(rooms=("100", "200"), heater: str | None = None) -> Home:
    rs = [Room(id=r, name=f"Pièce {r}", category="heating", module_types=["NMH"]) for r in rooms]
    water = {}
    if heater:
        rs.append(Room(id=heater, name="Chauffe-eau", category="water_heater", module_types=["NMW"], virtual=True))
        water = {heater: heater}
    return Home(id="h", name="Maison", timezone="Europe/Paris", bridge_id="b", rooms=rs, water_heaters=water)


class FakeIntuis:
    """gethomemeasure at 30 min: energy $1 by day, $2 by night, a temperature that varies, a setpoint
    of 19 °C, for `depth` days back from NOW."""

    def __init__(self, depth: int = 100, fail: str | None = None) -> None:
        self.depth = depth
        self.fail = fail
        self.calls: list[tuple[str, tuple[str, ...], int, int]] = []

    def home_measure(self, home_id, bridge, rooms, *, measure_type, scale, date_begin, date_end, module_ids=None):
        assert scale == "30min"
        assert (date_end - date_begin) // 1800 < 1020, "one request stays under 1 024 points"
        self.calls.append((measure_type, tuple(rooms), date_begin, date_end))
        if self.fail and self.fail in measure_type:
            raise ApiError(endpoint="/api/gethomemeasure", status=400)
        if measure_type == room30.LEGACY_ENERGY:
            return {"body": {"home": {"rooms": []}}}
        first = max(date_begin, NOW - self.depth * 86400)
        first += -first % 1800
        out = []
        for rid in rooms:
            values = []
            for ts in range(first, min(date_end, NOW) + 1, 1800):
                h = datetime.fromtimestamp(ts, UTC).hour
                if measure_type == room30.ENERGY:
                    values.append([None, 100.0, None] if 6 <= h < 22 else [None, None, 50.0])
                else:
                    values.append([18.0 + (ts // 1800) % 4 * 0.5, 19.0])
            if values:
                out.append({"id": rid, "measures": [{"beg_time": first, "step_time": 1800, "value": values}]})
        return {"body": {"home": {"rooms": out}}}


def _run(store, client, home, max_calls=500, today=TODAY):
    syncer = Syncer(client, store)  # type: ignore[arg-type]
    return room30.collect(store, home, syncer._fetch_cols, "home", today, max_calls)


# ---------------------------------------------------------------- compact columns
def test_pack_and_unpack():
    assert room30.pack([None] * 48) is None
    assert room30.pack([0] * 48) == 0
    assert room30.pack([19.5] * 48) == 19.5
    col = [1] * 47 + [None]
    assert room30.pack(col) == col
    assert room30.unpack(19) == [19] * 48 and room30.unpack(None) == [None] * 48
    assert room30.unpack([1, 2]) == [1, 2] + [None] * 46


def _ts(y, m, d, h, mi=0):
    return int(datetime(y, m, d, h, mi, tzinfo=UTC).timestamp())


def test_spring_dst_day_leaves_the_missing_half_hours_empty():
    day = date(2026, 3, 29)  # 02:00 → 03:00 local
    start = int(datetime(2026, 3, 29, tzinfo=PARIS).timestamp())
    end = int(datetime(2026, 3, 30, tzinfo=PARIS).timestamp())
    pts = [(ts, [None, 10.0, None]) for ts in range(start, end, 1800)]
    temps = [(ts, [20.0, 19.0]) for ts in range(start, end, 1800)]
    days = room30.to_days(pts, temps, PARIS)
    assert list(days) == [day.isoformat()]
    hp, hc, t, sp = days[day.isoformat()]
    assert len(pts) == 46
    assert hp[4] is None and hp[5] is None and hp[3] == 10 and hp[6] == 10
    assert sum(v for v in hp if v) == 460
    assert hc[4] is None and hc[3] == 0 and t[4] is None and t[6] == 20


def test_autumn_dst_day_adds_energy_and_averages_temperature():
    # 2025-10-26: 02:00 CEST = 00:00 UTC, 02:00 CET = 01:00 UTC
    pts = [(_ts(2025, 10, 26, 0), [None, 100.0, None]), (_ts(2025, 10, 26, 1), [None, 60.0, 5.0])]
    temps = [(_ts(2025, 10, 26, 0), [20.0, 19.0]), (_ts(2025, 10, 26, 1), [19.0, 19.0])]
    hp, hc, t, sp = room30.to_days(pts, temps, PARIS)["2025-10-26"]
    assert hp[4] == 160 and hc[4] == 5 and t[4] == 19.5 and sp[4] == 19


def test_base_energy_counts_as_hp_and_legacy_families_keep_the_largest():
    ts = _ts(2026, 1, 5, 12)
    hp, hc, *_ = room30.to_days([(ts, [30.0, 20.0, None])], [], PARIS)["2026-01-05"]
    assert hp[26] == 50 and hc[26] == 0
    hp, hc, *_ = room30.to_days([(ts, [30.0, 80.0, None])], [], PARIS, legacy=True)["2026-01-05"]
    assert hp[26] == 80 and hc[26] == 0


def test_a_refetch_overwrites_without_adding(tmp_path):
    store = Store(tmp_path, "pw")
    cols = [[None] * 48 for _ in range(4)]
    cols[0][10] = 100
    cols[2] = [20.0] * 48
    room30.merge_day(store, "100", "2026-01-05", cols)
    room30.merge_day(store, "100", "2026-01-05", cols)
    hp, hc, t, sp = store.doc("2026.room30")["rooms"]["100"]["2026-01-05"]
    assert hp[10] == 100 and hc is None and t == 20.0 and sp is None


# ---------------------------------------------------------------- collection
def test_first_night_refreshes_then_backfills_within_its_budget_and_resumes(tmp_path, caplog):
    store = Store(tmp_path, "pw")
    client = FakeIntuis(depth=100)
    home = _home()
    caplog.set_level(logging.INFO)
    s1 = _run(store, client, home, max_calls=9)
    # refresh + backfill windows of 2 calls (energy, temperatures), stopped when 3 are no longer left
    assert s1.stopped and s1.calls == 8 and s1.windows == 4
    prog = store.doc("room30")["progress"]
    assert set(prog) == {"100", "200"} and not any(p["done"] for p in prog.values())
    reached = TODAY - timedelta(days=2 + 3 * room30.WINDOW_DAYS)
    assert prog["100"]["to"] == prog["200"]["to"] == reached.isoformat()
    # never a value, a name or an id in the log: counters only
    assert "Pièce" not in caplog.text and '"100"' not in caplog.text and "200" not in caplog.text
    store.save({"id": "h"}, [])
    again = Store(tmp_path, "pw")
    before = len(client.calls)
    s2 = _run(again, client, home, max_calls=500)
    assert not s2.stopped and s2.rooms_done == 2
    # resumed where it stopped: no window newer than the frontier asked again (refresh apart)
    frontier = int(datetime.combine(reached, datetime.min.time(), PARIS).timestamp())
    backfill = [c for c in client.calls[before:] if c[2] < frontier - 86400]
    assert backfill and all(c[3] < frontier for c in backfill)
    days = again.doc("2026.room30")["rooms"]["100"]
    first = (TODAY - timedelta(days=99)).isoformat()
    assert min(again.doc("2026.room30")["rooms"]["200"]) <= first
    hp, hc, t, sp = days["2026-10-01"]
    assert sp == 19 and isinstance(t, list) and sum(hp) + sum(hc) == 32 * 100 + 16 * 50
    # history done: the next night only refreshes
    n = len(client.calls)
    s3 = _run(again, client, home, max_calls=500, today=TODAY + timedelta(days=1))
    assert s3.windows == 1 and len(client.calls) - n <= 3


def test_a_new_room_is_backfilled_alone(tmp_path):
    store = Store(tmp_path, "pw")
    client = FakeIntuis(depth=40)
    _run(store, client, _home(("100",)))
    assert store.doc("room30")["progress"]["100"]["done"]
    n = len(client.calls)
    _run(store, client, _home(("100", "300")), today=TODAY + timedelta(days=1))
    rooms = {r for c in client.calls[n:] if c[2] < NOW - 5 * 86400 for r in c[1]}
    assert rooms == {"300"}
    assert store.doc("room30")["progress"]["300"]["done"]
    assert min(store.doc("2026.room30")["rooms"]["300"]) <= (TODAY - timedelta(days=39)).isoformat()


def test_stops_below_the_intuis_cap_of_the_collection(tmp_path):
    store = Store(tmp_path, "pw")
    METER.reset({"intuis": 30})
    METER.calls["intuis"] = 12  # already used by the daily sync
    s = _run(store, FakeIntuis(depth=1500), _home(), max_calls=500)
    assert s.stopped and s.calls <= 30 - 12 - room30.RESERVE


def test_the_whole_history_takes_a_few_nights(tmp_path):
    store = Store(tmp_path, "pw")
    client = FakeIntuis(depth=1460)
    nights = 0
    while True:
        nights += 1
        s = _run(store, client, _home(), max_calls=room30.DEFAULT_CALLS, today=TODAY + timedelta(days=nights - 1))
        if s.rooms_done == s.rooms:
            break
        assert nights < 10
    assert 2 <= nights <= 4
    assert store.room30_years()[0] == 2022


def test_an_unanswered_measure_does_not_stop_the_night(tmp_path):
    store = Store(tmp_path, "pw")
    _run(store, FakeIntuis(depth=10, fail="sum_energy_elec"), _home(("100",)))
    hp, hc, t, sp = store.doc("2026.room30")["rooms"]["100"]["2026-11-05"]
    assert hp is None and hc is None and sp == 19


def test_water_heater_module_is_read_at_module_level(tmp_path):
    store = Store(tmp_path, "pw")

    class WithModule(FakeIntuis):
        def home_measure(self, home_id, bridge, rooms, *, module_ids=None, **kw):
            body = super().home_measure(home_id, bridge, rooms, module_ids=module_ids, **kw)
            if module_ids and kw["measure_type"] == room30.ENERGY:
                pts = super().home_measure(home_id, bridge, module_ids, **kw)["body"]["home"]["rooms"]
                body["body"]["home"]["modules"] = pts
            return body

    client = WithModule(depth=5)
    _run(store, client, _home(("100",), heater="m1"))
    assert "m1" in store.doc("2026.room30")["rooms"]
    temps = [c for c in client.calls if c[0] == room30.TEMPS]
    assert all("m1" not in c[1] for c in temps)


def test_meta_lists_the_years_and_delete_room_resets_progress(tmp_path):
    store = Store(tmp_path, "pw")
    _run(store, FakeIntuis(depth=320), _home(("100",)))
    store.save({"id": "h"}, [])
    assert store.meta["room30_years"] == [2025, 2026]
    store.delete_room("100")
    assert "100" not in store.doc("room30")["progress"]
    assert "100" not in store.doc("2026.room30").get("rooms", {})


def test_a_year_of_seven_rooms_stays_under_the_size_budget(tmp_path):
    """Realistic year: heating on in winter only, temperature varying, setpoint changing twice a day."""
    store = Store(tmp_path, "pw")
    d = date(2025, 1, 1)
    while d.year == 2025:
        winter = d.month in (1, 2, 3, 4, 10, 11, 12)
        for r in range(7):
            hp = [((i * 37 + r * 11) % 250 if winter and 12 <= i < 44 else 0) for i in range(48)]
            hc = [((i * 53 + r) % 300 if winter and not 12 <= i < 44 else 0) for i in range(48)]
            t = [18 + ((i * 7 + r) % 40) / 10 for i in range(48)]
            sp = [19 if 14 <= i < 44 else 17 for i in range(48)] if winter else [7] * 48
            room30.merge_day(store, str(r), d.isoformat(), [hp, hc, t, sp])
        d += timedelta(days=1)
    store.save({"id": "h"}, [])
    size = (tmp_path / "2025.room30.enc.json").stat().st_size
    assert size < room30.DOC_BUDGET_BYTES
    assert room30.size_check(store, {"2025"}) == []
    print(f"2025.room30.enc.json, 7 pièces : {size / 1e6:.2f} Mo")
    assert json.loads((tmp_path / "2025.room30.enc.json").read_text())["v"] == 1
