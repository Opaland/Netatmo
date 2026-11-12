"""#469: the evenings the stove burnt, read in the per-room half hours (collector/stove.py). The
thresholds are calibrated on the demo, whose stove follows the owner's report; these tests keep
them between what the demo's noise and fires give, so a change of either breaks them."""

from datetime import date

import pytest

from collector import demo, stove
from collector.storage import Store

TODAY = date(2026, 11, 9)
TZ = "Europe/Paris"


@pytest.fixture(scope="module")
def demo_store(tmp_path_factory):
    out = tmp_path_factory.mktemp("demo")
    demo.generate(out, today=TODAY)
    return Store(out, "demo")


def _candidates():
    stopped = {s["room"] for s in demo.STOPPED}
    return [r for r, _n, c, _w, _sp in demo.ROOMS if c == demo.HEATING and r not in stopped]


def test_rise_min_sits_between_the_noise_and_the_fires(demo_store):
    """The rise of a room at 0 W after sunset: on the evenings without fire (noise) it stays under
    RISE_MIN; on the demo's fires, every neighbour reaches it, over MIN_SLOTS half hours at least.
    A thin sample on the noise side (about twenty evenings at 0 W without fire in six weeks of
    autumn): said in collector/stove.py. With a radiator heating, rises reach 1.1 °C (the bathroom's
    evening slot): that is why a witness must be at 0 W, checked below."""
    truth = demo.stove_evenings(demo_store, TODAY)
    r30 = stove.room30_of(demo_store)
    noise, fires, spans, heated = [], [], [], []
    for room in _candidates():
        for day, cols in r30.get(room, {}).items():
            d = date.fromisoformat(day)
            start = stove.evening_from(d, None, None, TZ)
            if d in truth and room in demo.STOVE_NEIGHBOURS:
                run = stove.witness_run(cols, start)
                fires.append(run[2] if run else 0.0)
                spans.append(run[1] if run else 0)
            elif (run := stove.witness_run(cols, start)) is not None:
                noise.append(run[2])
            if (any_energy := stove.witness_run([0, 0, *cols[2:]], start)) and d not in truth:
                heated.append(any_energy[2])
    assert len(fires) >= 20 and len(noise) >= 15
    assert max(noise) < stove.RISE_MIN <= min(fires)
    assert max(heated) > stove.RISE_MIN  # energy not looked at, the threshold alone would not do
    # the midpoint, as written in collector/stove.py (rises are multiples of the 0.1 °C reading)
    assert pytest.approx((round(max(noise), 1) + round(min(fires), 1)) / 2) == stove.RISE_MIN
    assert min(spans) >= stove.MIN_SLOTS


def test_the_demo_fires_are_found_and_nothing_else(demo_store):
    truth = {d.isoformat() for d in demo.stove_evenings(demo_store, TODAY)}
    found = demo_store.meta["stove_fires"]
    covered = {d for a, b in found["covered"] for d in _days(a, b)}
    assert set(found["fires"]) == truth & covered
    assert len(found["fires"]) >= 10
    # the kids' bedroom sends nothing from 5 November (out of reach): one neighbour left, the
    # evenings say nothing, fire or not (here, three fires the detection cannot see)
    assert not any(d >= demo.OFFLINE_ROOM[1].isoformat() for d in covered)
    assert {"2026-11-06", "2026-11-07", "2026-11-08"} <= truth
    for start, slots, witnesses, rise in found["fires"].values():
        assert 37 <= start <= 47 and slots >= stove.MIN_SLOTS and witnesses == 2 and rise >= 5


def _days(a: str, b: str) -> list[str]:
    from datetime import timedelta

    d, out = date.fromisoformat(a), []
    while d <= date.fromisoformat(b):
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _evening(rise: float = 1.5, *, start: int = 38, heating: bool = False, base: float = 19.0) -> list:
    """A day of half hours: radiator at 10 Wh all day, then 0 W from `start` (unless `heating`)
    while the room warms by `rise` over four half hours, and stays."""
    hp, temp = [10.0] * 48, [base] * 48
    for i in range(start, 48):
        hp[i] = 10.0 if heating else 0.0
        temp[i] = round(base + rise * min(1.0, (i - start) / 4), 1)
    return [hp, 0, temp, 19.0]


def _detect(rooms: dict[str, dict[str, list]], outdoor: dict | None = None) -> dict:
    return stove.detect_fires(rooms, list(rooms), outdoor or {}, 48.85, 2.35, TZ)


def test_a_fire_needs_two_rooms_at_0_w_that_warm_up():
    day = "2026-01-15"
    assert _detect({"a": {day: _evening()}, "b": {day: _evening()}})["fires"] == {day: [38, 4, 2, 15]}
    # one room alone: a shower, a door, someone in it
    one = _detect({"a": {day: _evening()}, "b": {day: _evening(0)}})
    assert one["fires"] == {}
    # a radiator heating: its warmth, not the stove's
    assert _detect({"a": {day: _evening()}, "b": {day: _evening(heating=True)}})["fires"] == {}
    # under RISE_MIN: noise
    assert _detect({"a": {day: _evening(0.4)}, "b": {day: _evening(0.4)}})["fires"] == {}
    assert _detect({"a": {day: _evening(0.5)}, "b": {day: _evening(0.5)}})["fires"] != {}


def test_before_sunset_the_sun_may_warm_the_rooms():
    # Paris, mid-January: sunset ≈ 17 h 20, the window opens at 17 h 30 (slot 35)
    assert stove.evening_from(date(2026, 1, 15), 48.85, 2.35, TZ) == 35
    day = "2026-01-15"
    afternoon = _evening(start=26)  # warms from 13 h, done by 15 h: before sunset
    assert _detect({"a": {day: afternoon}, "b": {day: afternoon}})["fires"] == {}


def test_sunset_of_known_places():
    # Paris: 21 December ≈ 16 h 56, 21 June ≈ 21 h 58 (heure légale)
    assert abs(stove.sunset_minutes(date(2026, 12, 21), 48.85, 2.35, TZ) - (16 * 60 + 56)) < 5
    assert abs(stove.sunset_minutes(date(2026, 6, 21), 48.85, 2.35, TZ) - (21 * 60 + 58)) < 5
    # no location: the latest sunset of mainland France that day, never earlier than Paris's
    for d in (date(2026, 1, 15), date(2026, 6, 21), date(2026, 10, 20)):
        assert stove.evening_from(d, None, None, TZ) >= stove.evening_from(d, 48.85, 2.35, TZ)


def test_a_mild_spell_is_neither_a_fire_nor_a_day_without():
    days = _days("2025-11-01", "2026-01-31")
    outdoor = {d: [0.0, 6.0, 3.0 + (i % 3) * 0.5] for i, d in enumerate(days)}
    outdoor["2026-01-15"] = [8.0, 14.0, 11.0]  # +8 °C in a day: far above the home's usual rises
    rooms = {r: {"2026-01-15": _evening(), "2026-01-16": _evening(), "2026-01-17": _evening(0)} for r in "ab"}
    out = _detect(rooms, outdoor)
    assert set(out["fires"]) == {"2026-01-16"}
    assert out["covered"] == [["2026-01-16", "2026-01-17"]]


def test_covered_only_where_two_neighbours_answered():
    """A day is covered (a fire would have been seen) when two rooms that witnessed a fire sent
    their evening: the bathroom far from the stove counts for nothing."""
    rooms = {
        "a": {"2026-01-15": _evening(), "2026-01-16": _evening(0), "2026-01-17": _evening(0)},
        "b": {"2026-01-15": _evening(), "2026-01-16": _evening(0)},
        "sdb": {"2026-01-15": _evening(0), "2026-01-16": _evening(0), "2026-01-17": _evening(0)},
    }
    out = _detect(rooms)
    assert out["covered"] == [["2026-01-15", "2026-01-16"]]
    assert set(out["fires"]) == {"2026-01-15"}
    # no fire ever: no neighbour known, nothing covered (the app keeps the degree days)
    assert _detect({"a": {"2026-01-16": _evening(0)}, "b": {"2026-01-16": _evening(0)}}) == {
        "v": 1,
        "covered": [],
        "fires": {},
    }


def test_the_collection_writes_nothing_to_the_log(capsys, tmp_path):
    from collector.__main__ import _stove_fires

    assert _stove_fires(Store(tmp_path, "x"), None, []) is None

    class Broken:
        rooms = [object()]
        latitude = longitude = None
        timezone = TZ

    store = Store(tmp_path, "x")
    store.put("2026.room30", "rooms", "r-secret", "2026-01-15", _evening())
    assert _stove_fires(store, Broken(), []) is None  # a broken room: warned by its type only
    out = capsys.readouterr()
    assert "r-secret" not in out.out + out.err and "19" not in out.out + out.err
