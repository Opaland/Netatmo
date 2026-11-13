"""#582: the reading a day of the Linky curve was stored with. The nightly collection and the
catch-up mark the days they write whole with the 2026 reading (#568); a day stored before, or
keeping one half hour of before, stays unmarked and is never read again nor rewritten. The marks
written here are held equal to web/src/__fixtures__/curve-read.json, which curve-day.test.ts reads
(A20: the app is tested on what the collector writes). Fictitious data only."""

import copy
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from collector.audit import Audit
from collector.enedis import CURVE_READING, catch_up_curve, collect_curve
from collector.rattrapage import Tally, public_lines
from collector.storage import Store

ROOT = Path(__file__).resolve().parent.parent
VECTOR = json.loads((ROOT / "web/src/__fixtures__/curve-read.json").read_text(encoding="utf-8"))
TZ = ZoneInfo("Europe/Paris")
TODAY = date.fromisoformat(VECTOR["today"])


def _days(first: str, last: str) -> list[str]:
    d, end, out = date.fromisoformat(first), date.fromisoformat(last), []
    while d <= end:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _handler(calls: list):
    """A 2026 answer (step at the top, one quantity), every half hour of the range, except those
    the vector says Enedis leaves out."""
    left_out = set(VECTOR["left_out"])

    def handler(request: httpx.Request) -> httpx.Response:
        p = request.url.params
        calls.append((p["dateDebut"], p["dateFin"]))
        points = []
        for day in _days(p["dateDebut"], (date.fromisoformat(p["dateFin"]) - timedelta(days=1)).isoformat()):
            start = datetime.fromisoformat(f"{day}T00:00:00").replace(tzinfo=TZ)
            for i in range(48):
                if (start + timedelta(minutes=30 * i)).strftime("%Y-%m-%dT%H:%M") in left_out:
                    continue
                points.append({"d": (start + timedelta(minutes=30 * (i + 1))).isoformat(), "v": "2000"})
        return httpx.Response(200, json={"pas": "PT30M", "grandeur": [{"unite": "W", "points": points}]})

    return handler


def _former(store: Store) -> None:
    """The archive as the collector left it before #582: whole days, no mark."""
    for day in VECTOR["former_days"]:
        for i in range(48):
            store.put(f"{day[:4]}.linky30", "curve", f"{day}T{i // 2:02d}:{30 * (i % 2):02d}", None, 1.0)
    store.set_top("linky", "curve_scan", (TODAY - timedelta(days=1)).isoformat())


def _night(store: Store, calls: list, tally: Tally) -> None:
    http = httpx.Client(transport=httpx.MockTransport(_handler(calls)))
    collect_curve(store, "tok", "1", VECTOR["first_day"], "Europe/Paris", http=http, min_interval=0, today=TODAY)
    catch_up_curve(
        store, "tok", "1", VECTOR["first_day"], "Europe/Paris", tally, http=http, min_interval=0, today=TODAY
    )


def test_the_night_and_the_catch_up_mark_only_the_days_they_write_whole(tmp_path):
    store = Store(tmp_path, "pw")
    _former(store)
    before = copy.deepcopy(store.doc("2026.linky30")["curve"])
    calls: list = []
    _night(store, calls, Tally())
    assert calls  # both asked Enedis
    doc = store.doc("2026.linky30")
    assert {"2026": doc.get("read")} == VECTOR["read"]
    assert set(VECTOR["read"]["2026"].values()) == {CURVE_READING}
    # the former days the night does not read again stay unmarked and keep their values; the one it
    # reads again whole is marked (2026-11-12)
    refresh_from = (TODAY - timedelta(days=3)).isoformat()
    assert [d for d in VECTOR["former_days"] if d < refresh_from and d in doc["read"]] == []
    assert [d for d in VECTOR["former_days"] if d >= refresh_from and d in doc["read"]] == ["2026-11-12"]
    for k, v in before.items():
        if k[:10] < refresh_from:
            assert doc["curve"][k] == v
    # the refreshed former day keeps the half hour Enedis left out, of the former reading: unmarked
    kept = [k for k in VECTOR["left_out"] if k in before]
    assert kept and all(doc["curve"][k] == before[k] for k in kept)


def test_a_second_night_changes_nothing(tmp_path):
    store = Store(tmp_path, "pw")
    _former(store)
    _night(store, [], Tally())
    first = copy.deepcopy(store.doc("2026.linky30"))
    _night(store, [], Tally())
    assert store.doc("2026.linky30") == first


def test_the_marks_reach_neither_the_public_log_nor_the_audit_findings(tmp_path):
    store = Store(tmp_path, "pw")
    _former(store)
    tally = Tally()
    _night(store, [], tally)
    lines = "\n".join(public_lines(tally))
    assert not any(d in lines for d in VECTOR["read"]["2026"])  # months and counts only
    audit = Audit({"2026.linky30": store.doc("2026.linky30")}, TZ, TODAY.isoformat()).run()
    assert not audit.errors
    assert not [f for f in audit.findings if "lecture 2026" in str(f)]
